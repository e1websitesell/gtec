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

const KEY_MAP = { l: "lunch", d: "dinner", b: "both", o: "off" };

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const cycleLabel = document.getElementById("cycleLabel");
const noCycleMsg = document.getElementById("noCycleMsg");
const sheetContainer = document.getElementById("sheetContainer");

let activeCycle = null;
let studentsCache = [];
let entriesByUser = {};
let selectedCell = null; // বর্তমানে সিলেক্ট করা <td>

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

  renderTable();
}

function getDateRange() {
  const dates = [];
  for (let i = 0; i < CYCLE_LENGTH_DAYS; i++) {
    dates.push(addDays(activeCycle.startDate, i));
  }
  return dates;
}

function renderTable() {
  const students = studentsCache;
  const dates = getDateRange();
  const cycleStartDate = activeCycle.startDate;

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
          totalLunch += val === "lunch" || val === "both" ? 1 : 0;
          totalDinner += val === "dinner" || val === "both" ? 1 : 0;
        }
        const cls = (val === "off" ? "off-cell" : "on-cell") + (isFuture ? " future-col" : "");
        return `<td class="${cls}" tabindex="0" data-uid="${student.id}" data-date="${dateStr}" data-value="${val}">${MEAL_SHORT[val]}</td>`;
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
    td.addEventListener("click", () => selectCell(td));
  });

  selectedCell = null;
}

// ---------- সেল সিলেক্ট করা (হাইলাইট) ----------
function selectCell(td) {
  if (selectedCell) selectedCell.classList.remove("cell-selected");
  selectedCell = td;
  td.classList.add("cell-selected");
}

// ---------- কীবোর্ড শর্টকাট: L/D/B/O চাপলে সাথে সাথে সেভ ----------
document.addEventListener("keydown", async (e) => {
  if (!selectedCell) return;

  const key = e.key.toLowerCase();

  if (key === "escape") {
    selectedCell.classList.remove("cell-selected");
    selectedCell = null;
    return;
  }

  const newValue = KEY_MAP[key];
  if (!newValue) return;

  const { uid, date } = selectedCell.dataset;
  const oldValue = selectedCell.dataset.value;
  if (newValue === oldValue) return; // কোনো পরিবর্তন নেই

  await applyOverride(uid, date, newValue, selectedCell);
});

// ---------- ওভাররাইট সেভ করা — শুধু এই তারিখটাই বদলাবে, ক্যাসকেড আটকাতে পরের auto-carry দিনগুলো ফ্রিজ করে দেয়া হয় ----------
async function applyOverride(uid, date, newValue, td) {
  td.classList.add("cell-saving");

  const entries = entriesByUser[uid] || {};
  const cycleEnd = addDays(activeCycle.startDate, CYCLE_LENGTH_DAYS); // exclusive

  // এই তারিখের পরের যেসব দিনে কোনো এক্সপ্লিসিট এন্ট্রি নেই (মানে carry-forward এর উপর নির্ভরশীল),
  // সেগুলোর বর্তমান (পুরনো ভ্যালু দিয়ে হিসাব করা) মান ফ্রিজ করে রাখা হচ্ছে যাতে এই একটা পরিবর্তনে তারা না বদলে যায়
  const keysAfter = Object.keys(entries)
    .filter((k) => k > date)
    .sort();
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

  try {
    await updateDoc(doc(db, "cycles", activeCycle.id, "mealEntries", uid), updatePayload);

    await addDoc(collection(db, "notifications", uid, "items"), {
      type: "override",
      message: `তোমার ${formatBanglaDateFull(date)} তারিখের মিল অ্যাডমিন পরিবর্তন করে "${MEAL_LABELS[newValue]}" করেছে।`,
      isRead: false,
      createdAt: serverTimestamp(),
    });

    entriesByUser[uid] = entries;
    td.dataset.value = newValue;
    td.textContent = MEAL_SHORT[newValue];
    td.classList.remove("off-cell", "on-cell");
    td.classList.add(newValue === "off" ? "off-cell" : "on-cell");
    td.classList.remove("cell-saving");

    // সামারি কলাম ও ডেইলি টোটাল রো আপডেট করতে পুরো টেবিল রিফ্রেশ করা (হালকা অপারেশন, নেটওয়ার্ক কল লাগে না)
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
