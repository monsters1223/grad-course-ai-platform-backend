/* =========================================================
 * api.js —— 后端数据层（研究生通识课 AI 教育平台 · 学生端）
 *
 * 作用：把页面里的"本地存储"统一替换成"调用后端接口"。
 * 所有需要连后端的地方都走这里，UI（app.js）不直接写 fetch。
 *
 * 配置：后端地址 API_BASE。
 *   - 默认本地 docker 后端 http://localhost:8000（web 服务端口）。
 *   - 部署时可在 index.html 引入本文件之前加一句：
 *       <script>window.API_BASE = "https://你的后端地址";</script>
 *     来覆盖，无需改代码。
 *   - ⚠ 跨域（前端与后端不在同一网址）时，后端需开启 CORS 允许本前端来源。
 * ========================================================= */

// 后端基地址（可被 window.API_BASE 覆盖）
// 默认策略：localhost / 127.0.0.1 回落到 http://localhost:8000（本地前后端分端口开发）；
// 其余情况（校内 IP / 域名部署）使用同源地址，由 Caddy 反向代理 /api 与 /ws 到后端，无需硬编码 IP。
const API_BASE = (window.API_BASE || (() => {
  const o = window.location.origin;
  if (o.includes("localhost") || o.includes("127.0.0.1")) return "http://localhost:8000";
  return o;
})()).replace(/\/+$/, "");

// 登录令牌（JWT）存取：令牌不是业务数据，是登录凭证，必须本地留存才能保持登录态。
const TOKEN_KEY = "grad_token";
function getToken() { try { return localStorage.getItem(TOKEN_KEY); } catch (e) { return null; } }
function setToken(t) { try { localStorage.setItem(TOKEN_KEY, t); } catch (e) {} }
function clearToken() { try { localStorage.removeItem(TOKEN_KEY); } catch (e) {} }

// 统一请求封装：自动带 JWT、解析 JSON、统一抛错。
async function apiFetch(path, opts) {
  opts = opts || {};
  const headers = {};
  const tk = getToken();
  if (tk) headers["Authorization"] = "Bearer " + tk;
  // 文件上传走 multipart/form-data：不手动设 Content-Type（让浏览器自动带 boundary），
  // 且 body 直接传 FormData，不做 JSON.stringify。
  const isForm = !!(opts && opts.isForm && opts.body instanceof FormData);
  if (!isForm) headers["Content-Type"] = "application/json";
  let res;
  try {
    res = await fetch(API_BASE + path, {
      method: opts.method || "GET",
      headers: headers,
      body: isForm ? opts.body : (opts.body ? JSON.stringify(opts.body) : undefined),
      // 关页/切后台时补报需要：允许请求在页面卸载后继续发送（且能带 JWT 鉴权头，
      // 这是 sendBeacon 做不到的）。仅上报类接口显式开启。
      keepalive: opts.keepalive === true,
    });
  } catch (e) {
    throw new Error("网络异常，无法连接后端（" + (API_BASE) + "）");
  }
  let data = null;
  try { data = await res.json(); } catch (e) { /* 无 JSON 主体 */ }
  if (res.status === 401) {
    clearToken();
    if (typeof onUnauthorized === "function") onUnauthorized();
    throw new Error("登录已过期，请重新登录");
  }
  if (!res.ok) {
    const msg = (data && (data.detail || data.message)) || ("请求失败（" + res.status + "）");
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  return data;
}

// 接口集合（与后端 routers 一一对应）
const API = {
  // 鉴权
  login: (username, password) =>
    apiFetch("/api/auth/login", { method: "POST", body: { username, password } }),
  getMe: () => apiFetch("/api/auth/me"),

  // 课堂签到
  getSignins: () => apiFetch("/api/signin/me"),
  postSignin: (course_id, method) =>
    apiFetch("/api/signin", { method: "POST", body: { course_id, method } }),

  // 作业
  getHomeworks: (cid) => apiFetch("/api/courses/" + cid + "/homeworks"),
  submitHomework: (homework_id, answer) =>
    apiFetch("/api/homeworks/submit", { method: "POST", body: { homework_id, answer } }),
  // 带附件提交：用 FormData 上传文件（isForm 标记让 apiFetch 走 multipart）
  submitHomeworkWithFile: (homework_id, answer, file) => {
    const fd = new FormData();
    fd.append("homework_id", homework_id);
    fd.append("answer", answer || "");
    if (file) fd.append("file", file);
    return apiFetch("/api/homeworks/submit-file", { method: "POST", body: fd, isForm: true });
  },

  // 课程详情（含 ai_classroom_url：已生成的 AI 课堂链接，全班复用不耗额度）
  getCourseDetail: (cid) => apiFetch("/api/courses/" + cid),

  // 课程讨论
  getDiscussions: (cid) => apiFetch("/api/courses/" + cid + "/discussions"),
  postDiscussion: (course_id, content) =>
    apiFetch("/api/discussions", { method: "POST", body: { course_id, content } }),

  // 班级群聊 WebSocket 地址（rid = 房间/课程 id；token 作为查询参数鉴权）
  chatWsUrl: (rid) => {
    const wsBase = API_BASE.replace(/^http/, "ws");
    return wsBase + "/ws/chat/" + rid + "?token=" + encodeURIComponent(getToken() || "");
  },

  // 学习小组（与后端 routers/groups.py 对应）
  getGroups: () => apiFetch("/api/groups"),
  joinGroup: (gid) => apiFetch("/api/groups/" + gid + "/join", { method: "POST" }),
  // 群聊历史消息（后端留存，进入群聊时拉取）
  getRoomMessages: (rid) => apiFetch("/api/rooms/" + rid + "/messages"),

  // 学情上报（阶段二：真实化，落到 study_logs / quiz_results）
  reportVideo: (course_id, section_index, section_title, progress, watch_seconds) =>
    apiFetch("/api/progress/video", { method: "POST", body: { course_id, section_index, section_title, progress, watch_seconds }, keepalive: true }),
  reportQuiz: (course_id, quiz_index, quiz_title, score, total) =>
    apiFetch("/api/progress/quiz", { method: "POST", body: { course_id, quiz_index, quiz_title, score, total }, keepalive: true }),

  // 学情看板（真实聚合，来自后端）
  getDashboard: () => apiFetch("/api/dashboard"),

  // AI 互动课堂（后端 routers/ai_classroom.py）
  // 注意：OpenMAIC 每码每日仅 10 次生成额度，故前端优先复用课程已缓存的 ai_classroom_url。
  generateAIClassroom: (course_id) =>
    apiFetch("/api/ai/generate", { method: "POST", body: { course_id } }),
  getAIStatus: (job_id, course_id) =>
    apiFetch("/api/ai/status/" + encodeURIComponent(job_id) + "?course_id=" + course_id),
};
