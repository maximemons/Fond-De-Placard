import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/11.0.0/firebase-auth.js";
import {
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager
} from "https://www.gstatic.com/firebasejs/11.0.0/firebase-firestore.js";

// La clé "apiKey" d'une app web Firebase n'est pas un secret : elle identifie le projet.
// La protection des données repose sur les règles Firestore (voir firestore.rules).
export const firebaseConfig = {
  apiKey: "AIzaSyA3pwdR05Aoj0LgEH1fJHjXgt5DqdpC_oY",
  authDomain: "fond-de-placard-5eb12.firebaseapp.com",
  projectId: "fond-de-placard-5eb12",
  storageBucket: "fond-de-placard-5eb12.firebasestorage.app",
  messagingSenderId: "603048746029",
  appId: "1:603048746029:web:0a21ef982ac3e07fdc2ca4"
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
auth.languageCode = "fr";

// Cache local persistant : l'inventaire reste consultable (et modifiable) sans réseau,
// au fond de la cave comme au supermarché.
export const db = initializeFirestore(app, {
  localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() })
});

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: "select_account" });
