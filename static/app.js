// ===== 学生端前端逻辑（真实接口） =====
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};
const esc = (s) => String(s ?? "").replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

let TOKEN = localStorage.getItem("token") || "";
let ME = null;
let COURSES = [];
let currentCourseId = null;
let ws = null;

// ---------- API ----------
async function api(path, opts = {}) {
  opts.headers = opts.headers || {};
  if (TOKEN) opts.headers["Authorization"] = "Bearer " + TOKEN;
  if (opts.json) { opts.headers["Content-Type"] = "application/json"; opts.body = JSON.stringify(opts.json); }
  const r = await fetch(path, opts);
  if (r.status === 401) { logout(); throw new Error("未登录"); }
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.detail || "请求失败");
  return data;
}

// ---------- 登录 / 注册 ----------
function setupLoginToggles() {
  const toggle = $("#toggleReg");
  if (!toggle) return;  // 封闭账号体系：登录页无注册入口
  toggle.onclick = () => {
    const lf = $("#loginForm"), rf = $("#regForm");
    const showReg = lf.style.display === "none";
    lf.style.display = showReg ? "none" : "block";
    rf.style.display = showReg ? "block" : "none";
    $("#toggleReg").textContent = showReg ? "已有账号？去登录" : "没有账号？去注册";
  };
}
async function doLogin() {
  $("#li-err").textContent = "";
  const username = $("#li-user").value.trim();
  const password = $("#li-pass").value;
  if (!username || !password) { $("#li-err").textContent = "请输入用户名和密码"; return; }
  try {
    const d = await api("/api/auth/login", { method: "POST", json: { username, password } });
    afterAuth(d);
  } catch (e) { $("#li-err").textContent = e.message; }
}
async function doRegister() {
  $("#rg-err").textContent = "";
  const username = $("#rg-user").value.trim();
  const name = $("#rg-name").value.trim();
  const password = $("#rg-pass").value;
  if (!username || !name || !password) { $("#rg-err").textContent = "请填写完整"; return; }
  try {
    const d = await api("/api/auth/register", { method: "POST", json: { username, name, password } });
    afterAuth(d);
  } catch (e) { $("#rg-err").textContent = e.message; }
}
function afterAuth(d) {
  TOKEN = d.token; ME = d.user;
  localStorage.setItem("token", TOKEN);
  enterApp();
}
function logout() {
  TOKEN = ""; ME = null; localStorage.removeItem("token");
  if (ws) try { ws.close(); } catch (e) {}
  $("#app").style.display = "none";
  $("#login").style.display = "flex";
}

// ---------- 进入应用 ----------
function enterApp() {
  $("#login").style.display = "none";
  $("#app").style.display = "flex";
  $("#topAvatar").textContent = ME.avatar || ME.name[0];
  renderNav();
  boot();
}
function renderNav() {
  const items = [
    { id: "home", ic: "🏠", name: "首页" },
    { id: "courses", ic: "📚", name: "课程中心" },
    { id: "learn", ic: "▶️", name: "学习" },
    { id: "aichat", ic: "🤖", name: "AI 课堂" },
    { id: "homework", ic: "📝", name: "作业与测验" },
    { id: "chat", ic: "💬", name: "群聊" },
    { id: "groups", ic: "👥", name: "学习小组" },
    { id: "dashboard", ic: "📊", name: "学情看板" },
    { id: "signin", ic: "✅", name: "课堂签到" },
  ];
  const nav = $("#nav"); nav.innerHTML = "";
  items.forEach(it => {
    const a = el("div", "nav-item", `<span>${it.ic}</span><span>${it.name}</span>`);
    a.onclick = () => navigate(it.id);
    a.dataset.id = it.id;
    nav.appendChild(a);
  });
}
async function boot() {
  try { COURSES = await api("/api/courses"); if (COURSES[0]) currentCourseId = COURSES[0].id; }
  catch (e) { COURSES = []; }
  navigate("home");
}
function navigate(page) {
  $$(".nav-item").forEach(n => n.classList.toggle("active", n.dataset.id === page));
  const v = $("#view"); v.innerHTML = "";
  ({ home, courses, learn, aichat, homework, chat, groups, dashboard, signin }[page] || home)(v);
}

