# Daybook Tasks

> **Android app (APK):** see [Android app](#android-app-apk) — GitHub builds it for you.

A to-do list app that installs on **PC and mobile** (it's a PWA — one codebase, no app store), with:

- **Email + password login** for multiple people (Firebase Auth) — each person sees only their own tasks
- **Cloud storage** in Firebase Firestore — tasks sync live between your phone and PC, and work offline
- **Reminders with 3 alert types** (pick any combination per task): 🔊 alarm sound · 📳 vibrate · 💬 popup
- **Repeating tasks** — every day, every month, or weekly on chosen days (e.g. every Monday and Tuesday). Ticking a repeating task logs it and moves it to the next date automatically.
- Snooze (5 / 10 / 15 min), "Done" button right on the notification, remind 5 min–1 day before
- Pending / Today / Repeating / Completed views, overdue highlighting, dark mode

```
public/            ← the web app (this is what gets hosted)
  index.html  styles.css  app.js  recurrence.js  firebase-config.js  sw.js  manifest.json  icons/
functions/         ← Cloud Function that pushes reminders when the app is closed
firestore.rules    ← security: users can only touch their own data
firestore.indexes.json  firebase.json
```

---

## 1. Create the Firebase project (5 min)

1. Go to https://console.firebase.google.com → **Add project**.
2. **Build → Authentication → Get started → Sign-in method → Email/Password → Enable.**
3. **Build → Firestore Database → Create database** (production mode, pick a nearby location).
4. **Project settings (⚙) → General → Your apps → Web (`</>`)** → register an app → copy the `firebaseConfig` object into `public/firebase-config.js`.
5. **Project settings → Cloud Messaging → Web Push certificates → Generate key pair** → paste the key into `VAPID_KEY` in `public/firebase-config.js`.

## 1b. Publish the database rules (required)

Without published rules, a Firestore database in production mode blocks every read and write: tasks stay
on one device and never sync. In the Firebase console → **Firestore Database → Rules**, replace
everything with the contents of `firestore.rules` and click **Publish**:

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
      match /{sub=**} {
        allow read, write: if request.auth != null && request.auth.uid == uid;
      }
    }
  }
}
```

The app shows **"synced"** next to your email when the cloud has your tasks.

## 1c. Google sign-in

1. Firebase → **Authentication → Sign-in method → Add new provider → Google → Enable** → Save.
2. Website: works right away (make sure the site's domain is in *Authorised domains*).
3. Android app: Firebase → **Project settings → General → Add app → Android**
   - Package name: `org.beingtechy.daybook`
   - SHA-1: `B4:10:AC:E5:49:E8:74:D6:32:EB:AF:92:98:C5:33:3A:F4:E5:F1:F0` (from `android/daybook.keystore`)
   - Then copy the **Web client ID** (Authentication → Sign-in method → Google → Web SDK configuration)
     into `GOOGLE_WEB_CLIENT_ID` in `public/firebase-config.js` and push.

## 2. Deploy

**Already set up: GitHub Pages.** Every push to `main` publishes `public/` to
**https://ahamedjishfaanms.github.io/daybook/** (workflow: `.github/workflows/deploy-website.yml`).
In Firebase → Authentication → Settings → **Authorised domains**, add `ahamedjishfaanms.github.io`.

### Or: Firebase Hosting

```bash
npm install -g firebase-tools
firebase login
cd daybook-tasks
firebase use --add            # pick your project
firebase deploy --only hosting,firestore
```

You get a URL like `https://your-project.web.app`. Open it on your PC and phone.

> **Using GitHub + Vercel instead?** Push this folder to a GitHub repo, import it in Vercel and set **Root Directory = `public`**. Then in Firebase **Authentication → Settings → Authorized domains**, add your `*.vercel.app` domain. Still run `firebase deploy --only firestore` once to upload the security rules.

## 3. Reminders when the app is CLOSED (Cloud Function)

While the app is open (or minimized on PC), reminders ring by themselves. For your **phone to buzz when the app is closed or the screen is locked**, a server has to push the reminder — that's `functions/index.js`. It runs every minute, finds due reminders and sends them to every device you've enabled alerts on.

Cloud Functions need the **Blaze (pay-as-you-go) plan**. A personal to-do app stays inside the free monthly allowance (a 1-minute schedule ≈ 43,000 runs/month vs 2 million free), so in practice it's ₹0 / AED 0 — but Google requires a card on file. Set a budget alert of $1 to be safe.

