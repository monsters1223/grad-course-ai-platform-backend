/* =========================================================
   研究生通识课 AI 教育平台 · 学生端（静态展示版 · 图标化重构）
   纯前端：登录用 localStorage，数据来自 data.js，无后端请求。
   ========================================================= */

const $ = (s) => document.querySelector(s);
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const NF = (n) => Number(n);

let currentUser = null;

// 进度/学习时长按用户隔离：key 带上学号前缀。
// 新注册用户（新学号）在本地没有任何记录，因此进度天然为 0，开始学习后才累积。
function uKey(prefix, courseId) {
  const uid = (currentUser && currentUser.username) || "_guest";
  return prefix + "_" + uid + (courseId != null ? "_" + courseId : "");
}

let activeNav = "home";
let searchTerm = "";
let pages = {}; // SPA 页面缓存
let popHandling = false;
let aiChatOpen = false;

// 阶段二：学情真实化所需的全局状态
let ACTIVE_VIDEO = null;       // 当前正在播放的 <video>
let ACTIVE_COURSE = null;      // 当前课程对象
let ACTIVE_SECTION = -1;       // 当前章节在课程 sections 中的序号
let ACTIVE_SECTION_TITLE = "";

// AI 课堂：按课程缓存已生成的课堂 URL（OpenMAIC 每码每日仅 10 次生成额度，必须复用）
const AI_URL_CACHE = {};
let AI_POLL = null;            // 轮询定时器
let AI_BUSY = false;           // 是否正在生成中（防重复提交）
let DASH_BACKEND = null;       // 后端看板聚合结果（优先于 localStorage 兜底）
let _progressReportBound = false;

const STUDY_START = "2026-09-01";

/* ---------------- 图标初始化 ---------------- */
function initIcons(root) {
  (root || document).querySelectorAll("[data-icon]").forEach((node) => {
    node.innerHTML = icon(node.getAttribute("data-icon"));
  });
}

/* ---------------- 密码显示切换 ---------------- */
function togglePwd() {
  const inp = $("#li-pass");
  const eye = $("#eyeBtn");
  if (inp.type === "password") { inp.type = "text"; eye.innerHTML = icon("eye-off"); }
  else { inp.type = "password"; eye.innerHTML = icon("eye"); }
}

