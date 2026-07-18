import { db } from "./firebase-config.js";
import {
  collection,
  doc,
  updateDoc,
  getDocs,
  query,
  orderBy,
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function getMyNotifications(uid) {
  const q = query(collection(db, "notifications", uid, "items"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}

export async function markNotificationRead(uid, notifId) {
  await updateDoc(doc(db, "notifications", uid, "items", notifId), { isRead: true });
}