// ---------- 首页 ----------
async function home(v) {
  v.appendChild(el("h1", null, `你好，${esc(ME.name)} 👋`));
  v.appendChild(el("p", "h-sub", "继续你的通识课学习之旅"));
  // AI banner
  const banner = el("div", "ai-banner",
    `<div><b style="font-size:16px">🤖 AI 课堂 · 接入 OpenMAIC 多智能体</b>
     <p>有问题随时问 AI 助教，支持来源引用。先选一门课再开始提问效果更好。</p></div>
     <button class="btn ai" onclick="navigate('aichat')">进入 AI 课堂</button>`);
  v.appendChild(banner);
  // 统计
  let stats = {};
  try { stats = await api("/api/dashboard"); } catch (e) {}
  const grid = el("div", "stat-grid");
  const cards = [
    { n: stats.study_hours ?? 0, l: "本周学习时长(h)", to: "dashboard" },
    { n: stats.streak_days ?? 0, l: "签到次数", to: "signin" },
    { n: (COURSES || []).length, l: "进行中课程", to: "courses" },
    { n: stats.submission_count ?? 0, l: "已交作业", to: "homework" },
  ];
  cards.forEach(c => {
    const s = el("div", "stat", `<div class="ic" style="background:var(--primary-soft)">📌</div>
      <div class="num">${c.n}</div><div class="lbl">${c.l}</div>`);
    s.style.cursor = "pointer"; s.onclick = () => navigate(c.to);
    grid.appendChild(s);
  });
  v.appendChild(grid);
  // 我的课程
  v.appendChild(el("h3", "mt", "我的课程"));
  const list = el("div", "course-grid");
  (COURSES || []).forEach(c => list.appendChild(courseCard(c)));
  v.appendChild(list);
}

function courseCard(c) {
  const card = el("div", "course-card");
  card.innerHTML = `<div class="course-cover">${c.cover || "📘"}</div>
    <div class="course-body">
      <div class="course-meta">${esc(c.category)} · ${esc(c.teacher)}</div>
      <b>${esc(c.title)}</b>
      <div class="progress" style="margin:10px 0 6px"><span style="width:${c.progress || 0}%"></span></div>
      <div class="muted" style="font-size:12px">进度 ${c.progress || 0}%</div>
    </div>`;
  card.style.cursor = "pointer";
  card.onclick = () => { currentCourseId = c.id; navigate("learn"); };
  return card;
}

// ---------- 课程中心 ----------
function courses(v) {
  v.appendChild(el("h1", null, "课程中心"));
  v.appendChild(el("p", "h-sub", "选择课程开始学习"));
  const grid = el("div", "course-grid");
  (COURSES || []).forEach(c => grid.appendChild(courseCard(c)));
  v.appendChild(grid);
}

