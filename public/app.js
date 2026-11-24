// Daybook Tasks — PWA to-do list with Firebase Auth + Firestore + reminders (alarm / vibrate / popup)
// Firebase is bundled locally (public/vendor/firebase.js) so the app also starts offline.
import {
  initializeApp,
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile,
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy,
  serverTimestamp, Timestamp, increment,
  getMessaging, getToken, isSupported,
} from "./vendor/firebase.js";
import { firebaseConfig, VAPID_KEY } from "./firebase-config.js";
import { firstOccurrence, nextFutureOccurrence, describeRepeat } from "./recurrence.js";
import { isNative, initNative, nativeAlertsOn, requestNativeAlerts, scheduleNative, clearNative, dismissNative } from "./native.js";

// ---------- Firebase ----------
const fbApp = initializeApp(firebaseConfig);
const auth = getAuth(fbApp);
const db = initializeFirestore(fbApp, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), // works offline
});

// ---------- State ----------
let user = null;
let tasks = [];
let unsubTasks = null;
let filter = "pending";
let editingId = null;
let swReg = null;
let firstSnapshot = true;
const pendingUrlAction = readUrlAction();

const $ = (id) => document.getElementById(id);
const TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;
let pendingNativeAction = null;

initNative({
  onAction: (action, taskId) => {
    if (tasks.length) runNotifAction(action, taskId);
    else pendingNativeAction = { action, taskId }; // app was launched from the notification
  },
  onBack: () => {
    for (const id of ["alarmDialog", "taskDialog"]) {
      if ($(id).open) { id === "alarmDialog" ? Alarm.stop() : $(id).close(); return true; }
    }
    return false;
  },
});

// ---------- Service worker + install ----------
if (isNative) document.documentElement.classList.add("native");
if (!isNative && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js", { scope: "./" }).then((r) => (swReg = r)).catch(console.error);
  navigator.serviceWorker.addEventListener("message", onSwMessage);
}
let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstall = e;
  $("installBtn").classList.remove("hidden");
});
$("installBtn").onclick = async () => {
  if (!deferredInstall) return;
  deferredInstall.prompt();
  await deferredInstall.userChoice;
  deferredInstall = null;
  $("installBtn").classList.add("hidden");
};

// ======================================================================
// AUTH
// ======================================================================
let authMode = "login";
document.querySelectorAll("[data-auth-tab]").forEach((b) =>
  b.addEventListener("click", () => {
    authMode = b.dataset.authTab;
    document.querySelectorAll("[data-auth-tab]").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".signup-only").forEach((x) => x.classList.toggle("hidden", authMode !== "signup"));
    $("authSubmit").textContent = authMode === "login" ? "Log in" : "Create account";
    $("authPassword").autocomplete = authMode === "login" ? "current-password" : "new-password";
    showAuthError("");
  })
);

$("authForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  Alarm.unlock();
  const email = $("authEmail").value.trim();
  const pass = $("authPassword").value;
  $("authSubmit").disabled = true;
  try {
    if (authMode === "login") {
      await signInWithEmailAndPassword(auth, email, pass);
    } else {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      const name = $("authName").value.trim();
      if (name) await updateProfile(cred.user, { displayName: name });
      await setDoc(doc(db, "users", cred.user.uid), { email, name, createdAt: serverTimestamp() }, { merge: true });
    }
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  } finally {
    $("authSubmit").disabled = false;
  }
});

$("forgotBtn").onclick = async () => {
  const email = $("authEmail").value.trim();
  if (!email) return showAuthError("Type your email above first, then tap “Forgot password?”.");
  try {
    await sendPasswordResetEmail(auth, email);
    showAuthError("");
    toast("Password reset link sent to " + email);
  } catch (err) {
    showAuthError(friendlyAuthError(err));
  }
};

$("logoutBtn").onclick = async () => {
  if (confirm("Log out of Daybook Tasks?")) { await clearNative(); await signOut(auth); }
};

function showAuthError(msg) {
  $("authError").textContent = msg;
  $("authError").classList.toggle("hidden", !msg);
}
function friendlyAuthError(err) {
  const map = {
    "auth/invalid-credential": "Wrong email or password.",
    "auth/invalid-email": "That email address doesn’t look right.",
    "auth/user-not-found": "No account with that email. Try Sign up.",
    "auth/wrong-password": "Wrong password.",
    "auth/email-already-in-use": "An account already exists with this email. Try Log in.",
    "auth/weak-password": "Password must be at least 6 characters.",
    "auth/too-many-requests": "Too many attempts. Please wait a minute and try again.",
    "auth/network-request-failed": "No internet connection.",
  };
  return map[err.code] || err.message;
}

