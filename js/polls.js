import { db } from "./firebase-config.js";
import {
  collection,
  addDoc,
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  query,
  orderBy,
  serverTimestamp,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function createPoll({ type, question, options, deadline, maxSelectable }) {
  await addDoc(collection(db, "polls"), {
    type: type || "general", // "general" | "election"
    question,
    options, // [{id,label,imageUrl}]
    deadline, // ISO date string "YYYY-MM-DD" বা datetime-local ভ্যালু
    maxSelectable: maxSelectable || 1,
    isClosed: false,
    createdAt: serverTimestamp(),
  });
}

export async function closePoll(pollId) {
  await updateDoc(doc(db, "polls", pollId), { isClosed: true });
}

export async function getAllPolls() {
  const q = query(collection(db, "polls"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

export function isPollOpen(poll) {
  if (poll.isClosed) return false;
  if (!poll.deadline) return true;
  return new Date() < new Date(poll.deadline);
}

export async function castVote(pollId, uid, selectedOptionIds) {
  await setDoc(doc(db, "polls", pollId, "votes", uid), {
    selectedOptionIds,
    updatedAt: serverTimestamp(),
  });
}

export async function getMyVote(pollId, uid) {
  const snap = await getDoc(doc(db, "polls", pollId, "votes", uid));
  return snap.exists() ? snap.data() : null;
}

export async function getAllVotes(pollId) {
  const snap = await getDocs(collection(db, "polls", pollId, "votes"));
  const list = [];
  snap.forEach((d) => list.push({ uid: d.id, ...d.data() }));
  return list;
}

// প্রতিটা অপশনে কতজন ভোট দিয়েছে সেই কাউন্ট বের করা
export function tallyVotes(poll, votes) {
  const counts = {};
  poll.options.forEach((o) => (counts[o.id] = 0));
  votes.forEach((v) => {
    (v.selectedOptionIds || []).forEach((id) => {
      if (counts[id] !== undefined) counts[id]++;
    });
  });
  return counts;
}
