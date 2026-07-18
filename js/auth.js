import { auth, db, usernameToEmail } from "./firebase-config.js";
import { banglaToEnglishDigits } from "./dateutils.js";
import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  onAuthStateChanged,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import {
  doc,
  setDoc,
  getDoc,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- DOM references ----------
const tabLoginBtn = document.getElementById("tabLoginBtn");
const tabSignupBtn = document.getElementById("tabSignupBtn");
const loginForm = document.getElementById("loginForm");
const signupForm = document.getElementById("signupForm");
const errorBox = document.getElementById("errorBox");
const successBox = document.getElementById("successBox");

function showError(msg) {
  errorBox.textContent = msg;
  errorBox.classList.add("show");
  successBox.classList.remove("show");
}

function showSuccess(msg) {
  successBox.textContent = msg;
  successBox.classList.add("show");
  errorBox.classList.remove("show");
}

function clearAlerts() {
  errorBox.classList.remove("show");
  successBox.classList.remove("show");
}

// ---------- Tab switching ----------
tabLoginBtn.addEventListener("click", () => {
  tabLoginBtn.classList.add("active");
  tabSignupBtn.classList.remove("active");
  loginForm.style.display = "block";
  signupForm.style.display = "none";
  clearAlerts();
});

tabSignupBtn.addEventListener("click", () => {
  tabSignupBtn.classList.add("active");
  tabLoginBtn.classList.remove("active");
  signupForm.style.display = "block";
  loginForm.style.display = "none";
  clearAlerts();
});

// ---------- Firebase Auth error গুলো বাংলায় দেখানো ----------
function translateAuthError(code) {
  const map = {
    "auth/user-not-found": "এই ইউজারনেমে কোনো অ্যাকাউন্ট পাওয়া যায়নি।",
    "auth/wrong-password": "পাসওয়ার্ড ভুল হয়েছে।",
    "auth/invalid-credential": "ইউজারনেম বা পাসওয়ার্ড ভুল।",
    "auth/email-already-in-use": "এই ইউজারনেম আগে থেকেই নেয়া হয়ে গেছে, অন্য একটা দিন।",
    "auth/weak-password": "পাসওয়ার্ড কমপক্ষে ৬ ক্যারেক্টার হতে হবে।",
    "auth/invalid-email": "ইউজারনেমে শুধু ইংরেজি অক্ষর ও সংখ্যা ব্যবহার করুন।",
    "auth/too-many-requests": "অনেকবার চেষ্টা হয়েছে, একটু পর আবার চেষ্টা করুন।",
  };
  return map[code] || "কিছু একটা সমস্যা হয়েছে, আবার চেষ্টা করুন।";
}

// ---------- সাইনআপ ----------
signupForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlerts();

  const name = document.getElementById("signupName").value.trim();
  const room = banglaToEnglishDigits(document.getElementById("signupRoom").value.trim());
  const username = document.getElementById("signupUsername").value.trim();
  const password = document.getElementById("signupPassword").value;

  if (!name || !room || !username || !password) {
    showError("সব ফিল্ড পূরণ করুন।");
    return;
  }

  const btn = document.getElementById("signupBtn");
  const spinner = document.getElementById("signupSpinner");
  const btnText = document.getElementById("signupBtnText");
  btn.disabled = true;
  spinner.style.display = "inline-block";
  btnText.textContent = "অপেক্ষা করুন...";

  try {
    const email = usernameToEmail(username);
    const cred = await createUserWithEmailAndPassword(auth, email, password);

    // Firestore এ ইউজার ডকুমেন্ট তৈরি — স্ট্যাটাস pending
    await setDoc(doc(db, "users", cred.user.uid), {
      name,
      roomNumber: room,
      username: username.toLowerCase(),
      status: "pending",
      role: "student",
      createdAt: serverTimestamp(),
    });

    showSuccess("অ্যাকাউন্ট তৈরি হয়েছে। অ্যাডমিন অ্যাপ্রুভ করলে ব্যবহার করতে পারবেন।");
    // onAuthStateChanged নিজেই এখন pending.html এ পাঠিয়ে দেবে
  } catch (err) {
    console.error(err);
    showError(translateAuthError(err.code));
    btn.disabled = false;
    spinner.style.display = "none";
    btnText.textContent = "অ্যাকাউন্ট তৈরি করুন";
  }
});

// ---------- লগইন ----------
loginForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  clearAlerts();

  const username = document.getElementById("loginUsername").value.trim();
  const password = document.getElementById("loginPassword").value;

  const btn = document.getElementById("loginBtn");
  const spinner = document.getElementById("loginSpinner");
  const btnText = document.getElementById("loginBtnText");
  btn.disabled = true;
  spinner.style.display = "inline-block";
  btnText.textContent = "অপেক্ষা করুন...";

  try {
    const email = usernameToEmail(username);
    await signInWithEmailAndPassword(auth, email, password);
    // onAuthStateChanged নিজেই সঠিক পেজে পাঠিয়ে দেবে
  } catch (err) {
    console.error(err);
    showError(translateAuthError(err.code));
    btn.disabled = false;
    spinner.style.display = "none";
    btnText.textContent = "লগইন করুন";
  }
});

// ---------- লগইন হয়ে গেলে স্ট্যাটাস/রোল অনুযায়ী সঠিক পেজে পাঠানো ----------
onAuthStateChanged(auth, async (user) => {
  if (!user) return; // লগইন করা নেই, এই পেজেই থাকবে

  try {
    const userDocRef = doc(db, "users", user.uid);
    const snap = await getDoc(userDocRef);

    if (!snap.exists()) {
      showError("ইউজার তথ্য পাওয়া যায়নি, আবার চেষ্টা করুন।");
      return;
    }

    const data = snap.data();

    if (data.status === "pending") {
      window.location.href = "pending.html";
    } else if (data.status === "rejected") {
      showError("আপনার অ্যাকাউন্ট রিজেক্ট করা হয়েছে। অ্যাডমিনের সাথে যোগাযোগ করুন।");
    } else if (data.role === "mainadmin" || data.role === "subadmin") {
      window.location.href = "admin/dashboard.html";
    } else {
      window.location.href = "student/home.html";
    }
  } catch (err) {
    console.error(err);
  }
});