onAuthStateChanged(auth, (u) => {
  user = u;
  if (unsubTasks) { unsubTasks(); unsubTasks = null; }
  if (!u) {
    tasks = [];
    $("appView").classList.add("hidden");
    $("authView").classList.remove("hidden");
    return;
  }
  $("authView").classList.add("hidden");
  $("appView").classList.remove("hidden");
  $("helloText").textContent = `Hello, ${u.displayName || u.email.split("@")[0]}`;
  firstSnapshot = true;
  const q = query(collection(db, "users", u.uid, "tasks"), orderBy("dueAt", "asc"));
  unsubTasks = onSnapshot(q, (snap) => {
    tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    render();
    checkReminders();
    scheduleNative(tasks, { formatDue, dueDate });
    if (firstSnapshot) {
      firstSnapshot = false;
      handleUrlAction();
    }
  }, (err) => toast("Sync error: " + err.message));
  refreshNotifButton();
  if (!isNative && notifGranted()) registerPushToken(); // keep token fresh
});

// ======================================================================
// RENDER
// ======================================================================
document.querySelectorAll("[data-filter]").forEach((b) =>
  b.addEventListener("click", () => {
    filter = b.dataset.filter;
    document.querySelectorAll("[data-filter]").forEach((x) => x.classList.toggle("active", x === b));
    render();
  })
);

const dueDate = (t) => (t.dueAt?.toDate ? t.dueAt.toDate() : new Date(t.dueAt));
const isRepeat = (t) => t.repeat && t.repeat.type !== "none";
const sameDay = (a, b) => a.toDateString() === b.toDateString();

function render() {
  const now = new Date();
  const list = $("taskList");
  list.innerHTML = "";

  let shown = tasks;
  if (filter === "pending") shown = tasks.filter((t) => !t.completed);
  if (filter === "today") shown = tasks.filter((t) => !t.completed && dueDate(t) <= endOfDay(now));
  if (filter === "repeat") shown = tasks.filter((t) => !t.completed && isRepeat(t));
  if (filter === "done") shown = tasks.filter((t) => t.completed).sort((a, b) => (b.completedAt?.seconds || 0) - (a.completedAt?.seconds || 0));

  const pending = tasks.filter((t) => !t.completed);
  const overdueCount = pending.filter((t) => dueDate(t) < now).length;
  const todayCount = pending.filter((t) => sameDay(dueDate(t), now)).length;
  $("summaryText").textContent =
    `${pending.length} pending · ${todayCount} today` + (overdueCount ? ` · ${overdueCount} overdue` : "");

  $("emptyState").classList.toggle("hidden", shown.length > 0);
  if (!shown.length) return;

  if (filter === "done") {
    shown.forEach((t) => list.appendChild(taskEl(t, now)));
    return;
  }
  const groups = [
    ["Overdue", shown.filter((t) => dueDate(t) < now), "overdue"],
    ["Today", shown.filter((t) => dueDate(t) >= now && sameDay(dueDate(t), now))],
    ["Tomorrow", shown.filter((t) => sameDay(dueDate(t), addDays(now, 1)))],
    ["Later", shown.filter((t) => dueDate(t) > endOfDay(addDays(now, 1)))],
  ];
  for (const [label, items, cls] of groups) {
    if (!items.length) continue;
    const h = document.createElement("div");
    h.className = "group-title " + (cls || "");
    h.textContent = `${label} (${items.length})`;
    list.appendChild(h);
    items.forEach((t) => list.appendChild(taskEl(t, now)));
  }
}

