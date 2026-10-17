import { auth, db, $, fmtTime, fmtDateTime, bkkDay, errText, esc, busy, phoneKey, normCode, shiftInfo, shiftWindow, LATE_GRACE_MIN } from "./common.js";
import { firebaseConfig, OWNER_EMAILS, DEFAULT_RADIUS } from "./firebase-config.js";
import * as CFG from "./firebase-config.js";
const MULTI_ZONE = CFG.MULTI_ZONE !== false; // false = ใช้คนเดียว ไม่แบ่งเขต
import { initializeApp, deleteApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, signOut, onAuthStateChanged, createUserWithEmailAndPassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, query, where, orderBy, limit, startAfter, writeBatch, Timestamp, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";


const SCREENS = ["scLoading", "scLogin", "scDenied", "scPanel"];
const screen = (id) => { SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id)); $("btnLogout").classList.toggle("hidden", id === "scLogin" || id === "scLoading"); };
const msg = (id, t, k = "err") => { $(id).textContent = t || ""; $(id).className = "msg " + k; };

const STAFF_DOMAIN = ""; // ใส่ "lotuss.com" ถ้าต้องการบังคับโดเมนอีเมลพนักงาน ("" = ใช้อีเมลอะไรก็ได้)
let branches = [], allBranches = [], users = [], reportRows = [], zones = [];
let me = { uid: "", role: "", zoneId: "", owner: false };
const isRM = () => me.owner || me.role === "rm" || me.role === "admin";
const bName = (id) => (allBranches.find((b) => b.id === id) || {}).name || id || "-";
const bZoneOf = (id) => (allBranches.find((b) => b.id === id) || {}).zoneId || "";
const zName = (id) => (zones.find((z) => z.id === id) || {}).name || id || "-";
const ROLE_LABEL = { rm: "RM / RL", admin: "RM / RL", am: "AM", staff: "พนักงาน" };
const monthsBetween = (a, b) => { const out = []; let [y, m] = a.split("-").map(Number); const [y2, m2] = b.split("-").map(Number);
  while (y < y2 || (y === y2 && m <= m2)) { out.push(`${y}-${String(m).padStart(2, "0")}`); m++; if (m > 12) { m = 1; y++; } } return out; };
const nextMonth = (ym) => { let [y, m] = ym.split("-").map(Number); m++; if (m > 12) { m = 1; y++; } return `${y}-${String(m).padStart(2, "0")}`; };

/* ---------- auth ---------- */
onAuthStateChanged(auth, async (user) => {
  if (!user) return screen("scLogin");
  screen("scLoading");
  try {
    const ref = doc(db, "users", user.uid);
    let snap = await getDoc(ref);
    const isOwner = OWNER_EMAILS.map((e) => e.toLowerCase()).includes((user.email || "").toLowerCase());
    if (!snap.exists() && isOwner) {
      await setDoc(ref, { name: "ผู้ดูแลระบบ", email: user.email, empId: "", position: "RM", branchId: "", zoneId: "", role: "rm", active: true, mustChangePassword: false, deviceId: "", createdAt: serverTimestamp() });
      snap = await getDoc(ref);
    }
    const p = snap.exists() ? snap.data() : {};
    me = { uid: user.uid, role: p.role || "", zoneId: p.zoneId || "", owner: isOwner, name: p.name || user.email };
    const allowed = isRM() || (me.role === "am" && me.zoneId && p.active !== false);
    if (!allowed) { $("scDenied").querySelector("p").textContent = me.role === "am" ? "บัญชี AM นี้ยังไม่ได้กำหนดเขต — ติดต่อ RM" : "บัญชีนี้ไม่ใช่ผู้ดูแลระบบ"; return screen("scDenied"); }
    document.querySelectorAll(".rm-only").forEach((el) => el.classList.toggle("hidden", !isRM() || !MULTI_ZONE));
    if (!MULTI_ZONE) document.querySelectorAll("#uRole option[value=am]").forEach((o) => o.remove());
    screen("scPanel");
    await loadZones();
    $("whoami").textContent = !MULTI_ZONE ? "ผู้ดูแล" : isRM() ? "RM / RL" : `AM · ${zName(me.zoneId)}`;
    $("staffLink").textContent = new URL("./", location.href).href;
    await loadBranches();
    await loadUsers();
    if (isRM()) loadZones();
    loadDevices();
    const today = bkkDay();
    $("rFrom").value = today; $("rTo").value = today;
    $("aMonth").value = today.slice(0, 7); $("aGrace").textContent = LATE_GRACE_MIN;
    runReport();
  } catch (e) { screen("scLogin"); msg("liMsg", e && e.code === "permission-denied" ? "ล็อกอินได้แต่ฐานข้อมูลปฏิเสธการอ่าน — ตรวจว่าวาง Rules ล่าสุดใน Firebase และกด Publish แล้ว" : errText(e)); }
});
$("btnLogin").onclick = async () => {
  busy($("btnLogin"), true);
  try { await signInWithEmailAndPassword(auth, $("liEmail").value.trim(), $("liPw").value); msg("liMsg", ""); }
  catch (e) { msg("liMsg", errText(e)); }
  finally { busy($("btnLogin"), false); }
};
$("btnLogout").onclick = () => signOut(auth);

/* ---------- tabs ---------- */
$("tabs").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  [...$("tabs").children].forEach((x) => x.classList.toggle("on", x === b));
  ["report", "shifts", "devices", "users", "branches", "zones", "tools"].forEach((t) => $("t-" + t).classList.toggle("hidden", t !== b.dataset.t));
  if (b.dataset.t === "devices") loadDevices();
  if (b.dataset.t === "zones") loadZones();
});

/* ---------- photo modal ---------- */
document.addEventListener("click", async (e) => {
  const img = e.target.closest("img.thumb");
  const pb = e.target.closest("button[data-pid]");
  if (!img && !pb) return;
  let src = img ? img.src : null;
  if (pb) {
    try {
      const s = await getDoc(doc(db, "checkinPhotos", pb.dataset.pid));
      src = s.exists() ? s.data().photo : null;
    } catch (err) { src = null; }
    if (!src) { alert("ไม่พบรูป (อาจถูกลบตามรอบลบรูปเก่าแล้ว)"); return; }
  }
  $("photoBig").src = src; $("photoCap").textContent = (img || pb).dataset.cap || "";
  $("photoModal").classList.remove("hidden");
});
$("btnPhotoClose").onclick = () => $("photoModal").classList.add("hidden");
$("photoModal").onclick = (e) => { if (e.target.id === "photoModal") $("photoModal").classList.add("hidden"); };

