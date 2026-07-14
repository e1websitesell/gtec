import { auth, db } from "./firebase-config.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  getDoc,
  updateDoc,
  deleteDoc,
  collection,
  query,
  where,
  onSnapshot,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { getActiveCycle, startNewCycle } from "./cycle.js";
import { bdToday, formatBanglaDateFull } from "./dateutils.js";

const loadingScreen = document.getElementById("loadingScreen");
const appShell = document.getElementById("appShell");
const pendingList = document.getElementById("pendingList");
const approvedList = document.getElementById("approvedList");
const pendingCount = document.getElementById("pendingCount");
const adminRoleLabel = document.getElementById("adminRoleLabel");

let currentRole = null;

// ---------- Route guard: শুধু approved admin/subadmin এই পেজ দেখতে পারবে ----------
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
    // স্টুডেন্ট বা অ্যাপ্রুভড না হলে এই পেজে ঢুকতে পারবে না
    window.location.href = data.status === "approved" ? "../student/home.html" : "../pending.html";
    return;
  }

  currentRole = data.role;
  adminRoleLabel.textContent = currentRole === "mainadmin" ? "মেইন অ্যাডমিন" : "সাব-অ্যাডমিন";

  loadingScreen.style.display = "none";
  appShell.style.display = "block";

  listenPendingUsers();
  listenApprovedUsers();
  loadCycleInfo();
});

// ---------- সাইকেল সেটিংস ----------
async function loadCycleInfo() {
  const cycle = await getActiveCycle();
  const cycleInfo = document.getElementById("cycleInfo");

  if (!cycle) {
    cycleInfo.innerHTML = `কোনো সাইকেল চালু নেই। নতুন সাইকেল শুরু করো।`;
  } else {
    cycleInfo.innerHTML = `<strong>চলমান সাইকেল:</strong> ${formatBanglaDateFull(cycle.startDate)} থেকে শুরু।`;
  }
}

document.getElementById("newCycleBtn").addEventListener("click", () => {
  const form = document.getElementById("newCycleForm");
  form.style.display = form.style.display === "none" ? "block" : "none";
  document.getElementById("cycleStartDate").value = bdToday();
});

