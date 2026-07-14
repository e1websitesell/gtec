import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import {
  bdToday,
  addDays,
  formatBanglaDateShort,
  formatBanglaDateFull,
  isEditableDate,
  resolveSelection,
  MEAL_LABELS,
} from "./dateutils.js";

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const statusBadge = document.getElementById("statusBadge");
const statusText = document.getElementById("statusText");
const todayLabel = document.getElementById("todayLabel");
const noCycleMsg = document.getElementById("noCycleMsg");
const calendarSection = document.getElementById("calendarSection");
const dayList = document.getElementById("dayList");

const DAYS_AHEAD = 14;

let currentUid = null;
let cycle = null;
let entriesMap = {};

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    window.location.href = "../index.html";
    return;
  }

  const userSnap = await getDoc(doc(db, "users", user.uid));
  if (!userSnap.exists()) {
    window.location.href = "../index.html";
    return;
  }

  const userData = userSnap.data();

  if (userData.status !== "approved") {
    window.location.href = "../pending.html";
    return;
  }
  if (userData.role === "mainadmin" || userData.role === "subadmin") {
    window.location.href = "../admin/dashboard.html";
    return;
  }

  currentUid = user.uid;
  document.getElementById("welcomeText").textContent = `${userData.name} · রুম ${userData.roomNumber}`;

  cycle = await getActiveCycle();

  loadingScreen.style.display = "none";
  appShell.style.display = "block";

  if (!cycle) {
    noCycleMsg.style.display = "block";
    calendarSection.style.display = "none";
    statusText.textContent = "সাইকেল নেই";
    return;
  }

  noCycleMsg.style.display = "none";
  calendarSection.style.display = "block";

  await loadMyEntries();
  renderTodayStatus();
  renderCalendar();
});

document.getElementById("logoutBtn").addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
  window.location.href = "../index.html";
});

async function loadMyEntries() {
  const ref = doc(db, "cycles", cycle.id, "mealEntries", currentUid);
  const snap = await getDoc(ref);

  if (!snap.exists()) {
    await setDoc(ref, { entries: {} });
    entriesMap = {};
  } else {
    entriesMap = snap.data().entries || {};
  }
}

function renderTodayStatus() {
  const today = bdToday();
  todayLabel.textContent = `আজকের মিল · ${formatBanglaDateShort(today)}`;

  const resolved = resolveSelection(entriesMap, today, cycle.startDate);
  const isOff = resolved.value === "off";

  statusBadge.classList.toggle("status-on", !isOff);
  statusBadge.classList.toggle("status-off", isOff);
  statusText.textContent = MEAL_LABELS[resolved.value] + (resolved.isCarried ? " (অটো)" : "");
}

function renderCalendar() {
  const today = bdToday();
  let html = "";

  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const dateStr = addDays(today, i);
    const resolved = resolveSelection(entriesMap, dateStr, cycle.startDate);
    const editable = isEditableDate(dateStr); // ভবিষ্যতের তারিখ, সবসময় true এখানে যেহেতু i>=1

    html += `
      <div class="day-card">
        <div class="day-card-head">
          <span class="day-card-date">${formatBanglaDateFull(dateStr)}</span>
          ${resolved.isCarried ? '<span class="carried-tag">অটো-ক্যারি</span>' : ""}
        </div>
        <div class="option-grid" data-date="${dateStr}">
          ${["lunch", "dinner", "both", "off"]
            .map(
              (opt) => `
            <button type="button" class="option-btn ${resolved.value === opt ? "selected" : ""}"
              data-date="${dateStr}" data-value="${opt}">
              ${MEAL_LABELS[opt]}
            </button>`
            )
            .join("")}
        </div>
      </div>`;
  }

  dayList.innerHTML = html;

  dayList.querySelectorAll(".option-btn").forEach((btn) => {
    btn.addEventListener("click", () => handleSelect(btn.dataset.date, btn.dataset.value));
  });
}

async function handleSelect(dateStr, value) {
  if (!isEditableDate(dateStr)) {
    alert("এই তারিখের মিল আর পরিবর্তন করা যাবে না, কাটঅফ টাইম পার হয়ে গেছে।");
    renderCalendar();
    return;
  }

  // optimistic UI update
  entriesMap[dateStr] = value;
  renderCalendar();
  if (dateStr === bdToday()) renderTodayStatus();

  try {
    const ref = doc(db, "cycles", cycle.id, "mealEntries", currentUid);
    await updateDoc(ref, { [`entries.${dateStr}`]: value });
  } catch (err) {
    console.error(err);
    alert("সেভ করতে সমস্যা হয়েছে, আবার চেষ্টা করো।");
    await loadMyEntries();
    renderCalendar();
  }
}