function taskEl(t, now) {
  const due = dueDate(t);
  const el = document.createElement("div");
  const overdue = !t.completed && due < now;
  el.className = "task" + (t.completed ? " done" : "") + (overdue ? " is-overdue" : "");

  const check = document.createElement("button");
  check.className = "check";
  check.setAttribute("aria-label", t.completed ? "Mark as not done" : "Mark as done");
  check.textContent = "✓";
  check.onclick = () => (t.completed ? reopenTask(t) : completeTask(t));

  const body = document.createElement("div");
  body.className = "task-body";
  body.onclick = () => openEditor(t);

  const title = document.createElement("div");
  title.className = "task-title";
  title.textContent = t.title;
  body.appendChild(title);
  if (t.notes) {
    const n = document.createElement("div");
    n.className = "task-notes";
    n.textContent = t.notes;
    body.appendChild(n);
  }
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.appendChild(badge(formatDue(due), overdue ? "overdue" : ""));
  if (isRepeat(t)) meta.appendChild(badge("🔁 " + describeRepeat(t.repeat), "repeat"));
  if (t.remindBefore >= 0 && !t.completed) {
    const icons = [t.alerts?.sound && "🔊", t.alerts?.vibrate && "📳", t.alerts?.popup && "💬"].filter(Boolean).join(" ");
    meta.appendChild(badge("⏰ " + (t.remindBefore ? beforeLabel(t.remindBefore) : "on time") + (icons ? " " + icons : "")));
  }
  if (t.timesDone) meta.appendChild(badge(`Done ${t.timesDone}×`));
  body.appendChild(meta);

  el.append(check, body);
  return el;
}
function badge(text, cls = "") {
  const b = document.createElement("span");
  b.className = "badge " + cls;
  b.textContent = text;
  return b;
}

// ======================================================================
// TASK EDITOR
// ======================================================================
const dlg = $("taskDialog");
$("fab").onclick = () => openEditor(null);
dlg.querySelectorAll("[data-close]").forEach((b) => (b.onclick = () => dlg.close()));
$("fRepeat").onchange = syncDaysPicker;
$("fBefore").onchange = () => ($("alertsBox").disabled = $("fBefore").value === "-1");

function syncDaysPicker() {
  const weekly = $("fRepeat").value === "weekly";
  $("daysPicker").classList.toggle("hidden", !weekly);
  if (weekly && !dayBoxes().some((c) => c.checked)) {
    const d = $("fDate").value ? new Date($("fDate").value + "T00:00") : new Date();
    dayBoxes().forEach((c) => (c.checked = Number(c.value) === d.getDay()));
  }
}
const dayBoxes = () => [...$("daysPicker").querySelectorAll("input")];

function openEditor(t) {
  Alarm.unlock();
  editingId = t?.id || null;
  $("taskDialogTitle").textContent = t ? "Edit task" : "New task";
  $("deleteTaskBtn").classList.toggle("hidden", !t);
  $("taskError").classList.add("hidden");

  const due = t ? dueDate(t) : roundUpHour(new Date());
  $("fTitle").value = t?.title || "";
  $("fNotes").value = t?.notes || "";
  $("fDate").value = toDateInput(due);
  $("fTime").value = toTimeInput(due);
  $("fRepeat").value = t?.repeat?.type || "none";
  dayBoxes().forEach((c) => (c.checked = !!t?.repeat?.days?.includes(Number(c.value))));
  $("fBefore").value = String(t?.remindBefore ?? 0);
  $("fSound").checked = t ? !!t.alerts?.sound : true;
  $("fVibrate").checked = t ? !!t.alerts?.vibrate : true;
  $("fPopup").checked = t ? !!t.alerts?.popup : true;
  $("alertsBox").disabled = $("fBefore").value === "-1";
  syncDaysPicker();
  dlg.showModal();
  if (!t) setTimeout(() => $("fTitle").focus(), 50);
}

$("taskForm").addEventListener("submit", async (e) => {
  e.preventDefault();
  const repeatType = $("fRepeat").value;
  const repeat = { type: repeatType };
  if (repeatType === "weekly") {
    repeat.days = dayBoxes().filter((c) => c.checked).map((c) => Number(c.value)).sort();
    if (!repeat.days.length) return showTaskError("Pick at least one day for the weekly repeat.");
  }
  let due = new Date(`${$("fDate").value}T${$("fTime").value}`);
  if (isNaN(due)) return showTaskError("Please choose a valid date and time.");
  if (repeatType === "monthly") repeat.dayOfMonth = due.getDate();
  due = firstOccurrence(due, repeat);

  const remindBefore = Number($("fBefore").value);
  const alerts = { sound: $("fSound").checked, vibrate: $("fVibrate").checked, popup: $("fPopup").checked };
  if (remindBefore >= 0 && !alerts.sound && !alerts.vibrate && !alerts.popup) {
    return showTaskError("Choose at least one alert type, or set “No reminder”.");
  }
  const data = {
    title: $("fTitle").value.trim(),
    notes: $("fNotes").value.trim(),
    repeat,
    remindBefore,
    alerts,
    tz: TZ,
    ...scheduleFields(due, remindBefore),
    updatedAt: serverTimestamp(),
  };
  try {
    const col = collection(db, "users", user.uid, "tasks");
    if (editingId) await updateDoc(doc(col, editingId), data);
    else await addDoc(col, { ...data, completed: false, timesDone: 0, createdAt: serverTimestamp() });
    dlg.close();
    toast(editingId ? "Task updated" : "Task added");
    if (remindBefore >= 0 && !(isNative ? await nativeAlertsOn() : notifGranted())) {
      setTimeout(() => toast("Tip: tap 🔔 Enable alerts so reminders can reach you."), 1800);
    }
  } catch (err) {
    showTaskError(err.message);
  }
});