// ---------- 学习页 ----------
async function learn(v) {
  if (!currentCourseId) { v.appendChild(el("p", null, "请先在课程中心选择一门课。")); return; }
  let detail;
  try { detail = await api("/api/courses/" + currentCourseId); }
  catch (e) { v.appendChild(el("p", null, "课程加载失败")); return; }
  v.appendChild(el("h1", null, esc(detail.title)));
  v.appendChild(el("p", "h-sub", `${esc(detail.category)} · ${esc(detail.teacher)}`));

  // 空课程占位：老师暂未上传数据
  if (!detail.sections || detail.sections.length === 0) {
    const empty = el("div", "card");
    empty.innerHTML = `<div style="text-align:center;padding:48px 24px">
      <div style="font-size:56px;margin-bottom:14px">📭</div>
      <h2 style="color:#3b4260;margin:0 0 10px">老师暂未上传数据</h2>
      <p class="muted">该课程的视频、资料与测验尚未发布，请等待教师上传后再学习。</p>
    </div>`;
    v.appendChild(empty);
    return;
  }

  // tabs
  const tabs = el("div", "learn-tabs");
  ["video", "discussion", "materials", "quiz"].forEach((t, i) => {
    const b = el("button", i === 0 ? "active" : "", { video: "视频", discussion: "课程讨论", materials: "资料", quiz: "章节测验" }[t]);
    b.onclick = () => { $$(".learn-tabs button", v).forEach(x => x.classList.remove("active")); b.classList.add("active"); renderLearnTab(v, detail, t); };
    tabs.appendChild(b);
  });
  v.appendChild(tabs);
  const panel = el("div", "learn-panel"); v.appendChild(panel);
  renderLearnTab(panel, detail, "video");
}
function renderLearnTab(panel, detail, tab) {
  panel.innerHTML = "";
  if (tab === "video") {
    const vids = detail.sections.filter(s => s.stype === "video");
    const box = el("div", "video");
    const video = el("video");
    video.controls = true;
    video.style.width = "100%";
    video.style.borderRadius = "12px";
    video.style.background = "#000";
    video.style.maxHeight = "420px";
    if (vids[0]) video.src = vids[0].content;
    box.appendChild(video);
    panel.appendChild(box);
    const chap = el("div", "chapter");
    chap.appendChild(el("div", "ch", "章节列表（点击切换）"));
    vids.forEach((s, i) => {
      const it = el("div", "item" + (i === 0 ? " active" : ""), `▶ ${esc(s.title)}`);
      it.onclick = () => {
        $$(".item", chap).forEach(x => x.classList.remove("active"));
        it.classList.add("active");
        video.src = s.content;
        video.play().catch(() => {});
      };
      chap.appendChild(it);
    });
    panel.appendChild(chap);
  } else if (tab === "discussion") {
    renderDiscussion(panel, detail.id);
  } else if (tab === "materials") {
    const docs = detail.sections.filter(s => s.stype === "doc");
    if (!docs.length) { panel.appendChild(el("p", "muted", "暂无资料")); }
    docs.forEach(d => {
      const card = el("div", "card");
      card.appendChild(el("div", null, `<b>${esc(d.title)}</b>`));
      const a = el("a", "btn ghost", "📎 打开 / 下载资料");
      a.href = d.content; a.target = "_blank"; a.rel = "noopener";
      card.appendChild(a);
      panel.appendChild(card);
    });
  } else {
    const quizzes = detail.sections.filter(s => s.stype === "quiz");
    quizzes.forEach(q => panel.appendChild(el("div", "card", `<b>${esc(q.title)}</b><p class="muted">${esc(q.content)}</p>`)));
    if (!quizzes.length) panel.appendChild(el("p", "muted", "暂无测验"));
  }
}
async function renderDiscussion(panel, cid) {
  let list = [];
  try { list = await api("/api/courses/" + cid + "/discussions"); } catch (e) {}
  const wrap = el("div");
  list.forEach(d => wrap.appendChild(el("div", "list-item",
    `<div class="li-ic" style="background:var(--ai-soft)">${esc(d.avatar)}</div>
     <div class="li-body"><b>${esc(d.user)}</b><p>${esc(d.content)}</p>
     <span class="muted" style="font-size:11px">${esc(d.created_at)}</span></div>`)));
  panel.appendChild(wrap);
  const box = el("div", "chat-input");
  const inp = el("input"); inp.placeholder = "发起课程讨论…";
  const btn = el("button", "btn", "发送");
  btn.onclick = async () => {
    if (!inp.value.trim()) return;
    await api("/api/discussions", { method: "POST", json: { course_id: cid, content: inp.value.trim() } });
    inp.value = ""; renderDiscussion(panel, cid);
  };
  box.append(inp, btn); panel.appendChild(box);
}