/* ---------------- toast ---------------- */
function toast(msg) {
  let t = $("#toast");
  if (!t) { t = el("div", "toast"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._t);
  t._t = setTimeout(() => t.classList.remove("show"), 2200);
}

/* ---------------- localStorage 工具 ---------------- */
function lsGet(key, fallback) {
  try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
}
function lsSet(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch (e) {} }

// 演示级密码哈希（无后端）：用 Web Crypto 的 SHA-256，避免明文存进 localStorage。
// 注意：纯前端无服务端盐，仅作"防明文泄露"的演示防护，不等同真实账户安全；
// 正式上线应由后端（site/）用 pbkdf2/bcrypt 加盐哈希，前端只持 JWT。
async function hashPwd(p) {
  if (p == null) return "";
  try {
    const data = new TextEncoder().encode(String(p));
    const buf = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
  } catch (e) {
    // 极少数不支持 crypto.subtle 的环境降级（非哈希，仅作基础混淆）
    return "fb_" + btoa(unescape(encodeURIComponent(String(p))));
  }
}

function getAllUsers() {
  return USERS.concat(lsGet("reg_users", []));
}

/* ---------------- 阶段二：学情上报兜底（关页/切后台补报最后进度） ---------------- */
function bindProgressReportFallback() {
  if (_progressReportBound) return;
  _progressReportBound = true;
  const flush = () => {
    if (ACTIVE_VIDEO && ACTIVE_COURSE && ACTIVE_VIDEO.duration) {
      const ratio = Math.min(100, Math.round((ACTIVE_VIDEO.currentTime / ACTIVE_VIDEO.duration) * 100));
      try {
        API.reportVideo(ACTIVE_COURSE.id, ACTIVE_SECTION, ACTIVE_SECTION_TITLE, ratio, Math.round(ACTIVE_VIDEO.currentTime)).catch(() => {});
      } catch (e) {}
    }
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/* ---------------- 登录 / 退出（已接入后端） ---------------- */
async function doLogin() {
  const u = $("#li-user").value.trim();
  const p = $("#li-pass").value;
  if (!u || !p) { showErr("请输入学号和密码"); return; }
  try {
    const data = await API.login(u, p);
    setToken(data.token);
    const u0 = data.user || {};
    currentUser = {
      id: u0.id, username: u0.username, name: u0.name || u0.username,
      nickname: u0.name || u0.username, sid: u0.username,
      major: "—", specialty: "", cls: "", contact: "", avatar: u0.avatar,
      role: u0.role,
    };
    storeUser();
    bindProgressReportFallback();
    showApp({ replace: true });
  } catch (e) {
    showErr(e.message || "登录失败");
  }
}
function showErr(m) {
  const e = $("#li-err");
  e.textContent = m;
  setTimeout(() => { if (e.textContent === m) e.textContent = ""; }, 3000);
}
function storeUser() { lsSet("static_user", currentUser); }

function showRegister() {
  $("#loginForm").style.display = "none";
  $("#regForm").style.display = "block";
  $("#li-err").textContent = "";
}
function showLogin() {
  $("#regForm").style.display = "none";
  $("#forgotForm").style.display = "none";
  $("#loginForm").style.display = "block";
  $("#reg-msg").textContent = "";
  $("#fg-msg").textContent = "";
}
function togglePwdReg() {
  const inp = $("#reg-pass");
  const eye = $("#eyeBtn2");
  if (inp.type === "password") { inp.type = "text"; eye.innerHTML = icon("eye-off"); }
  else { inp.type = "password"; eye.innerHTML = icon("eye"); }
}
function togglePwdReg2() {
  const inp = $("#reg-pass2");
  const eye = $("#eyeBtn3");
  if (inp.type === "password") { inp.type = "text"; eye.innerHTML = icon("eye-off"); }
  else { inp.type = "password"; eye.innerHTML = icon("eye"); }
}
async function doRegister() {
  const msg = $("#reg-msg");
  msg.style.color = "var(--danger)";
  msg.textContent = "本平台为校内封闭账号体系，账号由管理员统一下发，不支持自助注册。";
}

function showForgot() {
  $("#loginForm").style.display = "none";
  $("#regForm").style.display = "none";
  $("#forgotForm").style.display = "block";
  $("#li-err").textContent = "";
  $("#fg-msg").textContent = "";
}
function togglePwdFg() {
  const inp = $("#fg-pass");
  const eye = $("#eyeBtn4");
  if (inp.type === "password") { inp.type = "text"; eye.innerHTML = icon("eye-off"); }
  else { inp.type = "password"; eye.innerHTML = icon("eye"); }
}
function togglePwdFg2() {
  const inp = $("#fg-pass2");
  const eye = $("#eyeBtn5");
  if (inp.type === "password") { inp.type = "text"; eye.innerHTML = icon("eye-off"); }
  else { inp.type = "password"; eye.innerHTML = icon("eye"); }
}
async function doForgot() {
  const msg = $("#fg-msg");
  msg.style.color = "var(--danger)";
  msg.textContent = "请联系管理员重置密码。";
}

function logout() {
  localStorage.removeItem("static_user");
  clearToken();
  currentUser = null;
  pages = {};
  activeNav = "home";
  searchTerm = "";
  $("#view").innerHTML = "";
  $("#topSearch").value = "";
  $("#li-user").value = "";
  $("#li-pass").value = "";
  $("#app").style.display = "none";
  $("#login").style.display = "flex";
  hideAIFAB();
}

function showApp(opts) {
  $("#login").style.display = "none";
  $("#app").style.display = "flex";
  applyAvatar();
  renderNav();
  showAIFAB();
  navigate("home", Object.assign({ replace: true }, opts || {}));
}

/* ---------------- 历史记录 / 浏览器返回 ---------------- */
function pushView(view, replace, data) {
  const state = Object.assign({ view: view }, data || {});
  const title = document.title;
  if (replace) history.replaceState(state, title, location.pathname);
  else history.pushState(state, title, location.pathname);
}

/* ---------------- 个人资料存储 ---------------- */
function getProfile(u) {
  const map = lsGet("profiles", {});
  return map[u] || {};
}
function setProfile(u, patch) {
  const map = lsGet("profiles", {});
  map[u] = Object.assign(map[u] || {}, patch);
  lsSet("profiles", map);
}
async function checkPass(u, p) {
  const hp = await hashPwd(p);
  const ov = lsGet("pwd_override", {});
  if (ov[u] != null) return ov[u] === hp;
  const base = getAllUsers().find((x) => x.username === u);
  return !!(base && base.password === hp);
}
function applyAvatar() {
  const av = $("#topAvatar");
  if (!av || !currentUser) return;
  const prof = getProfile(currentUser.username);
  const text = (prof.avatarText && prof.avatarText.trim()) || currentUser.nickname || currentUser.name || currentUser.username;
  if (prof.avatarImg) {
    av.textContent = "";
    av.style.background = "center/cover no-repeat url(" + prof.avatarImg + ")";
  } else {
    av.textContent = text.slice(0, 8);
    av.style.background = prof.avatarColor || "linear-gradient(135deg,var(--accent),var(--primary))";
  }
}

/* ---------------- 头像菜单 ---------------- */
function toggleAvatarMenu() {
  $("#avatarMenu").classList.toggle("show");
}
function openProfile() {
  $("#avatarMenu").classList.remove("show");
  const m = $("#menuWho");
  m.innerHTML = '<div style="font-size:13px;color:var(--text-2)">学号 ' + currentUser.sid + '</div>' +
    '<div style="font-size:15px;color:var(--text);font-weight:800;margin-top:2px">' + esc(currentUser.nickname || currentUser.name) + '</div>';
  $("#profileMask").style.display = "flex";
  renderProfileTab("info");
}
function closeProfile() { $("#profileMask").style.display = "none"; }

function renderProfileTab(tab) {
  document.querySelectorAll("#profileTabs .tab").forEach((t) => t.classList.toggle("cur", t.getAttribute("data-tab") === tab));
  const body = $("#profileBody");
  const prof = getProfile(currentUser.username);
  if (tab === "info") {
    const infoBg = prof.avatarImg ? ("center/cover no-repeat url(" + prof.avatarImg + ")") : (prof.avatarColor || "linear-gradient( 135deg,var(--accent),var(--primary))");
    const infoText = prof.avatarImg ? "" : ((prof.avatarText || currentUser.name || currentUser.username).slice(0, 2));
    const nm = (currentUser.name && currentUser.name !== currentUser.sid) ? currentUser.name : "未填写";
    let html =
      '<div style="display:flex;align-items:center;gap:14px;padding:6px 4px 16px">' +
        '<div class="avatar lg" style="width:64px;height:64px;font-size:20px;background:' + infoBg + '">' + infoText + '</div>' +
        '<div><div style="font-size:17px;font-weight:800">' + esc(nm) + '</div>' +
        '<div style="font-size:12px;color:var(--text-2);margin-top:3px">学号 ' + currentUser.sid + '</div></div>' +
      '</div>' +
      '<div class="info-list">' +
        '<div class="info-row"><span class="info-label">姓名</span><span class="info-val">' + esc(nm) + '</span></div>' +
        '<div class="info-row"><span class="info-label">学号</span><span class="info-val">' + currentUser.sid + '</span></div>' +
        '<div class="info-row"><span class="info-label">学院</span><span class="info-val">' + (currentUser.major && currentUser.major !== "—" ? esc(currentUser.major) : "未填写") + '</span></div>' +
        '<div class="info-row"><span class="info-label">专业</span><span class="info-val">' + (currentUser.specialty ? esc(currentUser.specialty) : "未填写") + '</span></div>' +
        '<div class="info-row"><span class="info-label">班级</span><span class="info-val">' + (currentUser.cls ? esc(currentUser.cls) : "未填写") + '</span></div>' +
        '<div class="info-row"><span class="info-label">联系方式</span><span class="info-val">' + (currentUser.contact ? esc(currentUser.contact) : "未填写") + '</span></div>' +
      '</div>' +
      '<button class="btn ghost" style="margin-top:14px;width:100%" onclick="editInfo()">编辑资料</button>';
    body.innerHTML = html;
  } else if (tab === "nick") {
    body.innerHTML =
      '<div class="field"><label>当前昵称</label><div class="muted" style="padding:4px 0">' + esc(currentUser.nickname || currentUser.name) + '</div></div>' +
      '<div class="field"><label>新昵称</label><input id="nf-nick" placeholder="输入新的昵称" value="' + esc(currentUser.nickname || "") + '" /></div>' +
      '<button class="btn" style="margin-top:10px" onclick="saveNick()">保存昵称</button>' +
      '<p id="nick-msg" class="muted" style="min-height:16px;font-size:12px;margin-top:8px;color:var(--success)"></p>';
  } else if (tab === "avatar") {
    const colors = ["linear-gradient(135deg,#8AA9F0,#5E82D8)", "linear-gradient(135deg,#FFB49E,#FF8C7A)", "linear-gradient(135deg,#A99CF5,#7C6FD6)", "linear-gradient(135deg,#62CBA0,#3FA98A)", "linear-gradient(135deg,#F5C26B,#E0A23C)", "linear-gradient(135deg,#69B7E8,#4A93C9)"];
    const cur = prof.avatarImg || "";
    const prevBg = cur ? ("center/cover no-repeat url(" + cur + ")") : (prof.avatarColor || colors[0]);
    const prevText = cur ? "" : ((prof.avatarText || currentUser.nickname || currentUser.name || currentUser.username).slice(0, 2));
    let html = '<div style="text-align:center;padding:8px 0 14px"><div class="avatar lg" id="av-prev" style="width:72px;height:72px;font-size:22px;margin:0 auto;background:' + prevBg + '" data-img="' + cur + '">' + prevText + '</div></div>';
    html += '<div class="field"><label>上传头像图片（不超过 2MB）</label><input type="file" id="av-file" accept="image/*" onchange="uploadAvatar(this)" /></div>';
    html += '<div class="field"><label>头像文字（无图片时生效，最多 2 字）</label><input id="av-text" maxlength="2" placeholder="留空则用昵称" value="' + esc(prof.avatarText || "") + '" oninput="updAvPrev()" /></div>';
    html += '<div style="font-size:12px;color:var(--text-3);margin:6px 0 8px">选择底色（无图片时生效）</div><div class="swatches">';
    colors.forEach((c) => { html += '<span class="sw" style="background:' + c + '" onclick="pickColor(\'' + c + '\')"></span>'; });
    html += '</div>';
    if (cur) html += '<button class="btn ghost" style="margin-top:10px" onclick="removeAvatar()">移除图片，使用文字头像</button>';
    html += '<button class="btn" style="margin-top:14px" onclick="saveAvatar()">保存头像</button>';
    body.innerHTML = html;
  } else if (tab === "pwd") {
    body.innerHTML =
      '<div class="field"><label>当前密码</label><input id="pw-old" type="password" placeholder="请输入当前密码" /></div>' +
      '<div class="field"><label>新密码</label><input id="pw-new" type="password" placeholder="至少 6 位" /></div>' +
      '<div class="field"><label>确认新密码</label><input id="pw-new2" type="password" placeholder="再次输入新密码" /></div>' +
      '<button class="btn" style="margin-top:10px" onclick="savePwd()">修改密码</button>' +
      '<p id="pw-msg" class="muted" style="min-height:16px;font-size:12px;margin-top:8px;color:var(--danger)"></p>';
  }
}
function updAvPrev() {
  const t = $("#av-text").value.trim() || currentUser.nickname || currentUser.name || currentUser.username;
  const prev = $("#av-prev");
  if (!prev.getAttribute("data-img")) prev.textContent = t.slice(0, 2);
}
function pickColor(c) { $("#av-prev").style.background = c; $("#av-prev").setAttribute("data-c", c); }
function uploadAvatar(input) {
  const file = input.files && input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { toast("图片过大，请选择 2MB 以内的图片"); return; }
  const reader = new FileReader();
  reader.onload = function () {
    const url = reader.result;
    const prev = $("#av-prev");
    prev.style.background = "center/cover no-repeat url(" + url + ")";
    prev.setAttribute("data-img", url);
    prev.textContent = "";
  };
  reader.readAsDataURL(file);
}
function removeAvatar() {
  const prev = $("#av-prev");
  const prof = getProfile(currentUser.username);
  prev.setAttribute("data-img", "");
  prev.style.background = prof.avatarColor || "linear-gradient(135deg,#8AA9F0,#5E82D8)";
  prev.textContent = (prof.avatarText || currentUser.nickname || currentUser.name || currentUser.username).slice(0, 2);
}
function saveNick() {
  const v = $("#nf-nick").value.trim();
  if (!v) { $("#nick-msg").style.color = "var(--danger)"; $("#nick-msg").textContent = "昵称不能为空"; return; }
  setProfile(currentUser.username, { avatarText: "", nickname: v });
  currentUser.nickname = v;
  applyAvatar();
  $("#nick-msg").textContent = "✓ 昵称已更新";
  setTimeout(() => { $("#nick-msg").textContent = ""; }, 1500);
}
function saveAvatar() {
  const img = $("#av-prev").getAttribute("data-img") || "";
  const c = $("#av-prev").getAttribute("data-c") || getProfile(currentUser.username).avatarColor || "linear-gradient(135deg,#8AA9F0,#5E82D8)";
  const t = $("#av-text").value.trim();
  setProfile(currentUser.username, { avatarColor: c, avatarText: t, avatarImg: img });
  applyAvatar();
  toast("✓ 头像已更新");
  renderProfileTab("info");
}
function editInfo() {
  const body = $("#profileBody");
  body.innerHTML =
    '<div class="field"><label>姓名</label><input id="inf-name" value="' + esc(currentUser.name || "") + '" placeholder="请输入姓名" /></div>' +
    '<div class="field"><label>学号</label><input value="' + currentUser.sid + '" disabled style="opacity:.7" /></div>' +
    '<div class="field"><label>学院</label><input id="inf-major" value="' + esc(currentUser.major && currentUser.major !== "—" ? currentUser.major : "") + '" placeholder="如 计算机学院" /></div>' +
    '<div class="field"><label>专业</label><input id="inf-spec" value="' + esc(currentUser.specialty || "") + '" placeholder="如 计算机科学与技术" /></div>' +
    '<div class="field"><label>班级</label><input id="inf-class" value="' + esc(currentUser.cls || "") + '" placeholder="如 计科2301班" /></div>' +
    '<div class="field"><label>联系方式</label><input id="inf-contact" value="' + esc(currentUser.contact || "") + '" placeholder="手机或邮箱" /></div>' +
    '<div style="display:flex;gap:10px;margin-top:14px">' +
      '<button class="btn" onclick="saveInfo()">保存</button>' +
      '<button class="btn ghost" onclick="renderProfileTab(\'info\')">取消</button>' +
    '</div>';
}
function saveInfo() {
  const name = $("#inf-name").value.trim();
  const major = $("#inf-major").value.trim();
  const spec = $("#inf-spec").value.trim();
  const cls = $("#inf-class").value.trim();
  const contact = $("#inf-contact").value.trim();
  if (!name) { toast("姓名不能为空"); return; }
  currentUser.name = name;
  currentUser.major = major || "—";
  currentUser.specialty = spec;
  currentUser.cls = cls;
  currentUser.contact = contact;
  setProfile(currentUser.username, { name: name, major: currentUser.major, specialty: spec, cls: cls, contact: contact });
  applyAvatar();
  toast("✓ 资料已更新");
  renderProfileTab("info");
}
async function savePwd() {
  const msg = $("#pw-msg");
  msg.textContent = "修改密码请联系管理员处理。";
}

/* ---------------- 顶部通知 ---------------- */
// 通知改为动态生成：基于当前登录用户的真实学习数据（纯前端，无需后端）。
// 包含「待完成测验 / 未签到 / 本周学习节奏」等个性化提醒，去掉写死的假作业与教师回复。
function buildNotifs() {
  const list = [];
  // 1) 待完成章节测验（按用户隔离）
  COURSES.forEach((c) => {
    const quizzes = (c.sections || []).filter((s) => s.stype === "quiz");
    if (!quizzes.length) return;
    let pending = 0, done = 0;
    quizzes.forEach((q, i) => {
      const st = lsGet(quizKey(c, i), null);
      if (st && st.submitted) done++; else pending++;
    });
    if (pending > 0) {
      list.push({
        ic: "clipboard",
        title: "待完成测验 · " + c.title,
        desc: "有 " + pending + " 份章节测验尚未提交（已提交 " + done + " 份）",
        time: "待办",
        to: "learn",
        cid: c.id,
      });
    }
  });
  // 2) 未签到提醒（按用户隔离）
  const sign = lsGet(uKey("signin_done"), null);
  if (!sign || !sign.done) {
    list.push({
      ic: "map-pin",
      title: "课堂签到提醒",
      desc: "研究生通识课近期有线下课堂，记得课前完成签到",
      time: "待办",
      to: "signin",
    });
  }
  // 3) 本周学习节奏提醒（按用户真实学习分钟）
  const dlog = lsGet(uKey("studyDaily"), {}) || {};
  const now = new Date();
  let weekMin = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(now); d.setDate(now.getDate() - i);
    weekMin += (dlog[d.toISOString().slice(0, 10)] || 0);
  }
  if (weekMin < 30) {
    list.push({
      ic: "clock",
      title: "学习节奏提醒",
      desc: "本周累计学习 " + weekMin + " 分钟，建议每天保持 15 分钟以上",
      time: "本周",
      to: "dashboard",
    });
  }
  // 4) 系统通知（始终存在，保证通知区非空）
  list.push({
    ic: "sparkles",
    title: "AI 课堂已开放",
    desc: "可进入多智能体课堂与 AI 助教互动、答疑、复习",
    time: "系统",
    to: "aichat",
  });
  return list;
}

function renderNotif() {
  const box = $("#notifyPanel");
  const notifs = buildNotifs();
  box.innerHTML = '<div class="nt-head"><span>通知</span><span class="muted">共 ' + notifs.length + ' 条</span></div>';
  if (!notifs.length) { box.innerHTML += '<div class="nt-empty">暂无通知</div>'; return; }
  notifs.forEach((n) => {
    const item = el("div", "nt-item");
    const icBox = el("div", "nt-ic"); icBox.innerHTML = icon(n.ic, 18);
    const body = el("div"); body.style.flex = "1";
    body.innerHTML = '<div style="font-weight:700">' + esc(n.title) + '</div><div class="nt-body">' + esc(n.desc) + '</div>';
    const t = el("div", "muted"); t.style.fontSize = "11px"; t.style.whiteSpace = "nowrap"; t.textContent = n.time;
    item.appendChild(icBox); item.appendChild(body); item.appendChild(t);
    item.onclick = () => {
      box.classList.remove("show");
      if (n.cid) { openCourse(n.cid, true); return; }
      if (n.to) navigate(n.to);
    };
    box.appendChild(item);
  });
}

/* ---------------- 导航 ---------------- */
const NAV = [
  { key: "home", ic: "book-open", label: "课程中心" },
  { key: "aichat", ic: "bot", label: "AI 课堂" },
  { key: "dashboard", ic: "bar-chart", label: "学情看板" },
  { key: "signin", ic: "check-circle", label: "课堂签到" },
  { key: "chat", ic: "message", label: "班级群聊" },
  { key: "groups", ic: "users", label: "学习小组" },
];

function renderNav() {
  const nav = $("#nav");
  nav.innerHTML = "";
  NAV.forEach((n) => {
    const item = el("div", "nav-item" + (n.key === activeNav ? " active" : ""));
    const ic = el("span", "ic"); ic.innerHTML = icon(n.ic, 18);
    item.appendChild(ic);
    item.appendChild(el("span", null, n.label));
    item.onclick = () => navigate(n.key);
    nav.appendChild(item);
  });
}

function navigate(key, opts) {
  opts = opts || {};
  activeNav = key;
  renderNav();
  hideCrumb();
  if (!opts.noPush && !popHandling) pushView(key, opts.replace);
  const v = $("#view");
  const content = $(".content");
  v.querySelectorAll(".page").forEach((p) => p.style.display = "none");
  if (!pages[key]) {
    const page = el("div", "page");
    page.id = "page-" + key;
    v.appendChild(page);
    pages[key] = page;
    if (key === "aichat") renderAIChat(page); // 仅首次渲染，保留对话上下文
  }
  pages[key].style.display = "block";
  // 数据页每次进入都重新读取本地记录，保证学情/进度/签到实时同步
  if (key === "home") renderHome(pages[key]);
  else if (key === "dashboard") { HW_STATES_LOADED = false; renderDashboard(pages[key]); }
  else if (key === "signin") renderSignin(pages[key]);
  else if (key === "chat") renderChat(pages[key]);
  else if (key === "groups") renderGroups(pages[key]);
  if (key === "learn") content.classList.add("learn-active");
  else content.classList.remove("learn-active");
}

/* ---------------- 面包屑 ---------------- */
function showCrumb(parts) {
  const v = $("#view");
  let cr = $("#crumb");
  if (!cr) { cr = el("div", "crumb"); cr.id = "crumb"; v.parentNode.insertBefore(cr, v); }
  cr.className = "crumb show";
  cr.innerHTML = "";
  parts.forEach((p, i) => {
    if (i > 0) cr.appendChild(Object.assign(el("span", "sep"), { textContent: "/" }));
    const item = el("span", "c-item" + (i === parts.length - 1 ? " cur" : ""), p.label);
    if (p.onclick) item.onclick = p.onclick;
    cr.appendChild(item);
  });
}
function hideCrumb() { const c = $("#crumb"); if (c) c.className = "crumb"; }

/* ---------------- 课程中心（含搜索过滤） ---------------- */
function highlight(text, term) {
  if (!term) return esc(text);
  const t = term.toLowerCase();
  const idx = text.toLowerCase().indexOf(t);
  if (idx < 0) return esc(text);
  return esc(text.slice(0, idx)) + '<mark>' + esc(text.slice(idx, idx + term.length)) + '</mark>' + esc(text.slice(idx + term.length));
}

function renderHome(v) {
  v.innerHTML = "";
  v.appendChild(el("div", "h-title", "课程中心"));
  v.appendChild(el("p", "h-sub", currentUser.name + "，" + currentUser.major + " · 这里有你的通识课程"));

  const grid = el("div", "course-grid");
  v.appendChild(grid);

  const s = (searchTerm || "").trim().toLowerCase();
  const list = COURSES.filter((c) => {
    if (!s) return true;
    return (c.title + " " + (c.desc || "")).toLowerCase().includes(s);
  });

  if (!list.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-3)">未找到与「' + esc(searchTerm) + '」相关的课程</div>';
    return;
  }
  list.forEach((c) => {
    const card = el("div", "course-card");
    const cover = el("div", "course-cover", c.coverText);
    cover.style.background = c.coverColor;
    const body = el("div", "course-body");
    const h4 = el("h4");
    h4.innerHTML = highlight(c.title, searchTerm);
    body.appendChild(h4);
    body.appendChild(el("div", "course-meta", c.category + " · " + c.teacher));
    const prog = el("div", "progress");
    const span = el("span");
    const pct = NF(localStorage.getItem(uKey("progress", c.id))) || 0;
    span.style.width = pct + "%";
    prog.appendChild(span);
    body.appendChild(prog);
    card.appendChild(cover);
    card.appendChild(body);
    card.onclick = () => openCourse(c.id);
    grid.appendChild(card);
  });
}

$("#topSearch").addEventListener("input", (e) => {
  searchTerm = e.target.value.trim();
  if (activeNav === "home" && pages.home) renderHome(pages.home);
});

/* ---------------- 学习页 ---------------- */
function openCourse(id, skipNav, targetTab) {
  const c = COURSES.find((x) => x.id === id);
  if (!c) return;
  activeNav = "learn";
  renderNav();
  showCrumb([
    { label: "课程中心", onclick: () => navigate("home") },
    { label: c.title },
  ]);
  const v = $("#view");
  v.querySelectorAll(".page").forEach((p) => p.style.display = "none");
  if (!pages.learn) {
    const page = el("div", "page");
    page.id = "page-learn";
    v.appendChild(page);
    pages.learn = page;
  }
  pages.learn.style.display = "block";
  pages.learn.innerHTML = "";
  renderLearn(pages.learn, c, targetTab);
  $(".content").classList.add("learn-active");
  if (!skipNav) pushView("learn", false, { courseId: id });
}

function renderLearn(v, c, targetTab) {
  v.innerHTML = "";
  const saved = NF(localStorage.getItem(uKey("progress", c.id))) || 0;

  const header = el("div", "learn-header");
  const backBtn = el("button", "btn sm ghost learn-back-btn");
  backBtn.innerHTML = icon("arrow-left", 14) + " 返回课程";
  backBtn.onclick = () => navigate("home");
  header.appendChild(backBtn);
  const titleWrap = el("div");
  titleWrap.appendChild(el("h1", "h-title", c.title));
  titleWrap.appendChild(el("p", "h-sub", c.category + " · " + c.teacher + " · 进度 " + saved + "%"));
  header.appendChild(titleWrap);
  v.appendChild(header);

  if (!c.sections || c.sections.length === 0) {
    const empty = el("div", "card");
    empty.style.textAlign = "center"; empty.style.padding = "64px 20px"; empty.style.color = "var(--text-3)";
    empty.innerHTML = '<div style="font-size:46px;opacity:.6">📭</div>' +
      '<div style="font-size:18px;margin-top:14px;color:var(--text-2);font-weight:800;font-family:var(--font-serif)">老师暂未上传数据</div>' +
      '<div style="margin-top:8px">本课程的内容正在准备中，请稍后再来查看～</div>';
    v.appendChild(empty);
    return;
  }

  const learn = el("div", "learn");
  const chapter = el("div", "chapter");
  const panel = el("div", "card");

  const videos = c.sections.filter((s) => s.stype === "video");
  const docs = c.sections.filter((s) => s.stype === "doc");
  const quizzes = c.sections.filter((s) => s.stype === "quiz");

  const player = el("div", "player-wrap");
  player.style.cssText = "border-radius:var(--radius);overflow:hidden;box-shadow:var(--shadow);background:#000;position:relative;min-height:320px";
  let currentVideo = videos[0] || null;

  function buildVideoPoster(s) {
    player.innerHTML = "";
    const poster = el("div", "video-poster");
    const hasVideo = s && s.content;
    poster.style.cssText = "position:absolute;inset:0;background:" + (hasVideo ? "linear-gradient(160deg,#3A3550,#574E7A)" : "linear-gradient(160deg,#5A5A6A,#7A7A8A)") + ";display:flex;flex-direction:column;align-items:center;justify-content:center;color:#fff;" + (hasVideo ? "cursor:pointer;" : "cursor:default;") + "z-index:2";
    if (hasVideo) {
      poster.innerHTML =
        '<div class="video-poster-play">' + icon("video", 36) + '</div>' +
        '<div style="margin-top:14px;font-size:16px;font-weight:700">' + esc(s.title) + '</div>' +
        '<div style="margin-top:6px;font-size:12px;opacity:.75">点击开始播放</div>';
      poster.onclick = () => startVideo(s);
    } else {
      poster.innerHTML =
        '<div style="font-size:40px;opacity:.6">📭</div>' +
        '<div style="margin-top:14px;font-size:16px;font-weight:700">教师未上传视频</div>' +
        '<div style="margin-top:6px;font-size:12px;opacity:.75">可以先看下方推荐视频</div>';
    }
    player.appendChild(poster);
  }

  function startVideo(s) {
    if (!s) return;
    currentVideo = s;
    const sectionIndex = c.sections.indexOf(s);
    const sectionTitle = s.title || "";
    player.innerHTML = "";
    const video = document.createElement("video");
    video.controls = true;
    video.style.cssText = "width:100%;display:block;max-height:420px;background:#000";
    video.src = s.content;
    video.addEventListener("timeupdate", () => {
      if (!video.duration) return;
      const ratio = Math.min(100, Math.round((video.currentTime / video.duration) * 100));
      const key = uKey("progress", c.id);
      const prev = NF(localStorage.getItem(key)) || 0;
      if (ratio > prev) { localStorage.setItem(key, ratio); refreshProgressLabel(c, ratio); }
      // 累计学习时长（每播放满 60 秒记 1 分钟），按用户隔离
      const tickKey = uKey("studyTick", c.id);
      const lastTick = NF(localStorage.getItem(tickKey)) || 0;
      if (video.currentTime - lastTick >= 60) {
        const studyKey = uKey("studyMin", c.id);
        localStorage.setItem(studyKey, (NF(localStorage.getItem(studyKey)) || 0) + 1);
        localStorage.setItem(tickKey, video.currentTime);
        // 写入「今日学习分钟」，用于学情看板「本周学习时长」
        const dlog = lsGet(uKey("studyDaily"), {}) || {};
        const today = new Date().toISOString().slice(0, 10);
        dlog[today] = (dlog[today] || 0) + 1;
        lsSet(uKey("studyDaily"), dlog);
      }
      // 阶段二：每 10 秒向后端上报一次视频进度（best-effort，失败不阻塞）
      // 节流基准用闭包变量（换视频/重开会话自动重置），不再存 localStorage
      if (typeof _lastReportTime === "undefined") _lastReportTime = 0;
      if (video.currentTime - _lastReportTime >= 10) {
        _lastReportTime = video.currentTime;
        try {
          API.reportVideo(c.id, sectionIndex, sectionTitle, ratio, Math.round(video.currentTime))
            .then(() => { DASH_BACKEND = null; }).catch(() => {});
        } catch (e) {}
      }
    });
    // 阶段二：记录当前活动视频，供关页/切后台时补报最后进度
    // 同时重置心跳节流基准（闭包变量，换视频自动归零）
    ACTIVE_VIDEO = video;
    ACTIVE_COURSE = c;
    ACTIVE_SECTION = sectionIndex;
    ACTIVE_SECTION_TITLE = sectionTitle;
    _lastReportTime = 0;
    player.appendChild(video);
    video.play().catch(() => {});
  }

  buildVideoPoster(currentVideo);

  const tabs = el("div", "learn-tabs");
  const tabDefs = [
    { key: "video", label: "视频", show: videos.length },
    { key: "doc", label: "资料", show: docs.length },
    { key: "quiz", label: "章节测验", show: quizzes.length },
    { key: "homework", label: "作业", show: (c.homeworks || []).length },
    { key: "discussion", label: "课程讨论", show: true },
  ];
  let curTab = "video";
  if (targetTab) curTab = targetTab;

  function buildRecs(recs, key) {
    const box = el("div", "video-recs");
    if (!recs || !recs.length) return box;
    const ckey = "rec_collapsed_" + (key || c.id);
    const collapsed = lsGet(ckey, true);
    if (collapsed) box.classList.add("collapsed");

    const head = el("div", "rec-head");
    const title = el("div", "rec-title", "本章节推荐视频");
    const toggle = el("button", "rec-toggle", collapsed ? "展开 ▼" : "收起 ▲");
    toggle.title = "折叠/展开推荐视频";
    toggle.onclick = (e) => {
      e.stopPropagation();
      const now = box.classList.toggle("collapsed");
      toggle.textContent = now ? "展开 ▼" : "收起 ▲";
      lsSet(ckey, now);
    };
    head.appendChild(title);
    head.appendChild(toggle);
    box.appendChild(head);

    const body = el("div", "rec-body");
    const ul = el("div", "rec-list");
    recs.forEach((r) => {
      const a = el("a", "rec-item");
      a.href = r.url; a.target = "_blank";
      a.innerHTML = '<span class="ic" data-icon="video"> </span><span>' + esc(r.title) + '</span><span class="rec-src">' + esc(r.source) + '</span>';
      ul.appendChild(a);
    });
    body.appendChild(ul);
    box.appendChild(body);
    return box;
  }

  let recBox = null;
  function renderTab() {
    panel.innerHTML = "";
    if (curTab === "video") {
      panel.appendChild(player);
      // 视频推荐链接（随当前章节变化）
      recBox = buildRecs((videos[0] && videos[0].recs) || VIDEO_LINKS[c.id], currentVideo ? currentVideo.title : c.id);
      panel.appendChild(recBox);
      const note = el("p", "muted");
      note.style.cssText = "font-size:12px;margin-top:12px";
      note.textContent = "提示：当前为演示视频，后续将接入课程实录与名师讲解。";
      panel.appendChild(note);
      chapter.innerHTML = '<div class="ch">章节列表</div>';
      if (videos.length === 0) chapter.appendChild(el("div", "item", "暂无视频"));
      videos.forEach((s, i) => {
        const it = el("div", "item" + (i === 0 ? " active" : ""), s.title);
        it.onclick = () => {
          currentVideo = s;
          buildVideoPoster(s);
          [...chapter.querySelectorAll(".item")].forEach((x) => x.classList.remove("active"));
          it.classList.add("active");
          if (recBox) {
            const next = buildRecs(s.recs || VIDEO_LINKS[c.id], s.title);
            recBox.parentNode.replaceChild(next, recBox);
            recBox = next;
          }
        };
        chapter.appendChild(it);
      });
    } else if (curTab === "doc") {
      panel.appendChild(el("h3", null, "课程资料"));
      const list = el("div", "card");
      list.style.cssText = "box-shadow:none;border:1px solid var(--border);margin-top:10px";
      if (docs.length === 0) list.appendChild(el("div", "muted", "暂无资料"));
      docs.forEach((s) => {
        const row = el("div", "doc-row");
        const info = el("div", "doc-info");
        info.innerHTML = '<div class="li-ic" data-icon="file-text"> </div><div class="li-body"><h4>' + esc(s.title) + '</h4><p>课件 / 讲义</p></div>';
        const actions = el("div", "doc-actions");
        const viewBtn = el("a", "btn sm");
        viewBtn.href = s.content; viewBtn.target = "_blank";
        viewBtn.textContent = "在线预览";
        const dlBtn = el("a", "btn sm ghost");
        dlBtn.href = s.content; dlBtn.download = s.title + ".html";
        dlBtn.textContent = "下载";
        actions.appendChild(viewBtn); actions.appendChild(dlBtn);
        row.appendChild(info); row.appendChild(actions);
        initIcons(row);
        list.appendChild(row);
      });
      panel.appendChild(list);
      chapter.innerHTML = '<div class="ch">资料列表</div><div class="item active">' + docs.length + " 份资料</div>";
    } else if (curTab === "quiz") {
      renderQuizPanel(panel, c);
      chapter.innerHTML = '<div class="ch">测验列表</div><div class="item active">' + quizzes.length + " 份测验</div>";
    } else if (curTab === "homework") {
      renderHomeworkPanel(panel, c);
      chapter.innerHTML = '<div class="ch">作业列表</div><div class="item active">' + ((c.homeworks || []).length) + " 项作业</div>";
    } else {
      renderDiscussion(panel, c);
      chapter.innerHTML = '<div class="ch">讨论区</div><div class="item active">课程讨论</div>';
    }
  }

  tabs.innerHTML = "";
  tabDefs.forEach((t) => {
    if (!t.show) return;
    const b = el("button", curTab === t.key ? "active" : "", t.label);
    b.onclick = () => { curTab = t.key; [...tabs.children].forEach((x) => x.classList.remove("active")); b.classList.add("active"); renderTab(); };
    tabs.appendChild(b);
  });
  v.appendChild(tabs);

  learn.appendChild(chapter);
  learn.appendChild(panel);
  v.appendChild(learn);
  renderTab();
}

/* ---------------- 课程作业（已接入后端 homeworks 状态） ---------------- */
// 点击「去提交」在作业行下方展开输入表单，填写内容后提交。
// 注意：课程详情里的 homeworks 可能没有 id 字段，提交前必须调 getHomeworks 按标题匹配拿真实 id。
function openHomeworkForm(cid, hw, row) {
  document.querySelectorAll(".hw-form-row").forEach((n) => n.remove()); // 收起其他已展开的表单
  const actions = row.querySelector(".doc-actions");
  const form = el("div", "hw-form-row");
  form.style.cssText = "padding:12px 18px;background:var(--surface-2,#f8fafc);border-top:1px dashed var(--border-2)";
  const ta = document.createElement("textarea");
  ta.rows = 3;
  ta.placeholder = "请输入作业内容…";
  ta.style.cssText = "width:100%;box-sizing:border-box;margin-bottom:10px;padding:10px 12px;border:1px solid var(--border-2);border-radius:10px;font-size:13px;font-family:inherit;resize:vertical";
  const fileInput = document.createElement("input");
  fileInput.type = "file";
  fileInput.style.cssText = "display:block;margin-bottom:6px;font-size:13px";
  const fileTip = el("div", "muted", "");
  fileTip.style.cssText = "font-size:12px;margin-bottom:10px;color:var(--muted)";
  fileInput.onchange = () => {
    fileTip.textContent = fileInput.files.length ? "已选择：" + fileInput.files[0].name : "";
  };
  const bar = el("div");
  bar.style.cssText = "display:flex;gap:8px;justify-content:flex-end";
  const ok = el("button", "btn sm", "提交作业");
  const cancel = el("button", "btn sm", "取消");
  bar.appendChild(ok);
  bar.appendChild(cancel);
  form.appendChild(ta);
  form.appendChild(fileInput);
  form.appendChild(fileTip);
  form.appendChild(bar);
  row.after(form);
  ta.focus();
  cancel.onclick = () => form.remove();
  ok.onclick = async () => {
    const answer = ta.value.trim();
    const file = fileInput.files.length ? fileInput.files[0] : null;
    if (!answer && !file) { toast("请填写作业内容或选择文件后再提交"); return; }
    ok.disabled = true;
    try {
      const hws = await API.getHomeworks(cid);
      const real = (hws || []).find((h) => h.title === hw.title);
      if (!real) { toast("未找到对应作业：「" + hw.title + "」"); ok.disabled = false; return; }
      const res = await API.submitHomeworkWithFile(real.id, answer, file);
      toast("已提交作业：「" + hw.title + "」" + (res && res.file_name ? "（含附件 " + res.file_name + "）" : ""));
      HW_STATES_LOADED = false;
      await loadHWStates();
      if (pages.dashboard) renderDashboard(pages.dashboard);
      form.remove();
      if (actions) {
        actions.innerHTML = "";
        const label = (res && res.file_name) ? "已提交 ✓ · 含附件" : "已提交 ✓";
        actions.appendChild(el("span", "badge ok", label));
      }
    } catch (e) {
      toast(e.message || "提交失败");
      ok.disabled = false;
    }
  };
}

function renderHomeworkPanel(panel, c) {
  panel.innerHTML = "";
  panel.appendChild(el("h3", null, "课程作业"));
  const list = el("div", "card");
  list.style.cssText = "box-shadow:none;border:1px solid var(--border);margin-top:10px";
  const hws = (c.homeworks || []);
  if (!hws.length) {
    list.appendChild(el("div", "muted", "本课程暂无作业"));
    panel.appendChild(list);
    return;
  }
  const stateMap = HW_STATES[c.id] || {};
  hws.forEach((hw) => {
    const submitted = !!(stateMap[hw.title] && stateMap[hw.title].submitted);
    const row = el("div", "doc-row");
    const info = el("div", "doc-info");
    info.innerHTML = '<div class="li-ic" data-icon="book-open"> </div><div class="li-body"><h4>' +
      esc(hw.title) + '</h4><p>' + esc(hw.desc || "") + (hw.due ? ' · 截止 ' + esc(hw.due) : '') + '</p></div>';
    const actions = el("div", "doc-actions");
    if (submitted) {
      actions.appendChild(el("span", "badge ok", "已提交 ✓"));
    } else {
      const b = el("button", "btn sm", "去提交");
      b.onclick = () => openHomeworkForm(c.id, hw, row);
      actions.appendChild(b);
    }
    row.appendChild(info); row.appendChild(actions);
    initIcons(row);
    list.appendChild(row);
  });
  panel.appendChild(list);

  // 异步用后端真实提交状态覆盖（HW_STATES 未加载时更准）
  API.getHomeworks(c.id).then((data) => {
    const byTitle = {};
    (data || []).forEach((h) => { byTitle[h.title] = h; });
    [...list.querySelectorAll(".doc-row")].forEach((row, i) => {
      const hw = hws[i]; const real = byTitle[hw.title];
      if (!real) return;
      const actions = row.querySelector(".doc-actions");
      actions.innerHTML = "";
      if (real.submitted) {
        actions.appendChild(el("span", "badge ok", "已提交 ✓"));
      } else {
        const b = el("button", "btn sm", "去提交");
        b.onclick = () => openHomeworkForm(c.id, hw, row);
        actions.appendChild(b);
      }
    });
  }).catch(() => {});
}

function refreshProgressLabel(c, ratio) {
  const sub = $("#page-learn").querySelector(".h-sub");
  if (sub) sub.textContent = c.category + " · " + c.teacher + " · 进度 " + ratio + "%";
}

/* ---------------- 章节测验（可交互） ---------------- */
function quizKey(c, qIdx) { return uKey("quiz", c.id) + "_" + qIdx; }

function renderQuizPanel(panel, c) {
  panel.innerHTML = "";
  panel.appendChild(el("h3", null, "章节测验"));
  const quizzes = c.sections.filter((s) => s.stype === "quiz");
  if (!quizzes.length) {
    panel.appendChild(el("div", "muted", "暂无测验"));
    return;
  }
  quizzes.forEach((quiz, qIdx) => {
    const wrap = el("div", "quiz-card");
    const head = el("div", "quiz-head", quiz.title);
    wrap.appendChild(head);
    const stored = lsGet(quizKey(c, qIdx), null);

    if (stored && stored.submitted) {
      const pct = Math.round((stored.score / quiz.questions.length) * 100);
      const summary = el("div", "quiz-summary");
      const circle = el("div", "quiz-score-circle");
      circle.style.background = "conic-gradient(var(--success) 0 " + pct + "%, var(--bg-2) " + pct + "% 100%)";
      circle.innerHTML = "<span>" + pct + "%</span>";
      const info = el("div", "quiz-score-info");
      info.innerHTML =
        '<div class="quiz-score-num">得分 ' + stored.score + ' / ' + quiz.questions.length + '</div>' +
        '<div class="quiz-score-time">' + (stored.at ? "提交于 " + stored.at.slice(0, 10) + " " + stored.at.slice(11, 16) : "已提交") + '</div>';
      summary.appendChild(circle);
      summary.appendChild(info);
      wrap.appendChild(summary);

      const hint = el("div", "quiz-hint");
      hint.textContent = "这是你的上次作答记录，题目答案默认隐藏，可点击查看解析。";
      wrap.appendChild(hint);

      const actions = el("div", "quiz-actions");
      const viewBtn = el("button", "btn sm", "查看解析");
      const resetBtn = el("button", "btn sm ghost", "重新测验");
      actions.appendChild(viewBtn);
      actions.appendChild(resetBtn);
      wrap.appendChild(actions);

      viewBtn.onclick = () => renderQuizReview(wrap, quiz, stored, c, qIdx, panel);
      resetBtn.onclick = () => {
        if (!confirm("重新测验将清空本次作答记录，确定吗？")) return;
        lsSet(quizKey(c, qIdx), null);
        renderQuizPanel(panel, c);
      };

      panel.appendChild(wrap);
      return;
    }

    const form = el("div", "quiz-form");
    quiz.questions.forEach((q, i) => {
      const qbox = el("div", "quiz-q");
      qbox.innerHTML = '<div class="quiz-qq"><span class="quiz-no">Q' + (i + 1) + '</span>' + esc(q.q) + '</div>';
      const opts = el("div", "quiz-opts");
      q.options.forEach((opt, j) => {
        const lab = el("label", "quiz-opt");
        lab.innerHTML = '<input type="radio" name="q_' + c.id + '_' + qIdx + '_' + i + '" value="' + j + '"><span>' + esc(opt) + '</span>';
        opts.appendChild(lab);
      });
      qbox.appendChild(opts);
      form.appendChild(qbox);
    });
    const submit = el("button", "btn", "提交测验");
    submit.onclick = () => {
      let score = 0;
      const answers = [];
      quiz.questions.forEach((q, i) => {
        const sel = form.querySelector('input[name="q_' + c.id + '_' + qIdx + '_' + i + '"]:checked');
        const val = sel ? Number(sel.value) : -1;
        answers.push(val);
        if (val === q.answer) score++;
      });
      lsSet(quizKey(c, qIdx), { submitted: true, score: score, total: quiz.questions.length, answers: answers, at: new Date().toISOString() });
      // 阶段二：后台上报测验成绩到后端（不阻塞 UI）；置空看板缓存以触发下次刷新
      try {
        API.reportQuiz(c.id, qIdx, quiz.title, score, quiz.questions.length)
          .then(() => { DASH_BACKEND = null; }).catch(() => {});
      } catch (e) {}
      if (pages.dashboard) renderDashboard(pages.dashboard);
      renderQuizPanel(panel, c);
      toast("测验已提交，得分 " + score + "/" + quiz.questions.length);
    };
    form.appendChild(submit);
    wrap.appendChild(form);
    panel.appendChild(wrap);
  });
}

function renderQuizReview(wrap, quiz, stored, c, qIdx, panel) {
  wrap.innerHTML = '<div class="quiz-head">' + esc(quiz.title) + ' · 解析</div>';
  quiz.questions.forEach((q, i) => {
    const userAns = (stored.answers && stored.answers[i] != null) ? stored.answers[i] : -1;
    const isCorrect = userAns === q.answer;
    const qbox = el("div", "quiz-q quiz-review" + (isCorrect ? " correct" : " wrong"));
    qbox.innerHTML =
      '<div class="quiz-qq"><span class="quiz-no">Q' + (i + 1) + '</span>' + esc(q.q) + '</div>' +
      '<div class="quiz-status">' + (isCorrect ? "✓ 回答正确" : (userAns < 0 ? "✗ 未作答" : "✗ 回答错误")) + '</div>';
    const opts = el("div", "quiz-opts");
    q.options.forEach((opt, j) => {
      const row = el("div", "quiz-opt-row");
      if (j === q.answer) row.classList.add("right");
      if (j === userAns && j !== q.answer) row.classList.add("picked-wrong");
      row.innerHTML = '<span class="quiz-opt-letter">' + String.fromCharCode(65 + j) + '</span><span>' + esc(opt) + '</span>';
      opts.appendChild(row);
    });
    qbox.appendChild(opts);
    if (q.explanation) {
      const exp = el("div", "quiz-exp");
      exp.innerHTML = '<b>解析：</b>' + esc(q.explanation);
      qbox.appendChild(exp);
    }
    wrap.appendChild(qbox);
  });
  const back = el("button", "btn sm ghost", "返回概览");
  back.style.marginTop = "10px";
  back.onclick = () => renderQuizPanel(panel, c);
  wrap.appendChild(back);
}

/* ---------------- 课程讨论 / 悬浮 AI：固定话术回复（无后端、不接大模型） ---------------- */

// AI 助教回复：基于关键词匹配 data.js 中的预设话术，不调用任何外部接口、不跳转、不转圈。
// 后续接入真实模型 / 后端时，只需把本函数内部替换为接口调用即可（保持返回 { text } 结构）。
function getAIReply(question, courseTitle) {
  const q = (question || "").toLowerCase();
  for (const item of AI_REPLIES) {
    if (item.keys.some((k) => q.indexOf(k.toLowerCase()) !== -1)) {
      return { text: item.answer };
    }
  }
  return { text: AI_FALLBACK };
}

function nowHM() {
  const ts = new Date();
  return String(ts.getHours()).padStart(2, "0") + ":" + String(ts.getMinutes()).padStart(2, "0");
}

/* ---------------- 课程讨论（已接入后端） ---------------- */
async function renderDiscussion(panel, c) {
  const box = el("div", "chat-box");
  const collapseKey = "discuss_collapsed_" + c.id;
  let collapsed = lsGet(collapseKey, false);

  const head = el("div", "chat-head chat-head-toggle");
  head.innerHTML = '<div style="display:flex;align-items:center;gap:9px">' + icon("message", 18) + " <span>" + esc(c.title) + " · 课程讨论</span></div>";
  const toggleBtn = el("button", "chat-toggle", collapsed ? "展开 ▼" : "收起 ▲");
  toggleBtn.title = "折叠/展开讨论区";
  head.appendChild(toggleBtn);

  const body = el("div", "chat-body");
  const msgs = el("div", "chat-msgs");

  function applyCollapse() {
    if (collapsed) {
      body.style.display = "none";
      box.classList.add("collapsed");
      toggleBtn.textContent = "展开 ▼";
    } else {
      body.style.display = "flex";
      box.classList.remove("collapsed");
      toggleBtn.textContent = "收起 ▲";
      setTimeout(() => { msgs.scrollTop = msgs.scrollHeight; }, 10);
    }
    lsSet(collapseKey, collapsed);
  }

  function paint(rawList) {
    const list = (rawList || []).slice().reverse();  // 后端按时间倒序返回，反转为正序（旧在上、新在下，楼层号按时间递增）
    msgs.innerHTML = "";
    if (!list.length) msgs.appendChild(el("div", "muted", "还没有讨论，来发第一条吧～"));
    let floor = 0;
    list.forEach((m) => {
      floor++;
      const isMe = m.user === (currentUser && currentUser.name);
      const wrap = el("div", "chat-msg " + (isMe ? "me" : ""));
      const meta = el("div", "meta");
      meta.innerHTML = '<span style="font-weight:700">' + esc(m.user) + "</span>" +
        "<span>· " + (m.created_at || "") + "</span><span>· #" + floor + "楼</span>";
      wrap.appendChild(meta);
      wrap.appendChild(el("div", null, m.content));
      msgs.appendChild(wrap);
    });
    msgs.scrollTop = msgs.scrollHeight;
  }

  // 拉取真实讨论（后端）
  let list = [];
  try {
    list = (await API.getDiscussions(c.id)) || [];
  } catch (e) {
    msgs.appendChild(el("div", "muted", "讨论加载失败：" + (e.message || "")));
  }
  paint(list);

  const input = el("div", "chat-input");
  const ipt = document.createElement("input");
  ipt.placeholder = "写下你的观点，发布到课程讨论区…";
  const send = el("button", "btn ai", "发布");
  send.onclick = async () => {
    const v = ipt.value.trim();
    if (!v) return;
    if (collapsed) { collapsed = false; applyCollapse(); }
    ipt.value = "";
    try {
      await API.postDiscussion(c.id, v);
      list = (await API.getDiscussions(c.id)) || [];
      paint(list);
    } catch (e) { toast(e.message || "发布失败"); }
  };
  ipt.addEventListener("keydown", (e) => { if (e.key === "Enter") send.onclick(); });
  input.appendChild(ipt);
  input.appendChild(send);

  toggleBtn.onclick = (e) => { e.stopPropagation(); collapsed = !collapsed; applyCollapse(); };

  body.appendChild(msgs);
  body.appendChild(input);
  box.appendChild(head);
  box.appendChild(body);
  panel.appendChild(box);
  applyCollapse();
}

/* ---------------- AI 课堂（已接入后端 /api/ai/generate + 轮询 status） ---------------- */
function renderAIChat(v) {
  v.innerHTML = "";
  // 进入页面先停掉上一轮未结束的轮询，避免重复请求
  if (AI_POLL) { clearInterval(AI_POLL); AI_POLL = null; AI_BUSY = false; }

  v.appendChild(el("div", "h-title", "AI 互动课堂"));
  v.appendChild(el("p", "h-sub", "基于 OpenMAIC 的多智能体课堂，选择课程后进入真实课堂"));

  const picker = el("div");
  picker.style.cssText = "display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap";
  picker.appendChild(el("span", "muted", "选择课程"));
  const sel = document.createElement("select");
  sel.style.cssText = "padding:7px 10px;border:1px solid rgba(0,0,0,.15);border-radius:8px;font-size:13px;min-width:220px;background:#fff";
  COURSES.forEach((c) => {
    const o = document.createElement("option");
    o.value = String(c.id);
    o.textContent = c.title;
    sel.appendChild(o);
  });
  picker.appendChild(sel);
  v.appendChild(picker);

  const banner = el("div", "ai-banner");
  const emoji = el("div", "emoji");
  emoji.setAttribute("data-icon", "bot");
  emoji.style.cssText = "font-size:40px;color:#6B5BD8";
  const info = el("div");
  const h3 = el("h3", null, "多智能体 AI 课堂");
  const pdesc = el("p", null, "由教师 / 助教 / 学伴三种智能体组成，选择课程后即可进入");
  info.appendChild(h3);
  info.appendChild(pdesc);
  const action = el("div");
  action.style.cssText = "margin-left:auto;display:flex;flex-direction:column;align-items:flex-end;gap:6px";
  const btn = el("button", "btn ai", "检查课堂");
  const tip = el("div", "muted", "");
  tip.style.cssText = "font-size:12px;min-height:16px";
  action.appendChild(btn);
  action.appendChild(tip);
  banner.appendChild(emoji);
  banner.appendChild(info);
  banner.appendChild(action);
  v.appendChild(banner);
  initIcons(banner);

  const agents = el("div", "ai-agent");
  const defs = [
    { cls: "teacher", face: "师", role: "教师智能体", name: "主讲教师", desc: "讲解知识点、梳理课程脉络", color: "#EAF1FB" },
    { cls: "tutor", face: "助", role: "助教智能体", name: "答疑助教", desc: "解答疑问、布置与批改练习", color: "#F0ECFF" },
    { cls: "mate", face: "伴", role: "学伴智能体", name: "AI 学伴", desc: "陪伴讨论、激发思考", color: "#FFEDE5" },
  ];
  defs.forEach((d) => {
    const a = el("div", "agent " + d.cls);
    const face = el("div", "face", d.face);
    face.style.cssText = "width:44px;height:44px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:800;background:#fff;color:#5E82D8";
    a.appendChild(face);
    a.appendChild(el("span", "role", d.role));
    a.appendChild(el("h4", null, d.name));
    a.appendChild(el("p", null, d.desc));
    agents.appendChild(a);
  });
  v.appendChild(agents);

  const chat = el("div", "chat-box");
  chat.style.height = "300px";
  chat.innerHTML =
    '<div class="chat-head">' + icon("sparkles", 18) + ' <span>示例对话</span></div>' +
    '<div class="chat-msgs"><div class="chat-msg ai"><div class="meta"><span style="font-weight:700">答疑助教</span></div>同学你好，我是本课 AI 助教。有什么想了解的吗？</div>' +
    '<div class="chat-msg me"><div class="meta"><span style="font-weight:700">' + esc(currentUser.name) + '</span></div>能帮我总结一下第 1 章的核心概念吗？</div>' +
    '<div class="chat-msg ai"><div class="meta"><span style="font-weight:700">答疑助教</span></div>当然！第 1 章围绕「数据思维」展开，重点是从业务问题出发，明确要回答什么问题、需要哪些数据……</div></div>';
  v.appendChild(chat);

  // ---- 生成 / 轮询逻辑 ----
  function setTip(t, color) { tip.textContent = t || ""; tip.style.color = color || ""; }

  function setReady(url, reused) {
    btn.textContent = "进入 AI 课堂";
    btn.className = "btn ai";
    btn.disabled = false;
    btn.onclick = () => window.open(url, "_blank");
    h3.textContent = "课堂已就绪";
    pdesc.textContent = reused
      ? "已复用本课程此前生成的课堂（不消耗 OpenMAIC 生成额度）"
      : "课堂生成完成，可随时进入学习";
    setTip(reused ? "复用已有课堂" : "生成完成", "#1D9E75");
  }

  function setIdle(msg, tipMsg) {
    btn.textContent = "生成课堂";
    btn.className = "btn";
    btn.disabled = false;
    btn.onclick = startGenerate;
    h3.textContent = "该课程尚未创建 AI 课堂";
    pdesc.textContent = msg || "点击下方按钮，由 OpenMAIC 多智能体生成专属互动课堂（约 1–10 分钟）";
    setTip(tipMsg || "", "#A32D2D");
  }

  function onGenFail(msg) {
    btn.textContent = "重试生成";
    btn.className = "btn";
    btn.disabled = false;
    btn.onclick = startGenerate;
    h3.textContent = "课堂生成失败";
    let hint = msg;
    if (/额度|403/.test(msg)) {
      hint = "OpenMAIC 今日生成额度已用完（每码每日 10 次）。课堂按课程复用，通常只有首次创建才消耗额度，请明天再试或联系管理员。";
    } else if (/无效|401/.test(msg)) {
      hint = "OpenMAIC 访问码无效，请联系管理员核对 .env 中的 OPENMAIC_ACCESS_CODE。";
    } else if (/访问码|501/.test(msg)) {
      hint = "后端未配置 OpenMAIC 访问码，请联系管理员在 .env 中设置 OPENMAIC_ACCESS_CODE。";
    }
    pdesc.textContent = hint;
    setTip(String(msg).length > 40 ? "" : String(msg), "#A32D2D");
  }

  // 先看该课程是否已有课堂 URL（全班复用，不耗额度）
  async function checkExisting(cid) {
    btn.disabled = true;
    btn.textContent = "检查中…";
    h3.textContent = "正在检查已有课堂";
    pdesc.textContent = "读取课程信息，若此前已生成过则直接复用";
    setTip("");
    try {
      if (AI_URL_CACHE[cid]) { setReady(AI_URL_CACHE[cid], true); return; }
      const d = await API.getCourseDetail(cid);
      if (d && d.ai_classroom_url) {
        AI_URL_CACHE[cid] = d.ai_classroom_url;
        setReady(d.ai_classroom_url, true);
      } else {
        setIdle();
      }
    } catch (e) {
      setIdle("读取课程信息失败：" + (e.message || "") + "。请确认后端已启动。", "后端未连接");
    }
  }

  async function startGenerate() {
    if (AI_BUSY) return;
    const cid = Number(sel.value);
    AI_BUSY = true;
    btn.disabled = true;
    btn.textContent = "生成中…";
    h3.textContent = "AI 正在生成课堂";
    pdesc.textContent = "OpenMAIC 多智能体正在备课，通常需要 1–10 分钟，请保持页面打开";
    const t0 = Date.now();
    setTip("已用时 0 秒");
    try {
      const g = await API.generateAIClassroom(cid);
      // 幂等复用：后端若已存在该课程的课堂 URL，会直接返回 reused，
      // 此时无需轮询、也不消耗 OpenMAIC 额度
      if (g && g.reused && g.url) {
        AI_URL_CACHE[cid] = g.url;
        AI_BUSY = false;
        setReady(g.url, false);
        toast("已复用已有 AI 课堂，未消耗生成额度");
        return;
      }
      const jobId = g && g.jobId;
      if (!jobId) throw new Error("后端未返回 jobId");
      const DONE = ["succeeded", "completed", "done"];
      let tries = 0;
      AI_POLL = setInterval(async () => {
        tries++;
        setTip("已用时 " + Math.round((Date.now() - t0) / 1000) + " 秒");
        try {
          const s = await API.getAIStatus(jobId, cid);
          if (DONE.indexOf(s.status) >= 0 && s.url) {
            clearInterval(AI_POLL); AI_POLL = null; AI_BUSY = false;
            AI_URL_CACHE[cid] = s.url;
            setReady(s.url, false);
            toast("AI 课堂生成完成");
            return;
          }
          if (s.status === "failed" || s.status === "error") {
            clearInterval(AI_POLL); AI_POLL = null; AI_BUSY = false;
            onGenFail("生成任务失败，请稍后重试");
            return;
          }
          if (tries >= 120) {
            clearInterval(AI_POLL); AI_POLL = null; AI_BUSY = false;
            onGenFail("生成超时（超过 10 分钟），请稍后重试");
          }
        } catch (pe) {
          clearInterval(AI_POLL); AI_POLL = null; AI_BUSY = false;
          onGenFail(pe.message || "轮询状态失败");
        }
      }, 5000);
    } catch (e) {
      AI_BUSY = false;
      onGenFail(e.message || "生成失败");
    }
  }

  sel.onchange = () => {
    if (AI_POLL) { clearInterval(AI_POLL); AI_POLL = null; AI_BUSY = false; }
    checkExisting(Number(sel.value));
  };
  btn.onclick = () => checkExisting(Number(sel.value));
  checkExisting(Number(sel.value));
}

/* ---------------- 学情看板 ---------------- */
// 后端拉取：作业提交状态 + 本人签到状态（进入看板时刷新）
let HW_STATES = {};      // { cid: { title: { submitted, id } } }
let SIGNIN_DONE = false;
let HW_STATES_LOADED = false;  // 防止 renderDashboard 末尾 loadHWStates 无限递归
async function loadHWStates() {
  if (!getToken()) return;
  try {
    const list = await API.getSignins();
    SIGNIN_DONE = Array.isArray(list) && list.length > 0;
  } catch (e) {}
  for (const c of COURSES) {
    try {
      const hws = await API.getHomeworks(c.id);
      const m = {};
      (hws || []).forEach((h) => { m[h.title] = { submitted: !!h.submitted, id: h.id, file_name: h.file_name }; });
      HW_STATES[c.id] = m;
    } catch (e) {}
  }
}
function getCourseStats(c) {
  const quizzes = (c.sections || []).filter((s) => s.stype === "quiz");
  // 阶段二：优先用后端真实聚合，缺失时回退 localStorage 兜底
  const be = (DASH_BACKEND && DASH_BACKEND.course_details)
    ? DASH_BACKEND.course_details.find((d) => d.course_id === c.id) : null;
  const studyMin = NF(localStorage.getItem(uKey("studyMin", c.id))) || 0;
  const studyHours = (be && be.study_hours != null) ? be.study_hours : +(studyMin / 60).toFixed(1);
  const videoProg = (be && be.video_progress != null) ? be.video_progress
    : (NF(localStorage.getItem(uKey("progress", c.id))) || 0);
  let quizCount = 0, avgScore = 0;
  if (be && be.quiz_done) {
    quizCount = be.quiz_done;
    avgScore = be.quiz_avg || 0;
  } else {
    let quizScore = 0;
    quizzes.forEach((q, i) => {
      const s = lsGet(quizKey(c, i), null);
      if (s && s.submitted) { quizScore += s.score; quizCount++; }
    });
    avgScore = quizCount ? Math.round(quizScore / quizCount) : 0;
  }
  return { studyHours, videoProg, avgScore, quizCount, totalQuiz: quizzes.length };
}

function renderDashboard(v) {
  v.innerHTML = "";
  // 阶段二：首次进入看板时从后端拉取真实聚合（覆盖 localStorage 兜底）；
  // DASH_BACKEND 非空后不再重复请求，避免递归刷屏。上报动作会将其置空以触发下次刷新。
  if (!DASH_BACKEND) {
    API.getDashboard().then((d) => {
      DASH_BACKEND = d;
      if (pages.dashboard === v) renderDashboard(pages.dashboard);
    }).catch(() => {});
  }
  v.appendChild(el("div", "h-title", "学情看板"));
  v.appendChild(el("p", "h-sub", currentUser.name + " · " + currentUser.major + " · 学习概览"));

  // 聚合数据
  let totalStudyMin = 0;
  let totalVideoNum = 0, totalVideoPct = 0;
  let totalScoreNum = 0, totalScoreSum = 0;
  COURSES.forEach((c) => {
    const st = getCourseStats(c);
    totalStudyMin += Math.round(st.studyHours * 60);
    totalVideoNum++; totalVideoPct += st.videoProg;
    if (st.quizCount) { totalScoreNum += st.quizCount; totalScoreSum += st.avgScore * st.quizCount; }
  });
  const studyHours = +(totalStudyMin / 60).toFixed(1);
  const avgVideo = totalVideoNum ? Math.round(totalVideoPct / totalVideoNum) : 0;
  const avgScore = totalScoreNum ? Math.round(totalScoreSum / totalScoreNum) : 0;
  const signCount = (DASH_BACKEND && DASH_BACKEND.signin_count) ? DASH_BACKEND.signin_count : (SIGNIN_DONE ? 1 : 0);
  const signText = signCount > 0 ? "已签到" : "未签到";

  const stats = el("div", "stat-grid");
  [
    { ic: "clock", num: studyHours + " h", lbl: "累计学习时长", tip: "自 " + STUDY_START + " 起累计，以实际观看视频与完成测验时长计算。" },
    { ic: "video", num: avgVideo + "%", lbl: "视频平均完成度", tip: "当前三门通识课视频完成度的平均值；可点下方课程明细查看单科进度。" },
    { ic: "clipboard", num: avgScore || "—", lbl: "测验平均得分", tip: avgScore ? "已提交测验的平均分。" : "尚未提交任何测验，完成章节测验后将自动更新。" },
    { ic: "check-circle", num: signText, lbl: "签到记录", tip: SIGNIN_DONE ? "你已签到，详情见课堂签到页。" : "今日尚未签到，请前往课堂签到。" },
  ].forEach((s) => {
    const card = el("div", "stat");
    const ic = el("div", "ic"); ic.style.background = "var(--primary-soft)"; ic.style.color = "var(--primary-deep)"; ic.innerHTML = icon(s.ic, 22);
    card.appendChild(ic);
    card.appendChild(el("div", "num", s.num));
    card.appendChild(el("div", "lbl", s.lbl));
    if (s.tip) {
      const tip = el("span", "stat-tip");
      tip.textContent = "?";
      tip.setAttribute("data-tip", s.tip);
      card.appendChild(tip);
    }
    stats.appendChild(card);
  });
  v.appendChild(stats);

  // 待办 / 未掌握
  const tasks = [];
  COURSES.forEach((c) => {
    const st = getCourseStats(c);
    if (st.videoProg < 100) tasks.push({ type: "video", text: "完成「" + c.title + "」视频学习（当前 " + st.videoProg + "%）", cid: c.id });
    if (st.totalQuiz && st.quizCount < st.totalQuiz) tasks.push({ type: "quiz", text: "完成「" + c.title + "」剩余章节测验", cid: c.id });
    const hwState = HW_STATES[c.id] || {};
    (c.homeworks || []).forEach((hw) => {
      if (hwState[hw.title] && hwState[hw.title].submitted) {
        const fn = hwState[hw.title].file_name;
        tasks.push({ type: "hw-done", text: "已提交作业：「" + hw.title + "」" + (fn ? "（含附件 " + fn + "）" : ""), cid: c.id, hwTitle: hw.title });
      } else {
        tasks.push({ type: "hw", text: "待提交作业：「" + hw.title + "」" + (hw.due ? "（截止 " + hw.due + "）" : ""), cid: c.id, hwTitle: hw.title });
      }
    });
  });
  const todoCard = el("div", "card dash-todo");
  todoCard.innerHTML = '<div class="h-title2">待办与未掌握</div>';
  if (!tasks.length) {
    todoCard.innerHTML += '<div class="todo-empty">✓ 当前没有待办任务，继续保持！</div>';
  } else {
    const ul = el("div", "todo-list");
    tasks.forEach((t) => {
      const row = el("div", "todo-row" + (t.type === "hw-done" ? " done" : ""));
      const iconName = t.type === "video" ? "video" : (t.type === "quiz" ? "clipboard" : (t.type === "hw-done" ? "check-circle" : "book-open"));
      row.innerHTML = '<span class="ic" data-icon="' + iconName + '"> </span><span>' + esc(t.text) + (t.at ? ' <em class="muted">（' + t.at.slice(0, 10) + '）</em>' : '') + '</span>';
      if (t.type === "hw-done") {
        const undo = el("button", "btn sm ghost", "撤销");
        undo.onclick = () => unmarkHomework(t.cid, t.hwTitle);
        row.appendChild(undo);
      } else if (t.type === "hw") {
        const btn = el("button", "btn sm", "标记已提交");
        btn.onclick = () => markHomework(t.cid, t.hwTitle);
        row.appendChild(btn);
      } else {
        const btn = el("button", "btn sm", "去做");
        const target = t.type === "quiz" ? "quiz" : "video";
        btn.onclick = () => { openCourse(t.cid, true, target); };
        row.appendChild(btn);
      }
      initIcons(row);
      ul.appendChild(row);
    });
    todoCard.appendChild(ul);
  }
  v.appendChild(todoCard);

  // 课程进度明细
  const progressCard = el("div", "card dash-progress");
  progressCard.innerHTML = '<div class="h-title2">课程进度明细</div>';
  COURSES.forEach((c) => {
    const st = getCourseStats(c);
    const row = el("div", "hbar");
    row.innerHTML = '<div class="lab">' + esc(c.title) + '</div>' +
      '<div class="track"><span style="width:' + st.videoProg + '%"></span></div>' +
      '<div class="val">' + st.videoProg + '%</div>';
    progressCard.appendChild(row);
  });
  v.appendChild(progressCard);

  // 本周学习时长
  const chartCard = el("div", "chart-card");
  chartCard.appendChild(el("div", "h-title2", "本周学习时长（分钟）"));
  // 本周学习时长：后端真实聚合优先，缺失时回退本地 studyDaily
  let weekly;
  if (DASH_BACKEND && DASH_BACKEND.weekly && DASH_BACKEND.weekly.length) {
    weekly = DASH_BACKEND.weekly;
  } else {
    const dlog = lsGet(uKey("studyDaily"), {}) || {};
    const wd = ["日", "一", "二", "三", "四", "五", "六"];
    weekly = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const k = d.toISOString().slice(0, 10);
      weekly.push({ label: "周" + wd[d.getDay()], val: dlog[k] || 0 });
    }
  }
  const bars = el("div", "bars");
  weekly.forEach((w) => {
    const bar = el("div", "bar");
    const col = el("div", "col");
    col.style.height = Math.min(180, w.val) + "px";
    bar.appendChild(col);
    bar.appendChild(el("div", "lab", w.label));
    bars.appendChild(bar);
  });
  chartCard.appendChild(bars);
  v.appendChild(chartCard);

  // 异步刷新作业/签到真实状态（后端）——仅首次进入看板时加载一次，避免无限递归
  if (!HW_STATES_LOADED) {
    HW_STATES_LOADED = true;
    loadHWStates().then(() => { if (pages.dashboard === v) renderDashboard(pages.dashboard); });
  }
}

