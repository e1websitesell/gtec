import { db } from "./firebase-config.js";
import { doc, getDoc, setDoc, updateDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const EMPTY = { market: {}, other: {}, gas: {} };

export async function getOrCreateExpenses(cycleId) {
  const ref = doc(db, "cycles", cycleId, "expenses", "data");
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, EMPTY);
    return { ...EMPTY };
  }
  const data = snap.data();
  return { market: data.market || {}, other: data.other || {}, gas: data.gas || {} };
}

export async function setExpenseValue(cycleId, category, dateKey, value) {
  const ref = doc(db, "cycles", cycleId, "expenses", "data");
  await updateDoc(ref, { [`${category}.${dateKey}`]: Number(value) || 0 });
}