// ---------- AI 课堂（接入 OpenMAIC 互动课堂）----------
function aichat(v) {
  v.appendChild(el("h1", null, "🤖 AI 互动课堂"));
  v.appendChild(el("p", "h-sub", "由 OpenMAIC 多智能体生成可交互课堂（幻灯片 / 测验 / 实验 / 白板）"));
  if (!currentCourseId) { v.appendChild(el("p", null, "请先在「课程中心」选择一门课。")); return; }
  const course = (COURSES || []).find(c => c.id === currentCourseId);
  const wrap = el("div");
  v.appendChild(wrap);

  const renderClassroom = (url) => {
    wrap.innerHTML = "";
    wrap.appendChild(el("div", "ai-banner",
      `<b>✅ 已生成 AI 互动课堂</b><p>这是 OpenMAIC 多智能体为你生成的互动课堂（幻灯片 / 测验 / 实验 / 白板）。点击下方按钮在新窗口打开体验。</p>`));
    const link = el("a", "btn ai", "🔗 在新窗口打开课堂（点击体验）");
    link.href = url; link.target = "_blank"; link.rel = "noopener";
    wrap.appendChild(link);
    const note = el("div", "muted", "说明：open.maic.chat 出于安全策略禁止跨站 iframe 嵌入，因此课堂会在新标签页打开（这是平台方限制，非本系统问题）。");
    note.style.marginTop = "10px";
    wrap.appendChild(note);
  };

  const renderGenerator = () => {
    wrap.innerHTML = "";
    const box = el("div", "card");
    box.innerHTML = `<b>为《${esc(course ? course.title : "本课程")}》生成 AI 互动课堂</b>
      <p class="muted">点击后将在 OpenMAIC 云端生成一堂多智能体互动课（约几分钟）。生成完成后可直接在本页观看，或导出。</p>`;
    const btn = el("button", "btn ai", "🚀 生成 AI 互动课堂");
    const status = el("div", "muted"); status.style.marginTop = "10px";
    btn.onclick = async () => {
      btn.disabled = true; btn.textContent = "提交中…";
      try {
        const g = await api("/api/ai/generate", { method: "POST", json: { course_id: currentCourseId } });
        const jobId = g.jobId;
        btn.textContent = "生成中…（请稍候，可保持本页）";
        status.textContent = "课堂生成中，预计需数分钟，完成后自动载入…";
        const timer = setInterval(async () => {
          try {
            const s = await api(`/api/ai/status/${jobId}?course_id=${currentCourseId}`);
            if (s.status === "completed" || s.status === "succeeded" || s.status === "done") {
              clearInterval(timer);
              if (s.url) { if (course) course.ai_classroom_url = s.url; renderClassroom(s.url); }
              else { status.textContent = "已生成，但未返回链接，请刷新页面重试。"; btn.disabled = false; btn.textContent = "🚀 重新生成"; }
            } else if (s.status === "failed") {
              clearInterval(timer); status.textContent = "生成失败，请重试。"; btn.disabled = false; btn.textContent = "🚀 重新生成";
            }
          } catch (e) {
            clearInterval(timer); status.textContent = "轮询出错：" + e.message; btn.disabled = false; btn.textContent = "🚀 重新生成";
          }
        }, 8000);
      } catch (e) {
        btn.disabled = false; btn.textContent = "🚀 生成 AI 互动课堂";
        status.textContent = "出错：" + e.message;
      }
    };
    box.append(btn, status);
    wrap.appendChild(box);
  };

  if (course && course.ai_classroom_url) renderClassroom(course.ai_classroom_url);
  else renderGenerator();
}

// ---------- 作业与测验 ----------
async function homework(v) {
  v.appendChild(el("h1", null, "作业与测验"));
  const sel = el("select", "field"); sel.style.margin = "0 0 14px";
  COURSES.forEach(c => { const o = el("option", null, c.title); o.value = c.id; sel.appendChild(o); });
  if (currentCourseId) sel.value = currentCourseId;
  v.appendChild(sel);
  const list = el("div"); v.appendChild(list);
  const load = async () => {
    list.innerHTML = "";
    let hws = [];
    try { hws = await api("/api/courses/" + sel.value + "/homeworks"); } catch (e) {}
    if (!hws.length) { list.appendChild(el("p", "muted", "该课程暂无作业")); return; }
    hws.forEach(h => {
      const item = el("div", "card", `<b>${esc(h.title)}</b>
        <p class="muted">${esc(h.desc || "")}</p>
        <div class="muted" style="font-size:12px">截止：${esc(h.due || "未设置")} · 状态：${h.submitted ? "已提交" + (h.score ? "（" + esc(h.score) + "）" : "") : "未提交"}</div>`);
      const btn = el("button", "btn ghost", h.submitted ? "重新提交" : "提交作业");
      const ta = el("textarea", "note"); ta.placeholder = "输入作答内容…";
      btn.onclick = async () => { await api("/api/homeworks/submit", { method: "POST", json: { homework_id: h.id, answer: ta.value } }); btn.textContent = "已提交 ✓"; };
      item.append(ta, btn); list.appendChild(item);
    });
  };
  sel.onchange = load; await load();
}

