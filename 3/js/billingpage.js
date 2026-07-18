import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, collection, query, where } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import { bdToday, addDays, formatBanglaDateFull, formatDateColumnLabel } from "./dateutils.js";
import {
  getAllSpecialValues,
  setSpecialValue,
  getAllGuestMeals,
  getAllPayments,
  addPayment,
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
const paymentModal = document.getElementById("paymentModal");

let cycle = null;
let students = [];
let entriesByUser = {};
let specialValuesMap = {};
let guestMeals = [];
let payments = [];
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

  specialValuesMap = await getAllSpecialValues(cycle.id);
  guestMeals = await getAllGuestMeals(cycle.id);
  payments = await getAllPayments(cycle.id);

  document.getElementById("mealRateInput").value = cycle.mealRate || "";
  document.getElementById("fixedCostInput").value = cycle.fixedCostPerHead || "";

  renderSpecialList();
  renderGuestMealList();
  renderBillingTable();
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

// ---------- বিলিং টেবিল ----------
function renderBillingTable() {
  const mealRate = cycle.mealRate || 0;
  const fixedCost = cycle.fixedCostPerHead || 0;

  let headerRow = `<tr>
    <th class="name-col">নাম</th><th>রুম</th>
    <th>Att.<br/>Lunch</th><th>Att.<br/>Dinner</th><th>Extra</th>
    <th>Guest<br/>Units</th><th>Total<br/>Units</th>
    <th>মিল বিল</th><th>ফিক্সড কস্ট</th><th>টোটাল বিল</th>
    <th>জমা</th><th>Due/Return</th><th>অ্যাকশন</th>
  </tr>`;

  let bodyRows = "";

  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};
    const myGuestMeals = guestMeals.filter((g) => g.userId === student.id);
    const result = computeStudentBilling(entries, dates, cycle.startDate, specialValuesMap, myGuestMeals);

    const guestUnits = myGuestMeals.reduce((sum, g) => {
      const dayVal = specialValuesMap[g.date]
        ? { lunch: specialValuesMap[g.date].lunchValue, dinner: specialValuesMap[g.date].dinnerValue }
        : { lunch: 1, dinner: 1 };
      return sum + (g.lunchCount || 0) * dayVal.lunch + (g.dinnerCount || 0) * dayVal.dinner;
    }, 0);

    const mealBill = result.billingUnits * mealRate;
    const totalBill = mealBill + fixedCost;

    const myPayments = payments.filter((p) => p.userId === student.id);
    const totalPaid = myPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const due = totalBill - totalPaid; // পজিটিভ = বাকি আছে, নেগেটিভ = বেশি দিয়েছে (ফেরত)

    bodyRows += `
      <tr>
        <td class="name-col">${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.roomNumber)}</td>
        <td>${result.attendanceLunch}</td>
        <td>${result.attendanceDinner}</td>
        <td>${result.extraLunch}</td>
        <td>${guestUnits.toFixed(1)}</td>
        <td><strong>${result.billingUnits.toFixed(1)}</strong></td>
        <td>${mealBill.toFixed(2)}</td>
        <td>${fixedCost.toFixed(2)}</td>
        <td><strong>${totalBill.toFixed(2)}</strong></td>
        <td>${totalPaid.toFixed(2)}</td>
        <td class="${due > 0 ? "due-positive" : due < 0 ? "due-negative" : ""}">
          ${due > 0 ? `বাকি ${due.toFixed(2)}` : due < 0 ? `ফেরত ${Math.abs(due).toFixed(2)}` : "০"}
        </td>
        <td><button class="btn btn-outline btn-sm" data-pay="${student.id}" data-name="${escapeHtml(student.name)}">পেমেন্ট যোগ</button></td>
      </tr>`;
  });

  billingTable.innerHTML = `<thead>${headerRow}</thead><tbody>${bodyRows}</tbody>`;

  billingTable.querySelectorAll("[data-pay]").forEach((btn) => {
    btn.addEventListener("click", () => openPaymentModal(btn.dataset.pay, btn.dataset.name));
  });
}

