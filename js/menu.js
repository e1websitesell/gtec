import { db } from "./firebase-config.js";
import { doc, setDoc, getDoc, getDocs, collection } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

export async function setMenu(dateStr, itemsText, updatedBy) {
  const items = itemsText
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  await setDoc(doc(db, "menus", dateStr), { items, updatedBy });
}

export async function getMenu(dateStr) {
  const snap = await getDoc(doc(db, "menus", dateStr));
  return snap.exists() ? snap.data() : null;
}

export async function getAllMenus() {
  const snap = await getDocs(collection(db, "menus"));
  const map = {};
  snap.forEach((d) => (map[d.id] = d.data()));
  return map;
}
