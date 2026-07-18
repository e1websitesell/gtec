import { db } from "./firebase-config.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  addDoc,
  getDocs,
  collection,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { bdToday, resolveSelection } from "./dateutils.js";

// ---------- স্পেশাল ডে মিল ভ্যালু ----------
export async function getAllSpecialValues(cycleId) {
  const snap = await getDocs(collection(db, "cycles", cycleId, "specialMealValues"));
  const map = {};
  snap.forEach((d) => (map[d.id] = d.data()));
  return map; // { "2026-07-18": { lunchValue, dinnerValue, reason } }
}

export async function setSpecialValue(cycleId, dateStr, lunchValue, dinnerValue, reason) {
  await setDoc(doc(db, "cycles", cycleId, "specialMealValues", dateStr), {
    lunchValue,
    dinnerValue,
    reason: reason || "",
  });
}

export async function deleteSpecialValueReset(cycleId, dateStr) {
  await setDoc(doc(db, "cycles", cycleId, "specialMealValues", dateStr), {
    lunchValue: 1,
    dinnerValue: 1,
    reason: "",
  });
}

// ---------- গেস্ট মিল ----------
export async function addGuestMeal(cycleId, userId, dateStr, lunchCount, dinnerCount) {
  await addDoc(collection(db, "cycles", cycleId, "guestMeals"), {
    userId,
    date: dateStr,
    lunchCount: Number(lunchCount) || 0,
    dinnerCount: Number(dinnerCount) || 0,
    createdAt: serverTimestamp(),
  });
}

export async function getAllGuestMeals(cycleId) {
  const snap = await getDocs(collection(db, "cycles", cycleId, "guestMeals"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function getGuestMealsForUser(cycleId, userId) {
  const q = query(collection(db, "cycles", cycleId, "guestMeals"), where("userId", "==", userId));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list.sort((a, b) => (a.date < b.date ? 1 : -1));
}

// ---------- পেমেন্ট ----------
export async function addPayment(cycleId, userId, amount, note) {
  await addDoc(collection(db, "cycles", cycleId, "payments"), {
    userId,
    amount: Number(amount) || 0,
    note: note || "",
    date: bdToday(),
    createdAt: serverTimestamp(),
  });
}

export async function getAllPayments(cycleId) {
  const snap = await getDocs(collection(db, "cycles", cycleId, "payments"));
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

// ---------- ফাইন (জরিমানা, মিল-ইউনিটে) ----------
export async function getAllFines(cycleId) {
  const snap = await getDocs(collection(db, "cycles", cycleId, "fines"));
  const map = {};
  snap.forEach((d) => (map[d.id] = d.data()));
  return map; // { userId: { amount, note } }
}

export async function setFine(cycleId, userId, amount, note) {
  await setDoc(doc(db, "cycles", cycleId, "fines", userId), {
    amount: Number(amount) || 0,
    note: note || "",
  });
}

// ---------- বিল ৫-এর গুণিতকে রাউন্ড করা (সবসময় উপরের দিকে, যাতে ম্যানেজারের ঘাটতি না পড়ে) ----------
export function roundBillUp5(amount) {
  return Math.ceil(amount / 5) * 5;
}

// ---------- সাইকেলে মিল রেট / ফিক্সড কস্ট সেট করা ----------
export async function setBillingConfig(cycleId, mealRate, fixedCostPerHead) {
  await updateDoc(doc(db, "cycles", cycleId), {
    mealRate: Number(mealRate) || 0,
    fixedCostPerHead: Number(fixedCostPerHead) || 0,
  });
}

// ---------- একটা নির্দিষ্ট তারিখের লাঞ্চ/ডিনার ভ্যালু বের করা (স্পেশাল থাকলে সেটা, নাহলে ডিফল্ট ১) ----------
export function getDayValue(specialValuesMap, dateStr) {
  if (specialValuesMap[dateStr]) {
    return {
      lunch: specialValuesMap[dateStr].lunchValue,
      dinner: specialValuesMap[dateStr].dinnerValue,
    };
  }
  return { lunch: 1, dinner: 1 };
}

// ---------- একজন স্টুডেন্টের পুরো বিল ক্যালকুলেট করা ----------
// entries: তার mealEntries.entries ম্যাপ
// dates: হিসাবের মধ্যে থাকা সব তারিখ (সাইকেল শুরু থেকে আজ পর্যন্ত)
// specialValuesMap: getAllSpecialValues() থেকে পাওয়া
// guestMealsForUser: এই ইউজারের নিজের guestMeals এন্ট্রিগুলো
export function computeStudentBilling(entries, dates, cycleStartDate, specialValuesMap, guestMealsForUser) {
  let attendanceLunch = 0;
  let attendanceDinner = 0;
  let billingUnits = 0;

  dates.forEach((dateStr) => {
    const val = resolveSelection(entries, dateStr, cycleStartDate).value;
    const dayVal = getDayValue(specialValuesMap, dateStr);

    if (val === "lunch" || val === "both") {
      attendanceLunch++;
      billingUnits += dayVal.lunch;
    }
    if (val === "dinner" || val === "both") {
      attendanceDinner++;
      billingUnits += dayVal.dinner;
    }
  });

  // গেস্ট মিল — সেই তারিখের ভ্যালু অনুযায়ী যোগ হবে
  let guestLunchCount = 0;
  let guestDinnerCount = 0;
  guestMealsForUser.forEach((g) => {
    const dayVal = getDayValue(specialValuesMap, g.date);
    billingUnits += (g.lunchCount || 0) * dayVal.lunch;
    billingUnits += (g.dinnerCount || 0) * dayVal.dinner;
    guestLunchCount += g.lunchCount || 0;
    guestDinnerCount += g.dinnerCount || 0;
  });

  // Extra Lunch বোনাস — নিজের attendance + গেস্ট মিল দুটোই ধরে হিসাব হবে
  const extraLunch = Math.max(0, (attendanceLunch + guestLunchCount - (attendanceDinner + guestDinnerCount)) * 0.5);
  billingUnits += extraLunch;

  return { attendanceLunch, attendanceDinner, extraLunch, billingUnits };
}
