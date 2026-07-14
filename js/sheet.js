import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  getDocs,
  collection,
  query,
  where,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import {
  bdToday,
  addDays,
  formatDateColumnLabel,
  formatBanglaDateFull,
  resolveSelection,
  MEAL_SHORT,
} from "./dateutils.js";

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const cycleLabel = document.getElementById("cycleLabel");
const noCycleMsg = document.getElementById("noCycleMsg");
const sheetContainer = document.getElementById("sheetContainer");

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

  if (!cycle) {
    noCycleMsg.style.display = "block";
    cycleLabel.textContent = "কোনো সাইকেল নেই";
    return;
  }

  cycleLabel.textContent = `${formatBanglaDateFull(cycle.startDate)} থেকে চলমান`;

  // তারিখের রেঞ্জ: সাইকেল শুরু থেকে আজ পর্যন্ত
  const today = bdToday();
  const dates = [];
  let d = cycle.startDate;
  while (d <= today) {
    dates.push(d);
    d = addDays(d, 1);
  }

  // অ্যাপ্রুভড স্টুডেন্ট লিস্ট
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

  // এই সাইকেলের সব মিল-এন্ট্রি একবারে টেনে আনা (পুরো সাবকালেকশন — প্রতি ইউজার ১টা ডকুমেন্ট)
  const entriesSnap = await getDocs(collection(db, "cycles", cycle.id, "mealEntries"));
  const entriesByUser = {};
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

  let headerCells = `<th class="name-col">নাম</th><th>রুম</th>
    <th>Total<br/>Lunch</th><th>Total<br/>Dinner</th><th>Extra<br/>Lunch</th><th>Total<br/>Meal</th>`;
  dates.forEach((d) => {
    headerCells += `<th>${formatDateColumnLabel(d)}</th>`;
  });

  let bodyRows = "";
  let lastRoom = null;

  students.forEach((student) => {
    const entries = entriesByUser[student.id] || {};

    let totalLunch = 0;
    let totalDinner = 0;
    const cellsHtml = dates
      .map((dateStr) => {
        const resolved = resolveSelection(entries, dateStr, cycleStartDate);
        const val = resolved.value;
        if (val === "lunch" || val === "both") totalLunch++;
        if (val === "dinner" || val === "both") totalDinner++;
        const cls = val === "off" ? "off-cell" : "on-cell";
        return `<td class="${cls}">${MEAL_SHORT[val]}</td>`;
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
      <thead><tr>${headerCells}</tr></thead>
      <tbody>${bodyRows}</tbody>
    </table>`;
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
