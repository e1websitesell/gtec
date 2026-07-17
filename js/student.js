import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle } from "./cycle.js";
import { addGuestMeal, getGuestMealsForUser } from "./billing.js";
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
const editModeBtn = document.getElementById("editModeBtn");
const editBar = document.getElementById("editBar");
const viewHint = document.getElementById("viewHint");
const cancelEditBtn = document.getElementById("cancelEditBtn");
const saveEditBtn = document.getElementById("saveEditBtn");
const confirmModal = document.getElementById("confirmModal");

const DAYS_AHEAD = 14;

let currentUid = null;
let cycle = null;
let savedEntriesMap = {}; // Firestore থেকে লোড হওয়া, শেষ সেভ করা অবস্থা
let workingEntriesMap = {}; // এডিট মোডে ইউজার যা পরিবর্তন করছে (লোকাল, সেভের আগ পর্যন্ত)
let isEditMode = false;

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
  document.getElementById("guestSection").style.display = "block";
  document.getElementById("guestDate").value = bdToday();

  await loadMyEntries();
  renderTodayStatus();
  renderCalendar();
  await loadGuestMeals();
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
    savedEntriesMap = {};
  } else {
    savedEntriesMap = snap.data().entries || {};
  }
  workingEntriesMap = { ...savedEntriesMap };
}

function renderTodayStatus() {
  const today = bdToday();
  todayLabel.textContent = `আজকের মিল · ${formatBanglaDateShort(today)}`;

  const resolved = resolveSelection(savedEntriesMap, today, cycle.startDate);
  const isOff = resolved.value === "off";

  statusBadge.classList.toggle("status-on", !isOff);
  statusBadge.classList.toggle("status-off", isOff);
  statusText.textContent = MEAL_LABELS[resolved.value] + (resolved.isCarried ? " (অটো)" : "");
}

// ---------- ভিউ/এডিট মোড টগল ----------
editModeBtn.addEventListener("click", () => {
  isEditMode = true;
  workingEntriesMap = { ...savedEntriesMap };
  editModeBtn.style.display = "none";
  editBar.style.display = "flex";
  viewHint.style.display = "none";
  renderCalendar();
});

cancelEditBtn.addEventListener("click", () => {
  isEditMode = false;
  workingEntriesMap = { ...savedEntriesMap };
  editModeBtn.style.display = "inline-flex";
  editBar.style.display = "none";
  viewHint.style.display = "block";
  renderCalendar();
});

saveEditBtn.addEventListener("click", () => {
  const today = bdToday();
  const changedDates = [];

  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const dateStr = addDays(today, i);
    const oldResolved = resolveSelection(savedEntriesMap, dateStr, cycle.startDate).value;
    const newResolved = resolveSelection(workingEntriesMap, dateStr, cycle.startDate).value;
    if (oldResolved !== newResolved) {
      changedDates.push({ dateStr, oldValue: oldResolved, newValue: newResolved });
    }
  }

  if (changedDates.length === 0) {
    alert("কোনো পরিবর্তন করা হয়নি।");
    return;
  }

  showConfirmModal(changedDates);
});

function showConfirmModal(changedDates) {
  const rows = changedDates
    .map(
      (c) => `
      <div class="diff-row">
        <span>${formatBanglaDateFull(c.dateStr)}</span>
        <span>${MEAL_LABELS[c.oldValue]} → <strong>${MEAL_LABELS[c.newValue]}</strong></span>
      </div>`
    )
    .join("");

  confirmModal.innerHTML = `
    <div class="modal-backdrop">
      <div class="modal-box">
        <h3 style="margin-bottom:4px;">পরিবর্তন কনফার্ম করো</h3>
        <p style="margin-bottom:10px;">${changedDates.length}টা দিনের মিল পরিবর্তন হবে —</p>
        ${rows}
        <div class="modal-actions">
          <button class="btn btn-outline" id="modalCancel">বাতিল করো</button>
          <button class="btn btn-primary" id="modalConfirm">কনফার্ম করো</button>
        </div>
      </div>
    </div>`;

  document.getElementById("modalCancel").addEventListener("click", () => {
    confirmModal.innerHTML = "";
  });
  document.getElementById("modalConfirm").addEventListener("click", () => applyChanges(changedDates));
}

