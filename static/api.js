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
// 默认同源相对路径：本平台后端同时托管前端静态页与 /api、/ws 接口，前端与接口永远同 origin，
// 因此默认用相对路径（空字符串）即可，避免无谓的跨域跳转（如 127.0.0.1 ↔ localhost 会被浏览器判为跨域）。
// 仅在「前端与后端分属不同域」的开发场景下，于 index.html 引入本文件前设置 window.API_BASE。
const API_BASE = (window.API_BASE || "").replace(/\/+$/, "");

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
  // 改密：账号是管理员/教师下发的，学生首次登录后可自行修改
  changePassword: (oldPwd, newPwd) =>
    apiFetch("/api/auth/change-password", { method: "POST", body: { old: oldPwd, new: newPwd } }),

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

  // 课程列表（课程中心数据源，替代 data.js 硬编码；失败回退静态 COURSES）
  getCourses: () => apiFetch("/api/courses"),

  // 课程详情（含 sections、章节测验题目（不含答案）、homeworks）
  getCourseDetail: (cid) => apiFetch("/api/courses/" + cid),

  // 测验：查询当前用户是否已提交（含解析回显数据）
  getQuizResult: (sectionId) => apiFetch("/api/quizzes/" + sectionId + "/result"),
  // 测验：提交作答，由服务端判分（答案只在数据库，前端无法伪造）
  submitQuiz: (sectionId, answers) =>
    apiFetch("/api/quizzes/" + sectionId + "/submit", { method: "POST", body: { answers } }),

  // 课程讨论
  getDiscussions: (cid) => apiFetch("/api/courses/" + cid + "/discussions"),
  postDiscussion: (course_id, content) =>
    apiFetch("/api/discussions", { method: "POST", body: { course_id, content } }),

  // 班级群聊 WebSocket 地址（rid = 房间/课程 id；token 作为查询参数鉴权）
  chatWsUrl: (rid) => {
    const wsBase = API_BASE
      ? API_BASE.replace(/^http/, "ws")
      : (location.protocol.replace("http", "ws") + "//" + location.host);
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

  // ===================== 站内通知（教师端 ↔ 学生端 交互通道） =====================
  // 教师发布公告 / 布置作业 / 开启签到 / 批改作业 → 学生端铃铛；学生交作业 / 发讨论 → 教师端铃铛。
  getNotifications: (limit) =>
    apiFetch("/api/notifications?limit=" + (limit || 30)),
  getNotifSummary: () => apiFetch("/api/notifications/summary"),
  readNotification: (nid) => apiFetch("/api/notifications/" + nid + "/read", { method: "POST" }),
  readAllNotifications: () => apiFetch("/api/notifications/read-all", { method: "POST" }),
  deleteNotification: (nid) => apiFetch("/api/notifications/" + nid, { method: "DELETE" }),
  clearReadNotifications: () => apiFetch("/api/notifications", { method: "DELETE" }),

  // 学生端课程公告（教师端发布内容的阅读入口）
  getAnnouncements: (cid) => apiFetch("/api/courses/" + cid + "/announcements"),

  // ===================== 教师端（routers/teacher.py） =====================
  // 课程
  teacherCourses: () => apiFetch("/api/teacher/courses"),
  teacherCreateCourse: (body) => apiFetch("/api/teacher/courses", { method: "POST", body }),
  teacherUpdateCourse: (cid, body) => apiFetch("/api/teacher/courses/" + cid, { method: "PUT", body }),
  teacherDeleteCourse: (cid) => apiFetch("/api/teacher/courses/" + cid, { method: "DELETE" }),

  // 章节
  teacherSections: (cid) => apiFetch("/api/teacher/courses/" + cid + "/sections"),
  teacherAddSection: (cid, body) => apiFetch("/api/teacher/courses/" + cid + "/sections", { method: "POST", body }),
  teacherUpdateSection: (sid, body) => apiFetch("/api/teacher/sections/" + sid, { method: "PUT", body }),
  teacherDeleteSection: (sid) => apiFetch("/api/teacher/sections/" + sid, { method: "DELETE" }),

  // 文件上传（章节资料）：返回 { url, name }
  teacherUpload: (file) => {
    const fd = new FormData();
    fd.append("file", file);
    return apiFetch("/api/teacher/upload", { method: "POST", body: fd, isForm: true });
  },

  // 学生名单
  teacherStudents: (cid) => apiFetch("/api/teacher/courses/" + cid + "/students"),
  teacherAddStudent: (body) => apiFetch("/api/teacher/students", { method: "POST", body }),
  teacherRemoveStudent: (cid, uid) => apiFetch("/api/teacher/courses/" + cid + "/students/" + uid, { method: "DELETE" }),
  teacherImportStudents: (file, cid) => {
    const fd = new FormData();
    fd.append("file", file);
    // 带上当前课程 id：表里没写课程代码/名称时，直接导入到这门课
    if (cid) fd.append("course_id", cid);
    return apiFetch("/api/teacher/students/import", { method: "POST", body: fd, isForm: true });
  },
  teacherDownloadTemplate: (cid) =>
    apiDownload("/api/teacher/students/template" + (cid ? "?cid=" + cid : ""), "student_template.xlsx"),

  // 作业批改
  teacherHomeworks: (cid) => apiFetch("/api/teacher/courses/" + cid + "/homeworks"),
  teacherSubmissions: (hid, status) =>
    apiFetch("/api/teacher/homeworks/" + hid + "/submissions" + (status ? ("?status=" + encodeURIComponent(status)) : "")),
  teacherGrade: (hid, sid, body) =>
    apiFetch("/api/teacher/homework/" + hid + "/submissions/" + sid + "/grade", { method: "POST", body }),

  // 作业布置（create / update / delete）
  teacherCreateHomework: (cid, body) =>
    apiFetch("/api/teacher/courses/" + cid + "/homeworks", { method: "POST", body }),
  teacherUpdateHomework: (hid, body) =>
    apiFetch("/api/teacher/homeworks/" + hid, { method: "PUT", body }),
  teacherDeleteHomework: (hid) =>
    apiFetch("/api/teacher/homeworks/" + hid, { method: "DELETE" }),

  // 测验出题（章节题库增删改查）
  teacherQuestions: (sid) => apiFetch("/api/teacher/sections/" + sid + "/questions"),
  teacherAddQuestion: (sid, body) =>
    apiFetch("/api/teacher/sections/" + sid + "/questions", { method: "POST", body }),
  teacherUpdateQuestion: (qid, body) =>
    apiFetch("/api/teacher/questions/" + qid, { method: "PUT", body }),
  teacherDeleteQuestion: (qid) =>
    apiFetch("/api/teacher/questions/" + qid, { method: "DELETE" }),

  // 学情看板
  teacherDashboard: (cid) => apiFetch("/api/teacher/courses/" + cid + "/dashboard"),

  // 签到
  teacherSigninOpen: (cid) => apiFetch("/api/teacher/courses/" + cid + "/signin/open", { method: "POST" }),
  teacherSigninClose: (cid) => apiFetch("/api/teacher/courses/" + cid + "/signin/close", { method: "POST" }),
  teacherSigninList: (cid) => apiFetch("/api/teacher/courses/" + cid + "/signin/list"),
  teacherSigninExport: (cid) => apiDownload("/api/teacher/courses/" + cid + "/signin/export", "signin_" + cid + ".csv"),

  // 公告
  teacherAnnouncements: (cid) => apiFetch("/api/teacher/courses/" + cid + "/announcements"),
  teacherCreateAnnouncement: (cid, body) => apiFetch("/api/teacher/courses/" + cid + "/announcements", { method: "POST", body }),
  teacherUpdateAnnouncement: (aid, body) => apiFetch("/api/teacher/announcements/" + aid, { method: "PUT", body }),
  teacherDeleteAnnouncement: (aid) => apiFetch("/api/teacher/announcements/" + aid, { method: "DELETE" }),
};

// 带鉴权的文件下载（模板 / 签到 CSV 等）：拉取二进制并触发浏览器下载
async function apiDownload(path, filename) {
  const tk = getToken();
  const res = await fetch(API_BASE + path, { headers: tk ? { Authorization: "Bearer " + tk } : {} });
  if (!res.ok) throw new Error("下载失败（" + res.status + "）");
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
