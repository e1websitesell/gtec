import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import { bdToday, addDays, formatBanglaDateFull } from "./dateutils.js";
import {
  getAllSpecialValues,
  setSpecialValue,
  getAllGuestMeals,
  getAllPayments,
  addPayment,
  getAllFines,
  setFine,
  roundBillUp5,
  setBillingConfig,
  computeStudentBilling,
} from "./billing.js";

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const cycleLabel = document.getElementById("cycleLabel");
const noCycleMsg = document.getElementById("noCycleMsg");
const billingBody = document.getElementById("billingBody");
const specialList = document.getElementById("specialList");
const guestMealList = document.getElementById("guestMealList");
const billingTable = document.getElementById("billingTable");
const bulkPaymentSection = document.getElementById("bulkPaymentSection");
const bulkPaymentTable = document.getElementById("bulkPaymentTable");

let cycle = null;
let students = [];
let entriesByUser = {};
let specialValuesMap = {};
let guestMeals = [];
let payments = [];
let finesMap = {};
let dates = [];

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }
  const snap = await getDoc(doc(db, "users", user.uid));
  if (!snap.exists()) {
    window.location.href = "../index.html";
    return;
  }
  const data = snap.data();
  const isAdmin = data.role === "mainadmin" || data.role === "subadmin";
  if (!isAdmin || data.status !== "approved") {
    window.location.href = data.status === "approved" ? "../student/home.html" : "../pending.html";
    return;
  }

  loadingScreen.style.display = "none";
  appShell.style.display = "block";

  await loadAll();
});

async function loadAll() {
  cycle = await getActiveCycle();
  if (!cycle) {
    noCycleMsg.style.display = "block";
    cycleLabel.textContent = "কোনো সাইকেল নেই";
    return;
  }

  cycleLabel.textContent = `${formatBanglaDateFull(cycle.startDate)} থেকে চলমান`;
  billingBody.style.display = "block";

  const today = bdToday();
  dates = [];
  let d = cycle.startDate;
  while (d <= today) {
    dates.push(d);
    d = addDays(d, 1);
  }

  const usersQ = query(collection(db, "users"), where("status", "==", "approved"), where("role", "==", "student"));
  const usersSnap = await getDocs(usersQ);
  students = [];
  usersSnap.forEach((docSnap) => students.push({ id: docSnap.id, ...docSnap.data() }));
  students.sort((a, b) => {
    if (a.roomNumber !== b.roomNumber) return a.roomNumber.localeCompare(b.roomNumber, "en", { numeric: true });
    return a.name.localeCompare(b.name, "bn");
  });

  const entriesSnap = await getDocs(collection(db, "cycles", cycle.id, "mealEntries"));
  entriesByUser = {};
  entriesSnap.forEach((docSnap) => (entriesByUser[docSnap.id] = docSnap.data().entries || {}));

  specialValuesMap = await safeLoad(() => getAllSpecialValues(cycle.id), {}, "স্পেশাল ডে ভ্যালু");
  guestMeals = await safeLoad(() => getAllGuestMeals(cycle.id), [], "গেস্ট মিল");
  payments = await safeLoad(() => getAllPayments(cycle.id), [], "পেমেন্ট");
  finesMap = await safeLoad(() => getAllFines(cycle.id), {}, "জরিমানা");

  document.getElementById("mealRateInput").value = cycle.mealRate || "";
  document.getElementById("fixedCostInput").value = cycle.fixedCostPerHead || "";

  renderSpecialList();
  renderGuestMealList();
  renderBillingTable();
}

// কোনো একটা ডেটা লোড ফেইল করলে বাকি পেজ যেন থেমে না যায় — এরর কনসোলে দেখাবে, ফাঁকা ডিফল্ট দিয়ে এগিয়ে যাবে
async function safeLoad(fn, fallback, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`${label} লোড করতে সমস্যা:`, err);
    return fallback;
  }
}

