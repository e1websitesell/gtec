// Firebase কনফিগ ও শেয়ার্ড ইনিশিয়ালাইজেশন
// সব পেজ এই ফাইল থেকে auth, db ইম্পোর্ট করবে

import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getAuth,
  setPersistence,
  browserLocalPersistence,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyCn_Y7vXAOwL6yVd6fdUh27ZtdjmhVd-F4",
  authDomain: "gtec-boyes-hostel.firebaseapp.com",
  projectId: "gtec-boyes-hostel",
  storageBucket: "gtec-boyes-hostel.firebasestorage.app",
  messagingSenderId: "349188760840",
  appId: "1:349188760840:web:a791295aaf60773883f8bd",
  measurementId: "G-EJ6LVQQHZ4",
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// লগইন সেশন যেন ব্রাউজার বন্ধ করলেও থেকে যায় (মোবাইলে বারবার লগইন করা লাগবে না)
setPersistence(auth, browserLocalPersistence);

// ইউজারনেমকে Firebase Auth-এর জন্য একটা ফেইক ইমেইলে রূপান্তর করে
// কারণ Firebase Auth email/password লগইন চায়, কিন্তু আমরা ইউজারনেম দিয়ে লগইন করাবো
export function usernameToEmail(username) {
  const clean = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, "");
  return `${clean}@gtechostel.local`;
}