// ---------- 群聊 ----------
async function chat(v) {
  v.appendChild(el("h1", null, "群聊"));
  const wrap = el("div", "chat-layout");
  const left = el("div", "group-list");
  const right = el("div", "chat-main");
  wrap.append(left, right); v.appendChild(wrap);
  let rooms = [];
  try { rooms = await api("/api/rooms"); } catch (e) {}
  if (!rooms.length) { left.appendChild(el("p", "muted", "暂无群聊")); }
  rooms.forEach((r, i) => {
    const g = el("div", "g" + (i === 0 ? " active" : ""),
      `<div class="g-ava ${r.rtype === "class" ? "" : "warm"}">${r.rtype === "class" ? "👥" : "⭐"}</div>
       <div class="li-body"><b>${esc(r.name)}</b><p>${esc(r.last || "还没有消息")}</p></div>`);
    g.onclick = () => { $$(".g", left).forEach(x => x.classList.remove("active")); g.classList.add("active"); openRoom(right, r.id, r.name); };
    left.appendChild(g);
  });
  if (rooms[0]) openRoom(right, rooms[0].id, rooms[0].name);
}
async function openRoom(right, rid, name) {
  right.innerHTML = "";
  const head = el("div", "chat-head", `💬 ${esc(name)}`);
  const box = el("div", "chat-box");
  const msgs = el("div", "chat-msgs"); msgs.style.flex = "1"; msgs.style.overflow = "auto"; msgs.style.padding = "16px";
  box.appendChild(msgs);
  right.append(head, box);
  let history = [];
  try { history = await api("/api/rooms/" + rid + "/messages"); } catch (e) {}
  history.forEach(m => msgs.appendChild(msgBubble(m)));
  // WS
  if (ws) try { ws.close(); } catch (e) {}
  ws = new WebSocket(`ws://${location.host}/ws/chat/${rid}?token=${TOKEN}`);
  ws.onmessage = (ev) => { const m = JSON.parse(ev.data); msgs.appendChild(msgBubble(m)); msgs.scrollTop = msgs.scrollHeight; };
  const input = el("div", "chat-input");
  const inp = el("input"); inp.placeholder = "输入消息，回车发送…";
  const send = (mtype, content) => {
    if (ws && ws.readyState === 1) ws.send(JSON.stringify({ mtype, content }));
    else msgs.appendChild(msgBubble({ user: ME.name, avatar: ME.avatar, mtype, content }));
  };
  inp.onkeydown = (e) => { if (e.key === "Enter") { send("text", inp.value); inp.value = ""; } };
  const btn = el("button", "btn", "发送");
  btn.onclick = () => { send("text", inp.value); inp.value = ""; };
  const imgBtn = el("button", "btn ghost", "🖼️"); imgBtn.onclick = () => send("image", "📷 图片 example.png");
  const fileBtn = el("button", "btn ghost", "📎"); fileBtn.onclick = () => send("file", "📄 文件 report.pdf");
  input.append(imgBtn, fileBtn, inp, btn);
  right.appendChild(input);
}
function msgBubble(m) {
  const cls = m.user === ME.name ? "msg me" : "msg";
  const inner = m.mtype === "image" ? "🖼️ " + esc(m.content)
    : m.mtype === "file" ? "📎 " + esc(m.content) : esc(m.content);
  const e = el("div", cls, `<div style="font-size:11px;opacity:.7;margin-bottom:2px">${esc(m.user)}</div>${inner}`);
  return e;
}

