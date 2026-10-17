import { auth, db, $, haversine, fmtDist, getDeviceId, isMobile, isInAppBrowser, bkkDay, fmtTime, fmtDateLong, GESTURES, errText, esc, busy, normCode, shiftInfo, shiftLabel } from "./common.js";
import { signInWithEmailAndPassword, signOut, onAuthStateChanged, updatePassword, sendPasswordResetEmail } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js";
import { doc, getDoc, getDocs, setDoc, updateDoc, collection, query, where, serverTimestamp, writeBatch } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

const SCREENS = ["scInApp", "scLoading", "scLogin", "scChangePw", "scDevice", "scBlocked", "scMain"];
function screen(id) {
  SCREENS.forEach((s) => $(s).classList.toggle("hidden", s !== id));
  $("btnLogout").classList.toggle("hidden", !["scChangePw", "scDevice", "scBlocked", "scMain"].includes(id));
}
function msg(id, text, kind = "err") { const el = $(id); el.textContent = text || ""; el.className = "msg " + kind; }

const deviceId = getDeviceId();
const MAX_DEVICES = 2;
let me = null, profile = null, branches = [], type = "in";
let pos = null, watchId = null, inRange = false, dist = null;
let stream = null, gesture = null, photo = null, todayCode = "";

/* ---------- เริ่มต้น ---------- */
if (isInAppBrowser()) {
  screen("scInApp");
  $("btnCopyLink").onclick = async () => {
    try { await navigator.clipboard.writeText(location.href); msg("copyMsg", "คัดลอกแล้ว นำไปวางใน Safari หรือ Chrome", "ok"); }
    catch { msg("copyMsg", location.href, "ok"); }
  };
} else {
  screen("scLoading");
  onAuthStateChanged(auth, onUser);
}

async function onUser(user) {
  stopAll();
  me = user;
  if (!user) { screen("scLogin"); return; }
  screen("scLoading");
  try {
    const snap = await getDoc(doc(db, "users", user.uid));
    if (!snap.exists()) return blocked("บัญชีนี้ยังไม่ได้ลงทะเบียนในระบบ กรุณาติดต่อหัวหน้า");
    profile = snap.data();
    if (profile.active === false) return blocked("บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อหัวหน้า");
    if (profile.mustChangePassword) { screen("scChangePw"); return; }
    await checkDevice();
  } catch (e) { blocked(errText(e)); }
}
function blocked(text) { $("blkText").textContent = text; screen("scBlocked"); }

/* ---------- ล็อกอิน ---------- */
$("btnLogin").onclick = async () => {
  const email = $("liEmail").value.trim(), pw = $("liPw").value;
  if (!email || !pw) return msg("liMsg", "กรุณากรอกอีเมลและรหัสผ่าน");
  busy($("btnLogin"), true);
  try { await signInWithEmailAndPassword(auth, email, pw); msg("liMsg", ""); }
  catch (e) { msg("liMsg", errText(e)); }
  finally { busy($("btnLogin"), false); }
};
$("liPw").addEventListener("keydown", (e) => { if (e.key === "Enter") $("btnLogin").click(); });
$("btnForgot").onclick = async () => {
  const email = $("liEmail").value.trim();
  if (!email) return msg("liMsg", "กรอกอีเมลของคุณในช่องด้านบนก่อน แล้วกด \"ลืมรหัสผ่าน\" อีกครั้ง");
  try { await sendPasswordResetEmail(auth, email); msg("liMsg", "ส่งลิงก์ตั้งรหัสผ่านใหม่ไปที่อีเมลแล้ว (ตรวจในกล่อง Junk/Spam ด้วย)", "ok"); }
  catch (e) { msg("liMsg", errText(e)); }
};
$("btnLogout").onclick = () => { stopAll(); signOut(auth); };

/* ---------- เปลี่ยนรหัสผ่านครั้งแรก ---------- */
$("btnChangePw").onclick = async () => {
  const a = $("cpPw1").value, b = $("cpPw2").value;
  if (a.length < 6) return msg("cpMsg", "รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร");
  if (a !== b) return msg("cpMsg", "รหัสผ่านทั้ง 2 ช่องไม่ตรงกัน");
  busy($("btnChangePw"), true);
  try {
    await updatePassword(me, a);
    await updateDoc(doc(db, "users", me.uid), { mustChangePassword: false });
    profile.mustChangePassword = false;
    msg("cpMsg", "");
    await checkDevice();
  } catch (e) { msg("cpMsg", errText(e)); }
  finally { busy($("btnChangePw"), false); }
};

