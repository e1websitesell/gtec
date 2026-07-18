import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  deleteField,
  collection,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import { getAllSpecialValues, getAllGuestMeals } from "./billing.js";
import { getOrCreateExpenses, setExpenseValue } from "./expenses.js";
import {
  bdToday,
  addDays,
  formatDateColumnLabel,
  formatBanglaDateFull,
  resolveSelection,
  MEAL_SHORT,
  MEAL_LABELS,
} from "./dateutils.js";

const CYCLE_LENGTH_DAYS = 31; // কিছু মাস ৩১ দিনের হয়, তাই সর্বোচ্চ ধরে নেয়া
const KEY_MAP = { l: "lunch", d: "dinner", b: "both", o: "off" };
const DOUBLE_PRESS_MS = 600;

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const cycleLabel = document.getElementById("cycleLabel");
const noCycleMsg = document.getElementById("noCycleMsg");
const sheetContainer = document.getElementById("sheetContainer");
const toggleViewBtn = document.getElementById("toggleViewBtn");

let activeCycle = null;
let studentsCache = [];
let entriesByUser = {};
let specialValuesMap = {};
let guestMeals = [];
let expensesData = { market: {}, other: {}, gas: {} };
let selectedCell = null;
let lastKeyInfo = null; // {key, time, cell}
let showFullMonth = false;

const expenseTable = document.getElementById("expenseTable");

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

  await buildSheet();
});

toggleViewBtn.addEventListener("click", () => {
  showFullMonth = !showFullMonth;
  toggleViewBtn.textContent = showFullMonth ? "সংক্ষিপ্ত দেখাও" : "পুরো মাস দেখাও";
  renderTable();
});

const exportSheetCsvBtn = document.getElementById("exportSheetCsvBtn");
if (exportSheetCsvBtn) {
  exportSheetCsvBtn.addEventListener("click", exportSheetCsv);
}

function exportSheetCsv() {
  try {
    if (!activeCycle || studentsCache.length === 0) {
      alert("এক্সপোর্ট করার মতো ডেটা নেই। আগে সাইকেল ও স্টুডেন্ট লোড হতে দাও।");
      return;
    }

    const dates = getVisibleDates();
    const cycleStartDate = activeCycle.startDate;

    const headers = ["নাম", "রুম", "Total Lunch", "Total Dinner", "Extra Lunch", "স্পেশাল মিল", "গেস্ট মিল", "Total Meal", ...dates.map((d) => formatDateColumnLabel(d))];
    const rows = [headers];

    studentsCache.forEach((student) => {
      const entries = entriesByUser[student.id] || {};
      const cellVals = dates.map((dateStr) => MEAL_LABELS[resolveSelection(entries, dateStr, cycleStartDate).value]);
      const s = computeStudentSummary(student);
      rows.push([
        student.name,
        student.roomNumber,
        s.totalLunch,
        s.totalDinner,
        s.extraLunch,
        s.specialBonus.toFixed(1),
        s.guestUnits.toFixed(1),
        s.totalMeal.toFixed(1),
        ...cellVals,
      ]);
    });

    const csvContent = rows.map((r) => r.map(csvEscape).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF" + csvContent], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");
    a.href = url;
    a.download = `meal-sheet-${activeCycle.id}.csv`;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();

    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 1000);
  } catch (err) {
    console.error("CSV export error:", err);
    alert("CSV ডাউনলোড করতে সমস্যা হয়েছে: " + err.message);
  }
}