$("deleteTaskBtn").onclick = async () => {
  if (!editingId || !confirm("Delete this task?")) return;
  await deleteDoc(doc(db, "users", user.uid, "tasks", editingId));
  dlg.close();
  toast("Task deleted");
};
function showTaskError(m) {
  $("taskError").textContent = m;
  $("taskError").classList.remove("hidden");
}

/** dueAt + reminderAt + reminded flag, used by both the app and the server reminder function. */
function scheduleFields(due, remindBefore) {
  const hasReminder = remindBefore >= 0;
  const reminderAt = new Date(due.getTime() - Math.max(remindBefore, 0) * 60000);
  return {
    dueAt: Timestamp.fromDate(due),
    reminderAt: hasReminder ? Timestamp.fromDate(reminderAt) : null,
    reminded: !hasReminder || reminderAt.getTime() < Date.now() - 60000, // don't ring for times already past
  };
}

// ---------- complete / reopen ----------
async function completeTask(t) {
  dismissNative(t.id);
  const ref = doc(db, "users", user.uid, "tasks", t.id);
  if (isRepeat(t)) {
    // Repeating task: log it and move it to the next date (e.g. next Monday/Tuesday)
    const next = nextFutureOccurrence(dueDate(t), t.repeat);
    await updateDoc(ref, {
      ...scheduleFields(next, t.remindBefore),
      timesDone: increment(1),
      lastDoneAt: serverTimestamp(),
    });
    toast(`Done! Next: ${formatDue(next)}`);
  } else {
    await updateDoc(ref, { completed: true, completedAt: serverTimestamp(), reminded: true });
    toast("Task completed ✓");
  }
}
async function reopenTask(t) {
  await updateDoc(doc(db, "users", user.uid, "tasks", t.id), {
    completed: false, completedAt: null, ...scheduleFields(dueDate(t), t.remindBefore),
  });
}

// ======================================================================
// REMINDERS (in-app scheduler)
// ======================================================================
setInterval(checkReminders, 10_000);
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkReminders());

const firingNow = new Set();
async function checkReminders() {
  if (!user) return;
  const now = Date.now();
  for (const t of tasks) {
    if (t.completed || t.reminded || !t.reminderAt || firingNow.has(t.id)) continue;
    const at = t.reminderAt.toDate().getTime();
    if (at > now) continue;
    firingNow.add(t.id);
    try {
      await updateDoc(doc(db, "users", user.uid, "tasks", t.id), { reminded: true, remindedBy: "app" });
      // App: the Android alarm already rang, so only ring in-app if it is due right now and you're looking.
      const ringWindow = isNative ? 90_000 : 6 * 3600_000;
      if (now - at < ringWindow && (!isNative || document.visibilityState === "visible")) fireAlert(t);
    } finally {
      firingNow.delete(t.id);
    }
  }
}

function fireAlert(t) {
  const alerts = t.alerts || { sound: true, vibrate: true, popup: true };
  Alarm.start(t, alerts);
  const pageHidden = document.visibilityState !== "visible";
  if (!isNative && notifGranted() && (pageHidden || !alerts.popup)) {
    showSystemNotification(t, alerts);
  }
}

async function showSystemNotification(t, alerts) {
  const reg = swReg || (await navigator.serviceWorker?.ready);
  const opts = {
    body: `${formatDue(dueDate(t))}${t.notes ? " — " + t.notes : ""}`,
    tag: t.id,
    renotify: true,
    requireInteraction: true,
    icon: "./icons/icon-192.png",
    badge: "./icons/badge-96.png",
    silent: !alerts.sound && !alerts.vibrate, // "silent" would also block vibration
    vibrate: alerts.vibrate ? [400, 200, 400, 200, 800] : undefined,
    data: { taskId: t.id },
    actions: [{ action: "done", title: "✓ Done" }, { action: "snooze", title: "Snooze 10 min" }],
  };
  try {
    if (reg) await reg.showNotification("⏰ " + t.title, opts);
    else new Notification("⏰ " + t.title, opts);
  } catch (e) { console.warn(e); }
}