```bash
cd functions && npm install && cd ..
firebase deploy --only functions,firestore
```

Without this step everything else still works; reminders just need the app open.

## 4. Install the app

| Device | How |
|---|---|
| **Windows / Mac (Chrome or Edge)** | Open the site → click **⬇ Install** in the app, or the install icon in the address bar. It gets its own window and Start-menu/Dock icon. |
| **Android (Chrome)** | Open the site → **⬇ Install** (or ⋮ → *Install app*). |
| **iPhone / iPad (Safari, iOS 16.4+)** | Share → **Add to Home Screen**, then open it **from the home-screen icon** (notifications only work there on iOS). |

Then tap **🔔 Enable alerts** on each device and allow notifications. Tap **🔊 Test** to hear/see the alarm.

## How each alert type behaves

| | App open | App minimized / in background | App closed / phone locked (needs step 3) |
|---|---|---|---|
| 🔊 Alarm sound | Loud repeating beep until you stop it | Beep + system notification sound | Phone's notification sound (once) |
| 📳 Vibrate | Repeating vibration (Android) | Vibrating notification (Android) | Vibrating notification (Android) |
| 💬 Popup | Full-screen alarm card with Done / Snooze | System notification with Done / Snooze buttons that stays until you act | Same |

**Honest limits of web apps** (vs a native Play Store / App Store app):
- A browser can't play a *continuous* alarm when the app is fully closed — you get the system notification sound instead.
- iPhones don't support web vibration; the notification still uses the phone's normal alert.
- On Android, make sure Chrome isn't battery-restricted (Settings → Apps → Chrome → Battery → Unrestricted) so pushes arrive on time.

If you later need a true ringing alarm on a locked phone, this same code can be wrapped as a native Android app with **Capacitor** and its Local Notifications plugin.

## Data model (Firestore)

```
users/{uid}                  name, email
users/{uid}/tasks/{taskId}   title, notes, dueAt, reminderAt, reminded, remindBefore (min, -1 = none),
                             alerts {sound, vibrate, popup}, repeat {type, days[0-6], dayOfMonth},
                             completed, completedAt, timesDone, lastDoneAt, tz
users/{uid}/tokens/{token}   push token per device (PC, phone…)
```

---

## Android app (APK)

The same app is also packaged as a real Android app with **Capacitor**. In the APK, reminders are
scheduled as **Android alarms**, so they ring / vibrate / pop up **even when Daybook is closed or the
phone is locked** — no Blaze plan or Cloud Function needed.

| Alert type | What the phone does |
|---|---|
| 🔊 Ring | Plays Daybook's alarm tone (`android/app/src/main/res/raw/daybook_alarm.wav`) |
| 📳 Vibrate | Vibrates (silent if Ring is off) |
| 💬 Popup | Heads-up banner over other apps, with **✓ Done** and **Snooze 10 min** buttons |

### Get the APK (GitHub builds it)

1. Create an empty repo on GitHub (e.g. `daybook-tasks`) — no README.
2. In this folder:
   ```bash
   git push   # repo: https://github.com/ahamedjishfaanms/daybook
   ```
3. On GitHub open **Actions** → *Build Android APK* (takes ~5–8 min the first time).
4. Open **Releases** → **Daybook 1.0.N** → download **Daybook.apk** on your phone → open it.
   Allow *Install unknown apps* if Android asks.
5. Open Daybook → log in → tap **Enable alerts** → allow notifications and **Alarms & reminders**.

Every push to `main` builds a new version that installs over the old one (same signing key,
higher version number).

### Build on your own PC instead
Needs Node 22, Java 21 and Android Studio:
```bash
npm ci
npm run apk          # → android/app/build/outputs/apk/debug/app-debug.apk
```
Or `npx cap open android` and press ▶ in Android Studio.

### Changing the app
Edit files in `public/`, then push — GitHub rebuilds the APK. Deploy the website as before with
`firebase deploy --only hosting`. After upgrading Firebase, run `npm run vendor` to rebuild
`public/vendor/firebase.js`.

### Signing key
`android/daybook.keystore` (password `daybook123`) is a test key so you can install and update the
APK yourself. **Before publishing on the Play Store**, create your own private key and keep it out of
GitHub.