// 作业提交（已接入后端：提交到 /api/homeworks/submit，状态从后端读取）
async function markHomework(cid, title) {
  if (!title) return;
  const answer = prompt("请输入作业内容：", "");
  if (answer === null) return;
  if (!answer.trim()) { toast("作业内容不能为空"); return; }
  try {
    const hws = await API.getHomeworks(cid);
    const hw = (hws || []).find((h) => h.title === title);
    if (!hw) { toast("未找到对应作业：「" + title + "」"); return; }
    await API.submitHomework(hw.id, answer);
    toast("已提交作业：「" + title + "」");
    HW_STATES_LOADED = false;  // 重置标志，让看板下次渲染时重新拉取作业状态
    await loadHWStates();
    if (pages.dashboard) renderDashboard(pages.dashboard);
  } catch (e) { toast(e.message || "提交失败"); }
}
function unmarkHomework() {
  toast("后端暂不支持撤销提交");
}

/* ---------------- 课堂签到（已接入后端） ---------------- */
async function renderSignin(v) {
  v.innerHTML = "";
  v.appendChild(el("div", "h-title", "课堂签到"));
  v.appendChild(el("p", "h-sub", "线下课程定位签到 / 扫码签到"));

  const SIGNIN_COURSE_ID = 1; // 对应「数据科学导论」（后端课程 id，按实际调整）

  const card = el("div", "signin-task");
  const left = el("div");
  left.appendChild(el("div", "st-course", "数据科学导论 · 第 5 讲"));
  left.appendChild(el("div", "muted", "签到时间：2026-09-15 10:00 - 10:15"));
  const btn = el("button", "btn", "立即签到");
  card.appendChild(left);
  card.appendChild(btn);
  v.appendChild(card);

  const panel = el("div", "signin-panel");
  panel.innerHTML =
    '<div class="sp-map"><span data-icon="map-pin" style="font-size:22px"> </span><div class="sp-pin">校本部 · 教学楼 A302</div></div>' +
    '<div class="sp-info">定位签到需授权浏览器位置；或请教师出示课堂二维码进行扫码签到。</div>';
  v.appendChild(panel);
  initIcons(panel);

  // 拉取本人签到记录（后端）
  let done = false;
  try {
    const list = await API.getSignins();
    done = Array.isArray(list) && list.length > 0;
  } catch (e) { /* 拉取失败按未签到处理 */ }
  if (done) { btn.textContent = "✅ 已签到"; btn.className = "btn ai"; btn.disabled = true; }

  btn.onclick = async () => {
    if (done) return;
    try {
      await API.postSignin(SIGNIN_COURSE_ID, "location");
      done = true;
      btn.textContent = "✅ 已签到";
      btn.className = "btn ai";
      btn.disabled = true;
      card.style.background = "linear-gradient(120deg,var(--ai-soft),var(--accent-soft))";
      toast("签到成功，已记录于「数据科学导论」");
      if (pages.dashboard) renderDashboard(pages.dashboard);
    } catch (e) { toast(e.message || "签到失败"); }
  };
}

