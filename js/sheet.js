import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  updateDoc,
  addDoc,
  collection,
  query,
  where,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import {
  bdToday,
  addDays,
  formatDateColumnLabel,
  formatBanglaDateFull,
  resolveSelection,
  MEAL_SHORT,
  MEAL_LABELS,
} from "./dateutils.js";

const CYCLE_LENGTH_DAYS = 30; // পুরা মাসের কলাম আগে থেকেই দেখানোর জন্য

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const cycleLabel = document.getElementById("cycleLabel");
const noCycleMsg = document.getElementById("noCycleMsg");
const sheetContainer = document.getElementById("sheetContainer");
const editModal = document.getElementById("editModal");

let activeCycle = null;
let studentsCache = [];
let entriesByUser = {};

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

async function buildSheet() {
  const cycle = await getActiveCycle();
  activeCycle = cycle;

  if (!cycle) {
    noCycleMsg.style.display = "block";
    cycleLabel.textContent = "কোনো সাইকেল নেই";
    return;
  }

  cycleLabel.textContent = `${formatBanglaDateFull(cycle.startDate)} থেকে চলমান`;

  const dates = [];
  for (let i = 0; i < CYCLE_LENGTH_DAYS; i++) {
    dates.push(addDays(cycle.startDate, i));
  }

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

  renderTable(students, dates, entriesByUser, cycle.startDate);
}

function renderTable(students, dates, entriesByUser, cycleStartDate) {
  if (students.length === 0) {
    sheetContainer.innerHTML = `<div class="empty-state">এখনো কোনো অ্যাপ্রুভড স্টুডেন্ট নেই।</div>`;
    return;
  }

  const today = bdToday();

  let headerCells = `<th class="name-col">নাম</th><th>রুম</th>
    <th>Total<br/>Lunch</th><th>Total<br/>Dinner</th><th>Extra<br/>Lunch</th><th>Total<br/>Meal</th>`;
  dates.forEach((d) => {
    const isFuture = d > today;
    headerCells += `<th class="${isFuture ? "future-col" : ""}">${formatDateColumnLabel(d)}</th>`;
  });

  // ---------- প্রতিদিন মোট লাঞ্চ/ডিনার (রাধুনির জন্য) ----------
  const dailyLunchCount = {};
  const dailyDinnerCount = {};
  dates.forEach((d) => {
    dailyLunchCount[d] = 0;
    dailyDinnerCount[d] = 0;
  });

  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};
    dates.forEach((dateStr) => {
      const val = resolveSelection(entries, dateStr, cycleStartDate).value;
      if (val === "lunch" || val === "both") dailyLunchCount[dateStr]++;
      if (val === "dinner" || val === "both") dailyDinnerCount[dateStr]++;
    });
  });

  const lunchRow = dates.map((d) => `<td class="daily-total-cell">${dailyLunchCount[d]}</td>`).join("");
  const dinnerRow = dates.map((d) => `<td class="daily-total-cell">${dailyDinnerCount[d]}</td>`).join("");

  // ---------- প্রতি স্টুডেন্টের রো ----------
  let bodyRows = "";
  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};

    let totalLunch = 0;
    let totalDinner = 0;
    const cellsHtml = dates
      .map((dateStr) => {
        const resolved = resolveSelection(entries, dateStr, cycleStartDate);
        const val = resolved.value;
        const isFuture = dateStr > today;
        if (!isFuture) {
          // সামারি (বিলিং) হিসাব শুধু আজ পর্যন্ত ফাইনাল দিনগুলো দিয়ে হবে
          if (val === "lunch" || val === "both") totalLunch++;
          if (val === "dinner" || val === "both") totalDinner++;
        }
        const cls = (val === "off" ? "off-cell" : "on-cell") + (isFuture ? " future-col" : "");
        return `<td class="${cls}" data-uid="${student.id}" data-date="${dateStr}" data-current="${val}" data-name="${escapeHtml(student.name)}">${MEAL_SHORT[val]}</td>`;
      })
      .join("");

    const extraLunch = Math.max(0, (totalLunch - totalDinner) * 0.5);
    const totalMeal = totalLunch + totalDinner + extraLunch;

    bodyRows += `
      <tr>
        <td class="name-col">${escapeHtml(student.name)}</td>
        <td>${escapeHtml(student.roomNumber)}</td>
        <td class="summary-col">${totalLunch}</td>
        <td class="summary-col">${totalDinner}</td>
        <td class="summary-col">${extraLunch}</td>
        <td class="summary-col">${totalMeal}</td>
        ${cellsHtml}
      </tr>`;
  });

  sheetContainer.innerHTML = `
    <table class="sheet-table">
      <thead>
        <tr>${headerCells}</tr>
        <tr class="daily-total-row">
          <td class="name-col" colspan="6">প্রতিদিন মোট লাঞ্চ</td>
          ${lunchRow}
        </tr>
        <tr class="daily-total-row">
          <td class="name-col" colspan="6">প্রতিদিন মোট ডিনার</td>
          ${dinnerRow}
        </tr>
      </thead>
      <tbody>${bodyRows}</tbody>
    </table>`;

  sheetContainer.querySelectorAll("td[data-uid]").forEach((td) => {
    td.addEventListener("click", () => openEditModal(td.dataset));
  });
}

// ---------- এডিট মোডাল (অ্যাডমিন ওভাররাইট) ----------
function openEditModal({ uid, date, current, name }) {
  editModal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3 style="margin-bottom:4px;">${name}</h3>
        <p style="margin-bottom:14px;">${formatBanglaDateFull(date)} — এই দিনের মিল পরিবর্তন করো</p>
        <div class="option-grid">
          ${["lunch", "dinner", "both", "off"]
            .map(
              (opt) => `
            <button type="button" class="option-btn ${current === opt ? "selected" : ""}" data-value="${opt}">
              ${MEAL_LABELS[opt]}
            </button>`
            )
            .join("")}
        </div>
        <button class="btn btn-outline btn-sm" id="modalCancelBtn" style="margin-top:16px; width:100%;">বাতিল করো</button>
      </div>
    </div>`;

  editModal.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => saveOverride(uid, date, btn.dataset.value, current, name));
  });
  editModal.querySelector("#modalCancelBtn").addEventListener("click", closeModal);
}

function closeModal() {
  editModal.innerHTML = "";
}

async function saveOverride(uid, date, newValue, oldValue, name) {
  if (newValue === oldValue) {
    closeModal();
    return;
  }
  if (!confirm(`${name}-এর ${formatBanglaDateFull(date)} তারিখের মিল "${MEAL_LABELS[newValue]}" করতে চাও?`)) {
    return;
  }

  try {
    await updateDoc(doc(db, "cycles", activeCycle.id, "mealEntries", uid), {
      [`entries.${date}`]: newValue,
    });

    await addDoc(collection(db, "notifications", uid, "items"), {
      type: "override",
      message: `তোমার ${formatBanglaDateFull(date)} তারিখের মিল অ্যাডমিন পরিবর্তন করে "${MEAL_LABELS[newValue]}" করেছে।`,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    closeModal();
    entriesByUser[uid] = entriesByUser[uid] || {};
    entriesByUser[uid][date] = newValue;
    const dates = [];
    for (let i = 0; i < CYCLE_LENGTH_DAYS; i++) dates.push(addDays(activeCycle.startDate, i));
    renderTable(studentsCache, dates, entriesByUser, activeCycle.startDate);
  } catch (err) {
    console.error(err);
    alert("পরিবর্তন করতে সমস্যা হয়েছে, আবার চেষ্টা করো।");
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
