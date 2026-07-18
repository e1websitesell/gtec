import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  deleteDoc,
  updateDoc,
  doc,
  getDocs,
  query,
  where,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { bdToday } from "./dateutils.js";

const DAILY_LIMIT = 2;

function timestampToBdDateStr(ts) {
  const date = ts.toDate ? ts.toDate() : new Date(ts);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Dhaka",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));
  return `${map.year}-${map.month}-${map.day}`;
}

export async function getMyReportCountToday(uid) {
  const q = query(collection(db, "reports"), where("submittedBy", "==", uid));
  const snap = await getDocs(q);
  const today = bdToday();
  let count = 0;
  snap.forEach((d) => {
    const data = d.data();
    if (data.createdAt && timestampToBdDateStr(data.createdAt) === today) count++;
  });
  return count;
}

export async function submitReport({ uid, name, text, isAnonymous, mediaUrls }) {
  const count = await getMyReportCountToday(uid);
  if (count >= DAILY_LIMIT) {
    throw new Error("DAILY_LIMIT_REACHED");
  }

  await addDoc(collection(db, "reports"), {
    submittedBy: uid,
    submitterName: name,
    isAnonymous: !!isAnonymous,
    text,
    mediaUrls: mediaUrls || [],
    status: "pending",
    createdAt: serverTimestamp(),
  });
}

export async function getAllReports() {
  const q = query(collection(db, "reports"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function deleteReport(reportId) {
  await deleteDoc(doc(db, "reports", reportId));
}

export async function updateReportStatus(reportId, status) {
  await updateDoc(doc(db, "reports", reportId), { status });
}

export function canAdminDelete(report) {
  if (!report.createdAt) return false;
  const createdMs = report.createdAt.toDate ? report.createdAt.toDate().getTime() : new Date(report.createdAt).getTime();
  const tenDaysMs = 10 * 24 * 60 * 60 * 1000;
  return Date.now() - createdMs > tenDaysMs;
}

export { DAILY_LIMIT };