document.getElementById("confirmNewCycleBtn").addEventListener("click", async () => {
  const startDate = document.getElementById("cycleStartDate").value;
  if (!startDate) {
    alert("তারিখ সিলেক্ট করো।");
    return;
  }
  if (!confirm(`${formatBanglaDateFull(startDate)} থেকে নতুন সাইকেল শুরু করতে চাও? আগের সাইকেল আর্কাইভ হয়ে যাবে।`)) return;

  try {
    await startNewCycle({ startDate, mealsPerDay: ["lunch", "dinner"] });
    document.getElementById("newCycleForm").style.display = "none";
    loadCycleInfo();
  } catch (err) {
    console.error(err);
    alert("সাইকেল শুরু করতে সমস্যা হয়েছে।");
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await signOut(auth);
  window.location.href = "../index.html";
});

// ---------- পেন্ডিং ইউজার লিস্ট (রিয়েল-টাইম) ----------
function listenPendingUsers() {
  const q = query(collection(db, "users"), where("status", "==", "pending"));

  onSnapshot(q, (snapshot) => {
    pendingCount.textContent = snapshot.size;

    if (snapshot.empty) {
      pendingList.innerHTML = `<div class="empty-state">এখন কোনো পেন্ডিং অ্যাপ্রুভাল নেই।</div>`;
      return;
    }

    let rows = "";
    snapshot.forEach((docSnap) => {
      const u = docSnap.data();
      rows += `
        <tr>
          <td>${escapeHtml(u.name)}</td>
          <td>${escapeHtml(u.roomNumber)}</td>
          <td>${escapeHtml(u.username)}</td>
          <td style="display:flex; gap:8px;">
            <button class="btn btn-primary btn-sm" data-approve="${docSnap.id}">অ্যাপ্রুভ</button>
            <button class="btn btn-danger btn-sm" data-reject="${docSnap.id}">রিজেক্ট</button>
          </td>
        </tr>`;
    });

    pendingList.innerHTML = `
      <table class="data-table">
        <thead>
          <tr><th>নাম</th><th>রুম</th><th>ইউজারনেম</th><th>অ্যাকশন</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`;

    pendingList.querySelectorAll("[data-approve]").forEach((btn) => {
      btn.addEventListener("click", () => setUserStatus(btn.dataset.approve, "approved"));
    });
    pendingList.querySelectorAll("[data-reject]").forEach((btn) => {
      btn.addEventListener("click", () => setUserStatus(btn.dataset.reject, "rejected"));
    });
  });
}

async function setUserStatus(uid, status) {
  try {
    await updateDoc(doc(db, "users", uid), { status });
  } catch (err) {
    console.error(err);
    alert("সমস্যা হয়েছে, আবার চেষ্টা করুন।");
  }
}

// ---------- সব পেন্ডিং একসাথে অ্যাপ্রুভ ----------
document.getElementById("approveAllBtn").addEventListener("click", async () => {
  const q = query(collection(db, "users"), where("status", "==", "pending"));
  const snap = await new Promise((resolve) => {
    const unsub = onSnapshot(q, (s) => {
      unsub();
      resolve(s);
    });
  });

  if (snap.empty) {
    alert("কোনো পেন্ডিং ইউজার নেই।");
    return;
  }

  if (!confirm(`${snap.size} জন ইউজারকে অ্যাপ্রুভ করতে চান?`)) return;

  const promises = [];
  snap.forEach((d) => promises.push(updateDoc(doc(db, "users", d.id), { status: "approved" })));
  await Promise.all(promises);
});

// ---------- অ্যাপ্রুভড ইউজার লিস্ট, রুম-ওয়াইজ গ্রুপ করা ----------
function listenApprovedUsers() {
  const q = query(collection(db, "users"), where("status", "==", "approved"));

  onSnapshot(q, (snapshot) => {
    if (snapshot.empty) {
      approvedList.innerHTML = `<div class="empty-state">এখনো কোনো অ্যাপ্রুভড ইউজার নেই।</div>`;
      return;
    }

    const users = [];
    snapshot.forEach((d) => users.push({ id: d.id, ...d.data() }));

    // রুম নাম্বার অনুযায়ী গ্রুপ করা
    const groups = {};
    users
      .filter((u) => u.role === "student") // শুধু স্টুডেন্ট রুম-ওয়াইজ দেখাবো
      .forEach((u) => {
        if (!groups[u.roomNumber]) groups[u.roomNumber] = [];
        groups[u.roomNumber].push(u);
      });

    const sortedRooms = Object.keys(groups).sort();

    let html = "";
    sortedRooms.forEach((room) => {
      html += `<div class="room-group">
        <div class="room-group-title">রুম ${escapeHtml(room)}</div>
        <table class="data-table">
          <tbody>
            ${groups[room]
              .map(
                (u) => `
              <tr>
                <td>${escapeHtml(u.name)}</td>
                <td>${escapeHtml(u.username)}</td>
                <td><span class="pill pill-approved">অ্যাপ্রুভড</span></td>
                <td><button class="btn btn-danger btn-sm" data-delete="${u.id}">ডিলিট</button></td>
              </tr>`
              )
              .join("")}
          </tbody>
        </table>
      </div>`;
    });

    approvedList.innerHTML = html;

    approvedList.querySelectorAll("[data-delete]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (!confirm("এই ইউজারকে ডিলিট করতে চান? এই অ্যাকশন ফেরানো যাবে না।")) return;
        try {
          await deleteDoc(doc(db, "users", btn.dataset.delete));
        } catch (err) {
          console.error(err);
          alert("ডিলিট করতে সমস্যা হয়েছে।");
        }
      });
    });
  });
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
