// Native (Android APK) layer — only active when running inside the Capacitor app.
// On the website this file does nothing (isNative = false).
//
// Reminders are scheduled as real Android alarms (AlarmManager via LocalNotifications),
// so they ring / vibrate / pop up even when the app is closed or the phone is locked.
import { Capacitor, registerPlugin } from "./vendor/capacitor-core.js";

export const isNative = Capacitor.isNativePlatform();
const LN = isNative ? registerPlugin("LocalNotifications") : null; // used for the notification permission
const Alarm = isNative ? registerPlugin("DaybookAlarm") : null;    // our native alarm-clock reminders
const App = isNative ? registerPlugin("App") : null;

const MAX_SCHEDULED = 60; // keep well under Android's per-app alarm limit

/** Call once at start-up. onAction(action, taskId) with action = "open" | "done" | "snooze". */
export async function initNative({ onAction, onBack }) {
  if (!isNative) return;
  try {
    // Buttons on the alarm screen / notification open the app with an action.
    await Alarm.addListener("alarmAction", (e) => {
      const action = e.action === "done" || e.action === "snooze" ? e.action : "open";
      if (e.taskId && e.taskId !== "test") onAction(action, e.taskId);
    });
    // Older builds scheduled through LocalNotifications — clear those so nothing rings twice.
    const old = (await LN.getPending()).notifications || [];
    if (old.length) await LN.cancel({ notifications: old.map((n) => ({ id: n.id })) });
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

/** Ask for: notifications, exact alarms ("Alarms & reminders") and full-screen pop-ups. */
export async function requestNativeAlerts() {
  const p = await LN.requestPermissions();
  if (p.display !== "granted") return { ok: false };
  let exact = (await LN.checkExactNotificationSetting()).exact_alarm === "granted";
  if (!exact) exact = (await LN.changeExactNotificationSetting()).exact_alarm === "granted";
  let fullScreen = (await Alarm.canFullScreen()).granted;
  if (!fullScreen) {
    await Alarm.openFullScreenSettings();
    fullScreen = (await Alarm.canFullScreen()).granted;
  }
  return { ok: true, exact, fullScreen };
}

/** Rings a test alarm a few seconds from now (lock the phone to see the full-screen alarm). */
export async function testNativeAlarm(seconds = 5) {
  await Alarm.test({ delaySeconds: seconds, title: "Test reminder", body: "This is how Daybook reminds you." });
}

// Stable 31-bit number from a Firestore id (Android needs int ids).
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
  const now = Date.now();
  const alarms = tasks
    .filter((t) => !t.completed && !t.reminded && t.reminderAt && t.reminderAt.toDate().getTime() > now + 2000)
    .sort((a, b) => a.reminderAt.toDate() - b.reminderAt.toDate())
    .slice(0, MAX_SCHEDULED)
    .map((t) => ({
      id: idFor(t.id),
      taskId: t.id,
      title: t.title,
      body: formatDue(dueDate(t)) + (t.notes ? " — " + t.notes : ""),
      at: t.reminderAt.toDate().getTime(),
      sound: !!t.alerts?.sound,
      vibrate: !!t.alerts?.vibrate,
      popup: !!t.alerts?.popup,
    }));
  await Alarm.schedule({ alarms });
}

export async function clearNative() {
  if (!isNative) return;
  try { await Alarm.cancelAll(); } catch {}
}

/** Silence a reminder that is ringing (after Done / Snooze in the app). */
export async function dismissNative(taskId) {
  if (!isNative) return;
  try { await Alarm.stop({ id: idFor(taskId) }); } catch {}
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
