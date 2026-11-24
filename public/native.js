// Native (Android APK) layer — only active when running inside the Capacitor app.
// On the website this file does nothing (isNative = false).
//
// Reminders are scheduled as real Android alarms (AlarmManager via LocalNotifications),
// so they ring / vibrate / pop up even when the app is closed or the phone is locked.
import { Capacitor, registerPlugin } from "./vendor/capacitor-core.js";

export const isNative = Capacitor.isNativePlatform();
const LN = isNative ? registerPlugin("LocalNotifications") : null;
const App = isNative ? registerPlugin("App") : null;

const MAX_SCHEDULED = 60; // keep well under Android's per-app alarm limit
let exactAllowed = false;

// One Android "channel" per alert combination. Channel = how the phone alerts.
//   sound  -> plays res/raw/daybook_alarm.wav
//   vibrate-> vibration on/off
//   popup  -> importance 5 (heads-up banner over other apps) vs 3 (status bar only)
function channelFor(alerts = {}) {
  const s = alerts.sound ? 1 : 0, v = alerts.vibrate ? 1 : 0, p = alerts.popup ? 1 : 0;
  return `daybook_s${s}v${v}p${p}`;
}
const COMBOS = [];
for (const s of [0, 1]) for (const v of [0, 1]) for (const p of [0, 1]) if (s || v || p) COMBOS.push({ s, v, p });
const LABEL = ({ s, v, p }) => [s && "Ring", v && "Vibrate", p && "Popup"].filter(Boolean).join(" + ");

/** Call once at start-up. onAction(action, taskId) with action = "open" | "done" | "snooze". */
export async function initNative({ onAction, onBack }) {
  if (!isNative) return;
  try {
    for (const c of COMBOS) {
      await LN.createChannel({
        id: `daybook_s${c.s}v${c.v}p${c.p}`,
        name: `Reminders — ${LABEL(c)}`,
        description: `Task reminders that ${LABEL(c).toLowerCase()}`,
        importance: c.p ? 5 : 3,
        visibility: 1,
        vibration: !!c.v,
        lights: true,
        lightColor: "#1F6F5C",
        ...(c.s ? { sound: "daybook_alarm.wav" } : {}), // no sound file = silent channel
      });
    }
    await LN.registerActionTypes({
      types: [{ id: "TASK", actions: [{ id: "done", title: "✓ Done" }, { id: "snooze", title: "Snooze 10 min" }] }],
    });
    await LN.addListener("localNotificationActionPerformed", (e) => {
      const taskId = e.notification?.extra?.taskId;
      const action = e.actionId === "done" || e.actionId === "snooze" ? e.actionId : "open";
      if (taskId) onAction(action, taskId);
    });
    exactAllowed = (await LN.checkExactNotificationSetting()).exact_alarm === "granted";
  } catch (e) {
    console.warn("Native init failed", e);
  }
  // Android back button: close an open dialog first, otherwise leave the app.
  App?.addListener("backButton", () => {
    if (onBack && onBack()) return;
    App.minimizeApp?.().catch(() => App.exitApp());
  });
}

export async function nativeAlertsOn() {
  if (!isNative) return false;
  try { return (await LN.checkPermissions()).display === "granted"; } catch { return false; }
}

/** Ask for notification permission and the "Alarms & reminders" permission (exact timing). */
export async function requestNativeAlerts() {
  const p = await LN.requestPermissions();
  if (p.display !== "granted") return { ok: false };
  let exact = (await LN.checkExactNotificationSetting()).exact_alarm === "granted";
  if (!exact) {
    exact = (await LN.changeExactNotificationSetting()).exact_alarm === "granted";
  }
  exactAllowed = exact;
  return { ok: true, exact };
}

// Stable 31-bit number from a Firestore id (Android notification ids must be ints).
function idFor(taskId) {
  let h = 0;
  for (let i = 0; i < taskId.length; i++) h = (Math.imul(31, h) + taskId.charCodeAt(i)) | 0;
  return (h & 0x7fffffff) || 1;
}

let syncTimer = null;
/** Re-schedule all upcoming reminders to match the task list (debounced). */
export function scheduleNative(tasks, { formatDue, dueDate }) {
  if (!isNative) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => doSchedule(tasks, { formatDue, dueDate }).catch((e) => console.warn("schedule", e)), 400);
}

async function doSchedule(tasks, { formatDue, dueDate }) {
  if ((await LN.checkPermissions()).display !== "granted") return;
  const now = Date.now();
  const upcoming = tasks
    .filter((t) => !t.completed && !t.reminded && t.reminderAt && t.reminderAt.toDate().getTime() > now + 2000)
    .sort((a, b) => a.reminderAt.toDate() - b.reminderAt.toDate())
    .slice(0, MAX_SCHEDULED);

  const pending = (await LN.getPending()).notifications || [];
  if (pending.length) await LN.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
  if (!upcoming.length) return;

  const res = await LN.schedule({
    notifications: upcoming.map((t) => ({
      id: idFor(t.id),
      title: "⏰ " + t.title,
      body: formatDue(dueDate(t)) + (t.notes ? " — " + t.notes : ""),
      largeBody: t.notes || undefined,
      schedule: { at: t.reminderAt.toDate(), allowWhileIdle: true },
      channelId: channelFor(t.alerts),
      sound: t.alerts?.sound ? "daybook_alarm.wav" : undefined,
      actionTypeId: "TASK",
      extra: { taskId: t.id },
      autoCancel: true,
      foreground: !!t.alerts?.popup,
      isExactNotification: exactAllowed, // never pops the settings screen during a background sync
    })),
  });
  if (res?.warning) console.warn(res.warning);
}

export async function clearNative() {
  if (!isNative) return;
  try {
    const pending = (await LN.getPending()).notifications || [];
    if (pending.length) await LN.cancel({ notifications: pending.map((n) => ({ id: n.id })) });
    await LN.removeAllDeliveredNotifications();
  } catch {}
}

/** Remove a reminder that is showing in the notification shade (after Done / Snooze in the app). */
export async function dismissNative(taskId) {
  if (!isNative) return;
  try { await LN.removeDeliveredNotificationsById({ ids: [idFor(taskId)] }); } catch {}
}

// ---------- Google sign-in inside the APK ----------
// Google blocks its sign-in page inside app web views, so the APK uses Android's own
// account picker (Credential Manager) and hands the resulting ID token to Firebase.
let social = null;
let socialReady = null;
export function nativeGoogleReady(webClientId) {
  if (!isNative || !webClientId || webClientId.startsWith("PASTE")) return false;
  if (!social) {
    social = registerPlugin("SocialLogin");
    socialReady = social.initialize({ google: { webClientId, mode: "online" } });
  }
  return true;
}
/** Shows the Google account picker; resolves to an ID token for Firebase. */
export async function nativeGoogleIdToken() {
  await socialReady;
  const res = await social.login({ provider: "google", options: { scopes: ["email", "profile"] } });
  const idToken = res?.result?.idToken;
  if (!idToken) throw new Error("Google didn’t return a sign-in token. Please try again.");
  return idToken;
}
export async function nativeGoogleLogout() {
  if (!social) return;
  try { await socialReady; await social.logout({ provider: "google" }); } catch {}
}
