import { db } from "./firebase-config.js";
import {
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  setDoc,
  updateDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { bdToday } from "./dateutils.js";

// বর্তমান অ্যাক্টিভ সাইকেল খুঁজে বের করা। না থাকলে null রিটার্ন করবে।
export async function getActiveCycle() {
  const q = query(collection(db, "cycles"), where("isActive", "==", true), limit(1));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// নতুন সাইকেল শুরু করা (অ্যাডমিন করবে) — আগেরটা থাকলে সেটা inactive/archived করে দেবে
export async function startNewCycle({ startDate, mealsPerDay, lengthDays }) {
  const existing = await getActiveCycle();
  if (existing) {
    await updateDoc(doc(db, "cycles", existing.id), {
      isActive: false,
      isArchived: true,
      endDate: startDate,
    });
  }

  const cycleId = startDate; // যেমন "2026-07-14" — সহজে চেনার জন্য
  await setDoc(doc(db, "cycles", cycleId), {
    startDate,
    lengthDays: lengthDays || 30,
    mealsPerDay: mealsPerDay || ["lunch", "dinner"],
    defaultMealValue: { lunch: 1, dinner: 1 },
    isActive: true,
    isArchived: false,
    createdAt: serverTimestamp(),
  });

  return cycleId;
}

export async function getAllCycles() {
  const snap = await getDocs(collection(db, "cycles"));
  const cycles = [];
  snap.forEach((d) => cycles.push({ id: d.id, ...d.data() }));
  return cycles.sort((a, b) => (a.startDate < b.startDate ? 1 : -1));
}