/* ---------------- 班级群聊（WebSocket，已接入后端） ---------------- */
let chatWs = null; // 页面级单例，避免反复进入时叠加多个连接
function renderChat(v) {
  v.innerHTML = "";
  v.appendChild(el("div", "h-title", "班级群聊"));
  v.appendChild(el("p", "h-sub", "与同学实时交流（WebSocket 实时消息）"));

  const CHAT_ROOM_ID = 1; // 后端群聊房间 id，按实际调整

  const box = el("div", "chat-box");
  const head = el("div", "chat-head");
  head.appendChild(el("span", "chat-room", "研究生通识课 · 班级群"));
  const status = el("span", "chat-status", "连接中…");
  head.appendChild(status);
  box.appendChild(head);

  const msgs = el("div", "chat-msgs");
  box.appendChild(msgs);

  const bar = el("div", "chat-input");
  const input = el("input", "chat-inp");
  input.type = "text";
  input.placeholder = "说点什么…";
  const sendBtn = el("button", "btn", "发送");
  bar.appendChild(input);
  bar.appendChild(sendBtn);
  box.appendChild(bar);
  v.appendChild(box);

  function appendMsg(m, mine) {
    const row = el("div", "msg" + (mine ? " me" : " ai"));
    if (!mine && m.user) row.appendChild(el("div", "m-name", m.user));
    row.appendChild(el("div", "m-text", m.content || ""));
    if (m.created_at) row.appendChild(el("div", "m-time", m.created_at));
    msgs.appendChild(row);
    msgs.scrollTop = msgs.scrollHeight;
  }

  appendMsg({ user: "系统", content: "已连接到班级群聊，正在加载历史消息…" }, false);

  // 拉取后端留存的历史消息（GET /api/rooms/{rid}/messages），再建立 WebSocket 收实时消息
  API.getRoomMessages(CHAT_ROOM_ID).then((list) => {
    (list || []).forEach((m) => {
      appendMsg(m, !!(currentUser && m.user === currentUser.name));
    });
    msgs.scrollTop = msgs.scrollHeight;
  }).catch(() => {});

  if (chatWs) { try { chatWs.close(); } catch (e) {} }
  function connect() {
    try {
      chatWs = new WebSocket(API.chatWsUrl(CHAT_ROOM_ID));
    } catch (e) {
      status.textContent = "连接失败";
      status.className = "chat-status off";
      return;
    }
    chatWs.onopen = () => { status.textContent = "● 已连接"; status.className = "chat-status on"; };
    chatWs.onmessage = (ev) => {
      let data; try { data = JSON.parse(ev.data); } catch (e) { return; }
      if (!data || !data.content) return;
      const mine = !!(currentUser && data.user === currentUser.name);
      appendMsg(data, mine);
    };
    chatWs.onclose = () => { status.textContent = "○ 已断开"; status.className = "chat-status off"; };
    chatWs.onerror = () => { status.textContent = "连接异常"; status.className = "chat-status off"; };
  }
  connect();

  function doSend() {
    const txt = input.value.trim();
    if (!txt) return;
    if (!chatWs || chatWs.readyState !== WebSocket.OPEN) {
      toast("群聊未连接，请稍候重试");
      return;
    }
    chatWs.send(JSON.stringify({ mtype: "text", content: txt }));
    input.value = "";
  }
  sendBtn.onclick = doSend;
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doSend(); });
}

