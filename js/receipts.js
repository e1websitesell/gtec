import { db } from "./firebase-config.js";
import { collection, addDoc, getDocs, query, orderBy, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function addReceipt(imageUrl, dateStr, note) {
  await addDoc(collection(db, "receipts"), {
    imageUrl,
    date: dateStr,
    note: note || "",
    createdAt: serverTimestamp(),
  });
}

export async function getAllReceipts() {
  const q = query(collection(db, "receipts"), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const list = [];
  snap.forEach((d) => list.push({ id: d.id, ...d.data() }));
  return list;
}