/* ---------- ตรวจเครื่อง (1 เครื่อง 1 คน) ---------- */
async function checkDevice() {
  const snap = await getDoc(doc(db, "users", me.uid));
  profile = snap.data();
  if (profile.active === false) return blocked("บัญชีนี้ถูกระงับการใช้งาน กรุณาติดต่อหัวหน้า");
  // 1 คนผูกได้ 2 ที่บนมือถือเครื่องเดียว (เช่น Safari + ไอคอนหน้าจอโฮม)
  const ids = Array.isArray(profile.deviceIds) && profile.deviceIds.length ? profile.deviceIds : (profile.deviceId ? [profile.deviceId] : []);
  if (!ids.includes(deviceId)) {
    if (!isMobile()) return requestDevice("คอมพิวเตอร์ต้องได้รับอนุมัติจากหัวหน้าก่อนใช้งาน ระบบส่งคำขอให้หัวหน้าแล้ว");
    if (ids.length < MAX_DEVICES) {
      const upd = { deviceIds: [...ids, deviceId] };
      if (!profile.deviceId) upd.deviceId = deviceId;
      await updateDoc(doc(db, "users", me.uid), upd);
      Object.assign(profile, upd);
      ids.push(deviceId);
    }
  }
  if (!ids.includes(deviceId)) {
    return requestDevice("เครื่องนี้ไม่ใช่เครื่องที่ลงทะเบียนไว้ (หรือมีการล้างข้อมูลเบราว์เซอร์) ระบบส่งคำขอเปลี่ยนเครื่องให้หัวหน้าแล้ว");
  }
  enterMain();
}
async function requestDevice(text) {
  await setDoc(doc(db, "deviceRequests", me.uid), {
    deviceId, ua: navigator.userAgent.slice(0, 300), name: profile.name || "", email: me.email || "",
    mobile: isMobile(), zoneId: profile.zoneId || "", at: serverTimestamp()
  });
  $("devText").textContent = text;
  screen("scDevice");
}
$("btnDevRecheck").onclick = async () => {
  busy($("btnDevRecheck"), true);
  try { await checkDevice(); } catch (e) { $("devText").textContent = errText(e); }
  finally { busy($("btnDevRecheck"), false); }
};

/* ---------- หน้าหลัก ---------- */
async function enterMain() {
  screen("scMain");
  $("mName").textContent = profile.name || me.email;
  $("mPos").textContent = [profile.position, profile.empId ? "รหัส " + profile.empId : ""].filter(Boolean).join(" · ");
  $("mDate").textContent = fmtDateLong();
  const bs = await getDocs(collection(db, "branches"));
  branches = bs.docs.map((d) => ({ id: d.id, ...d.data() }))
    .filter((b) => typeof b.lat === "number" && typeof b.lng === "number")
    .sort((a, b) => String(a.name).localeCompare(String(b.name), "th"));
  const sel = $("mBranch");
  sel.innerHTML = branches.map((b) => `<option value="${esc(b.id)}">${esc(b.name)} (${esc(b.id)})</option>`).join("")
    || `<option value="">— ยังไม่มีสาขาที่ตั้งพิกัดไว้ —</option>`;
  if (profile.branchId && branches.some((b) => b.id === profile.branchId)) sel.value = profile.branchId;
  sel.onchange = updateLoc;
  setType("in");
  resetPhoto();
  startGeo();
  loadToday();
  loadShift();
}

async function loadShift() {
  const el = $("mShift");
  el.classList.add("hidden"); todayCode = "";
  if (!profile.phoneKey) return;
  try {
    const day = bkkDay();
    const s = await getDoc(doc(db, "shifts", `${day.slice(0, 7)}_${profile.phoneKey}`));
    if (!s.exists()) return;
    todayCode = normCode((s.data().days || {})[day]);
    const info = shiftInfo(todayCode);
    el.textContent = "🕘 วันนี้: " + shiftLabel(todayCode);
    el.className = "loc " + (info && info.off ? "bad" : "ok");
  } catch (e) { /* ยังไม่มีตารางกะเดือนนี้ */ }
}
const curBranch = () => branches.find((b) => b.id === $("mBranch").value);

$("segType").addEventListener("click", (e) => { const v = e.target.dataset && e.target.dataset.v; if (v) setType(v); });
function setType(v) {
  type = v;
  [...$("segType").children].forEach((b) => b.classList.toggle("on", b.dataset.v === v));
  refresh();
}