/* ---------------- 学习小组（已接入后端 /api/groups） ---------------- */
function renderGroups(v) {
  v.innerHTML = "";
  v.appendChild(el("div", "h-title", "学习小组"));
  v.appendChild(el("p", "h-sub", "加入同学自发组织的学习小组，一起讨论与打卡"));

  const grid = el("div", "group-grid");
  v.appendChild(grid);
  grid.appendChild(el("div", "muted", "加载中…"));

  // 本地已加入记录（按用户隔离；后端 ChatMember 为真源，这里只控制按钮态）
  const joined = lsGet(uKey("joinedGroups"), {}) || {};

  function draw(groups) {
    grid.innerHTML = "";
    if (!groups.length) {
      grid.appendChild(el("div", "muted", "暂无学习小组，可联系老师创建。"));
      return;
    }
    groups.forEach((g) => {
      const card = el("div", "card group-card");
      const head = el("div", "group-head");
      head.appendChild(el("div", "group-name", g.name));
      head.appendChild(el("span", "group-vis " + (g.visibility === "private" ? "pri" : "pub"),
        g.visibility === "private" ? "私密" : "公开"));
      card.appendChild(head);
      if (g.desc) card.appendChild(el("p", "group-desc", g.desc));
      const foot = el("div", "group-foot");
      foot.appendChild(el("span", "muted", (g.members || 0) + " 人"));
      const btn = el("button", "btn sm", joined[g.id] ? "已加入 ✓" : "加入");
      if (joined[g.id]) { btn.classList.add("ghost"); btn.disabled = true; }
      else btn.onclick = () => {
        btn.textContent = "加入中…"; btn.disabled = true;
        API.joinGroup(g.id).then(() => {
          const j = lsGet(uKey("joinedGroups"), {}) || {};
          j[g.id] = true; lsSet(uKey("joinedGroups"), j);
          toast("已加入「" + g.name + "」");
          draw(groups);
        }).catch((e) => {
          btn.disabled = false; btn.textContent = "加入";
          toast(e.message || "加入失败");
        });
      };
      foot.appendChild(btn);
      card.appendChild(foot);
      grid.appendChild(card);
    });
  }

  API.getGroups().then(draw).catch((e) => {
    grid.innerHTML = "";
    grid.appendChild(el("div", "muted", "加载小组失败：" + (e.message || "后端未连接")));
  });
}

