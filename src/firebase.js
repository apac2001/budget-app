import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

const firebaseConfig = {
  apiKey: "AIzaSyDzqHagZp_hK8bLUUMkDc27lwdzweaHMSw",
  authDomain: "budget-app-ce7d4.firebaseapp.com",
  projectId: "budget-app-ce7d4",
  storageBucket: "budget-app-ce7d4.firebasestorage.app",
  messagingSenderId: "305158334228",
  appId: "1:305158334228:web:06163d4c2687af0f610401"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);