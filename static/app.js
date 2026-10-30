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

/* ---------------- 阶段一：课程数据源切换（后端为唯一真源，data.js 仅离线兜底） ---------------- */
let COURSE_CACHE = {};            // 课程详情缓存：id -> detail
let COURSE_LIST_CACHE = null;     // 课程列表缓存（后端返回；null 时回退 COURSES）

async function loadCourseList() {
  try {
    const list = await API.getCourses();
    if (list && list.length) { COURSE_LIST_CACHE = list; return list; }
  } catch (e) {}
  return COURSES;
}
function courseList() { return COURSE_LIST_CACHE || COURSES; }

async function loadCourse(id) {
  if (COURSE_CACHE[id]) return COURSE_CACHE[id];
  try {
    const c = await API.getCourseDetail(id);
    if (c) { COURSE_CACHE[id] = c; return c; }
  } catch (e) {}
  return COURSES.find((x) => x.id === id) || null;
}

// 课程封面（后端仅返回 cover emoji，前端按 id 派生配色）
function courseCover(c) {
  const palette = ["#A99CF5", "#62CBA0", "#5E82D8", "#E0A458", "#D98C9A"];
  return {
    color: c.coverColor || palette[(((c.id || 1) - 1) % palette.length)] || "#A99CF5",
    text: c.coverText || c.cover || "课",
  };
}