/* ---------- GPS ---------- */
function setLoc(kind, text) { const el = $("locBox"); el.className = "loc " + kind; el.textContent = text; }
function startGeo() {
  if (!("geolocation" in navigator)) { setLoc("bad", "✗ อุปกรณ์นี้ไม่รองรับการหาตำแหน่ง"); return; }
  setLoc("wait", "📍 กำลังหาตำแหน่ง...");
  watchId = navigator.geolocation.watchPosition(
    (p) => { pos = p.coords; updateLoc(); },
    (e) => {
      pos = null; inRange = false;
      setLoc("bad", e.code === 1
        ? "✗ ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิด Location ในเครื่อง และกดอนุญาตในเบราว์เซอร์"
        : "✗ หาตำแหน่งไม่ได้ — เปิด Location แล้วเดินไปใกล้หน้าต่างหรือที่โล่ง");
      refresh();
    },
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 }
  );
}
const isOff = () => $("mOff").checked;
const noteText = () => $("mNote").value.trim();
function updateLoc() {
  const b = curBranch(), off = isOff();
  $("noteReq").textContent = off ? "(จำเป็น — ระบุสถานที่/เหตุผล อย่างน้อย 5 ตัวอักษร)" : "(ไม่บังคับ)";
  $("noteReq").className = off ? "msg err" : "";
  if (!b) { inRange = false; setLoc("bad", "✗ ยังไม่ได้เลือกสาขา"); return refresh(); }
  if (!pos) return refresh();
  dist = haversine(pos.latitude, pos.longitude, b.lat, b.lng);
  const r = b.radius || 200, acc = Math.round(pos.accuracy);
  inRange = dist <= r;
  if (off) setLoc("wait", `📍 นอกสถานที่ — ห่างสาขา ${fmtDist(dist)} (±${acc} ม.) · ระบบบันทึกพิกัดจริงให้หัวหน้าตรวจ`);
  else if (inRange) setLoc("ok", `✓ อยู่ในพื้นที่สาขา (ห่าง ${Math.round(dist)} ม. · ความแม่นยำ ±${acc} ม.)`);
  else setLoc("bad", `✗ อยู่นอกพื้นที่สาขา — ห่าง ${fmtDist(dist)} (กำหนด ${r} ม. · ±${acc} ม.) · ถ้าทำงานนอกสถานที่ ให้ติ๊กช่องด้านล่าง`);
  refresh();
}
$("mOff").addEventListener("change", updateLoc);
$("mNote").addEventListener("input", refresh);

/* ---------- กล้อง ---------- */
async function openCam() {
  msg("mMsg", "");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }, audio: false });
    const v = $("video");
    v.srcObject = stream;
    await v.play();
    gesture = GESTURES[Math.floor(Math.random() * GESTURES.length)];
    $("gesture").innerHTML = `<span class="e">${gesture.emoji}</span>ทำท่า: ${esc(gesture.text)} แล้วกดถ่ายรูป`;
    $("gesture").classList.remove("hidden");
    v.classList.remove("hidden"); $("camPh").classList.add("hidden"); $("shot").classList.add("hidden");
    $("btnCam").classList.add("hidden"); $("btnShoot").classList.remove("hidden"); $("btnRetake").classList.add("hidden");
  } catch (e) {
    msg("mMsg", "เปิดกล้องไม่ได้ — ตรวจสอบว่าเปิดด้วย Safari/Chrome และกดอนุญาตกล้องแล้ว");
  }
}
function stopCam() {
  if (stream) stream.getTracks().forEach((t) => t.stop());
  stream = null;
  $("video").classList.add("hidden");
}
function resetPhoto() {
  stopCam(); photo = null; gesture = null;
  $("shot").classList.add("hidden"); $("shot").removeAttribute("src");
  $("camPh").classList.remove("hidden"); $("gesture").classList.add("hidden");
  $("btnCam").classList.remove("hidden"); $("btnShoot").classList.add("hidden"); $("btnRetake").classList.add("hidden");
  refresh();
}
$("btnCam").onclick = openCam;
$("btnRetake").onclick = () => { resetPhoto(); openCam(); };
$("btnShoot").onclick = () => {
  const v = $("video");
  if (!v.videoWidth) return;
  const W = 480, H = Math.round(W * (v.videoHeight / v.videoWidth));
  const c = $("canvas"), ctx = c.getContext("2d");
  c.width = W; c.height = H;
  ctx.save(); ctx.translate(W, 0); ctx.scale(-1, 1); ctx.drawImage(v, 0, 0, W, H); ctx.restore();
  const b = curBranch();
  ctx.fillStyle = "rgba(0,0,0,.55)"; ctx.fillRect(0, H - 56, W, 56);
  ctx.fillStyle = "#fff"; ctx.font = "15px sans-serif";
  ctx.fillText(`${profile.name || ""} · ${b ? b.name : ""}`, 10, H - 33);
  ctx.fillText(`${type === "in" ? "เข้างาน" : "ออกงาน"} · ท่า: ${gesture.text} · ${new Date().toLocaleString("th-TH", { timeZone: "Asia/Bangkok" })}`, 10, H - 12);
  photo = c.toDataURL("image/jpeg", 0.6);
  stopCam();
  $("shot").src = photo; $("shot").classList.remove("hidden");
  $("btnShoot").classList.add("hidden"); $("btnRetake").classList.remove("hidden");
  refresh();
};
document.addEventListener("visibilitychange", () => { if (document.hidden && stream) resetPhoto(); });

