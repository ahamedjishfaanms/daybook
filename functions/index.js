// Cloud Function: every minute, find reminders that are due and push them to all of the
// user's devices (PC + phone) — this is what makes reminders work while the app is CLOSED.
const { onSchedule } = require("firebase-functions/v2/scheduler");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, Timestamp, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");

initializeApp();

exports.sendDueReminders = onSchedule(
  { schedule: "every 1 minutes", region: "us-central1", timeoutSeconds: 120 },
  async () => {
    const db = getFirestore();
    const now = Timestamp.now();
    const sixHoursAgo = Timestamp.fromMillis(now.toMillis() - 6 * 3600 * 1000);

    const snap = await db
      .collectionGroup("tasks")
      .where("completed", "==", false)
      .where("reminded", "==", false)
      .where("reminderAt", "<=", now)
      .limit(300)
      .get();

    const tokensByUser = new Map();

    for (const taskDoc of snap.docs) {
      // Claim the reminder in a transaction so it is only sent once (the open app may claim it too).
      const claimed = await db.runTransaction(async (tx) => {
        const fresh = await tx.get(taskDoc.ref);
        if (!fresh.exists || fresh.get("reminded") || fresh.get("completed")) return false;
        tx.update(taskDoc.ref, { reminded: true, remindedBy: "server", remindedAt: FieldValue.serverTimestamp() });
        return true;
      });
      if (!claimed) continue;

      const t = taskDoc.data();
      if (t.reminderAt.toMillis() < sixHoursAgo.toMillis()) continue; // too old — don't ring for it

      const uid = taskDoc.ref.parent.parent.id;
      if (!tokensByUser.has(uid)) {
        const ts = await db.collection("users").doc(uid).collection("tokens").get();
        tokensByUser.set(uid, ts.docs.map((d) => d.id));
      }
      const tokens = tokensByUser.get(uid);
      if (!tokens.length) continue;

      const due = t.dueAt.toDate();
      const when = due.toLocaleString("en-US", {
        timeZone: t.tz || "UTC", weekday: "short", hour: "numeric", minute: "2-digit",
      });

      const res = await getMessaging().sendEachForMulticast({
        tokens,
        data: {
          taskId: taskDoc.id,
          title: `⏰ ${t.title}`,
          body: `${when}${t.notes ? " — " + t.notes : ""}`.slice(0, 200),
          vibrate: t.alerts?.vibrate ? "1" : "0",
          sound: t.alerts?.sound ? "1" : "0",
        },
        webpush: { headers: { Urgency: "high", TTL: "3600" } },
      });

      // Remove tokens of uninstalled apps / logged-out browsers.
      await Promise.all(
        res.responses.map((r, i) => {
          const code = r.error?.code || "";
          if (!r.success && (code.includes("registration-token-not-registered") || code.includes("invalid-registration-token"))) {
            return db.collection("users").doc(uid).collection("tokens").doc(tokens[i]).delete();
          }
          return null;
        })
      );
    }
  }
);