/* ================= สาขา ================= */
async function loadBranches() {
  allBranches = (await getDocs(collection(db, "branches"))).docs.map((d) => ({ id: d.id, ...d.data() }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));
  branches = isRM() ? allBranches : allBranches.filter((b) => b.zoneId === me.zoneId);
  $("bCount").textContent = branches.length;
  const opts = branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.id)})</option>`).join("");
  $("rBranch").innerHTML = `<option value="">ทุกสาขา</option>` + opts;
  $("aBranch").innerHTML = `<option value="">ทุกสาขา</option>` + opts;
  $("uBranch").innerHTML = `<option value="">— ไม่ระบุ —</option>` + opts;
  $("tBranches").innerHTML = `<tr><th>รหัส</th><th>ชื่อสาขา</th><th>เขต</th><th>พิกัด</th><th>รัศมี</th><th>แผนที่</th><th></th></tr>` +
    branches.map((b) => {
      const has = typeof b.lat === "number" && typeof b.lng === "number";
      return `<tr><td>${esc(b.id)}</td><td>${esc(b.name)}</td><td>${b.zoneId ? esc(zName(b.zoneId)) : `<span class="tag warn">ยังไม่กำหนด</span>`}</td>
        <td>${has ? `${b.lat.toFixed(6)}, ${b.lng.toFixed(6)}` : `<span class="tag off">ยังไม่มีพิกัด</span>`}</td>
        <td>${b.radius || DEFAULT_RADIUS} ม.</td>
        <td>${has ? `<a href="https://www.google.com/maps?q=${b.lat},${b.lng}" target="_blank" rel="noopener">เปิด</a>` : "-"}</td>
        <td class="actions"><button class="btn sm" data-bedit="${esc(b.id)}">แก้ไข</button><button class="btn sm danger" data-bdel="${esc(b.id)}">ลบ</button></td></tr>`;
    }).join("");
}
function parseNum(v) { const n = parseFloat(String(v).trim()); return Number.isFinite(n) ? n : null; }
$("bLat").addEventListener("input", () => {
  const m = $("bLat").value.match(/(-?\d+\.\d+)\s*,\s*(-?\d+\.\d+)/);
  if (m) { $("bLat").value = m[1]; $("bLng").value = m[2]; }
});
$("btnBSave").onclick = async () => {
  const id = $("bCode").value.trim(), name = $("bName").value.trim();
  const lat = parseNum($("bLat").value), lng = parseNum($("bLng").value), radius = parseNum($("bRad").value) || DEFAULT_RADIUS;
  if (!id || !name) return msg("bMsg", "กรอกรหัสและชื่อสาขา");
  if (/[\/]/.test(id)) return msg("bMsg", "รหัสสาขาห้ามมีเครื่องหมาย /");
  if ((lat === null) !== (lng === null)) return msg("bMsg", "กรอก Latitude และ Longitude ให้ครบทั้งคู่");
  if (lat !== null && (lat < 5 || lat > 21 || lng < 97 || lng > 106)) return msg("bMsg", "พิกัดไม่อยู่ในประเทศไทย ตรวจสอบอีกครั้ง (lat ก่อน lng)");
  busy($("btnBSave"), true);
  try {
    if (isRM()) await setDoc(doc(db, "branches", id), { name, lat, lng, radius, zoneId: $("bZone").value || "" });
    else {
      const other = allBranches.find((b) => b.id === id && b.zoneId && b.zoneId !== me.zoneId);
      if (other) throw new Error(`สาขา ${id} อยู่ในเขต ${zName(other.zoneId)} — แก้ไขได้เฉพาะสาขาในเขตตัวเอง`);
      await setDoc(doc(db, "branches", id), { name, lat, lng, radius, zoneId: me.zoneId });
    }
    msg("bMsg", "บันทึกแล้ว", "ok"); clearBranchForm(); await loadBranches();
  }
  catch (e) { msg("bMsg", errText(e)); }
  finally { busy($("btnBSave"), false); }
};
function clearBranchForm() { ["bCode", "bName", "bLat", "bLng", "bRad"].forEach((i) => ($(i).value = "")); $("bCode").disabled = false; $("bName").disabled = false; $("bZone").value = ""; }
$("btnBClear").onclick = clearBranchForm;
$("btnBHere").onclick = () => {
  msg("bMsg", "กำลังหาตำแหน่ง...", "ok");
  navigator.geolocation.getCurrentPosition(
    (p) => { $("bLat").value = p.coords.latitude.toFixed(6); $("bLng").value = p.coords.longitude.toFixed(6); msg("bMsg", `ได้ตำแหน่งแล้ว (ความแม่นยำ ±${Math.round(p.coords.accuracy)} ม.)`, "ok"); },
    () => msg("bMsg", "หาตำแหน่งไม่ได้ — อนุญาตการใช้ตำแหน่งในเบราว์เซอร์ก่อน"),
    { enableHighAccuracy: true, timeout: 20000 }
  );
};
$("tBranches").addEventListener("click", async (e) => {
  const ed = e.target.dataset.bedit, del = e.target.dataset.bdel;
  if (ed) {
    const b = branches.find((x) => x.id === ed);
    $("bCode").value = b.id; $("bCode").disabled = true; $("bName").value = b.name || "";
    $("bLat").value = b.lat ?? ""; $("bLng").value = b.lng ?? ""; $("bRad").value = b.radius || DEFAULT_RADIUS;
    $("bZone").value = b.zoneId || "";
    $("bFormTitle").scrollIntoView({ behavior: "smooth" });
  }
  if (del && confirm(`ลบสาขา ${del}?`)) { await deleteDoc(doc(db, "branches", del)); loadBranches(); }
});
$("btnBBulk").onclick = async () => {
  const lines = $("bBulk").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return msg("bBulkMsg", "ยังไม่มีข้อมูล");
  const batch = writeBatch(db); let n = 0; const bad = [];
  for (const l of lines) {
    const [id, name, la, ln, r, z] = l.split(/\t|,/).map((s) => (s || "").trim());
    if (!id || !name) { bad.push(l); continue; }
    const data = { name, lat: parseNum(la), lng: parseNum(ln), radius: parseNum(r) || DEFAULT_RADIUS };
    if (!isRM()) {
      const other = allBranches.find((b) => b.id === id && b.zoneId && b.zoneId !== me.zoneId);
      if (other) { bad.push(`${id} (อยู่เขตอื่น)`); continue; }
      data.zoneId = me.zoneId;
    } else if (z) data.zoneId = z;
    batch.set(doc(db, "branches", id), data, { merge: true });
    n++;
  }
  try { await batch.commit(); msg("bBulkMsg", `นำเข้า ${n} สาขา` + (bad.length ? ` · ข้าม ${bad.length} บรรทัดที่ข้อมูลไม่ครบ` : ""), "ok"); loadBranches(); }
  catch (e) { msg("bBulkMsg", errText(e)); }
};

/* ================= พนักงาน ================= */
let editingUid = null;
async function loadUsers() {
  const uq = isRM() ? collection(db, "users") : query(collection(db, "users"), where("zoneId", "==", me.zoneId));
  users = (await getDocs(uq)).docs.map((d) => ({ uid: d.id, ...d.data() }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  $("uCount").textContent = users.length;
  $("tUsers").innerHTML = `<tr><th>ชื่อ</th><th>ชื่อเล่น</th><th>รหัส</th><th>อีเมล</th><th>เบอร์โทร</th><th>ตำแหน่ง</th><th>สาขาประจำ</th><th>เขต</th><th>สิทธิ์</th><th>สถานะ</th><th>เครื่อง</th><th></th></tr>` +
    users.map((u) => `<tr>
      <td>${esc(u.name)}</td><td>${esc(u.nickname)}</td><td>${esc(u.empId)}</td><td>${esc(u.email)}</td><td>${esc(u.phone)}</td><td>${esc(u.position)}</td><td>${esc(bName(u.branchId))}</td><td>${u.zoneId ? esc(zName(u.zoneId)) : "-"}</td>
      <td>${ROLE_LABEL[u.role] || "พนักงาน"}</td>
      <td>${u.active === false ? `<span class="tag off">ระงับ</span>` : u.mustChangePassword ? `<span class="tag warn">ยังไม่เข้าครั้งแรก</span>` : `<span class="tag in">ใช้งาน</span>`}</td>
      <td>${(u.deviceIds && u.deviceIds.length) ? `ผูก ${u.deviceIds.length} ที่` : u.deviceId ? "ผูก 1 ที่" : "-"}</td>
      <td class="actions">
        <button class="btn sm" data-uedit="${u.uid}">แก้ไข</button>
        <button class="btn sm" data-ureset="${u.uid}">รีเซ็ตเครื่อง</button>
        <button class="btn sm" data-upw="${u.uid}">ส่งลิงก์ตั้งรหัสใหม่</button>
        <button class="btn sm ${u.active === false ? "" : "danger"}" data-uact="${u.uid}">${u.active === false ? "เปิดใช้งาน" : "ระงับ"}</button>
      </td></tr>`).join("");
}
function genPw() { const c = "abcdefghjkmnpqrstuvwxyz23456789"; return Array.from({ length: 8 }, () => c[Math.floor(Math.random() * c.length)]).join(""); }
$("btnUGen").onclick = () => { $("uPw").value = genPw(); };

async function createAuthUser(email, pw) {
  const sec = initializeApp(firebaseConfig, "sec-" + Date.now() + Math.random());
  const sa = getAuth(sec);
  try { return (await createUserWithEmailAndPassword(sa, email, pw)).user.uid; }
  finally { try { await signOut(sa); } catch {} await deleteApp(sec); }
}
async function addUser(d, pw) {
  const uid = await createAuthUser(d.email, pw);
  await setDoc(doc(db, "users", uid), { ...d, active: true, mustChangePassword: true, deviceId: "", deviceIds: [], createdAt: serverTimestamp() });
}
function resetUserForm() {
  editingUid = null;
  ["uName", "uEmp", "uEmail", "uPw", "uPos", "uPhone", "uNick"].forEach((i) => ($(i).value = ""));
  $("uEmail").disabled = false; $("uPw").disabled = false; $("uRole").value = "staff"; $("uBranch").value = ""; $("uZone").value = "";
  $("uFormTitle").textContent = "เพิ่มพนักงาน"; $("btnUSave").textContent = "เพิ่มพนักงาน"; $("btnUCancel").classList.add("hidden");
}
$("btnUCancel").onclick = resetUserForm;
$("btnUSave").onclick = async () => {
  const d = { name: $("uName").value.trim(), empId: $("uEmp").value.trim(), email: $("uEmail").value.trim().toLowerCase(), position: $("uPos").value.trim(), branchId: $("uBranch").value, role: $("uRole").value,
    phone: $("uPhone").value.trim(), phoneKey: phoneKey($("uPhone").value), nickname: $("uNick").value.trim() };
  if (!d.name) return msg("uMsg", "กรอกชื่อ-นามสกุล");
  if (!isRM()) d.role = "staff";
  if (d.role === "rm") d.zoneId = "";
  else if (d.role === "am") d.zoneId = isRM() ? $("uZone").value : me.zoneId;
  else d.zoneId = bZoneOf(d.branchId) || (isRM() ? $("uZone").value : me.zoneId);
  if (d.role === "am" && !d.zoneId) return msg("uMsg", "AM ต้องเลือกเขต");
  if (!isRM() && d.zoneId !== me.zoneId) return msg("uMsg", "เลือกสาขาประจำที่อยู่ในเขตของคุณ");
  if (!editingUid && d.role === "staff" && STAFF_DOMAIN && !d.email.endsWith("@" + STAFF_DOMAIN)) return msg("uMsg", `อีเมลพนักงานต้องเป็น @${STAFF_DOMAIN}`);
  busy($("btnUSave"), true);
  try {
    if (editingUid) {
      const { email, ...rest } = d;
      await updateDoc(doc(db, "users", editingUid), rest);
      msg("uMsg", "บันทึกการแก้ไขแล้ว", "ok");
    } else {
      const pw = $("uPw").value.trim();
      if (!d.email) throw { message: "กรอกอีเมล" };
      if (pw.length < 6) throw { message: "รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 6 ตัว" };
      await addUser(d, pw);
      msg("uMsg", `เพิ่ม ${d.name} แล้ว — แจ้งพนักงาน: อีเมล ${d.email} / รหัสผ่านเริ่มต้น ${pw}`, "ok");
    }
    resetUserForm(); await loadUsers();
  } catch (e) { msg("uMsg", errText(e)); }
  finally { busy($("btnUSave"), false); }
};
$("btnUBulk").onclick = async () => {
  const pw = $("uBulkPw").value.trim();
  if (pw.length < 6) return msg("uBulkMsg", "รหัสผ่านเริ่มต้นต้องมีอย่างน้อย 6 ตัว");
  const lines = $("uBulk").value.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return msg("uBulkMsg", "ยังไม่มีข้อมูล");
  busy($("btnUBulk"), true);
  let ok = 0; const fail = [];
  const existing = new Set(users.map((u) => (u.email || "").toLowerCase()));
  let skip = 0;
  for (const l of lines) {
    const [name, empId, email, position, branchId, phone, nickname] = l.split(l.includes("\t") ? "\t" : l.includes("|") ? "|" : l.includes(";") ? ";" : ",").map((s) => (s || "").trim());
    if (!name || !email || !email.includes("@")) { fail.push(`${name || l} (อ่านอีเมลไม่ได้ — คั่นข้อมูลด้วยจุลภาค , หรือคัดลอกจาก Excel)`); continue; }
    if (STAFF_DOMAIN && !email.toLowerCase().endsWith("@" + STAFF_DOMAIN)) { fail.push(`${email} (ต้องเป็น @${STAFF_DOMAIN})`); continue; }
    if (existing.has(email.toLowerCase())) { skip++; continue; }
    const bId = (String(branchId).match(/\d{4}/) || [""])[0];
    const zId = bZoneOf(bId) || (isRM() ? "" : me.zoneId);
    if (!isRM() && zId !== me.zoneId) { fail.push(`${name} (สาขา ${bId} ไม่อยู่ในเขตของคุณ)`); continue; }
    try { await addUser({ name, empId, email: email.toLowerCase(), position, branchId: bId, zoneId: zId, role: "staff", phone: phone || "", phoneKey: phoneKey(phone), nickname: nickname || "" }, pw); ok++; msg("uBulkMsg", `กำลังเพิ่ม... ${ok}/${lines.length}`, "ok"); }
    catch (e) { fail.push(`${email} (${errText(e)})`); }
  }
  busy($("btnUBulk"), false);
  msg("uBulkMsg", `เพิ่มสำเร็จ ${ok} คน` + (skip ? ` · ข้าม ${skip} คน (มีบัญชีอยู่แล้ว)` : "") + (fail.length ? ` · ไม่สำเร็จ: ${fail.join(" | ")}` : ""), fail.length ? "err" : "ok");
  loadUsers();
};
$("tUsers").addEventListener("click", async (e) => {
  const t = e.target.dataset; const u = users.find((x) => x.uid === (t.uedit || t.ureset || t.upw || t.uact));
  if (!u) return;
  try {
    if (t.uedit) {
      editingUid = u.uid;
      $("uName").value = u.name || ""; $("uEmp").value = u.empId || ""; $("uEmail").value = u.email || ""; $("uEmail").disabled = true;
      $("uPw").value = ""; $("uPw").disabled = true; $("uPos").value = u.position || "";
      $("uPhone").value = u.phone || ""; $("uNick").value = u.nickname || ""; $("uBranch").value = u.branchId || ""; $("uRole").value = u.role === "admin" ? "rm" : u.role || "staff"; $("uZone").value = u.zoneId || "";
      $("uFormTitle").textContent = "แก้ไข: " + u.name; $("btnUSave").textContent = "บันทึกการแก้ไข"; $("btnUCancel").classList.remove("hidden");
      $("uFormTitle").scrollIntoView({ behavior: "smooth" });
    } else if (t.ureset) {
      if (!confirm(`รีเซ็ตเครื่องของ ${u.name}? เครื่องถัดไปที่เข้าใช้งาน (มือถือ) จะถูกผูกอัตโนมัติ`)) return;
      await updateDoc(doc(db, "users", u.uid), { deviceId: "", deviceIds: [] }); loadUsers();
    } else if (t.upw) {
      await sendPasswordResetEmail(auth, u.email); alert(`ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่ ${u.email} แล้ว`);
    } else if (t.uact) {
      await updateDoc(doc(db, "users", u.uid), { active: u.active === false }); loadUsers();
    }
  } catch (err) { alert(errText(err)); }
});

/* ================= คำขอเปลี่ยนเครื่อง ================= */
async function loadDevices() {
  try {
    const dq = isRM() ? collection(db, "deviceRequests") : query(collection(db, "deviceRequests"), where("zoneId", "==", me.zoneId));
    const reqs = (await getDocs(dq)).docs.map((d) => ({ uid: d.id, ...d.data() }));
    $("devBadge").textContent = reqs.length; $("devBadge").classList.toggle("hidden", !reqs.length);
    $("tDev").innerHTML = reqs.length
      ? `<tr><th>ชื่อ</th><th>อีเมล</th><th>ประเภทเครื่อง</th><th>เวลาขอ</th><th>รายละเอียดเครื่อง</th><th></th></tr>` +
        reqs.map((r) => `<tr><td>${esc(r.name)}</td><td>${esc(r.email)}</td><td>${r.mobile ? "มือถือ/แท็บเล็ต" : "<b>คอมพิวเตอร์</b>"}</td>
          <td>${fmtDateTime(r.at && r.at.toDate())}</td><td class="wrap-txt muted">${esc((r.ua || "").slice(0, 120))}</td>
          <td class="actions"><button class="btn sm primary" data-ok="${r.uid}">อนุมัติ</button><button class="btn sm danger" data-no="${r.uid}">ปฏิเสธ</button></td></tr>`).join("")
      : `<tr><td class="muted">ไม่มีคำขอ</td></tr>`;
    $("tDev").onclick = async (e) => {
      const ok = e.target.dataset.ok, no = e.target.dataset.no;
      try {
        if (ok) { const r = reqs.find((x) => x.uid === ok); await updateDoc(doc(db, "users", ok), { deviceId: r.deviceId, deviceIds: [r.deviceId] }); await deleteDoc(doc(db, "deviceRequests", ok)); }
        if (no) await deleteDoc(doc(db, "deviceRequests", no));
        if (ok || no) { loadDevices(); loadUsers(); }
      } catch (err) { alert(errText(err)); }
    };
  } catch (e) { $("tDev").innerHTML = `<tr><td class="msg err">${esc(errText(e))}</td></tr>`; }
}
$("btnDevReload").onclick = loadDevices;

/* ================= รายงาน ================= */
const dayStart = (s) => new Date(s + "T00:00:00+07:00");
async function runReport() {
  const from = $("rFrom").value, to = $("rTo").value;
  if (!from || !to) return msg("rMsg", "เลือกช่วงวันที่");
  const start = dayStart(from), end = new Date(dayStart(to).getTime() + 86400000);
  if (end <= start) return msg("rMsg", "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด");
  if ((end - start) / 86400000 > 62) return msg("rMsg", "เลือกช่วงไม่เกิน 62 วันต่อครั้ง");
  busy($("btnReport"), true, "กำลังโหลด...");
  try {
    reportRows = (await fetchCheckins(start, end)).sort((a, b) => b.t - a.t);
    msg("rMsg", "");
    renderReport();
  } catch (e) { msg("rMsg", errText(e)); }
  finally { busy($("btnReport"), false); }
}
// RM: ดึงตามช่วงเวลา · AM: ดึงเฉพาะเขตตัวเอง (ตามเดือน) แล้วกรองเวลา
async function fetchCheckins(start, end) {
  let docs;
  if (isRM()) docs = (await getDocs(query(collection(db, "checkins"), where("ts", ">=", Timestamp.fromDate(start)), where("ts", "<", Timestamp.fromDate(end)), orderBy("ts")))).docs;
  else {
    const ms = monthsBetween(bkkDay(start), bkkDay(new Date(end.getTime() - 1))).map((m) => `${me.zoneId}_${m}`).slice(0, 10);
    docs = (await getDocs(query(collection(db, "checkins"), where("zoneId", "==", me.zoneId), where("zm", "in", ms)))).docs;
  }
  return docs.map((d) => ({ id: d.id, ...d.data(), t: d.data().ts ? d.data().ts.toDate() : null })).filter((r) => r.t && r.t >= start && r.t < end);
}
function filtered() {
  const br = $("rBranch").value, ty = $("rType").value, s = $("rSearch").value.trim().toLowerCase(), z = isRM() ? $("rZone").value : "";
  return reportRows.filter((r) => (!z || (r.zoneId || bZoneOf(r.branchId)) === z) && (!br || r.branchId === br) && (!ty || r.type === ty) && (!s || `${r.name} ${r.empId}`.toLowerCase().includes(s)));
}
function summarize(rows) {
  const m = new Map();
  for (const r of rows) {
    const k = r.uid + "|" + r.day;
    if (!m.has(k)) m.set(k, { day: r.day, name: r.name, empId: r.empId, position: r.position, branches: new Set(), firstIn: null, lastOut: null, count: 0 });
    const g = m.get(k); g.count++; g.branches.add(r.branchName);
    if (r.type === "in" && r.t && (!g.firstIn || r.t < g.firstIn)) g.firstIn = r.t;
    if (r.type === "out" && r.t && (!g.lastOut || r.t > g.lastOut)) g.lastOut = r.t;
  }
  return [...m.values()].map((g) => ({ ...g, branches: [...g.branches].join(", "),
    hours: g.firstIn && g.lastOut && g.lastOut > g.firstIn ? ((g.lastOut - g.firstIn) / 3600000) : null }))
    .sort((a, b) => b.day.localeCompare(a.day) || String(a.name).localeCompare(String(b.name), "th"));
}
function renderReport() {
  const rows = filtered(), sum = summarize(rows);
  const people = new Set(rows.map((r) => r.uid)).size;
  const noOut = sum.filter((s) => s.firstIn && !s.lastOut).length;
  $("rStats").innerHTML = `<div class="stat"><span class="muted">รายการทั้งหมด</span><b>${rows.length}</b></div>
    <div class="stat"><span class="muted">จำนวนคน</span><b>${people}</b></div>
    <div class="stat"><span class="muted">เข้างาน</span><b>${rows.filter((r) => r.type === "in").length}</b></div>
    <div class="stat"><span class="muted">ออกงาน</span><b>${rows.filter((r) => r.type === "out").length}</b></div>
    <div class="stat"><span class="muted">ยังไม่ลงออกงาน (คน-วัน)</span><b>${noOut}</b></div>
    <div class="stat"><span class="muted">นอกสถานที่ (รอตรวจ)</span><b>${rows.filter((r) => r.offsite && !r.reviewed).length}</b></div>`;
  $("tSum").innerHTML = `<tr><th>วันที่</th><th>ชื่อ</th><th>รหัส</th><th>สาขา</th><th>เข้างาน</th><th>ออกงาน</th><th>ชั่วโมง</th></tr>` +
    (sum.map((s) => `<tr><td>${s.day}</td><td>${esc(s.name)}</td><td>${esc(s.empId)}</td><td>${esc(s.branches)}</td>
      <td>${s.firstIn ? fmtTime(s.firstIn) : `<span class="tag warn">ไม่มี</span>`}</td>
      <td>${s.lastOut ? fmtTime(s.lastOut) : `<span class="tag warn">ไม่มี</span>`}</td>
      <td>${s.hours != null ? s.hours.toFixed(2) : "-"}</td></tr>`).join("") || `<tr><td class="muted" colspan="7">ไม่มีข้อมูล</td></tr>`);
  $("tRaw").innerHTML = `<tr><th>รูป</th><th>วัน-เวลา</th><th>ชื่อ</th><th>ประเภท</th><th>สาขา</th><th>ระยะ</th><th>ท่า</th><th>หมายเหตุ</th><th>แผนที่</th></tr>` +
    (rows.map((r) => `<tr>
      <td>${r.photo ? `<img class="thumb" loading="lazy" src="${r.photo}" data-cap="${esc(r.name)} · ${esc(r.gesture)} · ${esc(fmtDateTime(r.t))}">`
        : r.hasPhoto ? `<button class="btn sm" data-pid="${r.id}" data-cap="${esc(r.name)} · ท่า: ${esc(r.gesture)} · ${esc(fmtDateTime(r.t))}">📷 ดูรูป</button>` : `<span class="muted">-</span>`}</td>
      <td>${fmtDateTime(r.t)}</td><td>${esc(r.name)}</td>
      <td><span class="tag ${r.type}">${r.type === "in" ? "เข้างาน" : "ออกงาน"}</span>${r.offsite ? ` <span class="tag offsite">นอกสถานที่</span>` : ""}</td>
      <td>${esc(r.branchName)}</td><td>${r.distance != null ? fmtDistM(r.distance) : "-"} (±${r.accuracy ?? "-"})</td><td>${esc(r.gesture)}</td>
      <td class="wrap-txt">${esc(r.note || "")}${r.offsite ? (r.reviewed ? ` <span class="tag in">ตรวจแล้ว</span>` : ` <button class="btn sm" data-review="${r.id}">✓ ตรวจแล้ว</button>`) : ""}</td>
      <td><a href="https://www.google.com/maps?q=${r.lat},${r.lng}" target="_blank" rel="noopener">ดู</a></td></tr>`).join("") || `<tr><td class="muted" colspan="9">ไม่มีข้อมูล</td></tr>`);
}
const fmtDistM = (m) => (m >= 1000 ? (m / 1000).toFixed(1) + " กม." : m + " ม.");
$("tRaw").addEventListener("click", async (e) => {
  const id = e.target.dataset && e.target.dataset.review; if (!id) return;
  try { await updateDoc(doc(db, "checkins", id), { reviewed: true }); const r = reportRows.find((x) => x.id === id); if (r) r.reviewed = true; renderReport(); }
  catch (err) { alert(errText(err)); }
});
$("btnReport").onclick = runReport;
["rBranch", "rType", "rZone"].forEach((i) => $(i).addEventListener("change", renderReport));
$("rSearch").addEventListener("input", renderReport);

function downloadCsv(name, header, rows) {
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "﻿" + [header, ...rows].map((r) => r.map(q).join(",")).join("\r\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
$("btnCsvSum").onclick = () => {
  const s = summarize(filtered());
  downloadCsv(`${bkkDay()}_สรุปเข้าออกงาน_${$("rFrom").value}_${$("rTo").value}.csv`,
    ["วันที่", "ชื่อ", "รหัสพนักงาน", "ตำแหน่ง", "สาขา", "เข้างาน", "ออกงาน", "ชั่วโมง"],
    s.map((x) => [x.day, x.name, x.empId, x.position, x.branches, x.firstIn ? fmtTime(x.firstIn) : "", x.lastOut ? fmtTime(x.lastOut) : "", x.hours != null ? x.hours.toFixed(2) : ""]));
};
$("btnCsvRaw").onclick = () => {
  downloadCsv(`${bkkDay()}_รายการเข้าออกงาน_${$("rFrom").value}_${$("rTo").value}.csv`,
    ["วันที่", "เวลา", "ชื่อ", "รหัสพนักงาน", "ประเภท", "รหัสสาขา", "สาขา", "ระยะจากสาขา(ม.)", "ความแม่นยำ GPS(ม.)", "ท่า", "นอกสถานที่", "หมายเหตุ", "lat", "lng"],
    filtered().slice().reverse().map((r) => [r.day, fmtTime(r.t), r.name, r.empId, r.type === "in" ? "เข้างาน" : "ออกงาน", r.branchId, r.branchName, r.distance, r.accuracy, r.gesture, r.offsite ? "ใช่" : "", r.note || "", r.lat, r.lng]));
};

/* ================= ลบรูปเก่า ================= */
$("btnPurge").onclick = async () => {
  const days = parseInt($("pDays").value, 10);
  if (!(days >= 7)) return msg("pMsg", "กำหนดอย่างน้อย 7 วัน");
  if (!confirm(`ลบรูปเซลฟี่ที่เก่ากว่า ${days} วัน? (กู้คืนไม่ได้)`)) return;
  const cutoff = Timestamp.fromDate(new Date(Date.now() - days * 86400000));
  busy($("btnPurge"), true);
  let total = 0;
  try {
    if (!isRM()) {
      // AM: ลบเฉพาะรูปของเช็กอินในเขตตัวเอง
      const old = (await getDocs(query(collection(db, "checkins"), where("zoneId", "==", me.zoneId)))).docs
        .filter((d) => d.data().ts && d.data().ts.toMillis() < cutoff.toMillis() && d.data().hasPhoto !== false);
      // Rules ต้อง get() รายการเช็กอินทุกรูป (จำกัด 20 ครั้ง/คำสั่ง) → ลบครั้งละ 8 รูป
      const AM_CHUNK = 8;
      for (let i = 0; i < old.length; i += AM_CHUNK) {
        const batch = writeBatch(db);
        old.slice(i, i + AM_CHUNK).forEach((d) => { batch.delete(doc(db, "checkinPhotos", d.id)); batch.update(d.ref, { hasPhoto: false }); });
        await batch.commit(); total += Math.min(AM_CHUNK, old.length - i);
        msg("pMsg", `ลบแล้ว ${total} รูป...`, "ok");
      }
      msg("pMsg", `เสร็จแล้ว ลบรูปทั้งหมด ${total} รูป (เฉพาะเขต ${zName(me.zoneId)})`, "ok");
      return;
    }
    // รูปที่แยกเก็บใน checkinPhotos
    for (;;) {
      const snap = await getDocs(query(collection(db, "checkinPhotos"), where("ts", "<", cutoff), orderBy("ts"), limit(300)));
      if (snap.empty) break;
      const batch = writeBatch(db);
      snap.docs.forEach((d) => batch.delete(d.ref));
      await batch.commit(); total += snap.size;
      msg("pMsg", `ลบแล้ว ${total} รูป...`, "ok");
      if (snap.size < 300) break;
    }
    // รูปแบบเก่าที่เก็บในรายการเช็กอิน
    let lastDoc = null;
    for (;;) {
      const parts = [collection(db, "checkins"), where("ts", "<", cutoff), orderBy("ts")];
      if (lastDoc) parts.push(startAfter(lastDoc));
      parts.push(limit(300));
      const snap = await getDocs(query(...parts));
      if (snap.empty) break;
      lastDoc = snap.docs[snap.docs.length - 1];
      const withPhoto = snap.docs.filter((d) => d.data().photo);
      if (withPhoto.length) {
        const batch = writeBatch(db);
        withPhoto.forEach((d) => batch.update(d.ref, { photo: null }));
        await batch.commit(); total += withPhoto.length;
        msg("pMsg", `ลบแล้ว ${total} รูป...`, "ok");
      }
      if (snap.size < 300) break;
    }
    msg("pMsg", `เสร็จแล้ว ลบรูปทั้งหมด ${total} รูป`, "ok");
  } catch (e) { msg("pMsg", errText(e)); }
  finally { busy($("btnPurge"), false); }
};

/* ================= ตารางกะ: อัปโหลด ================= */
let parsedShift = null;
async function loadXLSX() {
  if (window.XLSX) return window.XLSX;
  await new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = "https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js";
    s.onload = res; s.onerror = () => rej(new Error("โหลดตัวอ่าน Excel ไม่สำเร็จ"));
    document.head.appendChild(s);
  });
  return window.XLSX;
}
const serialToDay = (n) => new Date(Math.round((n - 25569) * 86400000)).toISOString().slice(0, 10);
const cleanName = (s) => String(s ?? "").replace(/^\s*(คุณ|นางสาว|นาย|นาง|น\.ส\.)\s*/, "").replace(/\s+/g, " ").trim();

function parseShiftRows(rows) {
  const h = rows.findIndex((r) => r && String(r[0] ?? "").trim().toLowerCase() === "store");
  if (h < 1) throw new Error('ไม่พบหัวตาราง "Store" ในคอลัมน์ A');
  const cols = [];
  (rows[h - 1] || []).forEach((v, i) => { if (i >= 6 && typeof v === "number" && v > 40000 && v < 80000) cols.push([i, serialToDay(v)]); });
  if (!cols.length) throw new Error("ไม่พบแถววันที่เหนือหัวตาราง");
  const out = [];
  for (let i = h + 1; i < rows.length; i++) {
    const r = rows[i] || [];
    const store = String(r[0] ?? "").trim();
    if (!store) { if (out.length) break; continue; }
    const days = {};
    cols.forEach(([c, d]) => { const v = normCode(r[c]); if (v) days[d] = v; });
    const first = cleanName(r[1]), last = cleanName(r[2]);
    const bId = (store.match(/\d{4}/) || [""])[0];
    out.push({ store, branchId: bId, zoneId: bZoneOf(bId), name: `${first} ${last}`.trim(), nickname: String(r[3] ?? "").trim(),
      position: String(r[4] ?? "").trim(), phone: String(r[5] ?? "").trim(), phoneKey: phoneKey(r[5]), days });
  }
  const months = [...new Set(cols.map((c) => c[1].slice(0, 7)))];
  return { rows: out, month: months.sort((a, b) => cols.filter((c) => c[1].startsWith(b)).length - cols.filter((c) => c[1].startsWith(a)).length)[0] };
}

$("sFile").onchange = async (e) => {
  const f = e.target.files[0]; if (!f) return;
  parsedShift = null; $("btnSSave").classList.add("hidden"); $("tShiftPrev").innerHTML = "";
  msg("sMsg", "กำลังอ่านไฟล์...", "ok");
  try {
    const XLSX = await loadXLSX();
    const wb = XLSX.read(await f.arrayBuffer(), { type: "array" });
    const ws = wb.Sheets[wb.SheetNames[0]];
    parsedShift = parseShiftRows(XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null }));
    const byPhone = new Map(users.filter((u) => u.phoneKey).map((u) => [u.phoneKey, u]));
    let matched = 0;
    $("tShiftPrev").innerHTML = `<tr><th>สาขา</th><th>ชื่อ</th><th>ชื่อเล่น</th><th>เบอร์โทร</th><th>จำนวนวัน</th><th>บัญชีในระบบ</th><th>รหัสกะที่ไม่รู้จัก</th></tr>` +
      parsedShift.rows.map((r) => {
        const u = byPhone.get(r.phoneKey); if (u) matched++;
        const outZone = !isRM() && r.zoneId && r.zoneId !== me.zoneId;
        const unknown = [...new Set(Object.values(r.days).filter((c) => !shiftInfo(c)))];
        return `<tr><td>${esc(r.store)}</td><td>${esc(r.name)}</td><td>${esc(r.nickname)}</td><td>${esc(r.phone)}</td><td>${Object.keys(r.days).length}</td>
          <td>${outZone ? `<span class="tag off">นอกเขตของคุณ — ข้าม</span>` : !r.phoneKey ? `<span class="tag off">ไม่มีเบอร์</span>` : u ? `<span class="tag in">${esc(u.email)}</span>` : `<span class="tag warn">ยังไม่มีบัญชี</span>`}</td>
          <td>${unknown.length ? `<span class="tag warn">${esc(unknown.join(", "))}</span>` : "-"}</td></tr>`;
      }).join("");
    msg("sMsg", `เดือน ${parsedShift.month} · พนักงาน ${parsedShift.rows.length} คน · จับคู่บัญชีได้ ${matched} คน (คนที่ยังไม่มีบัญชี บันทึกกะไว้ก่อนได้ เพิ่มบัญชีทีหลังจะจับคู่ให้อัตโนมัติด้วยเบอร์โทร)`, "ok");
    $("btnSSave").classList.remove("hidden");
  } catch (err) { msg("sMsg", errText(err)); }
};
$("btnSSave").onclick = async () => {
  if (!parsedShift) return;
  if (!isRM()) parsedShift.rows.forEach((r) => { if (!r.zoneId) r.zoneId = me.zoneId; });
  const rows = parsedShift.rows.filter((r) => r.phoneKey && (isRM() || r.zoneId === me.zoneId));
  busy($("btnSSave"), true);
  try {
    const batch = writeBatch(db);
    rows.forEach((r) => batch.set(doc(db, "shifts", `${parsedShift.month}_${r.phoneKey}`), { ...r, month: parsedShift.month, updatedAt: serverTimestamp() }));
    await batch.commit();
    msg("sMsg", `บันทึกตารางกะเดือน ${parsedShift.month} แล้ว ${rows.length} คน` + (rows.length < parsedShift.rows.length ? ` · ข้าม ${parsedShift.rows.length - rows.length} คน (ไม่มีเบอร์โทร/อยู่นอกเขต)` : ""), "ok");
    $("btnSSave").classList.add("hidden");
    $("aMonth").value = parsedShift.month;
  } catch (err) { msg("sMsg", errText(err)); }
  finally { busy($("btnSSave"), false); }
};

/* ================= ตารางกะ: มาสาย / ขาด ================= */
let att = { sums: [], days: [] };
async function runAtt() {
  const month = $("aMonth").value;
  if (!month) return msg("aMsg", "เลือกเดือน");
  busy($("btnAtt"), true, "กำลังคำนวณ...");
  try {
    const startDay = $("aStart").value || "";
    const [y, mo] = month.split("-").map(Number);
    const start = new Date(`${month}-01T00:00:00+07:00`);
    const end = new Date(Date.UTC(y, mo, 1) - 7 * 3600000 + 86400000); // +1 วันเผื่อกะข้ามคืน
    const [shSnap, ckRows] = await Promise.all([
      getDocs(isRM() ? query(collection(db, "shifts"), where("month", "==", month)) : query(collection(db, "shifts"), where("month", "==", month), where("zoneId", "==", me.zoneId))),
      fetchCheckins(start, end)
    ]);
    if (shSnap.empty) { att = { sums: [], days: [] }; renderAtt(); return msg("aMsg", `ยังไม่มีตารางกะเดือน ${month} — อัปโหลดไฟล์ที่ด้านล่าง`); }
    const uidByPhone = new Map(users.filter((u) => u.phoneKey).map((u) => [u.phoneKey, u.uid]));
    const byUid = new Map();
    ckRows.forEach((r) => { (byUid.get(r.uid) || byUid.set(r.uid, []).get(r.uid)).push(r); });
    const now = new Date(), sums = [], days = [];
    for (const sd of shSnap.docs) {
      const s = sd.data(), uid = uidByPhone.get(s.phoneKey), list = uid ? byUid.get(uid) || [] : [];
      const sum = { name: s.name, nickname: s.nickname, branchId: s.branchId, zoneId: s.zoneId || bZoneOf(s.branchId), store: s.store, phone: s.phone, hasAccount: !!uid,
        work: 0, present: 0, offsite: 0, late: 0, lateMin: 0, early: 0, earlyMin: 0, absent: 0, noOut: 0, off: 0, leave: 0, offWork: 0 };
      for (const day of Object.keys(s.days || {}).sort()) {
        if (!day.startsWith(month) || (startDay && day < startDay)) continue;
        const code = s.days[day], info = shiftInfo(code);
        const dayRecs = list.filter((c) => c.day === day);
        const dayIns = dayRecs.filter((c) => c.type === "in").map((c) => c.t).sort((a, b) => a - b);
        const offRecs = dayRecs.filter((c) => c.offsite);
        const row = { day, name: s.name, nickname: s.nickname, store: s.store, branchId: s.branchId, zoneId: sum.zoneId, code, sched: "", in: dayIns[0] || null, out: null, status: "", kind: "" , issue: false };
        if (!info) { row.status = "รหัสกะไม่รู้จัก"; row.kind = "warn"; row.issue = true; }
        else if (info.off) {
          if (info.off === "วันหยุด") sum.off++; else sum.leave++;
          row.status = info.off;
          if (dayIns.length) { row.status += " (แต่มีเช็กอิน)"; row.kind = "warn"; row.issue = true; sum.offWork++; }
        } else {
          const w = shiftWindow(day, info);
          row.sched = `${info.s}–${info.e}`;
          if (now < w.s) { row.status = "ยังไม่ถึงกะ"; }
          else {
            sum.work++;
            const limit = new Date(w.e.getTime() + 6 * 3600000);
            const from = row.in || new Date(w.s.getTime() - 4 * 3600000);
            row.out = list.filter((c) => c.type === "out" && c.t > from && c.t < limit).map((c) => c.t).sort((a, b) => b - a)[0] || null;
            if (!uid) { row.status = "ยังไม่มีบัญชีในระบบ"; row.kind = "warn"; row.issue = true; }
            else if (!row.in) {
              if (now > w.e) { row.status = "ขาดงาน"; row.kind = "off"; row.issue = true; sum.absent++; }
              else { row.status = "ยังไม่เช็กอิน"; row.kind = "warn"; row.issue = true; }
            } else {
              sum.present++;
              const parts = [], late = Math.round((row.in - w.s) / 60000);
              if (late > LATE_GRACE_MIN) { parts.push(`สาย ${late} นาที`); sum.late++; sum.lateMin += late; }
              if (row.out) { const early = Math.round((w.e - row.out) / 60000); if (early > 0) { parts.push(`ออกก่อน ${early} นาที`); sum.early++; sum.earlyMin += early; } }
              else if (now > limit) { parts.push("ไม่ลงออกงาน"); sum.noOut++; }
              if (offRecs.length) { sum.offsite++; parts.push("นอกสถานที่: " + offRecs.map((c) => c.note).filter(Boolean).join(" / ")); }
              row.status = parts.join(" · ") || "ปกติ"; row.kind = offRecs.length ? "offsite" : parts.length ? "warn" : "in"; row.issue = parts.length > 0;
            }
          }
        }
        days.push(row);
      }
      sums.push(sum);
    }
    sums.sort((a, b) => String(a.store).localeCompare(String(b.store), "th") || String(a.name).localeCompare(String(b.name), "th"));
    days.sort((a, b) => b.day.localeCompare(a.day) || String(a.store).localeCompare(String(b.store), "th"));
    att = { sums, days };
    msg("aMsg", `คำนวณจากข้อมูลถึง ${fmtDateTime(now)}`, "ok");
    renderAtt();
  } catch (err) { msg("aMsg", errText(err)); }
  finally { busy($("btnAtt"), false); }
}
function attFiltered() {
  const br = $("aBranch").value, s = $("aSearch").value.trim().toLowerCase(), z = isRM() ? $("aZone").value : "";
  const ok = (r) => (!z || r.zoneId === z) && (!br || r.branchId === br) && (!s || `${r.name} ${r.nickname}`.toLowerCase().includes(s));
  return { sums: att.sums.filter(ok), days: att.days.filter(ok) };
}
function renderAtt() {
  const { sums, days } = attFiltered();
  const t = (k) => sums.reduce((a, x) => a + x[k], 0);
  $("aStats").innerHTML = [["พนักงานในตาราง", sums.length], ["วันทำงาน (ถึงวันนี้)", t("work")], ["มาสาย (ครั้ง)", t("late")], ["ขาดงาน (วัน)", t("absent")], ["ออกก่อนเวลา", t("early")], ["ไม่ลงออกงาน", t("noOut")], ["ยังไม่มีบัญชี (คน)", sums.filter((x) => !x.hasAccount).length]]
    .map(([l, v]) => `<div class="stat"><span class="muted">${l}</span><b>${v}</b></div>`).join("");
  if (isRM()) {
    const zs = new Map();
    sums.forEach((x) => { const k = x.zoneId || ""; const g = zs.get(k) || { n: 0, work: 0, present: 0, late: 0, absent: 0, noOut: 0, offsite: 0 }; g.n++; ["work", "present", "late", "absent", "noOut", "offsite"].forEach((f) => (g[f] += x[f])); zs.set(k, g); });
    $("tAttZone").innerHTML = `<tr><th>เขต</th><th>คน</th><th>วันทำงาน</th><th>มาทำงาน</th><th>% มาทำงาน</th><th>สาย (ครั้ง)</th><th>% ตรงเวลา</th><th>ขาด</th><th>ไม่ลงออก</th><th>นอกสถานที่</th></tr>` +
      ([...zs.entries()].sort().map(([k, g]) => `<tr><td>${k ? esc(zName(k)) : `<span class="tag warn">ยังไม่กำหนดเขต</span>`}</td><td>${g.n}</td><td>${g.work}</td><td>${g.present}</td>
        <td>${g.work ? Math.round((g.present / g.work) * 100) + "%" : "-"}</td><td>${g.late}</td><td>${g.present ? Math.round(((g.present - g.late) / g.present) * 100) + "%" : "-"}</td>
        <td>${g.absent}</td><td>${g.noOut}</td><td>${g.offsite}</td></tr>`).join("") || `<tr><td class="muted" colspan="10">ไม่มีข้อมูล</td></tr>`);
  }
  $("tAttSum").innerHTML = `<tr><th>สาขา</th><th>ชื่อ</th><th>ชื่อเล่น</th><th>วันทำงาน</th><th>มาทำงาน</th><th>นอกสถานที่</th><th>สาย (ครั้ง/นาที)</th><th>ขาด</th><th>ออกก่อน</th><th>ไม่ลงออก</th><th>หยุด</th><th>ลา/พักร้อน/อบรม</th><th>บัญชี</th></tr>` +
    (sums.map((x) => `<tr><td>${esc(x.store)}</td><td>${esc(x.name)}</td><td>${esc(x.nickname)}</td><td>${x.work}</td><td>${x.present}</td><td>${x.offsite || "-"}</td>
      <td>${x.late ? `<span class="tag warn">${x.late} / ${x.lateMin}</span>` : "-"}</td><td>${x.absent ? `<span class="tag off">${x.absent}</span>` : "-"}</td>
      <td>${x.early || "-"}</td><td>${x.noOut || "-"}</td><td>${x.off}</td><td>${x.leave}</td>
      <td>${x.hasAccount ? `<span class="tag in">มี</span>` : `<span class="tag warn">ยังไม่มี</span>`}</td></tr>`).join("") || `<tr><td class="muted" colspan="13">ไม่มีข้อมูล</td></tr>`);
  const showAll = $("aShow").value === "all";
  const rows = days.filter((r) => showAll || r.issue);
  $("tAttDay").innerHTML = `<tr><th>วันที่</th><th>สาขา</th><th>ชื่อ</th><th>กะ</th><th>เวลากะ</th><th>เข้างาน</th><th>ออกงาน</th><th>สถานะ</th></tr>` +
    (rows.slice(0, 1500).map((r) => `<tr><td>${r.day}</td><td>${esc(r.store)}</td><td>${esc(r.name)}${r.nickname ? ` (${esc(r.nickname)})` : ""}</td><td>${esc(r.code)}</td><td>${r.sched || "-"}</td>
      <td>${r.in ? fmtTime(r.in) : "-"}</td><td>${r.out ? fmtTime(r.out) : "-"}</td><td>${r.kind ? `<span class="tag ${r.kind}">${esc(r.status)}</span>` : esc(r.status)}</td></tr>`).join("")
      || `<tr><td class="muted" colspan="8">${showAll ? "ไม่มีข้อมูล" : "ไม่มีรายการผิดปกติ"}</td></tr>`);
}
$("btnAtt").onclick = runAtt;
["aBranch", "aShow", "aZone"].forEach((i) => $(i).addEventListener("change", renderAtt));
$("aSearch").addEventListener("input", renderAtt);
$("btnAttCsvSum").onclick = () => {
  const { sums } = attFiltered();
  downloadCsv(`${bkkDay()}_สรุปมาสายขาดงาน_${$("aMonth").value}.csv`,
    ["สาขา", "ชื่อ", "ชื่อเล่น", "เบอร์โทร", "วันทำงาน", "มาทำงาน", "นอกสถานที่(วัน)", "สาย(ครั้ง)", "สาย(นาทีรวม)", "ขาดงาน", "ออกก่อน(ครั้ง)", "ออกก่อน(นาทีรวม)", "ไม่ลงออก", "วันหยุด", "ลา/พักร้อน/อบรม", "เช็กอินในวันหยุด", "มีบัญชี"],
    sums.map((x) => [x.store, x.name, x.nickname, x.phone, x.work, x.present, x.offsite, x.late, x.lateMin, x.absent, x.early, x.earlyMin, x.noOut, x.off, x.leave, x.offWork, x.hasAccount ? "มี" : "ไม่มี"]));
};
$("btnAttCsvDay").onclick = () => {
  const { days } = attFiltered();
  downloadCsv(`${bkkDay()}_รายวันตามกะ_${$("aMonth").value}.csv`,
    ["วันที่", "สาขา", "ชื่อ", "ชื่อเล่น", "รหัสกะ", "เวลากะ", "เข้างาน", "ออกงาน", "สถานะ"],
    days.slice().reverse().map((r) => [r.day, r.store, r.name, r.nickname, r.code, r.sched, r.in ? fmtTime(r.in) : "", r.out ? fmtTime(r.out) : "", r.status]));
};

/* ================= เขต (RM) ================= */
async function loadZones() {
  try { zones = (await getDocs(collection(db, "zones"))).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.id.localeCompare(b.id)); }
  catch (e) { zones = []; console.warn("อ่านข้อมูลเขตไม่ได้ — ตรวจว่า Publish Rules ล่าสุดแล้ว", e); }
  const opts = zones.map((z) => `<option value="${esc(z.id)}">${esc(z.name || z.id)}</option>`).join("");
  $("rZone").innerHTML = `<option value="">ทุกเขต</option>` + opts;
  $("aZone").innerHTML = `<option value="">ทุกเขต</option>` + opts;
  $("uZone").innerHTML = `<option value="">— ตามสาขาประจำ —</option>` + opts;
  $("bZone").innerHTML = `<option value="">— ยังไม่กำหนด —</option>` + opts;
  if (!isRM()) return;
  $("tZones").innerHTML = `<tr><th>รหัส</th><th>ชื่อเขต</th><th>AM</th><th>สาขา</th><th>พนักงาน</th><th></th></tr>` +
    (zones.map((z) => {
      const ams = users.filter((u) => u.role === "am" && u.zoneId === z.id).map((u) => u.name).join(", ");
      return `<tr><td>${esc(z.id)}</td><td>${esc(z.name)}</td><td>${ams ? esc(ams) : `<span class="tag warn">ยังไม่มีบัญชี AM</span>`}</td>
        <td>${allBranches.filter((b) => b.zoneId === z.id).length}</td><td>${users.filter((u) => u.zoneId === z.id && u.role === "staff").length}</td>
        <td class="actions"><button class="btn sm" data-zedit="${esc(z.id)}">แก้ไข</button><button class="btn sm danger" data-zdel="${esc(z.id)}">ลบ</button></td></tr>`;
    }).join("") || `<tr><td class="muted">ยังไม่มีเขต</td></tr>`);
}
$("btnZSave").onclick = async () => {
  const id = $("zId").value.trim(), name = $("zName").value.trim();
  if (!/^[A-Za-z0-9-]{1,20}$/.test(id)) return msg("zMsg", "รหัสเขตใช้ได้เฉพาะ A-Z, 0-9 และ - (ไม่เกิน 20 ตัว)");
  if (!name) return msg("zMsg", "กรอกชื่อเขต");
  try { await setDoc(doc(db, "zones", id), { name }); msg("zMsg", "บันทึกแล้ว", "ok"); $("zId").value = ""; $("zName").value = ""; $("zId").disabled = false; await loadZones(); await loadBranches(); }
  catch (e) { msg("zMsg", errText(e)); }
};
$("btnZClear").onclick = () => { $("zId").value = ""; $("zName").value = ""; $("zId").disabled = false; };
$("tZones").addEventListener("click", async (e) => {
  const ed = e.target.dataset.zedit, del = e.target.dataset.zdel;
  if (ed) { const z = zones.find((x) => x.id === ed); $("zId").value = z.id; $("zId").disabled = true; $("zName").value = z.name || ""; }
  if (del) {
    if (allBranches.some((b) => b.zoneId === del)) return alert("ย้ายสาขาออกจากเขตนี้ก่อนลบ");
    if (confirm(`ลบเขต ${del}?`)) { await deleteDoc(doc(db, "zones", del)); loadZones(); }
  }
});
$("btnBackfill").onclick = async () => {
  if (!confirm("อัปเดตเขตให้พนักงาน ตารางกะ และประวัติเช็กอินทั้งหมดตามสาขาประจำ?")) return;
  busy($("btnBackfill"), true);
  let n = 0;
  const commitAll = async (ops) => { for (let i = 0; i < ops.length; i += 400) { const b = writeBatch(db); ops.slice(i, i + 400).forEach(([r, d]) => b.update(r, d)); await b.commit(); n += Math.min(400, ops.length - i); msg("bfMsg", `อัปเดตแล้ว ${n} รายการ...`, "ok"); } };
  try {
    const uOps = [];
    (await getDocs(collection(db, "users"))).docs.forEach((d) => { const u = d.data(); if (u.role === "staff" || !u.role) { const z = bZoneOf(u.branchId); if (z && z !== u.zoneId) uOps.push([d.ref, { zoneId: z }]); } });
    await commitAll(uOps);
    const sOps = [];
    (await getDocs(collection(db, "shifts"))).docs.forEach((d) => { const s = d.data(); const z = bZoneOf(s.branchId); if (z && z !== s.zoneId) sOps.push([d.ref, { zoneId: z }]); });
    await commitAll(sOps);
    const cOps = [];
    (await getDocs(collection(db, "checkins"))).docs.forEach((d) => { const c = d.data(); const z = bZoneOf(c.branchId); const zm = `${z}_${(c.day || "").slice(0, 7)}`; if (z && (z !== c.zoneId || zm !== c.zm)) cOps.push([d.ref, { zoneId: z, zm }]); });
    await commitAll(cOps);
    msg("bfMsg", `เสร็จแล้ว · พนักงาน ${uOps.length} · ตารางกะ ${sOps.length} · เช็กอิน ${cOps.length} รายการ`, "ok");
    await loadUsers(); await loadZones();
  } catch (e) { msg("bfMsg", errText(e)); }
  finally { busy($("btnBackfill"), false); }
};