/* ---------- ยืนยัน ---------- */
function refresh() {
  const btn = $("btnSubmit");
  btn.textContent = "ยืนยัน" + (type === "in" ? "เข้างาน" : "ออกงาน");
  const placeOk = isOff() ? noteText().length >= 5 : inRange;
  btn.textContent += isOff() ? " (นอกสถานที่)" : "";
  btn.disabled = !(placeOk && photo && pos);
}
$("btnSubmit").onclick = async () => {
  const b = curBranch();
  const off = isOff(), note = noteText();
  if (!(photo && pos && b && (off ? note.length >= 5 : inRange))) return;
  busy($("btnSubmit"), true, "กำลังบันทึก...");
  msg("mMsg", "");
  try {
    const ref = doc(collection(db, "checkins"));
    const batch = writeBatch(db);
    batch.set(doc(db, "checkinPhotos", ref.id), { uid: me.uid, ts: serverTimestamp(), photo });
    batch.set(ref, {
      uid: me.uid, name: profile.name || "", empId: profile.empId || "", position: profile.position || "",
      branchId: b.id, branchName: b.name || "", zoneId: b.zoneId || "", zm: `${b.zoneId || ""}_${bkkDay().slice(0, 7)}`, type, shiftCode: todayCode || "",
      ts: serverTimestamp(), day: bkkDay(),
      lat: pos.latitude, lng: pos.longitude, accuracy: Math.round(pos.accuracy), distance: Math.round(dist),
      gesture: gesture.text, hasPhoto: true, offsite: off, note, deviceId, ua: navigator.userAgent.slice(0, 300)
    });
    await batch.commit();
    const s = await getDoc(ref);
    const t = s.data().ts && s.data().ts.toDate();
    $("doneText").innerHTML = `${type === "in" ? "เข้างาน" : "ออกงาน"} · ${off ? "นอกสถานที่" : esc(b.name)}<br>เวลา ${fmtTime(t)} น.`;
    $("mNote").value = ""; $("mOff").checked = false; updateLoc();
    $("done").classList.remove("hidden");
    resetPhoto();
    loadToday();
  } catch (e) { msg("mMsg", errText(e)); }
  finally { busy($("btnSubmit"), false); refresh(); }
};
$("btnDone").onclick = () => $("done").classList.add("hidden");

async function loadToday() {
  try {
    const q = query(collection(db, "checkins"), where("uid", "==", me.uid), where("day", "==", bkkDay()));
    const rows = (await getDocs(q)).docs.map((d) => d.data())
      .sort((a, b) => (a.ts ? a.ts.toMillis() : 0) - (b.ts ? b.ts.toMillis() : 0));
    $("today").innerHTML = rows.length
      ? rows.map((r) => `<li><span><span class="tag ${r.type}">${r.type === "in" ? "เข้างาน" : "ออกงาน"}</span> ${r.offsite ? `<span class="tag offsite">นอกสถานที่</span>` : esc(r.branchName)}</span><b>${fmtTime(r.ts && r.ts.toDate())}</b></li>`).join("")
      : `<li class="muted">ยังไม่มีรายการ</li>`;
  } catch (e) { /* แสดงต่อได้แม้โหลดประวัติไม่สำเร็จ */ }
}

function stopAll() {
  if (watchId !== null) navigator.geolocation.clearWatch(watchId);
  watchId = null; pos = null; inRange = false;
  stopCam();
}
