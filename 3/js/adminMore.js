import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { setMenu, getAllMenus } from "./menu.js";
import { addReceipt, getAllReceipts } from "./receipts.js";
import { createPoll, getAllPolls, isPollOpen, closePoll, getAllVotes, tallyVotes } from "./polls.js";
import { getAllReports, deleteReport, updateReportStatus, canAdminDelete } from "./reports.js";
import { uploadToCloudinary } from "./cloudinary.js";
import { bdToday, formatBanglaDateFull } from "./dateutils.js";

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");

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

  document.getElementById("menuDate").value = bdToday();
  document.getElementById("receiptDate").value = bdToday();

  loadMenuList();
  loadReceiptList();
  loadPollList();
  loadElectionList();
  loadReportList();
});

// ---------- ট্যাব সুইচ ----------
document.querySelectorAll(".tab-strip button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-strip button").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-pane").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- মেনু ----------
document.getElementById("saveMenuBtn").addEventListener("click", async () => {
  const dateStr = document.getElementById("menuDate").value;
  const items = document.getElementById("menuItems").value.trim();
  if (!dateStr || !items) {
    alert("তারিখ ও খাবারের নাম দাও।");
    return;
  }
  await setMenu(dateStr, items, auth.currentUser.uid);
  document.getElementById("menuItems").value = "";
  loadMenuList();
});

async function loadMenuList() {
  const menus = await getAllMenus();
  const dates = Object.keys(menus).sort((a, b) => (a < b ? 1 : -1));
  const menuList = document.getElementById("menuList");
  if (dates.length === 0) {
    menuList.innerHTML = `<div class="empty-state">এখনো কোনো মেনু দেয়া হয়নি।</div>`;
    return;
  }
  menuList.innerHTML = dates
    .map((d) => `<div class="item-card"><strong>${formatBanglaDateFull(d)}</strong><p style="margin:6px 0 0;">${menus[d].items.join(", ")}</p></div>`)
    .join("");
}

// ---------- রশিদ ----------
document.getElementById("uploadReceiptBtn").addEventListener("click", async () => {
  const dateStr = document.getElementById("receiptDate").value;
  const file = document.getElementById("receiptFile").files[0];
  const note = document.getElementById("receiptNote").value.trim();

  if (!dateStr || !file) {
    alert("তারিখ ও ছবি দাও।");
    return;
  }

  const btn = document.getElementById("uploadReceiptBtn");
  btn.disabled = true;
  btn.textContent = "আপলোড হচ্ছে...";

  try {
    const uploaded = await uploadToCloudinary(file);
    await addReceipt(uploaded.url, dateStr, note);
    document.getElementById("receiptFile").value = "";
    document.getElementById("receiptNote").value = "";
    loadReceiptList();
  } catch (err) {
    console.error(err);
    alert("আপলোড করতে সমস্যা হয়েছে।");
  } finally {
    btn.disabled = false;
    btn.textContent = "আপলোড করো";
  }
});

async function loadReceiptList() {
  const receipts = await getAllReceipts();
  const receiptList = document.getElementById("receiptList");
  if (receipts.length === 0) {
    receiptList.innerHTML = `<div class="empty-state">এখনো কোনো রশিদ নেই।</div>`;
    return;
  }
  receiptList.innerHTML = receipts
    .map((r) => `<div class="item-card"><strong>${formatBanglaDateFull(r.date)}</strong>${r.note ? `<p style="margin:4px 0;">${escapeHtml(r.note)}</p>` : ""}<img src="${r.imageUrl}" /></div>`)
    .join("");
}

// ---------- পোল (সাধারণ) ----------
document.getElementById("addPollOptionBtn").addEventListener("click", () => {
  const container = document.getElementById("pollOptionsContainer");
  const row = document.createElement("div");
  row.className = "option-input-row";
  row.innerHTML = `<input type="text" class="poll-option-input" placeholder="আরেকটা অপশন" />`;
  container.appendChild(row);
});

