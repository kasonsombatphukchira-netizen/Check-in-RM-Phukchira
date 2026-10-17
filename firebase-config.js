// ============================================================
//  ตั้งค่า Firebase — แก้ 2 จุด แล้วบันทึก
//  1) วางค่า firebaseConfig จาก Firebase Console (Project settings → Your apps)
//  2) ใส่ Gmail ของผู้ดูแลระบบหลัก (RM) ใน OWNER_EMAIL
// ============================================================
export const firebaseConfig = {
  apiKey: "AIzaSyBTFj_9MHKxqLLuP5TJNwYoDK2LPMcf2oI",
  authDomain: "check-in-rm-phukchira.firebaseapp.com",
  projectId: "check-in-rm-phukchira",
  storageBucket: "check-in-rm-phukchira.firebasestorage.app",
  messagingSenderId: "53493484639",
  appId: "1:53493484639:web:ba3c789d9332ae5385dfea"
};

// Gmail ผู้ดูแลระบบหลัก (ต้องตรงกับ ownerEmails() ในไฟล์ firestore.rules)
export const OWNER_EMAILS = ["kasonsombatphukchira@gmail.com", "kanlys.2541@gmail.com"];
export const OWNER_EMAIL = OWNER_EMAILS[0];

// ชื่อระบบที่แสดงบนหน้าจอ
export const APP_NAME = "Check-In";

// รัศมีเริ่มต้น (เมตร) เมื่อเพิ่มสาขาใหม่
export const DEFAULT_RADIUS = 200;