/* ---------------- 悬浮 AI 助手 ---------------- */
function showAIFAB() {
  let fab = $("#aiFAB");
  if (!fab) {
    fab = el("div", "ai-fab");
    fab.id = "aiFAB";
    fab.innerHTML = icon("bot", 22);
    fab.setAttribute("title", "OpenMAIC 助教");
    fab.onclick = toggleAIDrawer;
    document.body.appendChild(fab);
  }
  fab.style.display = "flex";
}
function hideAIFAB() {
  const fab = $("#aiFAB"); if (fab) fab.style.display = "none";
  const drawer = $("#aiDrawer"); if (drawer) drawer.classList.remove("show");
  aiChatOpen = false;
}
function toggleAIDrawer() {
  let drawer = $("#aiDrawer");
  if (!drawer) {
    drawer = el("div", "ai-drawer");
    drawer.id = "aiDrawer";
    drawer.innerHTML =
      '<div class="ai-drawer-head"><span data-icon="bot"> </span><b>OpenMAIC 助教</b><span class="ai-close" onclick="toggleAIDrawer()">✕</span></div>' +
      '<div class="ai-drawer-msgs" id="aiDrawerMsgs"></div>' +
      '<div class="ai-drawer-input"><input id="aiDrawerInput" placeholder="随时提问…" onkeydown="if(event.key===\'Enter\') sendAI()" /><button class="btn ai" onclick="sendAI()">发送</button></div>';
    document.body.appendChild(drawer);
    initIcons(drawer);
    addAIMsg("同学你好，我是 OpenMAIC 助教。在课程、作业或讨论中遇到问题，可以随时问我。", false);
  }
  drawer.classList.toggle("show");
  aiChatOpen = drawer.classList.contains("show");
  if (aiChatOpen) setTimeout(() => $("#aiDrawerInput").focus(), 50);
}
function addAIMsg(text, me) {
  const box = $("#aiDrawerMsgs");
  const wrap = el("div", "ai-msg " + (me ? "me" : "ai"));
  wrap.innerHTML = '<div>' + esc(text) + '</div>';
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
}
function addAIMsgTyping() {
  const box = $("#aiDrawerMsgs");
  const wrap = el("div", "ai-msg ai");
  wrap.innerHTML = '<div class="typing"><span></span><span></span><span></span></div>';
  box.appendChild(wrap);
  box.scrollTop = box.scrollHeight;
  return wrap;
}
async function sendAI() {
  const ipt = $("#aiDrawerInput");
  const v = ipt.value.trim();
  if (!v) return;
  addAIMsg(v, true);
  ipt.value = "";
  const typing = addAIMsgTyping();
  const result = await getAIReply(v, "研究生通识课");
  if (typing && typing.remove) typing.remove();
  addAIMsg(result.text, false);
}