async function applyChanges(changedDates) {
  const btn = document.getElementById("modalConfirm");
  btn.disabled = true;
  btn.textContent = "সেভ হচ্ছে...";

  try {
    const updatePayload = {};
    changedDates.forEach((c) => {
      updatePayload[`entries.${c.dateStr}`] = c.newValue;
      savedEntriesMap[c.dateStr] = c.newValue;
    });

    const ref = doc(db, "cycles", cycle.id, "mealEntries", currentUid);
    await updateDoc(ref, updatePayload);

    confirmModal.innerHTML = "";
    isEditMode = false;
    workingEntriesMap = { ...savedEntriesMap };
    editModeBtn.style.display = "inline-flex";
    editBar.style.display = "none";
    viewHint.style.display = "block";
    renderTodayStatus();
    renderCalendar();
  } catch (err) {
    console.error(err);
    alert("সেভ করতে সমস্যা হয়েছে, আবার চেষ্টা করো।");
    btn.disabled = false;
    btn.textContent = "কনফার্ম করো";
  }
}

// ---------- ক্যালেন্ডার রেন্ডার (ভিউ বা এডিট মোড অনুযায়ী) ----------
function renderCalendar() {
  const today = bdToday();
  const activeMap = isEditMode ? workingEntriesMap : savedEntriesMap;
  let html = "";

  for (let i = 1; i <= DAYS_AHEAD; i++) {
    const dateStr = addDays(today, i);
    const resolved = resolveSelection(activeMap, dateStr, cycle.startDate);

    if (isEditMode) {
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
    } else {
      html += `
        <div class="day-card">
          <div class="day-card-head" style="margin-bottom:0;">
            <span class="day-card-date">${formatBanglaDateFull(dateStr)}</span>
            <span>
              ${resolved.isCarried ? '<span class="carried-tag">অটো-ক্যারি</span>' : ""}
              <span class="view-tag">${MEAL_LABELS[resolved.value]}</span>
            </span>
          </div>
        </div>`;
    }
  }

  dayList.innerHTML = html;

  if (isEditMode) {
    dayList.querySelectorAll(".option-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        workingEntriesMap[btn.dataset.date] = btn.dataset.value;
        renderCalendar();
      });
    });
  }
}

// ---------- গেস্ট মিল ----------
async function loadGuestMeals() {
  const list = await getGuestMealsForUser(cycle.id, currentUid);
  const guestHistory = document.getElementById("guestHistory");

  if (list.length === 0) {
    guestHistory.innerHTML = `<div class="empty-state">এখনো কোনো গেস্ট মিল দাওনি।</div>`;
    return;
  }

  guestHistory.innerHTML = list
    .map(
      (g) => `
      <div class="day-card" style="display:flex; justify-content:space-between; align-items:center; padding:12px 14px;">
        <span>${formatBanglaDateFull(g.date)}</span>
        <span style="font-size:13px; color:var(--color-text-muted);">লাঞ্চ: ${g.lunchCount} · ডিনার: ${g.dinnerCount}</span>
      </div>`
    )
    .join("");
}

document.getElementById("addGuestBtn").addEventListener("click", async () => {
  const dateStr = document.getElementById("guestDate").value;
  const lunchCount = document.getElementById("guestLunch").value;
  const dinnerCount = document.getElementById("guestDinner").value;

  if (!dateStr) {
    alert("তারিখ সিলেক্ট করো।");
    return;
  }
  if ((Number(lunchCount) || 0) === 0 && (Number(dinnerCount) || 0) === 0) {
    alert("কমপক্ষে একটা মিল সংখ্যা দাও।");
    return;
  }

  const btn = document.getElementById("addGuestBtn");
  btn.disabled = true;

  try {
    await addGuestMeal(cycle.id, currentUid, dateStr, lunchCount, dinnerCount);
    document.getElementById("guestLunch").value = 0;
    document.getElementById("guestDinner").value = 0;
    await loadGuestMeals();
  } catch (err) {
    console.error(err);
    alert("গেস্ট মিল যোগ করতে সমস্যা হয়েছে।");
  } finally {
    btn.disabled = false;
  }
});