document.getElementById("createPollBtn").addEventListener("click", async () => {
  const question = document.getElementById("pollQuestion").value.trim();
  const deadline = document.getElementById("pollDeadline").value;
  const optionInputs = Array.from(document.querySelectorAll(".poll-option-input"));
  const options = optionInputs
    .map((inp, i) => ({ id: `opt${i}`, label: inp.value.trim() }))
    .filter((o) => o.label);

  if (!question || options.length < 2 || !deadline) {
    alert("প্রশ্ন, কমপক্ষে ২টা অপশন, এবং ডেডলাইন দাও।");
    return;
  }

  await createPoll({ type: "general", question, options, deadline, maxSelectable: 1 });
  document.getElementById("pollQuestion").value = "";
  document.getElementById("pollDeadline").value = "";
  optionInputs.forEach((inp) => (inp.value = ""));
  loadPollList();
});

async function loadPollList() {
  const polls = (await getAllPolls()).filter((p) => p.type !== "election");
  const pollList = document.getElementById("pollList");
  pollList.innerHTML = await renderPollCards(polls);
}

// ---------- ইলেকশন ----------
document.getElementById("addCandidateBtn").addEventListener("click", () => {
  const container = document.getElementById("electionCandidatesContainer");
  const row = document.createElement("div");
  row.className = "option-input-row";
  row.innerHTML = `<input type="text" class="election-name-input" placeholder="প্রার্থীর নাম" style="flex:1;" /><input type="url" class="election-photo-input" placeholder="ছবির লিংক (অপশনাল)" style="flex:1;" />`;
  container.appendChild(row);
});

document.getElementById("createElectionBtn").addEventListener("click", async () => {
  const question = document.getElementById("electionQuestion").value.trim();
  const deadline = document.getElementById("electionDeadline").value;
  const maxSelectable = parseInt(document.getElementById("electionMaxSelect").value, 10) || 1;

  const names = Array.from(document.querySelectorAll(".election-name-input"));
  const photos = Array.from(document.querySelectorAll(".election-photo-input"));
  const options = names
    .map((inp, i) => ({ id: `cand${i}`, label: inp.value.trim(), imageUrl: photos[i].value.trim() }))
    .filter((o) => o.label);

  if (!question || options.length < 2 || !deadline) {
    alert("টাইটেল, কমপক্ষে ২ জন প্রার্থী, এবং ডেডলাইন দাও।");
    return;
  }

  await createPoll({ type: "election", question, options, deadline, maxSelectable });
  document.getElementById("electionQuestion").value = "";
  document.getElementById("electionDeadline").value = "";
  names.forEach((inp) => (inp.value = ""));
  photos.forEach((inp) => (inp.value = ""));
  loadElectionList();
});

async function loadElectionList() {
  const polls = (await getAllPolls()).filter((p) => p.type === "election");
  const electionList = document.getElementById("electionList");
  electionList.innerHTML = await renderPollCards(polls, true);
}

