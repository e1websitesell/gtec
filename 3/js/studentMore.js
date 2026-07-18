import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getAllMenus } from "./menu.js";
import { getAllReceipts } from "./receipts.js";
import { getAllPolls, isPollOpen, castVote, getMyVote, getAllVotes, tallyVotes } from "./polls.js";
import { getMyReportCountToday, submitReport, getAllReports, deleteReport, DAILY_LIMIT } from "./reports.js";
import { getMyNotifications, markNotificationRead } from "./notifications.js";
import { uploadToCloudinary } from "./cloudinary.js";
import { bdToday, addDays, formatBanglaDateFull } from "./dateutils.js";

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");

let currentUid = null;
let currentName = null;

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
  if (data.status !== "approved") {
    window.location.href = "../pending.html";
    return;
  }
  if (data.role === "mainadmin" || data.role === "subadmin") {
    window.location.href = "../admin/dashboard.html";
    return;
  }

  currentUid = user.uid;
  currentName = data.name;

  loadingScreen.style.display = "none";
  appShell.style.display = "block";

  loadMenu();
  loadReceipts();
  loadPolls();
  loadReports();
  loadNotifications();
});

document.getElementById("logoutBtn").addEventListener("click", async (e) => {
  e.preventDefault();
  await signOut(auth);
  window.location.href = "../index.html";
});

// ---------- ট্যাব সুইচ ----------
document.querySelectorAll(".tab-strip button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-strip button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
    if (btn.dataset.tab === "notif") markAllRead();
  });
});

// ---------- মেনু ----------
async function loadMenu() {
  const menus = await getAllMenus();
  const today = bdToday();
  const dates = [];
  for (let i = -2; i <= 4; i++) dates.push(addDays(today, i));

  const menuList = document.getElementById("menuList");
  menuList.innerHTML = dates
    .map((d) => {
      const m = menus[d];
      const isToday = d === today;
      return `
        <div class="item-card" style="${isToday ? "border-color:var(--color-primary);" : ""}">
          <strong>${formatBanglaDateFull(d)}</strong>${isToday ? ' <span class="view-tag" style="margin-left:6px;">আজকে</span>' : ""}
          <p style="margin-top:6px; margin-bottom:0;">${m && m.items && m.items.length ? m.items.join(", ") : "মেনু এখনো দেয়া হয়নি"}</p>
        </div>`;
    })
    .join("");
}

// ---------- রশিদ ----------
async function loadReceipts() {
  const receipts = await getAllReceipts();
  const receiptList = document.getElementById("receiptList");
  if (receipts.length === 0) {
    receiptList.innerHTML = `<div class="empty-state">এখনো কোনো রশিদ আপলোড হয়নি।</div>`;
    return;
  }
  receiptList.innerHTML = receipts
    .map(
      (r) => `
      <div class="item-card">
        <strong>${formatBanglaDateFull(r.date)}</strong>
        ${r.note ? `<p style="margin:4px 0;">${escapeHtml(r.note)}</p>` : ""}
        <img src="${r.imageUrl}" alt="রশিদ" />
      </div>`
    )
    .join("");
}

// ---------- পোল ----------
async function loadPolls() {
  const polls = await getAllPolls();
  const pollList = document.getElementById("pollList");

  if (polls.length === 0) {
    pollList.innerHTML = `<div class="empty-state">এখনো কোনো পোল নেই।</div>`;
    return;
  }

  let html = "";
  for (const poll of polls) {
    const open = isPollOpen(poll);
    const myVote = await getMyVote(poll.id, currentUid);
    const mySelections = myVote ? myVote.selectedOptionIds : [];

    let optionsHtml = "";
    if (open) {
      optionsHtml = poll.options
        .map(
          (o) => `
        <div class="poll-option-row ${mySelections.includes(o.id) ? "selected" : ""}" data-poll="${poll.id}" data-option="${o.id}" data-max="${poll.maxSelectable}">
          ${o.imageUrl ? `<img src="${o.imageUrl}" />` : ""}
          <span>${escapeHtml(o.label)}</span>
        </div>`
        )
        .join("");
    } else {
      const votes = await getAllVotes(poll.id);
      const tally = tallyVotes(poll, votes);
      const total = votes.length || 1;
      optionsHtml = poll.options
        .map((o) => {
          const pct = Math.round(((tally[o.id] || 0) / total) * 100);
          return `
          <div style="margin-bottom:8px;">
            <div style="display:flex; justify-content:space-between; font-size:13px;">
              <span>${escapeHtml(o.label)}</span><span>${tally[o.id] || 0} ভোট</span>
            </div>
            <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
          </div>`;
        })
        .join("");
    }

    html += `
      <div class="item-card">
        <strong>${escapeHtml(poll.question)}</strong>
        <span class="view-tag" style="margin-left:6px; font-size:11px;">${poll.type === "election" ? "ইলেকশন" : "পোল"}</span>
        <p style="font-size:12px; margin:6px 0;">${open ? "এখনো ভোট দেয়া/পরিবর্তন করা যাবে" : "ফলাফল (বন্ধ হয়ে গেছে)"}</p>
        <div data-options-for="${poll.id}">${optionsHtml}</div>
      </div>`;
  }

  pollList.innerHTML = html;

  pollList.querySelectorAll(".poll-option-row").forEach((row) => {
    row.addEventListener("click", async () => {
      const pollId = row.dataset.poll;
      const optionId = row.dataset.option;
      const max = parseInt(row.dataset.max, 10);
      const container = document.querySelector(`[data-options-for="${pollId}"]`);
      const selectedRows = Array.from(container.querySelectorAll(".poll-option-row.selected"));

      let newSelection = selectedRows.map((r) => r.dataset.option);
      if (newSelection.includes(optionId)) {
        newSelection = newSelection.filter((id) => id !== optionId);
        row.classList.remove("selected");
      } else {
        if (newSelection.length >= max) {
          alert(`সর্বোচ্চ ${max}টা সিলেক্ট করা যাবে।`);
          return;
        }
        newSelection.push(optionId);
        row.classList.add("selected");
      }

      try {
        await castVote(pollId, currentUid, newSelection);
      } catch (err) {
        console.error(err);
        alert("ভোট সেভ করতে সমস্যা হয়েছে।");
      }
    });
  });
}