// ---------- পেমেন্ট এন্ট্রি মোডাল ----------
function openPaymentModal(uid, name) {
  const myPayments = payments.filter((p) => p.userId === uid);
  const historyHtml = myPayments.length
    ? myPayments.map((p) => `<div class="diff-row" style="border:none; padding:4px 0;">${p.date} — ৳${p.amount} ${p.note ? `(${escapeHtml(p.note)})` : ""}</div>`).join("")
    : `<p style="font-size:12.5px;">এখনো কোনো পেমেন্ট নেই।</p>`;

  paymentModal.innerHTML = `
    <div class="modal-backdrop-billing">
      <div class="modal-box-billing">
        <h3 style="margin-bottom:12px;">${name} — পেমেন্ট</h3>
        <div style="max-height:150px; overflow-y:auto; margin-bottom:14px;">${historyHtml}</div>
        <div class="field">
          <label>নতুন কিস্তির পরিমাণ (৳)</label>
          <input type="number" id="paymentAmount" step="1" />
        </div>
        <div class="field">
          <label>নোট (অপশনাল)</label>
          <input type="text" id="paymentNote" placeholder="যেমন: ২য় কিস্তি" />
        </div>
        <div style="display:flex; gap:10px; margin-top:14px;">
          <button class="btn btn-outline" id="paymentCancel" style="width:auto; flex:1;">বন্ধ করো</button>
          <button class="btn btn-primary" id="paymentSave" style="width:auto; flex:1;">যোগ করো</button>
        </div>
      </div>
    </div>`;

  document.getElementById("paymentCancel").addEventListener("click", () => (paymentModal.innerHTML = ""));
  document.getElementById("paymentSave").addEventListener("click", async () => {
    const amount = document.getElementById("paymentAmount").value;
    const note = document.getElementById("paymentNote").value.trim();
    if (!amount || isNaN(amount)) {
      alert("সঠিক পরিমাণ দাও।");
      return;
    }
    await addPayment(cycle.id, uid, amount, note);
    payments = await getAllPayments(cycle.id);
    paymentModal.innerHTML = "";
    renderBillingTable();
  });
}

// ---------- CSV এক্সপোর্ট (UTF-8 BOM) ----------
document.getElementById("exportCsvBtn").addEventListener("click", () => {
  const mealRate = cycle.mealRate || 0;
  const fixedCost = cycle.fixedCostPerHead || 0;

  const headers = ["নাম", "রুম", "Attendance Lunch", "Attendance Dinner", "Extra Lunch", "Guest Units", "Total Units", "মিল বিল", "ফিক্সড কস্ট", "টোটাল বিল", "জমা", "Due/Return"];
  const rows = [headers];

  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};
    const myGuestMeals = guestMeals.filter((g) => g.userId === student.id);
    const result = computeStudentBilling(entries, dates, cycle.startDate, specialValuesMap, myGuestMeals);
    const guestUnits = myGuestMeals.reduce((sum, g) => {
      const dayVal = specialValuesMap[g.date]
        ? { lunch: specialValuesMap[g.date].lunchValue, dinner: specialValuesMap[g.date].dinnerValue }
        : { lunch: 1, dinner: 1 };
      return sum + (g.lunchCount || 0) * dayVal.lunch + (g.dinnerCount || 0) * dayVal.dinner;
    }, 0);
    const mealBill = result.billingUnits * mealRate;
    const totalBill = mealBill + fixedCost;
    const myPayments = payments.filter((p) => p.userId === student.id);
    const totalPaid = myPayments.reduce((s, p) => s + (p.amount || 0), 0);
    const due = totalBill - totalPaid;

    rows.push([
      student.name,
      student.roomNumber,
      result.attendanceLunch,
      result.attendanceDinner,
      result.extraLunch,
      guestUnits.toFixed(1),
      result.billingUnits.toFixed(1),
      mealBill.toFixed(2),
      fixedCost.toFixed(2),
      totalBill.toFixed(2),
      totalPaid.toFixed(2),
      due.toFixed(2),
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
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
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