async function snoozeTask(taskId, minutes) {
  dismissNative(taskId);
  const at = new Date(Date.now() + minutes * 60000);
  await updateDoc(doc(db, "users", user.uid, "tasks", taskId), { reminderAt: Timestamp.fromDate(at), reminded: false });
  toast(`Snoozed until ${at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`);
}

// ---------- Alarm: sound + vibration + popup ----------
const Alarm = {
  ctx: null, loop: null, current: null, queue: [],
  unlock() {
    // Browsers only allow sound after the user has tapped something — we prime audio on first taps.
    try {
      if (!this.ctx) this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      if (this.ctx.state === "suspended") this.ctx.resume();
    } catch {}
  },
  beep() {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== "running") return;
    const t0 = ctx.currentTime;
    [0, 0.22, 0.44].forEach((o, i) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = "square";
      osc.frequency.value = i === 2 ? 1175 : 880;
      g.gain.setValueAtTime(0.0001, t0 + o);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + o + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + o + 0.18);
      osc.connect(g).connect(ctx.destination);
      osc.start(t0 + o);
      osc.stop(t0 + o + 0.2);
    });
  },
  start(task, alerts) {
    if (this.current) {
      if (this.current.task.id !== task.id && !this.queue.some((q) => q.task.id === task.id)) this.queue.push({ task, alerts });
      return;
    }
    this.current = { task, alerts };
    let ticks = 0;
    const tick = () => {
      if (alerts.sound) this.beep();
      if (alerts.vibrate && navigator.vibrate) navigator.vibrate([400, 150, 400]);
      if (++ticks > 60) this.stop(); // auto-stop after ~1.5 min
    };
    tick();
    this.loop = setInterval(tick, 1500);

    if (alerts.popup) {
      $("alarmTitle").textContent = task.title;
      $("alarmWhen").textContent = formatDue(dueDate(task)) + (isRepeat(task) ? " · " + describeRepeat(task.repeat) : "");
      $("alarmNotes").textContent = task.notes || "";
      if (!$("alarmDialog").open) $("alarmDialog").showModal();
    } else if (alerts.sound || alerts.vibrate) {
      $("alarmBarText").textContent = "⏰ " + task.title;
      $("alarmBar").classList.remove("hidden");
    }
  },
  stop() {
    clearInterval(this.loop);
    this.loop = null;
    if (navigator.vibrate) navigator.vibrate(0);
    if ($("alarmDialog").open) $("alarmDialog").close();
    $("alarmBar").classList.add("hidden");
    this.current = null;
    const next = this.queue.shift();
    if (next) setTimeout(() => this.start(next.task, next.alerts), 400);
  },
};
document.addEventListener("pointerdown", () => Alarm.unlock(), { passive: true });

$("alarmDone").onclick = async () => {
  const id = Alarm.current?.task.id;
  Alarm.stop();
  const t = tasks.find((x) => x.id === id);
  if (t && !t.completed) await completeTask(t);
};
$("alarmSnooze5").onclick = () => { const id = Alarm.current?.task.id; Alarm.stop(); if (id) snoozeTask(id, 5); };
$("alarmSnooze15").onclick = () => { const id = Alarm.current?.task.id; Alarm.stop(); if (id) snoozeTask(id, 15); };
$("alarmDismiss").onclick = () => Alarm.stop();
$("alarmDialog").addEventListener("cancel", (e) => { e.preventDefault(); Alarm.stop(); });
$("alarmBarStop").onclick = () => Alarm.stop();

$("testAlarmBtn").onclick = () => {
  Alarm.unlock();
  const fake = { id: "test", title: "Test reminder", notes: "This is how your alarm looks and sounds.", dueAt: new Date(), repeat: { type: "none" } };
  fireAlert({ ...fake, alerts: { sound: true, vibrate: true, popup: true } });
};