// ---------- স্পেশাল ডে ভ্যালু ----------
document.getElementById("addSpecialBtn").addEventListener("click", async () => {
  const dateStr = document.getElementById("specialDate").value;
  const lunchVal = parseFloat(document.getElementById("specialLunch").value);
  const dinnerVal = parseFloat(document.getElementById("specialDinner").value);
  const reason = document.getElementById("specialReason").value.trim();

  if (!dateStr || isNaN(lunchVal) || isNaN(dinnerVal)) {
    alert("তারিখ ও ভ্যালু ঠিকভাবে দাও।");
    return;
  }

  await setSpecialValue(cycle.id, dateStr, lunchVal, dinnerVal, reason);
  specialValuesMap[dateStr] = { lunchValue: lunchVal, dinnerValue: dinnerVal, reason };
  renderSpecialList();
  renderBillingTable();
});

function renderSpecialList() {
  const entries = Object.entries(specialValuesMap).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (entries.length === 0) {
    specialList.innerHTML = `<div class="empty-state">এখনো কোনো স্পেশাল ডে সেট করা হয়নি।</div>`;
    return;
  }
  specialList.innerHTML = entries
    .map(
      ([dateStr, v]) => `
      <div class="special-row">
        <span>${formatBanglaDateFull(dateStr)} ${v.reason ? `— ${escapeHtml(v.reason)}` : ""}</span>
        <span>লাঞ্চ: <strong>${v.lunchValue}</strong> · ডিনার: <strong>${v.dinnerValue}</strong></span>
      </div>`
    )
    .join("");
}

// ---------- মিল রেট / ফিক্সড কস্ট ----------
document.getElementById("saveConfigBtn").addEventListener("click", async () => {
  const rate = document.getElementById("mealRateInput").value;
  const fixed = document.getElementById("fixedCostInput").value;
  await setBillingConfig(cycle.id, rate, fixed);
  cycle.mealRate = Number(rate) || 0;
  cycle.fixedCostPerHead = Number(fixed) || 0;
  renderBillingTable();
});