function csvEscape(val) {
  const str = String(val);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

async function buildSheet() {
  const cycle = await getActiveCycle();
  activeCycle = cycle;

  if (!cycle) {
    noCycleMsg.style.display = "block";
    cycleLabel.textContent = "কোনো সাইকেল নেই";
    return;
  }

  cycleLabel.textContent = `${formatBanglaDateFull(cycle.startDate)} থেকে চলমান`;

  const usersQ = query(
    collection(db, "users"),
    where("status", "==", "approved"),
    where("role", "==", "student")
  );
  const usersSnap = await getDocs(usersQ);
  const students = [];
  usersSnap.forEach((docSnap) => students.push({ id: docSnap.id, ...docSnap.data() }));

  students.sort((a, b) => {
    if (a.roomNumber !== b.roomNumber) return a.roomNumber.localeCompare(b.roomNumber, "en", { numeric: true });
    return a.name.localeCompare(b.name, "bn");
  });
  studentsCache = students;

  const entriesSnap = await getDocs(collection(db, "cycles", cycle.id, "mealEntries"));
  entriesByUser = {};
  entriesSnap.forEach((docSnap) => {
    entriesByUser[docSnap.id] = docSnap.data().entries || {};
  });

  specialValuesMap = await safeLoad(() => getAllSpecialValues(cycle.id), {}, "স্পেশাল ডে ভ্যালু");
  guestMeals = await safeLoad(() => getAllGuestMeals(cycle.id), [], "গেস্ট মিল");

  // মূল মিল শিট আগেই রেন্ডার করে ফেলছি — নিচের খরচের হিসাব লোড করতে সমস্যা হলেও যেন মূল শিট দেখা যায়
  renderTable();

  try {
    expensesData = await getOrCreateExpenses(cycle.id);
    renderExpenseTable();
  } catch (err) {
    console.error("Expense data load error:", err);
    expenseTable.innerHTML = `<tbody><tr><td class="name-col">ব্যয়ের হিসাব লোড করতে সমস্যা হয়েছে। Firestore Rules Publish করা হয়েছে কিনা চেক করো। (${err.message})</td></tr></tbody>`;
  }
}

// কোনো একটা ডেটা লোড ফেইল করলে বাকি পেজ যেন থেমে না যায়
async function safeLoad(fn, fallback, label) {
  try {
    return await fn();
  } catch (err) {
    console.error(`${label} লোড করতে সমস্যা:`, err);
    return fallback;
  }
}

function getFullCycleDates() {
  const dates = [];
  for (let i = 0; i < CYCLE_LENGTH_DAYS; i++) {
    dates.push(addDays(activeCycle.startDate, i));
  }
  return dates;
}

function getVisibleDates() {
  const all = getFullCycleDates();
  if (showFullMonth) return all;

  const today = bdToday();
  const windowStart = addDays(today, -6);
  const windowEnd = addDays(today, 5);
  return all.filter((d) => d >= windowStart && d <= windowEnd);
}

// একটা তারিখে স্পেশাল ভ্যালু সেট থাকলে সেই কলাম আলাদা স্টাইলে (নীল ব্যাকগ্রাউন্ড, লাল লেখা) দেখানো হবে
function specialColorClass(dateStr) {
  const sv = specialValuesMap[dateStr];
  if (!sv) return "";
  const anyDeviation = sv.lunchValue !== 1 || sv.dinnerValue !== 1;
  return anyDeviation ? "special-col" : "";
}

// সামারি (বিলিং-সংক্রান্ত) কলাম সবসময় পুরো সাইকেল থেকে আজ পর্যন্ত হিসাব করবে,
// "সংক্ষিপ্ত/পুরো মাস" টগল শুধু কলাম (দিন-ভিত্তিক ঘর) কয়টা দেখাবে সেটা ঠিক করে, সামারি না
function getFullToDateRange() {
  const today = bdToday();
  const dates = [];
  let d = activeCycle.startDate;
  while (d <= today) {
    dates.push(d);
    d = addDays(d, 1);
  }
  return dates;
}

function getDayValue(dateStr) {
  const sv = specialValuesMap[dateStr];
  return sv ? { lunch: sv.lunchValue, dinner: sv.dinnerValue } : { lunch: 1, dinner: 1 };
}

// একজন স্টুডেন্টের সব সামারি সংখ্যা একসাথে বের করা — Total Lunch/Dinner/Extra/স্পেশাল/গেস্ট/Total Meal
function computeStudentSummary(student) {
  const entries = entriesByUser[student.id] || {};
  const fullDates = getFullToDateRange();

  let totalLunch = 0;
  let totalDinner = 0;
  let specialBonus = 0;

  fullDates.forEach((dateStr) => {
    const val = resolveSelection(entries, dateStr, activeCycle.startDate).value;
    const dayVal = getDayValue(dateStr);
    if (val === "lunch" || val === "both") {
      totalLunch++;
      specialBonus += dayVal.lunch - 1;
    }
    if (val === "dinner" || val === "both") {
      totalDinner++;
      specialBonus += dayVal.dinner - 1;
    }
  });

  const myGuestMeals = guestMeals.filter((g) => g.userId === student.id && g.date <= bdToday());
  let guestLunchCount = 0;
  let guestDinnerCount = 0;
  let guestUnits = 0;
  myGuestMeals.forEach((g) => {
    const dayVal = getDayValue(g.date);
    guestLunchCount += g.lunchCount || 0;
    guestDinnerCount += g.dinnerCount || 0;
    guestUnits += (g.lunchCount || 0) * dayVal.lunch + (g.dinnerCount || 0) * dayVal.dinner;
  });

  const extraLunch = Math.max(0, (totalLunch + guestLunchCount - (totalDinner + guestDinnerCount)) * 0.5);
  const totalMeal = totalLunch + totalDinner + extraLunch + specialBonus + guestUnits;

  return { totalLunch, totalDinner, extraLunch, specialBonus, guestUnits, totalMeal };
}

function renderTable() {
  const students = studentsCache;
  const dates = getVisibleDates();
  const cycleStartDate = activeCycle.startDate;

  if (students.length === 0) {
    sheetContainer.innerHTML = `<div class="empty-state">এখনো কোনো অ্যাপ্রুভড স্টুডেন্ট নেই।</div>`;
    return;
  }

  const today = bdToday();

  let headerCells = `<th class="name-col">নাম</th><th>রুম</th>
    <th>Total<br/>Lunch</th><th>Total<br/>Dinner</th><th>Extra<br/>Lunch</th><th>স্পেশাল<br/>মিল</th><th>গেস্ট<br/>মিল</th><th>Total<br/>Meal</th>`;
  dates.forEach((d) => {
    const isFuture = d > today;
    const specialCls = specialColorClass(d);
    const sv = specialValuesMap[d];
    const title = sv ? ` title="লাঞ্চ: ${sv.lunchValue}, ডিনার: ${sv.dinnerValue}${sv.reason ? " — " + sv.reason : ""}"` : "";
    headerCells += `<th class="${isFuture ? "future-col" : ""} ${specialCls}"${title}>${formatDateColumnLabel(d)}</th>`;
  });

  // ---------- প্রতিদিনের টোটাল (attendance + guest) ----------
  const attLunch = {}, attDinner = {}, guestLunch = {}, guestDinner = {};
  dates.forEach((d) => {
    attLunch[d] = 0; attDinner[d] = 0; guestLunch[d] = 0; guestDinner[d] = 0;
  });

  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};
    dates.forEach((dateStr) => {
      const val = resolveSelection(entries, dateStr, cycleStartDate).value;
      if (val === "lunch" || val === "both") attLunch[dateStr]++;
      if (val === "dinner" || val === "both") attDinner[dateStr]++;
    });
  });

  guestMeals.forEach((g) => {
    if (guestLunch[g.date] !== undefined) guestLunch[g.date] += g.lunchCount || 0;
    if (guestDinner[g.date] !== undefined) guestDinner[g.date] += g.dinnerCount || 0;
  });

  const rowHtml = (label, valuesMap) =>
    `<tr class="daily-total-row"><td class="name-col" colspan="8">${label}</td>${dates
      .map((d) => `<td class="daily-total-cell">${valuesMap[d]}</td>`)
      .join("")}</tr>`;

  const totalLunchRow = {}, totalDinnerRow = {};
  dates.forEach((d) => {
    totalLunchRow[d] = attLunch[d] + guestLunch[d];
    totalDinnerRow[d] = attDinner[d] + guestDinner[d];
  });

  const summaryRows =
    rowHtml("স্টুডেন্ট লাঞ্চ", attLunch) +
    rowHtml("স্টুডেন্ট ডিনার", attDinner) +
    rowHtml("গেস্ট লাঞ্চ", guestLunch) +
    rowHtml("গেস্ট ডিনার", guestDinner) +
    rowHtml("সর্বমোট লাঞ্চ (রান্নার জন্য)", totalLunchRow) +
    rowHtml("সর্বমোট ডিনার (রান্নার জন্য)", totalDinnerRow);

  // ---------- প্রতি স্টুডেন্টের রো ----------
  let bodyRows = "";
  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};

    const cellsHtml = dates
      .map((dateStr) => {
        const resolved = resolveSelection(entries, dateStr, cycleStartDate);
        const val = resolved.value;
        const isFuture = dateStr > today;
        const specialCls = specialColorClass(dateStr);
        const cls = (val === "off" ? "off-cell" : "on-cell") + (isFuture ? " future-col" : "") + (specialCls ? " " + specialCls : "");
        return `<td class="${cls}" tabindex="0" data-uid="${student.id}" data-date="${dateStr}" data-value="${val}">${MEAL_SHORT[val]}</td>`;
      })
      .join("");

    const s = computeStudentSummary(student);

    bodyRows += `
      <tr>
        <td class="name-col">${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.roomNumber)}</td>
        <td class="summary-col">${s.totalLunch}</td>
        <td class="summary-col">${s.totalDinner}</td>
        <td class="summary-col">${s.extraLunch}</td>
        <td class="summary-col">${s.specialBonus.toFixed(1)}</td>
        <td class="summary-col">${s.guestUnits.toFixed(1)}</td>
        <td class="summary-col">${s.totalMeal.toFixed(1)}</td>
        ${cellsHtml}
      </tr>`;
  });

  sheetContainer.innerHTML = `
    <table class="sheet-table">
      <thead>
        ${summaryRows}
        <tr>${headerCells}</tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  sheetContainer.querySelectorAll("td[data-uid]").forEach((td) => {
    td.addEventListener("click", () => selectCell(td));
  });

  selectedCell = null;
}

function selectCell(td) {
  if (selectedCell) selectedCell.classList.remove("cell-selected");
  selectedCell = td;
  td.classList.add("cell-selected");
}

// ---------- কীবোর্ড: একবার চাপলে শুধু ওই দিন বদলাবে (ফ্রিজ), দুইবার দ্রুত চাপলে সেদিন থেকে অটো-ক্যারি শুরু হবে (কাস্কেড) ----------
document.addEventListener("keydown", async (e) => {
  if (!selectedCell) return;
  const key = e.key.toLowerCase();

  if (key === "escape") {
    selectedCell.classList.remove("cell-selected");
    selectedCell = null;
    lastKeyInfo = null;
    return;
  }

  const newValue = KEY_MAP[key];
  if (!newValue) return;

  const now = Date.now();
  const isDouble =
    lastKeyInfo &&
    lastKeyInfo.key === key &&
    lastKeyInfo.cell === selectedCell &&
    now - lastKeyInfo.time < DOUBLE_PRESS_MS;

  const { uid, date } = selectedCell.dataset;
  const oldValue = selectedCell.dataset.value;

  if (isDouble) {
    lastKeyInfo = null;
    await applyCascade(uid, date, newValue, selectedCell);
  } else {
    lastKeyInfo = { key, time: now, cell: selectedCell };
    if (newValue !== oldValue) {
      await applySingle(uid, date, newValue, selectedCell);
    }
  }
});

// ---------- সিঙ্গেল প্রেস: শুধু এই তারিখ বদলাবে, পরের auto-carry দিনগুলো ফ্রিজ হয়ে আগের মতোই থাকবে ----------
async function applySingle(uid, date, newValue, td) {
  td.classList.add("cell-saving");
  const entries = entriesByUser[uid] || {};
  const cycleEnd = addDays(activeCycle.startDate, CYCLE_LENGTH_DAYS);

  const keysAfter = Object.keys(entries).filter((k) => k > date).sort();
  const nextExplicitDate = keysAfter.length > 0 ? keysAfter[0] : cycleEnd;

  const updatePayload = {};
  let d = addDays(date, 1);
  while (d < nextExplicitDate) {
    if (!entries[d]) {
      const frozenVal = resolveSelection(entries, d, activeCycle.startDate).value;
      updatePayload[`entries.${d}`] = frozenVal;
      entries[d] = frozenVal;
    }
    d = addDays(d, 1);
  }
  updatePayload[`entries.${date}`] = newValue;
  entries[date] = newValue;

  await commitChange(uid, date, newValue, updatePayload, entries, td);
}

// ---------- ডাবল প্রেস: এই তারিখ বদলাবে এবং পরের সব এক্সপ্লিসিট এন্ট্রি মুছে দেবে যাতে এখান থেকে নতুন করে অটো-ক্যারি শুরু হয় ----------
async function applyCascade(uid, date, newValue, td) {
  td.classList.add("cell-saving");
  const entries = entriesByUser[uid] || {};
  const cycleEnd = addDays(activeCycle.startDate, CYCLE_LENGTH_DAYS);

  const updatePayload = {};
  let d = addDays(date, 1);
  while (d < cycleEnd) {
    if (entries[d] !== undefined) {
      updatePayload[`entries.${d}`] = deleteField();
      delete entries[d];
    }
    d = addDays(d, 1);
  }
  updatePayload[`entries.${date}`] = newValue;
  entries[date] = newValue;

  await commitChange(uid, date, newValue, updatePayload, entries, td, true);
}

async function commitChange(uid, date, newValue, updatePayload, entries, td, isCascade) {
  try {
    await updateDoc(doc(db, "cycles", activeCycle.id, "mealEntries", uid), updatePayload);

    await addDoc(collection(db, "notifications", uid, "items"), {
      type: "override",
      message: isCascade
        ? `তোমার ${formatBanglaDateFull(date)} তারিখ থেকে মিল অ্যাডমিন পরিবর্তন করে "${MEAL_LABELS[newValue]}" করেছে (এরপর থেকে অটো-ক্যারি হবে)।`
        : `তোমার ${formatBanglaDateFull(date)} তারিখের মিল অ্যাডমিন পরিবর্তন করে "${MEAL_LABELS[newValue]}" করেছে।`,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    entriesByUser[uid] = entries;
    const scrollLeft = sheetContainer.scrollLeft;
    renderTable();
    sheetContainer.scrollLeft = scrollLeft;
  } catch (err) {
    console.error(err);
    td.classList.remove("cell-saving");
    alert("পরিবর্তন সেভ করতে সমস্যা হয়েছে, আবার চেষ্টা করো।");
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str
    .toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------- খরচের হিসাব (মিল শিটের নিচের ৪টা রো) ----------
const EXPENSE_EXTRA_KEY = "extra";

function getExpenseDateKeys() {
  const keys = [];
  for (let i = 0; i < CYCLE_LENGTH_DAYS; i++) {
    keys.push(addDays(activeCycle.startDate, i));
  }
  keys.push(EXPENSE_EXTRA_KEY);
  return keys;
}

function renderExpenseTable() {
  if (!activeCycle) return;
  const keys = getExpenseDateKeys();

  const headerCells = keys
    .map((k) => `<th>${k === EXPENSE_EXTRA_KEY ? "এক্সট্রা" : formatDateColumnLabel(k)}</th>`)
    .join("");

  function inputRow(label, category) {
    const cells = keys
      .map((k) => {
        const val = (expensesData[category] && expensesData[category][k]) || "";
        return `<td><input type="number" step="1" class="expense-input" data-category="${category}" data-key="${k}" value="${val || ""}" placeholder="0" /></td>`;
      })
      .join("");
    const total = keys.reduce((sum, k) => sum + ((expensesData[category] && expensesData[category][k]) || 0), 0);
    return `<tr><td class="name-col">${label}</td>${cells}<td class="expense-total">${total}</td></tr>`;
  }

  function computedRow(label) {
    const cells = keys
      .map((k) => {
        const market = (expensesData.market && expensesData.market[k]) || 0;
        const other = (expensesData.other && expensesData.other[k]) || 0;
        return `<td class="expense-computed">${market - other}</td>`;
      })
      .join("");
    const total = keys.reduce((sum, k) => {
      const market = (expensesData.market && expensesData.market[k]) || 0;
      const other = (expensesData.other && expensesData.other[k]) || 0;
      return sum + (market - other);
    }, 0);
    return `<tr><td class="name-col">${label}</td>${cells}<td class="expense-total expense-computed">${total}</td></tr>`;
  }

  expenseTable.innerHTML = `
    <thead><tr><th class="name-col">খাত</th>${headerCells}<th>টোটাল</th></tr></thead>
    <tbody>
      ${inputRow("মোট বাজার খরচ", "market")}
      ${inputRow("অন্যান্য খরচ", "other")}
      ${computedRow("মিলের বাজার")}
      ${inputRow("গ্যাস বিল", "gas")}
    </tbody>`;

  expenseTable.querySelectorAll(".expense-input").forEach((input) => {
    input.addEventListener("change", async () => {
      const { category, key } = input.dataset;
      const value = parseFloat(input.value) || 0;
      expensesData[category] = expensesData[category] || {};
      expensesData[category][key] = value;
      try {
        await setExpenseValue(activeCycle.id, category, key, value);
      } catch (err) {
        console.error(err);
        alert("খরচের হিসাব সেভ করতে সমস্যা হয়েছে।");
      }
      renderExpenseTable();
    });
  });
}