/* ---------------- 启动 ---------------- */
(function init() {
  // 铃铛
  $("#bellBtn").addEventListener("click", (e) => {
    e.stopPropagation();
    const p = $("#notifyPanel");
    p.classList.toggle("show");
    renderNotif();
  });
  document.addEventListener("click", (e) => {
    const p = $("#notifyPanel");
    if (p && !$("#bellBtn").contains(e.target)) p.classList.remove("show");
    const am = $("#avatarMenu");
    if (am && !$("#topAvatar").parentNode.contains(e.target)) am.classList.remove("show");
  });

  document.querySelectorAll("#profileTabs .tab").forEach((t) => {
    t.addEventListener("click", () => renderProfileTab(t.getAttribute("data-tab")));
  });

  const saved = localStorage.getItem("static_user");
  if (saved) { try { currentUser = JSON.parse(saved); } catch (e) { currentUser = null; } }

  // 浏览器返回 / 前进
  window.addEventListener("popstate", (e) => {
    const s = e.state || {};
    popHandling = true;
    if (s.view === "learn" && s.courseId) openCourse(+s.courseId, true);
    else if (s.view) navigate(s.view, { noPush: true });
    popHandling = false;
  });

  if (currentUser) {
    showApp({ replace: true });
  } else {
    $("#login").style.display = "flex";
    $("#app").style.display = "none";
  }

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      const d = $("#aiDrawer");
      if (d && d.classList.contains("show")) { toggleAIDrawer(); return; }
    }
    if (e.key !== "Enter" || $("#login").style.display === "none") return;
    if ($("#regForm").style.display !== "none") { doRegister(); return; }
    if (e.target.id === "li-user" || e.target.id === "li-pass") doLogin();
  });

  initIcons();
})();
