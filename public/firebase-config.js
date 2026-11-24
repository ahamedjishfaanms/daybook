// Firebase console -> Project settings -> General -> "Your apps" -> Web app.
export const firebaseConfig = {
  apiKey: "AIzaSyBIVi0cNrlXkXysS3BdY9ywGEHiCTRMSew",
  authDomain: "daybook-tasks.firebaseapp.com",
  projectId: "daybook-tasks",
  storageBucket: "daybook-tasks.firebasestorage.app",
  messagingSenderId: "78218066451",
  appId: "1:78218066451:web:f8deee0d7154e532ec1de6",
  measurementId: "G-SD0F2RHJFD",
};

// Firebase console -> Project settings -> Cloud Messaging -> Web Push certificates -> "Generate key pair".
//    Needed only for reminders while the app is CLOSED (see README). Leave as-is to skip.
export const VAPID_KEY = "BHJmF2FqX_fhaxbzHYBqLZ4hJs4Ei8rObzXqK3jJMetR73Of9BNR3Kqm2rJUo6SZluh2Op5mFrE1p1c47sAzTaU";

// Google sign-in inside the Android app (the website doesn't need this):
// Firebase console -> Authentication -> Sign-in method -> Google -> "Web SDK configuration" -> Web client ID.
export const GOOGLE_WEB_CLIENT_ID = "PASTE_WEB_CLIENT_ID.apps.googleusercontent.com";
