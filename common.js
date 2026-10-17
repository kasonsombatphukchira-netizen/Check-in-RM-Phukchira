import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { firebaseConfig, APP_NAME } from "./firebase-config.js";

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

export const $ = (id) => document.getElementById(id);

document.querySelectorAll("[data-appname]").forEach((el) => (el.textContent = APP_NAME));

// ระยะทางระหว่าง 2 พิกัด (เมตร)
export function haversine(lat1, lon1, lat2, lon2) {
  const R = 6371000, t = (x) => (x * Math.PI) / 180;
  const dLat = t(lat2 - lat1), dLon = t(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(t(lat1)) * Math.cos(t(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

export function fmtDist(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + " กม." : Math.round(m) + " ม.";
}

// รหัสประจำเครื่อง (สร้างครั้งเดียว เก็บในเบราว์เซอร์)
export function getDeviceId() {
  const KEY = "amci_device_id";
  try {
    let id = localStorage.getItem(KEY);
    if (!id) {
      id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));
      localStorage.setItem(KEY, id);
    }
    return id;
  } catch (e) {
    return "nostorage-" + navigator.userAgent.length;
  }
}

export function isMobile() {
  const ua = navigator.userAgent;
  if (/Android|iPhone|iPod|iPad/i.test(ua)) return true;
  // iPadOS แสดงตัวเป็น Macintosh แต่มีจอสัมผัส
  return /Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
}

export function isInAppBrowser() {
  return /\bLine\/|FBAN|FBAV|FB_IAB|Instagram|MicroMessenger/i.test(navigator.userAgent);
}

const TZ = "Asia/Bangkok";
export function bkkDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d); // YYYY-MM-DD
}
export function fmtTime(d) {
  return d ? new Intl.DateTimeFormat("th-TH", { timeZone: TZ, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(d) : "-";
}
export function fmtDateTime(d) {
  return d ? new Intl.DateTimeFormat("th-TH", { timeZone: TZ, dateStyle: "medium", timeStyle: "short" }).format(d) : "-";
}
export function fmtDateLong(d = new Date()) {
  return new Intl.DateTimeFormat("th-TH", { timeZone: TZ, dateStyle: "full" }).format(d);
}

export const GESTURES = [
  { emoji: "✌️", text: "ชู 2 นิ้ว" },
  { emoji: "👍", text: "ชูนิ้วโป้ง" },
  { emoji: "👌", text: "ทำมือ OK" },
  { emoji: "☝️", text: "ชู 1 นิ้ว" },
  { emoji: "✋", text: "ชูฝ่ามือ 5 นิ้ว" },
  { emoji: "🤟", text: "ชู 3 นิ้ว" },
  { emoji: "🫶", text: "ทำมือรูปหัวใจ" },
  { emoji: "✊", text: "กำมือชูขึ้น" }
];

export function errText(e) {
  const c = (e && e.code) || "";
  const map = {
    "auth/invalid-credential": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    "auth/wrong-password": "อีเมลหรือรหัสผ่านไม่ถูกต้อง",
    "auth/user-not-found": "ไม่พบบัญชีนี้ในระบบ",
    "auth/invalid-email": "รูปแบบอีเมลไม่ถูกต้อง",
    "auth/too-many-requests": "ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่",
    "auth/network-request-failed": "อินเทอร์เน็ตมีปัญหา กรุณาลองใหม่",
    "auth/weak-password": "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร",
    "auth/email-already-in-use": "อีเมลนี้มีบัญชีอยู่แล้ว",
    "auth/user-disabled": "บัญชีนี้ถูกปิดการใช้งาน",
    "auth/requires-recent-login": "กรุณาออกจากระบบแล้วเข้าใหม่อีกครั้ง",
    "permission-denied": "ระบบปฏิเสธการบันทึก (อาจอยู่นอกพื้นที่สาขา หรือเครื่องยังไม่ได้รับอนุมัติ)",
    "unavailable": "เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาตรวจสอบอินเทอร์เน็ต"
  };
  return map[c] || (e && e.message) || String(e);
}

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

export function busy(btn, on, label) {
  if (!btn) return;
  if (on) { btn.dataset.label = btn.textContent; btn.textContent = label || "กำลังดำเนินการ..."; btn.disabled = true; }
  else { btn.textContent = btn.dataset.label || btn.textContent; btn.disabled = false; }
}

/* ---------- ตารางกะ ---------- */
export const LATE_GRACE_MIN = 20; // อนุโลมมาสาย (นาที)
export const SHIFT_CODES = {
  A: { s: "08:00", e: "17:00" }, B: { s: "04:30", e: "13:30" }, C: { s: "05:00", e: "14:00" },
  D: { s: "05:30", e: "14:30" }, E: { s: "07:00", e: "16:00" }, F: { s: "08:00", e: "17:00" },
  G: { s: "09:30", e: "18:30" }, I: { s: "10:30", e: "19:30" }, J: { s: "11:00", e: "20:00" },
  K: { s: "12:00", e: "21:00" }, W: { s: "12:00", e: "21:00" }, L: { s: "13:00", e: "22:00" },
  M: { s: "21:00", e: "06:00" }, N: { s: "15:00", e: "24:00" }, O1: { s: "08:00", e: "17:00", note: "เปิดเซฟ" },
  H: { off: "วันหยุด" }, V: { off: "พักร้อน" }, T: { off: "Training" }, MT: { off: "อบรม" },
  "ลากิจ": { off: "ลากิจ" }, "ลาป่วย": { off: "ลาป่วย" }, "ลาคลอด": { off: "ลาคลอด" }
};
export function normCode(v) {
  const s = String(v ?? "").trim();
  return /^[a-z0-9]+$/i.test(s) ? s.toUpperCase() : s;
}
export function shiftInfo(code) { return SHIFT_CODES[normCode(code)] || null; }
export function shiftLabel(code) {
  const c = normCode(code), i = shiftInfo(c);
  if (!c) return "ไม่มีกะ";
  if (!i) return `รหัส ${c}`;
  return i.off ? i.off : `กะ ${c} ${i.s}–${i.e}${i.note ? " (" + i.note + ")" : ""}`;
}
export function phoneKey(p) { const d = String(p ?? "").replace(/\D/g, ""); return d.length >= 9 ? d.slice(-9) : ""; }
export function bkkTime(day, hhmm) {
  if (hhmm === "24:00") return new Date(new Date(day + "T00:00:00+07:00").getTime() + 86400000);
  return new Date(`${day}T${hhmm}:00+07:00`);
}
export function shiftWindow(day, info) {
  const s = bkkTime(day, info.s); let e = bkkTime(day, info.e);
  if (e <= s) e = new Date(e.getTime() + 86400000);
  return { s, e };
}