// ---------- রিপোর্ট ----------
async function loadReports() {
  const count = await getMyReportCountToday(currentUid);
  const note = document.getElementById("reportLimitNote");
  note.textContent = `আজকে তুমি ${count}/${DAILY_LIMIT} টা রিপোর্ট দিয়েছো।`;
  document.getElementById("submitReportBtn").disabled = count >= DAILY_LIMIT;

  const reports = await getAllReports();
  const reportList = document.getElementById("reportList");

  if (reports.length === 0) {
    reportList.innerHTML = `<div class="empty-state">এখনো কোনো রিপোর্ট নেই।</div>`;
    return;
  }

  reportList.innerHTML = reports
    .map((r) => {
      const isMine = r.submittedBy === currentUid;
      const name = r.isAnonymous ? "অজানা (অ্যানোনিমাস)" : escapeHtml(r.submitterName || "");
      const media = (r.mediaUrls || [])
        .map((m) => (m.type === "video" ? `<video src="${m.url}" controls style="max-width:100%; margin-top:8px;"></video>` : `<img src="${m.url}" />`))
        .join("");
      return `
        <div class="item-card">
          <div style="display:flex; justify-content:space-between;">
            <strong>${name}</strong>
            <span class="pill ${r.status === "resolved" ? "pill-approved" : "pill-pending"}">${r.status === "resolved" ? "সমাধান হয়েছে" : r.status === "seen" ? "দেখা হয়েছে" : "পেন্ডিং"}</span>
          </div>
          <p style="margin:8px 0 0;">${escapeHtml(r.text)}</p>
          ${media}
          ${isMine ? `<button class="btn btn-danger btn-sm" style="margin-top:10px;" data-delete-report="${r.id}">ডিলিট করো</button>` : ""}
        </div>`;
    })
    .join("");

  reportList.querySelectorAll("[data-delete-report]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("এই রিপোর্ট ডিলিট করতে চাও?")) return;
      await deleteReport(btn.dataset.deleteReport);
      loadReports();
    });
  });
}

document.getElementById("submitReportBtn").addEventListener("click", async () => {
  const text = document.getElementById("reportText").value.trim();
  const isAnon = document.getElementById("reportAnon").checked;
  const fileInput = document.getElementById("reportMedia");

  if (!text) {
    alert("বিবরণ লেখো।");
    return;
  }

  const btn = document.getElementById("submitReportBtn");
  btn.disabled = true;
  btn.textContent = "সাবমিট হচ্ছে...";

  try {
    let mediaUrls = [];
    if (fileInput.files.length > 0) {
      const uploaded = await uploadToCloudinary(fileInput.files[0]);
      mediaUrls = [uploaded];
    }

    await submitReport({ uid: currentUid, name: currentName, text, isAnonymous: isAnon, mediaUrls });

    document.getElementById("reportText").value = "";
    document.getElementById("reportAnon").checked = false;
    fileInput.value = "";
    await loadReports();
  } catch (err) {
    console.error(err);
    if (err.message === "DAILY_LIMIT_REACHED") {
      alert(`আজকের জন্য তোমার রিপোর্ট লিমিট (${DAILY_LIMIT}টা) শেষ হয়ে গেছে।`);
    } else {
      alert("রিপোর্ট সাবমিট করতে সমস্যা হয়েছে।");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = "সাবমিট করো";
  }
});

// ---------- নোটিফিকেশন ----------
let cachedNotifs = [];

async function loadNotifications() {
  cachedNotifs = await getMyNotifications(currentUid);
  const unreadCount = cachedNotifs.filter((n) => !n.isRead).length;
  document.getElementById("notifBadge").textContent = unreadCount > 0 ? `(${unreadCount})` : "";

  const notifList = document.getElementById("notifList");
  if (cachedNotifs.length === 0) {
    notifList.innerHTML = `<div class="empty-state">এখনো কোনো নোটিফিকেশন নেই।</div>`;
    return;
  }

  notifList.innerHTML = cachedNotifs
    .map(
      (n) => `
      <div class="item-card ${!n.isRead ? "notif-unread" : ""}">
        <p style="margin:0;">${escapeHtml(n.message)}</p>
      </div>`
    )
    .join("");
}

async function markAllRead() {
  const unread = cachedNotifs.filter((n) => !n.isRead);
  for (const n of unread) {
    await markNotificationRead(currentUid, n.id);
  }
  if (unread.length > 0) {
    document.getElementById("notifBadge").textContent = "";
  }
}

function escapeHtml(str) {
  if (!str) return "";
  return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