// ---------- 学习小组 ----------
async function groups(v) {
  v.appendChild(el("h1", null, "学习小组"));
  v.appendChild(el("p", "h-sub", "由同学自主发起，可公开加入或私密邀请"));
  let glist = [];
  try { glist = await api("/api/groups"); } catch (e) {}
  const grid = el("div", "course-grid");
  glist.forEach(g => {
    const card = el("div", "course-card");
    card.innerHTML = `<div class="course-cover">⭐</div><div class="course-body">
      <div class="course-meta">${g.visibility === "public" ? "公开" : "私密"} · ${g.members} 人</div>
      <b>${esc(g.name)}</b><p class="muted">${esc(g.desc || "")}</p></div>`;
    card.style.cursor = "pointer";
    card.onclick = async () => { await api("/api/groups/" + g.id + "/join", { method: "POST" }); alert("已加入「" + g.name + "」，可在群聊中查看"); };
    grid.appendChild(card);
  });
  v.appendChild(grid);
  // 发起
  const form = el("div", "card");
  form.innerHTML = `<b>发起学习小组</b>`;
  const nameI = el("input", "field"); nameI.placeholder = "小组名称";
  const descI = el("input", "field"); descI.placeholder = "小组目标（选填）";
  const btn = el("button", "btn ai", "创建并建群");
  btn.onclick = async () => {
    if (!nameI.value.trim()) return;
    await api("/api/groups", { method: "POST", json: { name: nameI.value.trim(), course_id: currentCourseId, visibility: "public", desc: descI.value.trim() } });
    btn.textContent = "已创建 ✓"; groups(v);
  };
  form.append(nameI, descI, btn); v.appendChild(form);
}

// ---------- 学情看板 ----------
async function dashboard(v) {
  v.appendChild(el("h1", null, "学情看板"));
  let s = {};
  try { s = await api("/api/dashboard"); } catch (e) {}
  const grid = el("div", "stat-grid");
  [["总课程数", s.total_courses], ["签到次数", s.signin_count], ["提交作业", s.submission_count], ["平均成绩", s.avg_score], ["学习时长(h)", s.study_hours]].forEach(([l, n]) => {
    grid.appendChild(el("div", "stat", `<div class="ic" style="background:var(--ai-soft)">📊</div><div class="num">${n ?? 0}</div><div class="lbl">${l}</div>`));
  });
  v.appendChild(grid);
  // 签到记录
  v.appendChild(el("h3", "mt", "我的签到记录"));
  let recs = [];
  try { recs = await api("/api/signin/me"); } catch (e) {}
  const t = el("table", "tbl");
  t.innerHTML = `<tr><th>时间</th><th>方式</th><th>状态</th></tr>` + recs.map(r => `<tr><td>${esc(r.created_at)}</td><td>${esc(r.method)}</td><td>${esc(r.status)}</td></tr>`).join("");
  v.appendChild(t);
}

// ---------- 课堂签到 ----------
async function signin(v) {
  v.appendChild(el("h1", null, "课堂签到"));
  const sel = el("select", "field"); sel.style.margin = "0 0 14px";
  COURSES.forEach(c => { const o = el("option", null, c.title); o.value = c.id; sel.appendChild(o); });
  if (currentCourseId) sel.value = currentCourseId;
  v.appendChild(sel);
  const methods = [
    { m: "location", ic: "📍", name: "定位签到", desc: "获取当前位置，确认在校内范围内" },
    { m: "gesture", ic: "✍️", name: "手势签到", desc: "在框内画出指定手势图案" },
    { m: "photo", ic: "📷", name: "拍照签到", desc: "拍摄本人照片完成核验" },
    { m: "qr", ic: "🔳", name: "扫码签到", desc: "扫描课堂二维码" },
  ];
  const grid = el("div", "course-grid");
  methods.forEach(me => {
    const card = el("div", "course-card signin-card");
    card.innerHTML = `<div class="course-cover">${me.ic}</div><div class="course-body">
      <b>${me.name}</b><p>${me.desc}</p></div>`;
    card.style.cursor = "pointer";
    card.onclick = async () => {
      const r = await api("/api/signin", { method: "POST", json: { course_id: Number(sel.value), method: me.m } });
      card.innerHTML = `<div class="course-cover">✅</div><div class="course-body"><div class="sp-done">签到成功（${me.name}）<br>${esc(r.time)}</div></div>`;
    };
    grid.appendChild(card);
  });
  v.appendChild(grid);
}

// ---------- 启动 ----------
setupLoginToggles();
if (TOKEN) {
  api("/api/auth/me").then(d => { ME = d; enterApp(); boot(); })
    .catch(() => { TOKEN = ""; localStorage.removeItem("token"); });
}