// 课件在线预览：统一走服务端渲染页（Office/PDF/图片/文本都能直接在浏览器里看，不再强制下载）
function previewUrl(content, title) {
  return "/api/preview?path=" + encodeURIComponent(content || "") +
    (title ? "&title=" + encodeURIComponent(title) : "");
}
// 下载文件名：保留真实扩展名，避免 .pptx 被存成 .html 打不开
function downloadName(title, content) {
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(content || "");
  const ext = m ? m[1].toLowerCase() : "";
  const base = String(title || "课件").replace(/[\\/:*?"<>|]/g, "").trim() || "课件";
  return ext ? base + "." + ext : base;
}

// 课件类型标签：让老师/学生一眼知道是什么文件、能不能在线看
function docTypeLabel(content) {
  const m = /\.([a-z0-9]{2,5})(?:$|\?)/i.exec(content || "");
  const ext = m ? m[1].toUpperCase() : "";
  const ok = ["PPTX", "DOCX", "XLSX", "PDF", "HTML", "PNG", "JPG", "JPEG", "MP4"].indexOf(ext) >= 0;
  return (ext ? ext + " " : "") + "课件" + (ok ? " · 支持在线预览" : "");
}

// 题干兼容：后端字段为 text，data.js 兜底字段为 q
function qText(q) { return (q && q.text != null) ? q.text : (q && q.q); }

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
  stopNotifPolling();
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
  // 侧边栏标识：按角色显示「教师端 / 学生端」
  const sb = $(".sidebar .sub");
  if (sb) sb.textContent = isTeacher() ? "教师端" : "学生端";
  renderNav();
  showAIFAB();
  startNotifPolling();  // 进入应用即开始轮询通知，保证教师发布后学生端数秒内可见
  const entry = isTeacher() ? "t_courses" : "home";
  navigate(entry, Object.assign({ replace: true }, opts || {}));
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
  const oldP = $("#pw-old") ? $("#pw-old").value : "";
  const n1 = $("#pw-new") ? $("#pw-new").value : "";
  const n2 = $("#pw-new2") ? $("#pw-new2").value : "";
  msg.style.color = "var(--danger)";
  if (!oldP || !n1) { msg.textContent = "请填写当前密码与新密码"; return; }
  if (n1.length < 6) { msg.textContent = "新密码至少 6 位"; return; }
  if (n1 !== n2) { msg.textContent = "两次输入的新密码不一致"; return; }
  msg.style.color = "var(--text-3)";
  msg.textContent = "提交中…";
  try {
    await API.changePassword(oldP, n1);
    msg.style.color = "var(--success)";
    msg.textContent = "✓ 密码已更新，下次登录请使用新密码";
    ["#pw-old", "#pw-new", "#pw-new2"].forEach((s) => { const e = $(s); if (e) e.value = ""; });
    toast("✓ 密码已更新");
  } catch (e) {
    msg.style.color = "var(--danger)";
    msg.textContent = e.message || "修改失败";
  }
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

/* ---------------- 顶部通知中心（服务端驱动，师生互通） ----------------
 * 数据源：GET /api/notifications（教师端发布 → 学生端接收；学生提交 → 教师端接收）
 * 本地 buildNotifs() 只保留「学习待办」这类纯前端推算的提醒，作为面板底部的补充分组。
 * 轮询：登录后每 20 秒拉一次未读数；窗口重新获得焦点时立即刷新。
 */
const NOTIF = { unread: 0, items: [], latestId: null, timer: null, open: false };

// 通知类型 → 主色（图标底色与前景同色系，保证视觉一致）
const NOTIF_TONE = {
  announcement: "#2563EB",
  homework: "#D97706",
  grade: "#059669",
  signin: "#0891B2",
  content: "#7C3AED",
  submission: "#2563EB",
  discussion: "#7C3AED",
  system: "#6B7280",
};

function setNotifBadge(n) {
  const b = $("#bellBadge");
  if (!b) return;
  if (n > 0) {
    b.textContent = n > 99 ? "99+" : String(n);
    b.classList.add("show");
  } else {
    b.textContent = "";
    b.classList.remove("show");
  }
}

// 只取未读数的轻量轮询：有新消息时弹一条提示，并同步角标
async function pollNotif() {
  if (!currentUser) return;
  try {
    const s = await API.getNotifSummary();
    const prev = NOTIF.latestId;
    NOTIF.unread = s.unread || 0;
    setNotifBadge(NOTIF.unread);
    if (s.latest) {
      NOTIF.latestId = s.latest.id;
      if (prev && s.latest.id !== prev) {
        if (NOTIF.open) renderNotif();
        else toast("新通知 · " + s.latest.title);
      }
    }
  } catch (e) { /* 未登录 / 离线时静默失败，不打扰用户 */ }
}

function startNotifPolling() {
  stopNotifPolling();
  pollNotif();
  NOTIF.timer = setInterval(pollNotif, 20000);
}
function stopNotifPolling() {
  if (NOTIF.timer) { clearInterval(NOTIF.timer); NOTIF.timer = null; }
  NOTIF.unread = 0; NOTIF.items = []; NOTIF.latestId = null;
  setNotifBadge(0);
}

function notifItem(n) {
  const item = el("div", "nt-item" + (n.read ? "" : " unread"));
  const tone = NOTIF_TONE[n.kind] || NOTIF_TONE.system;
  const icBox = el("div", "nt-ic");
  icBox.innerHTML = icon(n.icon || "bell", 17);
  icBox.style.color = tone;
  icBox.style.background = tone + "16";
  const body = el("div", "nt-main");
  body.innerHTML =
    '<div class="nt-title">' + esc(n.title) + "</div>" +
    (n.body ? '<div class="nt-desc">' + esc(n.body) + "</div>" : "") +
    '<div class="nt-meta">' +
      (n.course_title ? '<span class="nt-chip">' + esc(n.course_title) + "</span>" : "") +
      '<span class="nt-time">' + esc(n.ago || n.created_at || "") + "</span>" +
    "</div>";
  item.appendChild(icBox);
  item.appendChild(body);
  if (!n.read) item.appendChild(el("span", "nt-dot"));
  item.onclick = () => openNotification(n);
  return item;
}

// 点击通知：标记已读 → 关闭面板 → 跳到对应课程/页面
function openNotification(n) {
  const box = $("#notifyPanel");
  box.classList.remove("show");
  NOTIF.open = false;
  if (!n.read) {
    const it = NOTIF.items.find((x) => x.id === n.id);
    if (it) it.read = true;
    NOTIF.unread = Math.max(0, NOTIF.unread - 1);
    setNotifBadge(NOTIF.unread);
    API.readNotification(n.id).catch(() => {});
  }
  if (n.course_id) {
    // 通知携带的是「刚刚发生」的变更，必须绕过课程详情缓存，否则进去还是旧公告/旧作业
    delete COURSE_CACHE[n.course_id];
    if (isTeacher() && n.page !== "learn") openTeacherCourse(n.course_id, n.tab);
    else openCourse(n.course_id, false, n.tab || "video");
    return;
  }
  if (n.page) navigate(n.page);
}

async function renderNotif() {
  const box = $("#notifyPanel");
  box.innerHTML = '<div class="nt-head"><span>消息</span><span class="muted">加载中…</span></div>';
  let data;
  try {
    data = await API.getNotifications(30);
  } catch (e) {
    box.innerHTML = '<div class="nt-empty">通知加载失败，请稍后重试</div>';
    return;
  }
  NOTIF.items = (data && data.items) || [];
  NOTIF.unread = (data && data.unread) || 0;
  setNotifBadge(NOTIF.unread);
  box.innerHTML = "";

  // 头部：未读数 + 全部已读
  const head = el("div", "nt-head");
  head.appendChild(el("span", "nt-h-title", "消息"));
  const headRight = el("div", "nt-h-right");
  headRight.appendChild(el("span", "muted", NOTIF.unread ? NOTIF.unread + " 条未读" : "全部已读"));
  if (NOTIF.unread) {
    const all = el("button", "nt-link", "全部已读");
    all.onclick = async (ev) => {
      ev.stopPropagation();
      try { await API.readAllNotifications(); } catch (e) {}
      NOTIF.unread = 0;
      NOTIF.items.forEach((x) => { x.read = true; });
      setNotifBadge(0);
      renderNotif();
    };
    headRight.appendChild(all);
  }
  head.appendChild(headRight);
  box.appendChild(head);

  // 消息列表
  const list = el("div", "nt-list");
  if (!NOTIF.items.length) {
    list.innerHTML = '<div class="nt-empty">还没有来自老师的新消息<br>' +
      '<span style="font-size:11px;opacity:.8">发布公告、布置作业、开启签到时，这里会自动提醒</span></div>';
  }
  NOTIF.items.forEach((n) => list.appendChild(notifItem(n)));
  box.appendChild(list);

  // 学习提醒：本地推算的待办，不进入消息表，学生端专用
  if (!isTeacher()) {
    const todos = buildNotifs().slice(0, 2);
    if (todos.length) {
      box.appendChild(el("div", "nt-group", "学习提醒"));
      todos.forEach((t) => {
        const item = el("div", "nt-item todo");
        const icBox = el("div", "nt-ic");
        icBox.innerHTML = icon(t.ic, 17);
        icBox.style.color = NOTIF_TONE.system;
        icBox.style.background = NOTIF_TONE.system + "16";
        const body = el("div", "nt-main");
        body.innerHTML = '<div class="nt-title">' + esc(t.title) + "</div>" +
          '<div class="nt-desc">' + esc(t.desc) + "</div>";
        item.appendChild(icBox); item.appendChild(body);
        item.onclick = () => {
          box.classList.remove("show"); NOTIF.open = false;
          if (t.cid) openCourse(t.cid, false, "quiz");
          else if (t.to) navigate(t.to);
        };
        box.appendChild(item);
      });
    }
  }

  // 底部：清理已读
  if (NOTIF.items.some((x) => x.read)) {
    const foot = el("div", "nt-foot");
    const clr = el("button", "nt-link ghost", "清空已读消息");
    clr.onclick = async (ev) => {
      ev.stopPropagation();
      try { await API.clearReadNotifications(); } catch (e) {}
      renderNotif();
    };
    foot.appendChild(clr);
    box.appendChild(foot);
  }
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
  // 教师端仅显示「我的课程」；学生端显示完整导航
  const items = isTeacher()
    ? [{ key: "t_courses", ic: "book-open", label: "我的课程" }]
    : NAV;
  items.forEach((n) => {
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
  // 每次切页顺手刷一次未读数（轮询之外的兜底，保证任何进入方式都能看到角标）
  if (currentUser) pollNotif();
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
  else if (key === "t_courses") renderTeacherCourses(pages[key]);
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

async function renderHome(v) {
  v.innerHTML = "";
  v.appendChild(el("div", "h-title", "课程中心"));
  v.appendChild(el("p", "h-sub", currentUser.name + "，" + currentUser.major + " · 这里有你的通识课程"));

  const grid = el("div", "course-grid");
  v.appendChild(grid);

  const list = await loadCourseList();
  const s = (searchTerm || "").trim().toLowerCase();
  const filtered = (list || []).filter((c) => {
    if (!s) return true;
    return ((c.title || "") + " " + (c.desc || "")).toLowerCase().includes(s);
  });

  if (!filtered.length) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:48px;color:var(--text-3)">未找到与「' + esc(searchTerm) + '」相关的课程</div>';
    return;
  }
  filtered.forEach((c) => {
    const card = el("div", "course-card");
    const cover = courseCover(c);
    const coverEl = el("div", "course-cover", cover.text);
    coverEl.style.background = cover.color;
    const body = el("div", "course-body");
    const h4 = el("h4");
    h4.innerHTML = highlight(c.title, searchTerm);
    body.appendChild(h4);
    body.appendChild(el("div", "course-meta", (c.category || "") + " · " + (c.teacher || "")));
    const prog = el("div", "progress");
    const span = el("span");
    const pct = NF(localStorage.getItem(uKey("progress", c.id))) || 0;
    span.style.width = pct + "%";
    prog.appendChild(span);
    body.appendChild(prog);
    card.appendChild(coverEl);
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
async function openCourse(id, skipNav, targetTab) {
  const c = await loadCourse(id);
  if (!c) { toast("课程加载失败，请稍后重试"); return; }
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

  // 空课程判定：章节、作业、公告全空才算「老师未上传数据」。
  // 只要有一项内容（例如只有公告）就正常渲染，保证通知跳转过来的公告页可读。
  const hasAny = (c.sections && c.sections.length)
    || (c.homeworks && c.homeworks.length)
    || (c.announcements && c.announcements.length);
  if (!hasAny) {
    const empty = el("div", "card");
    empty.style.textAlign = "center"; empty.style.padding = "64px 20px"; empty.style.color = "var(--text-3)";
    empty.innerHTML = '<div style="font-size:46px;opacity:.6">📭</div>' +
      '<div style="font-size:18px;margin-top:14px;color:var(--text-2);font-weight:800;font-family:var(--font-serif)">老师暂未上传数据</div>' +
      '<div style="margin-top:8px">本课程的内容正在准备中，请稍后再来查看～</div>';
    v.appendChild(empty);
    return;
  }
  if (!c.sections) c.sections = [];   // 无章节时后续 filter 仍可安全执行
  if (!c.homeworks) c.homeworks = [];

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
    { key: "announcements", label: "公告" + ((c.announcements || []).length ? " · " + c.announcements.length : ""), show: true },
    { key: "discussion", label: "课程讨论", show: true },
  ];
  let curTab = "video";
  if (targetTab) curTab = targetTab;
  // 目标 tab 可能因内容为空而不存在（如课程暂无资料），回落到视频，避免空白页
  if (!tabDefs.some((t) => t.key === curTab && t.show)) curTab = videos.length ? "video" : (docs.length ? "doc" : "announcements");

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
        info.innerHTML = '<div class="li-ic" data-icon="file-text"> </div><div class="li-body"><h4>' + esc(s.title) + '</h4><p>' + esc(docTypeLabel(s.content)) + '</p></div>';
        const actions = el("div", "doc-actions");
        const viewBtn = el("a", "btn sm");
        viewBtn.href = previewUrl(s.content, s.title); viewBtn.target = "_blank";
        viewBtn.textContent = "在线预览";
        const dlBtn = el("a", "btn sm ghost");
        dlBtn.href = s.content; dlBtn.download = downloadName(s.title, s.content);
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
    } else if (curTab === "announcements") {
      renderAnnouncements(panel, c);
      chapter.innerHTML = '<div class="ch">课程公告</div><div class="item active">' + ((c.announcements || []).length) + " 条公告</div>";
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

/* ---------------- 课程公告（教师端发布 → 学生端阅读） ---------------- */
// 公告随课程详情返回（/api/courses/{cid} 的 announcements 字段），
// 点击通知中心的「新公告」会直接定位到本标签页。
function renderAnnouncements(panel, c) {
  panel.appendChild(el("h3", null, "课程公告"));
  const list = c.announcements || [];
  if (!list.length) {
    const empty = el("div", "muted");
    empty.style.cssText = "padding:30px 0;text-align:center;font-size:13px";
    empty.textContent = "老师暂未发布公告，发布后会在这里同步显示。";
    panel.appendChild(empty);
    return;
  }
  list.forEach((a) => {
    const card = el("div", "ann-card");
    card.innerHTML =
      '<div class="ann-head"><b>' + esc(a.title) + "</b>" +
        '<span class="ann-time">' + esc(a.created_at || "") + "</span></div>" +
      '<div class="ann-body">' + esc(a.content || "").replace(/\n/g, "<br>") + "</div>" +
      '<div class="ann-foot">' + esc(a.author || "教师") + " 发布</div>";
    panel.appendChild(card);
  });
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

/* ---------------- 章节测验（阶段一：服务端判分，前端不持有答案） ---------------- */
function quizKey(c, key) { return uKey("quiz", c.id) + "_" + key; }

// 章节测验面板：优先读服务端提交记录，否则展示作答表单
async function renderQuizPanel(panel, c) {
  panel.innerHTML = "";
  panel.appendChild(el("h3", null, "章节测验"));
  const quizzes = c.sections.filter((s) => s.stype === "quiz");
  if (!quizzes.length) {
    panel.appendChild(el("div", "muted", "暂无测验"));
    return;
  }
  for (const quiz of quizzes) {
    const wrap = el("div", "quiz-card");
    panel.appendChild(wrap);
    let res = null;
    try { res = await API.getQuizResult(quiz.id); } catch (e) {}
    if (res && res.submitted) {
      renderQuizSummary(wrap, quiz, res, c, panel);
    } else {
      renderQuizForm(wrap, quiz, c, panel);
    }
  }
}

// 作答表单（提交后由服务端判分）
function renderQuizForm(wrap, quiz, c, panel) {
  wrap.innerHTML = "";
  wrap.appendChild(el("div", "quiz-head", quiz.title));
  const hint = el("div", "quiz-hint");
  hint.textContent = "请独立完成，提交后由系统判分。";
  wrap.appendChild(hint);
  const form = el("div", "quiz-form");
  (quiz.questions || []).forEach((q, i) => {
    const qbox = el("div", "quiz-q");
    qbox.innerHTML = '<div class="quiz-qq"><span class="quiz-no">Q' + (i + 1) + '</span>' + esc(qText(q)) + '</div>';
    const opts = el("div", "quiz-opts");
    q.options.forEach((opt, j) => {
      const lab = el("label", "quiz-opt");
      lab.innerHTML = '<input type="radio" name="q_' + quiz.id + '_' + i + '" value="' + j + '"><span>' + esc(opt) + '</span>';
      opts.appendChild(lab);
    });
    qbox.appendChild(opts);
    form.appendChild(qbox);
  });
  const submit = el("button", "btn", "提交测验");
  submit.onclick = async () => {
    submit.disabled = true;
    const answers = [];
    (quiz.questions || []).forEach((q, i) => {
      const sel = form.querySelector('input[name="q_' + quiz.id + '_' + i + '"]:checked');
      answers.push(sel ? Number(sel.value) : -1);
    });
    try {
      const res = await API.submitQuiz(quiz.id, answers);
      lsSet(quizKey(c, quiz.id), res);
      if (pages.dashboard) renderDashboard(pages.dashboard);
      renderQuizSummary(wrap, quiz, res, c, panel);
      toast("测验已提交，得分 " + res.score + "/" + res.total);
    } catch (e) {
      toast(e.message || "提交失败");
      submit.disabled = false;
    }
  };
  form.appendChild(submit);
  wrap.appendChild(form);
}

// 已提交：得分概览 + 查看解析 / 重新测验
function renderQuizSummary(wrap, quiz, res, c, panel) {
  wrap.innerHTML = "";
  wrap.appendChild(el("div", "quiz-head", quiz.title));
  const total = res.total || (quiz.questions ? quiz.questions.length : 0);
  const pct = total ? Math.round((res.score / total) * 100) : 0;
  const summary = el("div", "quiz-summary");
  const circle = el("div", "quiz-score-circle");
  circle.style.background = "conic-gradient(var(--success) 0 " + pct + "%, var(--bg-2) " + pct + "% 100%)";
  circle.innerHTML = "<span>" + pct + "%</span>";
  const info = el("div", "quiz-score-info");
  const at = res.submitted_at ? res.submitted_at.replace("T", " ").slice(0, 16) : "已提交";
  info.innerHTML =
    '<div class="quiz-score-num">得分 ' + res.score + ' / ' + total + '</div>' +
    '<div class="quiz-score-time">提交于 ' + at + '</div>';
  summary.appendChild(circle);
  summary.appendChild(info);
  wrap.appendChild(summary);

  const hint = el("div", "quiz-hint");
  hint.textContent = "这是你的作答记录，可点击查看解析。";
  wrap.appendChild(hint);

  const actions = el("div", "quiz-actions");
  const viewBtn = el("button", "btn sm", "查看解析");
  const resetBtn = el("button", "btn sm ghost", "重新测验");
  actions.appendChild(viewBtn);
  actions.appendChild(resetBtn);
  wrap.appendChild(actions);

  viewBtn.onclick = () => renderQuizReview(wrap, quiz, res, c, panel);
  resetBtn.onclick = () => {
    if (!confirm("重新测验将清空本次作答记录，确定吗？")) return;
    renderQuizForm(wrap, quiz, c, panel);
  };
}

// 解析页：正确答案与用户作答均来自服务端返回（前端无标准答案）
function renderQuizReview(wrap, quiz, res, c, panel) {
  wrap.innerHTML = '<div class="quiz-head">' + esc(quiz.title) + ' · 解析</div>';
  (quiz.questions || []).forEach((q, i) => {
    const r = (res.results && res.results[i]) || {};
    const userAns = (res.answers && res.answers[i] != null) ? res.answers[i] : -1;
    const isCorrect = !!r.correct;
    const qbox = el("div", "quiz-q quiz-review" + (isCorrect ? " correct" : " wrong"));
    qbox.innerHTML =
      '<div class="quiz-qq"><span class="quiz-no">Q' + (i + 1) + '</span>' + esc(qText(q)) + '</div>' +
      '<div class="quiz-status">' + (isCorrect ? "✓ 回答正确" : (userAns < 0 ? "✗ 未作答" : "✗ 回答错误")) + '</div>';
    const opts = el("div", "quiz-opts");
    q.options.forEach((opt, j) => {
      const row = el("div", "quiz-opt-row");
      if (j === r.answer) row.classList.add("right");
      if (j === userAns && j !== r.answer) row.classList.add("picked-wrong");
      row.innerHTML = '<span class="quiz-opt-letter">' + String.fromCharCode(65 + j) + '</span><span>' + esc(opt) + '</span>';
      opts.appendChild(row);
    });
    qbox.appendChild(opts);
    const exp = r.explanation || q.explanation;
    if (exp) {
      const e = el("div", "quiz-exp");
      e.innerHTML = '<b>解析：</b>' + esc(exp);
      qbox.appendChild(e);
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
  // 阶段一：同步拉取课程列表（后端为唯一真源），拿到后刷新看板课程集合
  if (!COURSE_LIST_CACHE) {
    loadCourseList().then(() => { if (pages.dashboard === v) renderDashboard(v); }).catch(() => {});
  }
  v.appendChild(el("div", "h-title", "学情看板"));
  v.appendChild(el("p", "h-sub", currentUser.name + " · " + currentUser.major + " · 学习概览"));

  // 聚合数据
  let totalStudyMin = 0;
  let totalVideoNum = 0, totalVideoPct = 0;
  let totalScoreNum = 0, totalScoreSum = 0;
  courseList().forEach((c) => {
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
  courseList().forEach((c) => {
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
  courseList().forEach((c) => {
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
  // 铃铛：打开面板时拉取真实通知（教师端/学生端共用同一入口）
  $("#bellBtn").addEventListener("click", (e) => {
    // 点击面板内部（通知条目、按钮）不触发开关，否则会在跳转后又把面板重新打开
    if ($("#notifyPanel").contains(e.target)) return;
    e.stopPropagation();
    const p = $("#notifyPanel");
    NOTIF.open = p.classList.toggle("show");
    if (NOTIF.open) renderNotif();
  });
  document.addEventListener("click", (e) => {
    const p = $("#notifyPanel");
    if (p && !$("#bellBtn").contains(e.target)) { p.classList.remove("show"); NOTIF.open = false; }
    const am = $("#avatarMenu");
    if (am && !$("#topAvatar").parentNode.contains(e.target)) am.classList.remove("show");
  });
  // 切回标签页时立刻刷新未读数，避免"回到页面才发现有新消息"
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && currentUser) pollNotif();
  });
  window.addEventListener("focus", () => { if (currentUser) pollNotif(); });

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

/* =========================================================
 * 教师端模块（routers/teacher.py 的前端实现）
 * 入口：role === "teacher" 时，showApp/navigate 进入 "t_courses"。
 * 安全：全部接口依赖后端 require_teacher 守卫与课程行级隔离，前端仅负责展示与调用。
 * ========================================================= */
let T_COURSE = null;   // 当前管理的课程对象 {id,title,code,category,student_count,...}
let T_TAB = "sections"; // 课程详情当前 tab
let T_HW = null;        // 作业批改：当前展开的作业 id
let T_IMPORT = null;    // 最近一次学生导入结果 {cid, data}，用于在学生页展示逐行原因

// 教师端前端缓存：避免每次切换 tab 重复拉接口；删除课程/退出时 clearAll 重置。
// 结构：courses(列表) / course[cid].sections / students[cid] / homeworks[cid]
//       / dashboard[cid] / announcements[cid]。各渲染函数按 cid 读缓存，缺失才请求。
const TeacherCache = {
  courses: null,        // GET /api/teacher/courses
  course: {},           // cid -> { sections: [...] }
  students: {},         // cid -> [学生]
  homeworks: {},        // cid -> [作业]
  dashboard: {},        // cid -> 学情聚合
  announcements: {},    // cid -> [公告]
  clearAll() {
    this.courses = null;
    this.course = {};
    this.students = {};
    this.homeworks = {};
    this.dashboard = {};
    this.announcements = {};
  },
};

function isTeacher() { return !!(currentUser && currentUser.role === "teacher"); }

// 通用表格 HTML 构造（cells 已是转义后的 HTML 字符串）
function tTable(headers, rows) {
  let h = '<table class="t-table"><thead><tr>' +
    headers.map((x) => "<th>" + x + "</th>").join("") + "</tr></thead><tbody>";
  if (!rows.length) {
    h += '<tr><td colspan="' + headers.length + '" style="text-align:center;color:var(--text-3);padding:24px">暂无数据</td></tr>';
  } else {
    h += rows.map((r) => "<tr>" + r.map((c) => "<td>" + c + "</td>").join("") + "</tr>").join("");
  }
  return h + "</tbody></table>";
}

/* ---------------- 课程列表 + 课程详情壳 ---------------- */
async function renderTeacherCourses(v) {
  if (T_COURSE) { renderTeacherCourseDetail(v); return; }
  v.innerHTML = "";
  v.appendChild(el("div", "h-title", "我的课程"));
  v.appendChild(el("p", "h-sub", (currentUser.name || "老师") + "，管理你开设的通识课程"));

  const bar = el("div", "t-toolbar");
  const newBtn = el("button", "btn", "＋ 新建课程");
  newBtn.onclick = () => toggleTeacherCourseForm($("#tCourseForm"), null);
  bar.appendChild(newBtn);
  v.appendChild(bar);

  const formHost = el("div"); formHost.id = "tCourseForm"; v.appendChild(formHost);
  const grid = el("div", "course-grid"); grid.id = "tCourseGrid"; v.appendChild(grid);
  await loadTeacherCourses(grid);
}

async function loadTeacherCourses(grid) {
  grid.innerHTML = '<div class="muted2">加载中…</div>';
  try {
    const list = await API.teacherCourses();
    TeacherCache.courses = list;
    if (!list.length) {
      grid.innerHTML = '<div class="card" style="grid-column:1/-1;text-align:center;padding:40px;color:var(--text-3)">还没有课程，点击「新建课程」开始。</div>';
      return;
    }
    grid.innerHTML = "";
    list.forEach((c) => grid.appendChild(teacherCourseCard(c)));
  } catch (e) {
    grid.innerHTML = '<div class="card" style="grid-column:1/-1;color:var(--danger)">加载失败：' + esc(e.message) + "</div>";
  }
}

function teacherCourseCard(c) {
  const card = el("div", "course-card");
  const cover = el("div", "course-cover", c.cover || "📘");
  cover.style.background = "var(--primary)";
  const body = el("div", "course-body");
  const h = el("h4"); h.textContent = c.title; body.appendChild(h);
  body.appendChild(el("div", "course-meta", (c.code || "") + (c.code ? " · " : "") + (c.category || "")));
  body.appendChild(el("div", "course-meta", "学生 " + (c.student_count || 0) + " 人"));
  const act = el("div");
  act.style.marginTop = "10px"; act.style.display = "flex"; act.style.gap = "8px"; act.style.flexWrap = "wrap";
  const m = el("button", "btn", "管理"); m.onclick = () => openTeacherCourse(c.id);
  const ed = el("button", "btn ghost", "编辑");
  ed.onclick = () => toggleTeacherCourseForm($("#tCourseForm"), c);
  const del = el("button", "btn ghost", "删除"); del.style.color = "var(--danger)";
  del.onclick = async () => {
    if (!confirm("确定删除课程《" + c.title + "》？将级联删除章节/作业/签到/公告，不可恢复。")) return;
    try { await API.teacherDeleteCourse(c.id); TeacherCache.clearAll(); toast("已删除"); navigate("t_courses"); }
    catch (e) { toast(e.message); }
  };
  act.appendChild(m); act.appendChild(ed); act.appendChild(del);
  body.appendChild(act);
  card.appendChild(cover); card.appendChild(body);
  return card;
}

function toggleTeacherCourseForm(host, course) {
  if (!host) return;
  if (host._open && !course) { host.innerHTML = ""; host._open = false; return; }
  host._open = true;
  const c = course || {};
  host.innerHTML =
    '<div class="t-form">' +
      '<div><label>课程名称 *</label><input id="cf_title" value="' + esc(c.title || "") + '" placeholder="如：数据科学导论"></div>' +
      '<div><label>课程代码</label><input id="cf_code" value="' + esc(c.code || "") + '" placeholder="如：CS101"></div>' +
      '<div><label>教师</label><input id="cf_teacher" value="' + esc(c.teacher || currentUser.name || "") + '"></div>' +
      '<div><label>分类</label><input id="cf_category" value="' + esc(c.category || "通识课") + '"></div>' +
      '<div class="full"><label>简介</label><textarea id="cf_desc" rows="2">' + esc(c.desc || "") + '</textarea></div>' +
      '<div class="full"><button class="btn" id="cf_save">' + (course ? "保存修改" : "创建课程") + '</button>' +
      (course ? '<button class="btn ghost" id="cf_cancel">取消</button>' : "") +
      ' <span class="muted2" id="cf_msg"></span></div>' +
    '</div>';
  document.getElementById("cf_save").onclick = async () => {
    const body = {
      title: document.getElementById("cf_title").value.trim(),
      code: document.getElementById("cf_code").value.trim(),
      teacher: document.getElementById("cf_teacher").value.trim(),
      category: document.getElementById("cf_category").value.trim(),
      desc: document.getElementById("cf_desc").value.trim(),
    };
    if (!body.title) { document.getElementById("cf_msg").textContent = "请填写课程名称"; return; }
    try {
      if (course) await API.teacherUpdateCourse(course.id, body);
      else await API.teacherCreateCourse(body);
      TeacherCache.courses = null;
      host.innerHTML = ""; host._open = false;
      toast(course ? "已保存" : "已创建");
      navigate("t_courses");
    } catch (e) { document.getElementById("cf_msg").textContent = e.message; }
  };
  const cancel = document.getElementById("cf_cancel");
  if (cancel) cancel.onclick = () => { host.innerHTML = ""; host._open = false; };
}

async function openTeacherCourse(cid, tab) {
  let c = (TeacherCache.courses || []).find((x) => x.id === cid);
  if (!c) { try { const list = await API.teacherCourses(); TeacherCache.courses = list; c = list.find((x) => x.id === cid); } catch (e) {} }
  if (!c) c = { id: cid, title: "课程" + cid };
  const validTabs = ["sections", "students", "grading", "dashboard", "signin", "announcements"];
  T_COURSE = c;
  T_TAB = validTabs.indexOf(tab) >= 0 ? tab : "sections";  // 通知点击可直达「作业批改」等 Tab
  T_HW = null;
  navigate("t_courses");
}

function renderTeacherCourseDetail(v) {
  const c = T_COURSE;
  v.innerHTML = "";
  const back = el("button", "btn ghost", "← 我的课程");
  back.onclick = () => { T_COURSE = null; T_HW = null; navigate("t_courses"); };
  v.appendChild(back);

  const head = el("div", "t-section");
  head.style.display = "flex"; head.style.justifyContent = "space-between"; head.style.alignItems = "center";
  const htxt = el("div");
  htxt.innerHTML = '<div style="font-size:20px;font-weight:800">' + esc(c.title) + '</div>' +
    '<div class="muted2">' + esc(c.code || "") + (c.code ? " · " : "") + "学生 " + (c.student_count || 0) + " 人</div>";
  head.appendChild(htxt);
  const del = el("button", "btn ghost", "删除课程"); del.style.color = "var(--danger)";
  del.onclick = async () => {
    if (!confirm("确定删除《" + c.title + "》？")) return;
    try { await API.teacherDeleteCourse(c.id); TeacherCache.clearAll(); T_COURSE = null; toast("已删除"); navigate("t_courses"); }
    catch (e) { toast(e.message); }
  };
  head.appendChild(del);
  v.appendChild(head);

  const tabs = el("div", "tabs");
  const tabsDef = [
    ["sections", "章节"], ["students", "学生"], ["grading", "作业批改"],
    ["dashboard", "学情"], ["signin", "签到"], ["announcements", "公告"],
  ];
  tabsDef.forEach(([k, label]) => {
    const t = el("div", "tab" + (k === T_TAB ? " cur" : ""), label);
    t.onclick = () => { T_TAB = k; renderTeacherCourseDetail(v); };
    tabs.appendChild(t);
  });
  v.appendChild(tabs);

  const body = el("div", "tab-body"); v.appendChild(body);
  if (T_TAB === "sections") renderTeacherSections(body, c);
  else if (T_TAB === "students") renderTeacherStudents(body, c);
  else if (T_TAB === "grading") renderTeacherGrading(body, c);
  else if (T_TAB === "dashboard") renderTeacherDashboard(body, c);
  else if (T_TAB === "signin") renderTeacherSignin(body, c);
  else if (T_TAB === "announcements") renderTeacherAnnouncements(body, c);
}

/* ---------------- Tab: 章节 ---------------- */
async function renderTeacherSections(v, c) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  let list = TeacherCache.course[c.id] && TeacherCache.course[c.id].sections;
  if (!list) {
    try {
      list = await API.teacherSections(c.id);
      TeacherCache.course[c.id] = TeacherCache.course[c.id] || {};
      TeacherCache.course[c.id].sections = list;
    } catch (e) { v.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; return; }
  }
  v.innerHTML = "";
  const bar = el("div", "t-toolbar");
  const add = el("button", "btn", "＋ 添加章节");
  add.onclick = () => toggleSectionForm(v, c, null);
  bar.appendChild(add);
  v.appendChild(bar);
  const host = el("div"); host.id = "secForm"; v.appendChild(host);

  if (!list.length) { v.appendChild(el("div", "muted2", "暂无章节，点击「添加章节」添加视频 / 课件 / 测验。")); return; }
  list.forEach((s) => v.appendChild(sectionRow(s, c)));
}

function stypeBadge(t, count) {
  if (t === "quiz") return '<span class="badge gray">测验 · ' + (count || 0) + ' 题</span>';
  const map = { video: ["视频", "green"], doc: ["课件", ""] };
  const [txt, cls] = map[t] || ["其它", "gray"];
  return '<span class="badge ' + cls + '">' + txt + "</span>";
}

function sectionRow(s, c) {
  const row = el("div", "t-row");
  const left = el("div");
  left.innerHTML = '<b>' + esc(s.title) + "</b> " + stypeBadge(s.stype, s.question_count) +
    (s.content ? ' <span class="muted2">' + esc(s.content) + "</span>" : "");
  const right = el("div"); right.style.display = "flex"; right.style.gap = "8px";
  if (s.stype === "quiz") {
    const qm = el("button", "btn ghost", "出题");
    qm.onclick = () => renderTeacherQuestions(document.querySelector(".tab-body"), c, s);
    right.appendChild(qm);
  }
  // 课件/视频：老师也能用与学生完全相同的预览页，避免"学生看到的是另一副样子"
  if (s.stype !== "quiz" && s.content) {
    const pv = el("button", "btn ghost", "预览");
    pv.onclick = () => window.open(previewUrl(s.content, s.title), "_blank");
    right.appendChild(pv);
  }
  const ed = el("button", "btn ghost", "编辑");
  ed.onclick = () => toggleSectionForm(document.getElementById("secForm"), c, s);
  const del = el("button", "btn ghost", "删除"); del.style.color = "var(--danger)";
  del.onclick = async () => {
    if (!confirm("删除章节《" + s.title + "》？")) return;
    try { await API.teacherDeleteSection(s.id); TeacherCache.course[c.id] = undefined; toast("已删除"); renderTeacherSections(document.getElementById("tTabBody") || document.querySelector(".tab-body"), c); }
    catch (e) { toast(e.message); }
  };
  right.appendChild(ed); right.appendChild(del);
  row.appendChild(left); row.appendChild(right);
  return row;
}

function toggleSectionForm(v, c, sec) {
  const host = document.getElementById("secForm");
  if (!host) return;
  if (host._open && !sec) { host.innerHTML = ""; host._open = false; return; }
  host._open = true;
  const s = sec || {};
  host.innerHTML =
    '<div class="t-form">' +
      '<div class="full"><label>章节标题 *</label><input id="sf_title" value="' + esc(s.title || "") + '"></div>' +
      '<div><label>类型</label><select id="sf_stype">' +
        '<option value="video"' + (s.stype === "video" ? " selected" : "") + '>视频</option>' +
        '<option value="doc"' + (s.stype === "doc" ? " selected" : "") + '>课件</option>' +
        '<option value="quiz"' + (s.stype === "quiz" ? " selected" : "") + '>测验</option>' +
      '</select></div>' +
      '<div><label>内容地址/链接</label><input id="sf_content" value="' + esc(s.content || "") + '" placeholder="如 /files/xxx.mp4 或外链"></div>' +
      '<div class="full"><label>上传资料（可选，将覆盖上方内容地址）</label><input type="file" id="sf_file"></div>' +
      '<div class="full"><button class="btn" id="sf_save">' + (sec ? "保存修改" : "添加章节") + '</button>' +
      (sec ? '<button class="btn ghost" id="sf_cancel">取消</button>' : "") +
      ' <span class="muted2" id="sf_msg"></span></div>' +
    '</div>';
  document.getElementById("sf_save").onclick = async () => {
    const title = document.getElementById("sf_title").value.trim();
    if (!title) { document.getElementById("sf_msg").textContent = "请填写章节标题"; return; }
    let content = document.getElementById("sf_content").value.trim();
    const fileInput = document.getElementById("sf_file");
    try {
      if (fileInput.files && fileInput.files[0]) {
        const up = await API.teacherUpload(fileInput.files[0]);
        content = up.url;
      }
      const body = { title, stype: document.getElementById("sf_stype").value, content, position: 0 };
      if (sec) await API.teacherUpdateSection(sec.id, body);
      else await API.teacherAddSection(c.id, body);
      TeacherCache.course[c.id] = undefined;
      host.innerHTML = ""; host._open = false;
      toast(sec ? "已保存" : "已添加");
      renderTeacherSections(document.querySelector(".tab-body"), c);
    } catch (e) { document.getElementById("sf_msg").textContent = e.message; }
  };
  const cancel = document.getElementById("sf_cancel");
  if (cancel) cancel.onclick = () => { host.innerHTML = ""; host._open = false; };
}

/* ---------------- 测验出题（章节题库管理） ---------------- */
async function renderTeacherQuestions(v, c, sec) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  const bar = el("div", "t-toolbar");
  const back = el("button", "btn ghost", "← 返回章节");
  back.onclick = () => { TeacherCache.course[c.id] = undefined; renderTeacherSections(v, c); };
  bar.appendChild(back);
  const add = el("button", "btn", "＋ 添加题目");
  add.onclick = () => toggleQuestionForm(v, c, sec, null);
  bar.appendChild(add);
  v.appendChild(bar);
  const host = el("div"); host.id = "qForm"; v.appendChild(host);

  let list;
  try {
    list = await API.teacherQuestions(sec.id);
  } catch (e) { v.appendChild(el("div", "card", "加载失败：" + esc(e.message))); return; }

  const wrap = el("div"); v.appendChild(wrap);
  if (!list.length) { wrap.appendChild(el("div", "muted2", "暂无题目，点击「添加题目」开始出题。")); return; }
  list.forEach((q) => {
    const card = el("div", "t-section");
    const top = el("div");
    top.style.display = "flex"; top.style.justifyContent = "space-between"; top.style.alignItems = "center";
    const optsPreview = (q.options || []).map((o, i) => String.fromCharCode(65 + i) + ". " + o).join("　");
    top.innerHTML = "<div><b>Q" + (q.q_order + 1) + ".</b> " + esc(q.q_text) +
      ' <span class="badge gray">答案 ' + String.fromCharCode(65 + (q.answer || 0)) + '</span></div>';
    const right = el("div"); right.style.display = "flex"; right.style.gap = "8px";
    const ed = el("button", "btn ghost", "编辑");
    ed.onclick = () => toggleQuestionForm(v, c, sec, q);
    const del = el("button", "btn ghost", "删除"); del.style.color = "var(--danger)";
    del.onclick = async () => {
      if (!confirm("删除该题？")) return;
      try { await API.teacherDeleteQuestion(q.id); toast("已删除"); renderTeacherQuestions(v, c, sec); }
      catch (e) { toast(e.message); }
    };
    right.appendChild(ed); right.appendChild(del);
    top.appendChild(right);
    card.appendChild(top);
    card.appendChild(el("div", "muted2", optsPreview));
    if (q.explanation) card.appendChild(el("div", null, "解析：" + q.explanation));
    wrap.appendChild(card);
  });
}

function toggleQuestionForm(v, c, sec, q) {
  const host = document.getElementById("qForm");
  if (!host) return;
  if (host._open && !q) { host.innerHTML = ""; host._open = false; return; }
  host._open = true;
  const qq = q || {};
  const opts = qq.options || ["", "", "", ""];
  host.innerHTML =
    '<div class="t-form">' +
      '<div class="full"><label>题干 *</label><textarea id="qf_text" rows="2">' + esc(qq.q_text || "") + '</textarea></div>' +
      '<div class="full"><label>选项 A</label><input id="qf_opt0" value="' + esc(opts[0] || "") + '"></div>' +
      '<div class="full"><label>选项 B</label><input id="qf_opt1" value="' + esc(opts[1] || "") + '"></div>' +
      '<div class="full"><label>选项 C（可选）</label><input id="qf_opt2" value="' + esc(opts[2] || "") + '"></div>' +
      '<div class="full"><label>选项 D（可选）</label><input id="qf_opt3" value="' + esc(opts[3] || "") + '"></div>' +
      '<div><label>正确答案</label><select id="qf_ans">' +
        '<option value="0"' + ((qq.answer === 0) ? " selected" : "") + '>A</option>' +
        '<option value="1"' + ((qq.answer === 1) ? " selected" : "") + '>B</option>' +
        '<option value="2"' + ((qq.answer === 2) ? " selected" : "") + '>C</option>' +
        '<option value="3"' + ((qq.answer === 3) ? " selected" : "") + '>D</option>' +
      '</select></div>' +
      '<div class="full"><label>解析（可选）</label><textarea id="qf_exp" rows="2">' + esc(qq.explanation || "") + '</textarea></div>' +
      '<div class="full"><button class="btn" id="qf_save">' + (q ? "保存修改" : "添加题目") + '</button>' +
      (q ? '<button class="btn ghost" id="qf_cancel">取消</button>' : "") +
      ' <span class="muted2" id="qf_msg"></span></div>' +
    '</div>';
  document.getElementById("qf_save").onclick = async () => {
    const qtext = document.getElementById("qf_text").value.trim();
    if (!qtext) { document.getElementById("qf_msg").textContent = "请填写题干"; return; }
    const optsArr = [0, 1, 2, 3].map((i) => document.getElementById("qf_opt" + i).value.trim()).filter((x) => x !== "");
    if (optsArr.length < 2) { document.getElementById("qf_msg").textContent = "至少需要 2 个非空选项"; return; }
    const ans = parseInt(document.getElementById("qf_ans").value, 10);
    if (ans < 0 || ans >= optsArr.length) { document.getElementById("qf_msg").textContent = "正确选项超出了选项数量，请调整选项或答案"; return; }
    const body = {
      q_text: qtext,
      options: optsArr,
      answer: ans,
      explanation: document.getElementById("qf_exp").value.trim(),
    };
    try {
      if (q) await API.teacherUpdateQuestion(q.id, body);
      else await API.teacherAddQuestion(sec.id, body);
      host.innerHTML = ""; host._open = false;
      toast(q ? "已保存" : "已添加");
      renderTeacherQuestions(v, c, sec);
    } catch (e) { document.getElementById("qf_msg").textContent = e.message; }
  };
  const cancel = document.getElementById("qf_cancel");
  if (cancel) cancel.onclick = () => { host.innerHTML = ""; host._open = false; };
}

/* ---------------- Tab: 学生 ---------------- */
async function renderTeacherStudents(v, c) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  let list = TeacherCache.students[c.id];
  if (!list) {
    try {
      list = await API.teacherStudents(c.id);
      TeacherCache.students[c.id] = list;
    } catch (e) { v.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; return; }
  }
  v.innerHTML = "";
  const bar = el("div", "t-toolbar");
  const tpl = el("button", "btn ghost", "下载导入模板");
  tpl.onclick = () => { try { API.teacherDownloadTemplate(c.id); } catch (e) { toast(e.message); } };
  const imp = el("button", "btn ghost", "导入 Excel");
  const impFile = document.createElement("input");
  impFile.type = "file"; impFile.accept = ".xlsx,.xls"; impFile.style.display = "none";
  impFile.onchange = () => importStudentsFile(c, impFile);
  imp.onclick = () => impFile.click();
  const add = el("button", "btn", "手动添加");
  add.onclick = () => toggleStudentForm(v, c, null);
  bar.appendChild(tpl); bar.appendChild(imp); bar.appendChild(impFile); bar.appendChild(add);
  v.appendChild(bar);
  const host = el("div"); host.id = "stuForm"; v.appendChild(host);
  // 导入结果面板：逐行说明为什么被跳过，避免"跳过 1"却不知道原因
  if (T_IMPORT && T_IMPORT.cid === c.id && T_IMPORT.data) {
    v.appendChild(importResultPanel(c));
  }

  if (!list.length) { v.appendChild(el("div", "muted2", "暂无学生，可手动添加或导入 Excel（课程代码/名称可留空，默认进当前课程）。")); return; }
  const rows = list.map((u) => {
    const act = '<button class="btn ghost" data-rm="' + u.id + '">移除</button>';
    return [esc(u.username), esc(u.name), esc(u.klass || ""), esc(u.major || ""), act];
  });
  const table = el("div");
  table.innerHTML = tTable(["学号", "姓名", "班级", "专业", "操作"], rows);
  table.querySelectorAll("[data-rm]").forEach((btn) => {
    btn.onclick = async () => {
      const uid = +btn.getAttribute("data-rm");
      if (!confirm("从本课程移除该学生？")) return;
      try { await API.teacherRemoveStudent(c.id, uid); TeacherCache.students[c.id] = undefined; toast("已移除"); renderTeacherStudents(v, c); }
      catch (e) { toast(e.message); }
    };
  });
  v.appendChild(table);
}

async function importStudentsFile(c, input) {
  const file = input.files && input.files[0];
  if (!file) return;
  try {
    const r = await API.teacherImportStudents(file, c.id);
    TeacherCache.students = {};
    T_IMPORT = { cid: c.id, data: r };
    const fail = (r.details || []).filter((d) => d.type !== "ok").length;
    let msg = "导入完成：新建 " + r.created + "，加入课程 " + r.updated + "，跳过 " + r.skipped;
    if (fail) msg += "（下方已列出原因）";
    else if (!r.created && !r.updated) msg += "（没有可导入的行）";
    toast(msg);
    const body = document.querySelector(".tab-body");
    if (body) renderTeacherStudents(body, c);
  } catch (e) { toast(e.message); }
  input.value = "";
}

// 导入结果面板：新建 / 加入 / 跳过 的逐行明细
function importResultPanel(c) {
  const r = T_IMPORT.data;
  const box = el("div", "import-result");
  const tone = (r.created || r.updated) ? "ok" : (r.skipped ? "warn" : "ok");
  const head = el("div", "ir-head " + tone);
  head.innerHTML = "<b>导入结果 · 《" + esc(c.title) + "》</b>" +
    '<span class="ir-nums">新建 <b>' + r.created + "</b> · 加入课程 <b>" + r.updated +
    "</b> · 跳过 <b>" + r.skipped + "</b></span>";
  const close = el("button", "ir-close", "✕");
  close.title = "关闭";
  close.onclick = () => { T_IMPORT = null; const b = document.querySelector(".tab-body"); if (b) renderTeacherStudents(b, c); };
  head.appendChild(close);
  box.appendChild(head);

  const list = el("div", "ir-list");
  const details = r.details || [];
  if (!details.length) {
    list.innerHTML = '<div class="ir-row"><span class="ir-tag skip">提示</span><span>表格里没有数据行（只有表头或全为空行）。</span></div>';
  }
  details.forEach((d) => {
    const row = el("div", "ir-row");
    const tagCls = d.type === "ok" ? "ok" : (d.type === "error" ? "err" : "skip");
    row.innerHTML = '<span class="ir-tag ' + tagCls + '">' + (d.type === "ok" ? "成功" : (d.type === "error" ? "未导入" : "跳过")) + "</span>" +
      '<span class="ir-who">第' + d.row + "行" + (d.student ? " · " + esc(d.student) : "") + "</span>" +
      "<span class=\"ir-why\">" + esc(d.reason) + "</span>";
    list.appendChild(row);
  });
  box.appendChild(list);
  return box;
}

function toggleStudentForm(v, c, stu) {
  const host = document.getElementById("stuForm");
  if (!host) return;
  if (host._open && !stu) { host.innerHTML = ""; host._open = false; return; }
  host._open = true;
  const s = stu || {};
  host.innerHTML =
    '<div class="t-form">' +
      '<div><label>学号 *</label><input id="stf_user" value="' + esc(s.username || "") + '"></div>' +
      '<div><label>姓名 *</label><input id="stf_name" value="' + esc(s.name || "") + '"></div>' +
      '<div><label>班级</label><input id="stf_class" value="' + esc(s.klass || "") + '"></div>' +
      '<div><label>专业</label><input id="stf_major" value="' + esc(s.major || "") + '"></div>' +
      '<div class="full"><button class="btn" id="stf_save">添加</button> <span class="muted2" id="stf_msg"></span></div>' +
    '</div>';
  document.getElementById("stf_save").onclick = async () => {
    const username = document.getElementById("stf_user").value.trim();
    const name = document.getElementById("stf_name").value.trim();
    if (!username || !name) { document.getElementById("stf_msg").textContent = "请填写学号和姓名"; return; }
    try {
      await API.teacherAddStudent({ username, name, klass: document.getElementById("stf_class").value.trim(), major: document.getElementById("stf_major").value.trim(), course_id: c.id });
      TeacherCache.students[c.id] = undefined;
      host.innerHTML = ""; host._open = false;
      toast("已添加"); renderTeacherStudents(v, c);
    } catch (e) { document.getElementById("stf_msg").textContent = e.message; }
  };
}

/* ---------------- Tab: 作业批改 ---------------- */
async function renderTeacherGrading(v, c) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  let list = TeacherCache.homeworks[c.id];
  if (!list) {
    try {
      list = await API.teacherHomeworks(c.id);
      TeacherCache.homeworks[c.id] = list;
    } catch (e) { v.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; return; }
  }
  v.innerHTML = "";
  const bar = el("div", "t-toolbar");
  const add = el("button", "btn", "＋ 布置作业");
  add.onclick = () => toggleHomeworkForm(v, c, null);
  bar.appendChild(add);
  v.appendChild(bar);
  const host = el("div"); host.id = "hwForm"; v.appendChild(host);

  if (!list.length) { v.appendChild(el("div", "muted2", "本课程暂无作业，点击「布置作业」添加。")); return; }
  list.forEach(async (hw) => {
    const card = el("div", "t-section");
    const top = el("div");
    top.style.display = "flex"; top.style.justifyContent = "space-between"; top.style.alignItems = "center";
    top.innerHTML = "<div><b>" + esc(hw.title) + "</b> <span class=\"muted2\">截止：" + esc(hw.due || "未设置") +
      " · 提交 " + hw.submissions + " / 未批改 " + hw.ungraded + "</span></div>";
    const right = el("div"); right.style.display = "flex"; right.style.gap = "8px";
    const ed = el("button", "btn ghost", "编辑");
    ed.onclick = () => toggleHomeworkForm(v, c, hw);
    const del = el("button", "btn ghost", "删除"); del.style.color = "var(--danger)";
    del.onclick = async () => {
      if (!confirm("删除作业《" + hw.title + "》？相关学生提交记录将一并删除。")) return;
      try { await API.teacherDeleteHomework(hw.id); TeacherCache.homeworks[c.id] = undefined; toast("已删除"); renderTeacherGrading(v, c); }
      catch (e) { toast(e.message); }
    };
    const btn = el("button", "btn ghost", T_HW === hw.id ? "收起" : "查看提交");
    btn.onclick = () => { T_HW = (T_HW === hw.id ? null : hw.id); renderTeacherGrading(v, c); };
    right.appendChild(ed); right.appendChild(del); right.appendChild(btn);
    top.appendChild(right);
    card.appendChild(top);
    if (T_HW === hw.id) card.appendChild(await buildSubmissionsPanel(c, hw));
    v.appendChild(card);
  });
}

function toggleHomeworkForm(v, c, hw) {
  const host = document.getElementById("hwForm");
  if (!host) return;
  if (host._open && !hw) { host.innerHTML = ""; host._open = false; return; }
  host._open = true;
  const h = hw || {};
  host.innerHTML =
    '<div class="t-form">' +
      '<div class="full"><label>作业标题 *</label><input id="hwf_title" value="' + esc(h.title || "") + '"></div>' +
      '<div class="full"><label>说明 / 要求</label><textarea id="hwf_desc" rows="2">' + esc(h.desc || "") + '</textarea></div>' +
      '<div><label>截止时间</label><input id="hwf_due" value="' + esc(h.due || "") + '" placeholder="如 2026-11-01 23:59"></div>' +
      '<div class="full"><button class="btn" id="hwf_save">' + (hw ? "保存修改" : "布置作业") + '</button>' +
      (hw ? '<button class="btn ghost" id="hwf_cancel">取消</button>' : "") +
      ' <span class="muted2" id="hwf_msg"></span></div>' +
    '</div>';
  document.getElementById("hwf_save").onclick = async () => {
    const title = document.getElementById("hwf_title").value.trim();
    if (!title) { document.getElementById("hwf_msg").textContent = "请填写作业标题"; return; }
    const body = {
      title,
      desc: document.getElementById("hwf_desc").value.trim(),
      due: document.getElementById("hwf_due").value.trim(),
    };
    try {
      if (hw) await API.teacherUpdateHomework(hw.id, body);
      else await API.teacherCreateHomework(c.id, body);
      TeacherCache.homeworks[c.id] = undefined;
      host.innerHTML = ""; host._open = false;
      toast(hw ? "已保存" : "已布置");
      renderTeacherGrading(v, c);
    } catch (e) { document.getElementById("hwf_msg").textContent = e.message; }
  };
  const cancel = document.getElementById("hwf_cancel");
  if (cancel) cancel.onclick = () => { host.innerHTML = ""; host._open = false; };
}

async function buildSubmissionsPanel(c, hw) {
  const panel = el("div"); panel.style.marginTop = "10px";
  panel.innerHTML = '<div class="muted2">加载提交中…</div>';
  try {
    const subs = await API.teacherSubmissions(hw.id);
    if (!subs.length) { panel.innerHTML = '<div class="muted2">暂无提交。</div>'; return panel; }
    const rows = subs.map((s) => {
      const graded = s.status === "graded";
      const file = s.file_path ? '<a href="/files/' + esc(s.file_path) + '" target="_blank">附件</a>' : "—";
      const act = '<button class="btn ghost" data-gd="' + s.id + '">' + (graded ? "修改批改" : "批改") + "</button>";
      return [esc(s.username), esc(s.name), esc(s.klass || ""), esc(s.answer || "—"), file,
        "<b>" + esc(s.score || "—") + "</b>", esc(s.feedback || "—"),
        '<span class="badge ' + (graded ? "green" : "gray") + '">' + (graded ? "已批改" : "未批改") + "</span>", act];
    });
    panel.innerHTML = tTable(["学号", "姓名", "班级", "作答", "附件", "得分", "反馈", "状态", "操作"], rows);
    panel.querySelectorAll("[data-gd]").forEach((btn) => {
      btn.onclick = () => openGradeForm(panel, c, hw.id, +btn.getAttribute("data-gd"), subs);
    });
  } catch (e) { panel.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; }
  return panel;
}

function openGradeForm(panel, c, hid, sid, subs) {
  const sub = subs.find((x) => x.id === sid);
  const form = el("div", "t-form");
  form.innerHTML =
    '<div><label>得分</label><input id="gd_score" value="' + esc(sub.score || "") + '" placeholder="如 95"></div>' +
    '<div><label>状态</label><span class="muted2">批改后自动标记已批改</span></div>' +
    '<div class="full"><label>反馈</label><textarea id="gd_fb" rows="2">' + esc(sub.feedback || "") + '</textarea></div>' +
    '<div class="full"><button class="btn" id="gd_save">保存批改</button> <span class="muted2" id="gd_msg"></span></div>';
  panel.innerHTML = "";
  panel.appendChild(form);
  document.getElementById("gd_save").onclick = async () => {
    try {
      await API.teacherGrade(hid, sid, {
        score: document.getElementById("gd_score").value.trim(),
        feedback: document.getElementById("gd_fb").value.trim(),
      });
      TeacherCache.homeworks[c.id] = undefined;
      toast("已保存批改");
      const body = document.querySelector(".tab-body");
      if (body) renderTeacherGrading(body, c);
    } catch (e) { document.getElementById("gd_msg").textContent = e.message; }
  };
}

/* ---------------- Tab: 学情看板 ---------------- */
async function renderTeacherDashboard(v, c) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  let d = TeacherCache.dashboard[c.id];
  if (!d) {
    try { d = await API.teacherDashboard(c.id); TeacherCache.dashboard[c.id] = d; }
    catch (e) { v.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; return; }
  }
  v.innerHTML = "";
  const cards = el("div", "course-grid"); cards.style.gridTemplateColumns = "repeat(auto-fill,minmax(150px,1fr))";
  const stats = [
    ["学生总数", d.total_students],
    ["平均视频进度", d.avg_video + "%"],
    ["平均作业分", d.avg_homework],
    ["平均测验分", d.avg_quiz],
    ["签到率", d.signin_rate + "%"],
    ["周学习时长", Math.round((d.weekly_watch_seconds.reduce((a, b) => a + b, 0)) / 3600) + " 小时"],
  ];
  stats.forEach(([k, val]) => {
    const card = el("div", "card");
    card.style.padding = "14px";
    card.innerHTML = '<div class="muted2">' + esc(k) + '</div><div style="font-size:22px;font-weight:800;margin-top:4px">' + esc(String(val)) + "</div>";
    cards.appendChild(card);
  });
  v.appendChild(cards);

  v.appendChild(el("h4", null, "学生明细"));
  if (!d.students.length) { v.appendChild(el("div", "muted2", "暂无学生数据。")); return; }
  const rows = d.students.map((s) => [
    esc(s.username), esc(s.name), esc(s.klass || ""), esc(s.major || ""),
    esc(s.video), esc(s.homework), esc(s.quiz),
    '<span class="badge ' + (s.signed ? "green" : "gray") + '">' + (s.signed ? "已签到" : "未签到") + "</span>",
  ]);
  const table = el("div");
  table.innerHTML = tTable(["学号", "姓名", "班级", "专业", "视频", "作业", "测验", "签到"], rows);
  v.appendChild(table);
}

/* ---------------- Tab: 签到 ---------------- */
async function renderTeacherSignin(v, c) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  let data;
  try { data = await API.teacherSigninList(c.id); }
  catch (e) { v.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; return; }
  v.innerHTML = "";
  const bar = el("div", "t-toolbar");
  const open = el("button", "btn", "开启签到");
  const close = el("button", "btn ghost", "关闭签到"); close.style.color = "var(--danger)";
  const exp = el("button", "btn ghost", "导出 CSV");
  open.onclick = async () => { try { await API.teacherSigninOpen(c.id); toast("签到已开启"); renderTeacherSignin(v, c); } catch (e) { toast(e.message); } };
  close.onclick = async () => { try { await API.teacherSigninClose(c.id); toast("签到已关闭"); renderTeacherSignin(v, c); } catch (e) { toast(e.message); } };
  exp.onclick = () => { try { API.teacherSigninExport(c.id); } catch (e) { toast(e.message); } };
  bar.appendChild(open); bar.appendChild(close); bar.appendChild(exp);
  v.appendChild(bar);
  v.appendChild(el("div", "muted2", data.session_open ? "当前签到进行中" : "当前未开启签到"));

  if (!data.students.length) { v.appendChild(el("div", "muted2", "暂无学生。")); return; }
  const rows = data.students.map((s) => [
    esc(s.username), esc(s.name), esc(s.klass || ""),
    '<span class="badge ' + (s.signed ? "green" : "gray") + '">' + (s.signed ? "已签到" : "未签到") + "</span>",
    esc(s.time || "—"),
  ]);
  const table = el("div");
  table.innerHTML = tTable(["学号", "姓名", "班级", "状态", "签到时间"], rows);
  v.appendChild(table);
}

/* ---------------- Tab: 公告 ---------------- */
async function renderTeacherAnnouncements(v, c) {
  v.innerHTML = '<div class="muted2">加载中…</div>';
  let list = TeacherCache.announcements[c.id];
  if (!list) {
    try { list = await API.teacherAnnouncements(c.id); TeacherCache.announcements[c.id] = list; }
    catch (e) { v.innerHTML = '<div class="card" style="color:var(--danger)">' + esc(e.message) + "</div>"; return; }
  }
  v.innerHTML = "";
  const bar = el("div", "t-toolbar");
  const add = el("button", "btn", "＋ 发布新公告");
  add.onclick = () => toggleAnnForm(v, c, null);
  bar.appendChild(add);
  v.appendChild(bar);
  const host = el("div"); host.id = "annForm"; v.appendChild(host);

  if (!list.length) { v.appendChild(el("div", "muted2", "暂无公告。")); return; }
  list.forEach((a) => {
    const card = el("div", "t-section");
    const top = el("div");
    top.style.display = "flex"; top.style.justifyContent = "space-between"; top.style.alignItems = "center";
    top.innerHTML = "<div><b>" + esc(a.title) + "</b> <span class=\"muted2\">" + esc(a.created_at || "") + "</span></div>";
    const right = el("div"); right.style.display = "flex"; right.style.gap = "8px";
    const ed = el("button", "btn ghost", "编辑");
    ed.onclick = () => toggleAnnForm(v, c, a);
    const del = el("button", "btn ghost", "删除"); del.style.color = "var(--danger)";
    del.onclick = async () => {
      if (!confirm("删除公告《" + a.title + "》？")) return;
      try { await API.teacherDeleteAnnouncement(a.id); TeacherCache.announcements[c.id] = undefined; toast("已删除"); renderTeacherAnnouncements(v, c); }
      catch (e) { toast(e.message); }
    };
    right.appendChild(ed); right.appendChild(del);
    top.appendChild(right);
    card.appendChild(top);
    card.appendChild(el("div", null, a.content || ""));
    v.appendChild(card);
  });
}

function toggleAnnForm(v, c, ann) {
  const host = document.getElementById("annForm");
  if (!host) return;
  if (host._open && !ann) { host.innerHTML = ""; host._open = false; return; }
  host._open = true;
  const a = ann || {};
  host.innerHTML =
    '<div class="t-form">' +
      '<div class="full"><label>标题 *</label><input id="af_title" value="' + esc(a.title || "") + '"></div>' +
      '<div class="full"><label>内容</label><textarea id="af_content" rows="3">' + esc(a.content || "") + '</textarea></div>' +
      '<div class="full"><button class="btn" id="af_save">' + (ann ? "保存修改" : "发布") + '</button>' +
      (ann ? '<button class="btn ghost" id="af_cancel">取消</button>' : "") +
      ' <span class="muted2" id="af_msg"></span></div>' +
    '</div>';
  document.getElementById("af_save").onclick = async () => {
    const title = document.getElementById("af_title").value.trim();
    if (!title) { document.getElementById("af_msg").textContent = "请填写标题"; return; }
    const body = { title, content: document.getElementById("af_content").value.trim() };
    try {
      if (ann) await API.teacherUpdateAnnouncement(ann.id, body);
      else await API.teacherCreateAnnouncement(c.id, body);
      TeacherCache.announcements[c.id] = undefined;
      host.innerHTML = ""; host._open = false;
      toast(ann ? "已保存" : "已发布");
      renderTeacherAnnouncements(v, c);
    } catch (e) { document.getElementById("af_msg").textContent = e.message; }
  };
  const cancel = document.getElementById("af_cancel");
  if (cancel) cancel.onclick = () => { host.innerHTML = ""; host._open = false; };
}
