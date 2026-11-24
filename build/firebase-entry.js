// Everything the app uses from Firebase, bundled into public/vendor/firebase.js (run: npm run vendor)
export { initializeApp } from "firebase/app";
export {
  getAuth, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  sendPasswordResetEmail, signOut, updateProfile,
} from "firebase/auth";
export {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager,
  collection, doc, addDoc, updateDoc, deleteDoc, setDoc, onSnapshot, query, orderBy,
  serverTimestamp, Timestamp, increment,
} from "firebase/firestore";
export { getMessaging, getToken, isSupported } from "firebase/messaging";