// ---------- পোল/ইলেকশন কার্ড রেন্ডার (রেজাল্ট + বন্ধ করার বাটন) ----------
async function renderPollCards(polls, isElection) {
  if (polls.length === 0) {
    return `<div class="empty-state">এখনো কোনো ${isElection ? "ইলেকশন" : "পোল"} নেই।</div>`;
  }

  let html = "";
  for (const poll of polls) {
    const votes = await getAllVotes(poll.id);
    const tally = tallyVotes(poll, votes);
    const total = votes.length || 1;
    const open = isPollOpen(poll);

    const optionsHtml = poll.options
      .map((o) => {
        const pct = Math.round(((tally[o.id] || 0) / total) * 100);
        return `
        <div style="margin-bottom:8px;">
          <div style="display:flex; justify-content:space-between; font-size:13px;">
            <span>${o.imageUrl ? `<img src="${o.imageUrl}" style="width:24px; height:24px; border-radius:50%; object-fit:cover; vertical-align:middle; margin-right:6px;" />` : ""}${escapeHtml(o.label)}</span>
            <span>${tally[o.id] || 0} ভোট</span>
          </div>
          <div class="bar-track"><div class="bar-fill" style="width:${pct}%;"></div></div>
        </div>`;
      })
      .join("");

    html += `
      <div class="item-card">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <strong>${escapeHtml(poll.question)}</strong>
          <span class="pill ${open ? "pill-pending" : "pill-approved"}">${open ? "চলমান" : "বন্ধ"}</span>
        </div>
        <p style="font-size:12px; margin:6px 0;">মোট ভোটার: ${votes.length}</p>
        ${optionsHtml}
        ${open ? `<button class="btn btn-danger btn-sm" data-close-poll="${poll.id}" style="margin-top:8px;">এখনই বন্ধ করো</button>` : ""}
      </div>`;
  }

  setTimeout(() => {
    document.querySelectorAll("[data-close-poll]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("এই পোল/ইলেকশন এখনই বন্ধ করতে চাও?")) return;
        await closePoll(btn.dataset.closePoll);
        loadPollList();
        loadElectionList();
      });
    });
  }, 0);

  return html;
}

// ---------- রিপোর্ট ম্যানেজমেন্ট ----------
async function loadReportList() {
  const reports = await getAllReports();
  const adminReportList = document.getElementById("adminReportList");

  if (reports.length === 0) {
    adminReportList.innerHTML = `<div class="empty-state">এখনো কোনো রিপোর্ট নেই।</div>`;
    return;
  }

  adminReportList.innerHTML = reports
    .map((r) => {
      const name = r.isAnonymous ? "অজানা (অ্যানোনিমাস)" : escapeHtml(r.submitterName || "");
      const media = (r.mediaUrls || [])
        .map((m) => (m.type === "video" ? `<video src="${m.url}" controls style="max-width:100%; margin-top:8px;"></video>` : `<img src="${m.url}" />`))
        .join("");
      const canDelete = canAdminDelete(r);
      return `
        <div class="item-card">
          <div style="display:flex; justify-content:space-between;">
            <strong>${name}</strong>
            <span class="pill ${r.status === "resolved" ? "pill-approved" : "pill-pending"}">${r.status}</span>
          </div>
          <p style="margin:8px 0 0;">${escapeHtml(r.text)}</p>
          ${media}
          <div style="display:flex; gap:8px; margin-top:10px; flex-wrap:wrap;">
            <select data-status="${r.id}" style="padding:6px 10px; border-radius:8px; border:1px solid var(--color-border);">
              <option value="pending" ${r.status === "pending" ? "selected" : ""}>পেন্ডিং</option>
              <option value="seen" ${r.status === "seen" ? "selected" : ""}>দেখা হয়েছে</option>
              <option value="resolved" ${r.status === "resolved" ? "selected" : ""}>সমাধান হয়েছে</option>
            </select>
            <button class="btn btn-danger btn-sm" data-delete-report="${r.id}" ${canDelete ? "" : "disabled"}>
              ${canDelete ? "ডিলিট করো" : "১০ দিন পর ডিলিট করা যাবে"}
            </button>
          </div>
        </div>`;
    })
    .join("");

  adminReportList.querySelectorAll("[data-status]").forEach((sel) => {
    sel.addEventListener("change", async () => {
      await updateReportStatus(sel.dataset.status, sel.value);
      loadReportList();
    });
  });

  adminReportList.querySelectorAll("[data-delete-report]:not(:disabled)").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm("এই রিপোর্ট ডিলিট করতে চাও?")) return;
      await deleteReport(btn.dataset.deleteReport);
      loadReportList();
    });
  });
}

function escapeHtml(str) {
  if (!str) return "";
  return str.toString().replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
