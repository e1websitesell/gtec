// বাংলাদেশ টাইমজোন (Asia/Dhaka, UTC+6) অনুযায়ী তারিখ/সময় হ্যান্ডলিং
// যেহেতু সব ইউজার বাংলাদেশে, ডিভাইসের টাইমজোন যাই হোক না কেন এই হিসাব ব্যবহার হবে

const BD_TZ = "Asia/Dhaka";

const BANGLA_DIGITS = ["০", "১", "২", "৩", "৪", "৫", "৬", "৭", "৮", "৯"];
const BANGLA_WEEKDAYS = ["রবি", "সোম", "মঙ্গল", "বুধ", "বৃহস্পতি", "শুক্র", "শনি"];
const BANGLA_MONTHS = [
  "জানুয়ারি", "ফেব্রুয়ারি", "মার্চ", "এপ্রিল", "মে", "জুন",
  "জুলাই", "আগস্ট", "সেপ্টেম্বর", "অক্টোবর", "নভেম্বর", "ডিসেম্বর",
];

export function toBanglaNumber(n) {
  return n.toString().replace(/[0-9]/g, (d) => BANGLA_DIGITS[d]);
}

export function banglaToEnglishDigits(str) {
  if (!str) return str;
  return str.toString().replace(/[০-৯]/g, (d) => BANGLA_DIGITS.indexOf(d).toString());
}

// এখন বাংলাদেশ সময়ে কত তারিখ/সময় সেটা বের করা
export function bdNowParts() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BD_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(new Date());

  const map = {};
  parts.forEach((p) => (map[p.type] = p.value));

  return {
    dateStr: `${map.year}-${map.month}-${map.day}`,
    hour: parseInt(map.hour === "24" ? "0" : map.hour, 10),
    minute: parseInt(map.minute, 10),
    second: parseInt(map.second, 10),
  };
}

export function bdToday() {
  return bdNowParts().dateStr;
}

export function addDays(dateStr, n) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  const yyyy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function dateStrToWeekdayIndex(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCDay(); // 0 = রবি
}

export function formatBanglaDateShort(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = BANGLA_WEEKDAYS[dateStrToWeekdayIndex(dateStr)];
  return `${toBanglaNumber(d)} ${BANGLA_MONTHS[m - 1].slice(0, 3)}, ${weekday}বার`;
}

export function formatBanglaDateFull(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const weekday = BANGLA_WEEKDAYS[dateStrToWeekdayIndex(dateStr)];
  return `${toBanglaNumber(d)} ${BANGLA_MONTHS[m - 1]}, ${weekday}বার`;
}

export function formatDateColumnLabel(dateStr) {
  const [, m, d] = dateStr.split("-");
  return `${toBanglaNumber(parseInt(d, 10))}/${toBanglaNumber(parseInt(m, 10))}`;
}

// dateStr তারিখটা কি আজকের চেয়ে পরে (মানে এডিটযোগ্য এখনো)?
export function isEditableDate(dateStr) {
  return dateStr > bdToday();
}

// entries ম্যাপ থেকে একটা নির্দিষ্ট তারিখের সিলেকশন বের করা
// যদি সরাসরি সেট করা না থাকে, আগের সবচেয়ে কাছের এন্ট্রি থেকে carry-forward হবে
export function resolveSelection(entriesMap, dateStr, cycleStartDate) {
  if (entriesMap && entriesMap[dateStr]) {
    return { value: entriesMap[dateStr], isCarried: false };
  }

  if (!entriesMap) return { value: "off", isCarried: false };

  // dateStr এর আগের সব key খুঁজে সবচেয়ে বড়টা (নিকটতম আগের তারিখ) বের করা
  const priorKeys = Object.keys(entriesMap)
    .filter((k) => k < dateStr && k >= cycleStartDate)
    .sort();

  if (priorKeys.length === 0) {
    return { value: "off", isCarried: false }; // ডিফল্ট: কোনো হিস্ট্রি নেই তো অফ
  }

  const lastKey = priorKeys[priorKeys.length - 1];
  return { value: entriesMap[lastKey], isCarried: true };
}

export const MEAL_LABELS = {
  lunch: "লাঞ্চ",
  dinner: "ডিনার",
  both: "লাঞ্চ + ডিনার",
  off: "অফ",
};

export const MEAL_SHORT = {
  lunch: "লা",
  dinner: "ডি",
  both: "উভ",
  off: "-",
};