// ---------- messages from the service worker (push arrived / notification tapped) ----------
function onSwMessage(e) {
  const m = e.data || {};
  const t = tasks.find((x) => x.id === m.taskId);
  if (m.type === "REMOTE_ALARM" && t) Alarm.start(t, t.alerts || {});
  if (m.type === "NOTIF_ACTION") runNotifAction(m.action, m.taskId);
}
async function runNotifAction(action, taskId) {
  const t = tasks.find((x) => x.id === taskId);
  if (!t) return;
  if (Alarm.current?.task.id === taskId) Alarm.stop();
  if (action === "done" && !t.completed) await completeTask(t);
  else if (action === "snooze") await snoozeTask(taskId, 10);
  else openEditor(t);
}
function readUrlAction() {
  const p = new URLSearchParams(location.search);
  const r = p.get("task") ? { taskId: p.get("task"), action: p.get("action") || "open" } : null;
  if (r) history.replaceState(null, "", location.pathname);
  return r;
}
function handleUrlAction() {
  if (pendingUrlAction) runNotifAction(pendingUrlAction.action, pendingUrlAction.taskId);
  if (pendingNativeAction) {
    const { action, taskId } = pendingNativeAction;
    pendingNativeAction = null;
    runNotifAction(action, taskId);
  }
}

// ======================================================================
// NOTIFICATION PERMISSION + PUSH TOKEN (for reminders while the app is closed)
// ======================================================================
$("notifBtn").onclick = async () => {
  Alarm.unlock();
  if (isNative) {
    const r = await requestNativeAlerts();
    await refreshNotifButton();
    if (!r.ok) return toast("Notifications are off. Turn them on in Android Settings → Apps → Daybook.");
    scheduleNative(tasks, { formatDue, dueDate });
    return toast(r.exact
      ? "Alerts on — reminders ring on time, even when Daybook is closed."
      : "Alerts on. Allow “Alarms & reminders” in settings for exact timing.");
  }
  if (!("Notification" in window)) {
    return toast(isIOS() ? "On iPhone: Share → Add to Home Screen, then open the app from there." : "This browser can’t show notifications.");
  }
  const perm = await Notification.requestPermission();
  refreshNotifButton();
  if (perm !== "granted") return toast("Notifications are blocked. Allow them in your browser/site settings.");
  if (navigator.vibrate) navigator.vibrate(200);
  const ok = await registerPushToken();
  toast(ok ? "Alerts on — reminders will reach this device even when the app is closed." : "Alerts on while the app is open.");
};

async function refreshNotifButton() {
  const on = isNative ? await nativeAlertsOn() : "Notification" in window && Notification.permission === "granted";
  $("notifBtn").classList.toggle("on", on);
  $("notifBtn").textContent = on ? "🔔 Alerts on" : "🔔 Enable alerts";
}

async function registerPushToken() {
  try {
    if (!user || !VAPID_KEY || VAPID_KEY.startsWith("PASTE")) return false;
    if (!(await isSupported())) return false;
    const reg = swReg || (await navigator.serviceWorker.ready);
    const token = await getToken(getMessaging(fbApp), { vapidKey: VAPID_KEY, serviceWorkerRegistration: reg });
    if (!token) return false;
    await setDoc(doc(db, "users", user.uid, "tokens", token), {
      token, device: navigator.userAgent.slice(0, 160), updatedAt: serverTimestamp(),
    });
    return true;
  } catch (e) {
    console.warn("Push token error", e);
    return false;
  }
}

// ======================================================================
// HELPERS
// ======================================================================
function toast(msg) {
  const el = $("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(toast._t);
  toast._t = setTimeout(() => el.classList.add("hidden"), 3200);
}
function formatDue(d) {
  const now = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (sameDay(d, now)) return `Today ${time}`;
  if (sameDay(d, addDays(now, 1))) return `Tomorrow ${time}`;
  if (sameDay(d, addDays(now, -1))) return `Yesterday ${time}`;
  return d.toLocaleDateString([], { weekday: "short", day: "numeric", month: "short" }) + " " + time;
}
function beforeLabel(m) {
  if (m >= 1440) return `${m / 1440} day before`;
  if (m >= 60) return `${m / 60} hr before`;
  return `${m} min before`;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const endOfDay = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };
const pad = (n) => String(n).padStart(2, "0");
const toDateInput = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const toTimeInput = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;
function roundUpHour(d) { const x = new Date(d); x.setMinutes(0, 0, 0); x.setHours(x.getHours() + 1); return x; }
const notifGranted = () => "Notification" in window && Notification.permission === "granted";
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent);