// ---------- গেস্ট মিল লিস্ট ----------
function renderGuestMealList() {
  if (guestMeals.length === 0) {
    guestMealList.innerHTML = `<div class="empty-state">এখনো কোনো গেস্ট মিল এন্ট্রি নেই।</div>`;
    return;
  }
  const rows = guestMeals
    .slice()
    .sort((a, b) => (a.date < b.date ? 1 : -1))
    .map((g) => {
      const student = students.find((s) => s.id === g.userId);
      const name = student ? student.name : "(অজানা)";
      return `<tr>
        <td>${formatBanglaDateFull(g.date)}</td>
        <td>${escapeHtml(name)}</td>
        <td>${g.lunchCount}</td>
        <td>${g.dinnerCount}</td>
      </tr>`;
    })
    .join("");

  guestMealList.innerHTML = `
    <table class="data-table">
      <thead><tr><th>তারিখ</th><th>কে দিলো</th><th>লাঞ্চ</th><th>ডিনার</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

// ---------- একজন স্টুডেন্টের সম্পূর্ণ বিল হিসাব (ফাইন + রাউন্ডিং সহ) ----------
function computeFullBill(student) {
  const entries = entriesByUser[student.id] || {};
  const myGuestMeals = guestMeals.filter((g) => g.userId === student.id);
  const result = computeStudentBilling(entries, dates, cycle.startDate, specialValuesMap, myGuestMeals);

  const guestUnits = myGuestMeals.reduce((sum, g) => {
    const dayVal = specialValuesMap[g.date]
      ? { lunch: specialValuesMap[g.date].lunchValue, dinner: specialValuesMap[g.date].dinnerValue }
      : { lunch: 1, dinner: 1 };
    return sum + (g.lunchCount || 0) * dayVal.lunch + (g.dinnerCount || 0) * dayVal.dinner;
  }, 0);

  const fine = (finesMap[student.id] && finesMap[student.id].amount) || 0;
  const mealRate = cycle.mealRate || 0;
  const fixedCost = cycle.fixedCostPerHead || 0;

  const totalUnits = result.billingUnits + fine;
  const mealBill = totalUnits * mealRate;
  const rawTotalBill = mealBill + fixedCost;
  const totalBill = roundBillUp5(rawTotalBill);

  const myPayments = payments.filter((p) => p.userId === student.id);
  const totalPaid = myPayments.reduce((s, p) => s + (p.amount || 0), 0);
  const due = totalBill - totalPaid;

  return { ...result, guestUnits, fine, totalUnits, mealBill, fixedCost, rawTotalBill, totalBill, totalPaid, due };
}

// ---------- বিলিং টেবিল ----------
function renderBillingTable() {
  let headerRow = `<tr>
    <th class="name-col">নাম</th><th>রুম</th>
    <th>Att.<br/>Lunch</th><th>Att.<br/>Dinner</th><th>Extra</th>
    <th>Guest<br/>Units</th><th>জরিমানা<br/>(মিল)</th><th>Total<br/>Units</th>
    <th>মিল বিল</th><th>ফিক্সড কস্ট</th><th>টোটাল বিল</th>
    <th>জমা</th><th>Due/Return</th>
  </tr>`;

  let bodyRows = "";

  students.forEach((student) => {
    const b = computeFullBill(student);

    bodyRows += `
      <tr>
        <td class="name-col">${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.roomNumber)}</td>
        <td>${b.attendanceLunch}</td>
        <td>${b.attendanceDinner}</td>
        <td>${b.extraLunch}</td>
        <td>${b.guestUnits.toFixed(1)}</td>
        <td><input type="number" step="0.5" class="fine-input" data-uid="${student.id}" value="${b.fine || ""}" placeholder="0" style="width:64px; padding:5px; border:1px solid var(--color-border); border-radius:6px;" /></td>
        <td><strong>${b.totalUnits.toFixed(1)}</strong></td>
        <td>${b.mealBill.toFixed(2)}</td>
        <td>${b.fixedCost.toFixed(2)}</td>
        <td><strong>${b.totalBill.toFixed(0)}</strong></td>
        <td>${b.totalPaid.toFixed(2)}</td>
        <td class="${b.due > 0 ? "due-positive" : b.due < 0 ? "due-negative" : ""}">
          ${b.due > 0 ? `বাকি ${b.due.toFixed(0)}` : b.due < 0 ? `ফেরত ${Math.abs(b.due).toFixed(0)}` : "০"}
        </td>
      </tr>`;
  });

  billingTable.innerHTML = `<thead>${headerRow}</thead><tbody>${bodyRows}</tbody>`;

  // ফাইন ইনপুট — বদলালে সেভ হয়ে যাবে (ব্লার হলে)
  billingTable.querySelectorAll(".fine-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const uid = input.dataset.uid;
      const amount = parseFloat(input.value) || 0;
      try {
        await setFine(cycle.id, uid, amount, "");
        finesMap[uid] = { amount, note: "" };
        renderBillingTable();
      } catch (err) {
        console.error(err);
        alert("জরিমানা সেভ করতে সমস্যা হয়েছে — Firestore Rules Publish করা হয়েছে কিনা চেক করো।");
      }
    });
  });
}

// ---------- বাল্ক পেমেন্ট এন্ট্রি ----------
document.getElementById("bulkPaymentBtn").addEventListener("click", () => {
  const isHidden = bulkPaymentSection.style.display === "none" || !bulkPaymentSection.style.display;
  bulkPaymentSection.style.display = isHidden ? "block" : "none";
  if (isHidden) renderBulkPaymentTable();
});

function renderBulkPaymentTable() {
  let headerRow = `<tr>
    <th class="name-col">নাম</th><th>রুম</th><th>মোট জমা</th>
    <th>কিস্তি ১</th><th>কিস্তি ২</th><th>কিস্তি ৩</th><th>কিস্তি ৪</th><th>কিস্তি ৫</th>
  </tr>`;

  const bodyRows = students
    .map((student) => {
      const myPayments = payments.filter((p) => p.userId === student.id);
      const totalPaid = myPayments.reduce((s, p) => s + (p.amount || 0), 0);
      const installmentInputs = [1, 2, 3, 4, 5]
        .map(
          (n) =>
            `<td><input type="number" step="1" class="installment-input" data-uid="${student.id}" data-slot="${n}" placeholder="৳" style="width:70px; padding:5px; border:1px solid var(--color-border); border-radius:6px;" /></td>`
        )
        .join("");

      return `<tr>
        <td class="name-col">${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.roomNumber)}</td>
        <td><strong>${totalPaid.toFixed(0)}</strong></td>
        ${installmentInputs}
      </tr>`;
    })
    .join("");

  bulkPaymentTable.innerHTML = `<thead>${headerRow}</thead><tbody>${bodyRows}</tbody>`;
}

document.getElementById("saveBulkPaymentBtn").addEventListener("click", async () => {
  const btn = document.getElementById("saveBulkPaymentBtn");
  btn.disabled = true;
  btn.textContent = "সেভ হচ্ছে...";

  // প্রতি স্টুডেন্টের ৫টা কিস্তি-ঘরের যোগফল বের করে একটাই পেমেন্ট এন্ট্রি হিসেবে সেভ করা হবে
  const totals = {};
  bulkPaymentTable.querySelectorAll(".installment-input").forEach((input) => {
    const val = parseFloat(input.value);
    if (!val || val <= 0) return;
    const uid = input.dataset.uid;
    totals[uid] = (totals[uid] || 0) + val;
  });

  const uids = Object.keys(totals);
  if (uids.length === 0) {
    alert("কোনো ঘরে টাকার পরিমাণ দেয়া হয়নি।");
    btn.disabled = false;
    btn.textContent = "সব সেভ করো";
    return;
  }

  try {
    for (const uid of uids) {
      await addPayment(cycle.id, uid, totals[uid], "বাল্ক এন্ট্রি");
    }
    payments = await getAllPayments(cycle.id);

    const summaryLines = uids.map((uid) => {
      const student = students.find((s) => s.id === uid);
      return `${student ? student.name : uid}: +৳${totals[uid]}`;
    });
    alert(`${uids.length} জনের পেমেন্ট যোগ হয়েছে —\n\n${summaryLines.join("\n")}`);

    bulkPaymentSection.style.display = "none";
    renderBillingTable();
  } catch (err) {
    console.error(err);
    alert("পেমেন্ট সেভ করতে সমস্যা হয়েছে।");
  } finally {
    btn.disabled = false;
    btn.textContent = "সব সেভ করো";
  }
});

// ---------- CSV এক্সপোর্ট (UTF-8 BOM) ----------
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  const headers = ["নাম", "রুম", "Attendance Lunch", "Attendance Dinner", "Extra Lunch", "Guest Units", "জরিমানা", "Total Units", "মিল বিল", "ফিক্সড কস্ট", "টোটাল বিল", "জমা", "Due/Return"];
  const rows = [headers];

  students.forEach((student) => {
    const b = computeFullBill(student);
    rows.push([
      student.name,
      student.roomNumber,
      b.attendanceLunch,
      b.attendanceDinner,
      b.extraLunch,
      b.guestUnits.toFixed(1),
      b.fine,
      b.totalUnits.toFixed(1),
      b.mealBill.toFixed(2),
      b.fixedCost.toFixed(2),
      b.totalBill.toFixed(0),
      b.totalPaid.toFixed(2),
      b.due.toFixed(0),
    ]);
  });

  const csvContent = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
  const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `bill-${cycle.id}.csv`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 1000);
});

function csvEscape(val) {
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function escapeHtml(str) {
  if (!str) return "";
  return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
