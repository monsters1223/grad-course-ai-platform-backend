/* =========================================================
   内嵌数据（静态展示版 · 无后端）
   说明：本文件把"后端接口返回的数据"直接写死在前端，
   因此部署到 GitHub Pages 后无需任何服务器即可运行。
   如需修改课程/资料，改这里即可。
   ========================================================= */

// 可登录的学生账号（演示用）。密码以 SHA-256 哈希存储（前端演示级防护，非服务端安全）。
// 原下发密码 123456 -> 8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92
const USERS = [
  { username: "2023110001", password: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", name: "陈嘉禾", studentId: "2023110001", major: "人工智能学院" },
  { username: "2023110002", password: "8d969eef6ecad3c29a3a629280e686cf0c3f5d5a86aff3ca12020c923adc6c92", name: "林深夜", studentId: "2023110002", major: "计算机学院" },
];

// AI 互动课堂（多智能体）稳定入口
// 说明：原先写死的 classroom/GEFSFOgzV6 是一次性生成的课堂，会话失效后会一直转圈；
//       这里改为指向 OpenMAIC 官网稳定入口，点击即可进入多智能体课堂，不会再卡死。
const AI_CLASSROOM_URL = "https://open.maic.chat/";

// =========================================================
// AI 助教「固定话术」知识库（静态演示版 · 无后端 · 不接大模型）
// ---------------------------------------------------------
// 说明：当前为前端演示阶段，AI 助教按关键词匹配下方预设答案进行回复，
//       不调用任何外部接口、不跳转、不转圈。等后续接入后端/大模型时，
//       只需把 app.js 中 getAIReply 的匹配逻辑替换为真实模型调用即可。
// =========================================================
const AI_REPLIES = [
  {
    keys: ["引用", "参考文献", "脚注", "尾注", "标注", "citation", "reference"],
    answer: "关于引用与参考文献：课程要求使用 GB/T 7714 规范。直接引用需加引号并标注页码；间接引用（转述）也要注明来源作者与年份。建议用 Zotero / 知网导出功能统一管理，避免格式混乱和漏引。需要我帮你核对某一段的引用格式吗？"
  },
  {
    keys: ["直接引用", "间接引用", "转述", "改写", "paraphrase"],
    answer: "直接引用与间接引用的区别：① 直接引用——原样摘录他人表述，必须加引号并标注出处与页码，用于关键定义或权威论断；② 间接引用（转述）——用自己的话重述他人观点，同样必须注明来源（作者、年份），但不用引号。无论哪种，漏标来源都可能构成学术不端。"
  },
  {
    keys: ["查重", "重复率", "抄袭", "学术不端", "诚信", "剽窃", "伪造"],
    answer: "关于学术诚信与查重：学校查重主要比对已发表文献与往届论文。避免不端的关键——所有借鉴都要规范引用；直接复制不加引号即抄袭；自我抄袭（大量复用自己已发表内容未说明）同样需标注。建议初稿完成后先自行查重再提交。"
  },
  {
    keys: ["文献综述", "综述", "literature", "调研", "研究空白"],
    answer: "文献综述不是罗列文献，而是「对话」：先按主题/方法归类，再指出研究空白与争议，最后说明你的研究如何承接。建议用表格梳理「作者—方法—结论—局限」，再据此写述评。需要综述模板我可以整理给你。"
  },
  {
    keys: ["摘要", "结论", "论文结构", "大纲", "框架", "开题", "选题"],
    answer: "论文基本结构：摘要（200–300字，含目的/方法/结果/结论）→ 引言（研究背景与问题）→ 文献综述 → 方法 → 结果与讨论 → 结论与展望 → 参考文献。摘要要独立成篇，避免出现「本文认为」这类空泛评价。"
  },
  {
    keys: ["数据", "python", "pandas", "可视化", "图表", "统计", "回归", "模型", "机器学习"],
    answer: "数据科学方向：清洗（去重/缺失值处理）→ 探索性分析（描述统计+可视化）→ 建模（回归/分类/聚类）→ 评估。Python 常用 pandas + matplotlib/seaborn。作图时务必标注坐标轴、单位与图例，避免误导读者。需要示例代码我可以整理。"
  },
  {
    keys: ["伦理", "责任", "隐私", "安全", "道德", "伦理审查", "irb", "举报", "whistleblowing"],
    answer: "工程伦理核心：公众安全优先于商业利益；对用户隐私与数据尽职保护；发现重大风险时有责任向上报告甚至公开（whistleblowing）。涉及人的研究须过伦理审查（IRB）。遇到伦理两难，可用「利益相关方—后果—原则」三步框架分析。"
  },
  {
    keys: ["作业", "提交", "截止", "ddl", "deadline", "交", "批阅"],
    answer: "作业提交：在「课程中心 → 对应课程 → 作业」中上传，注意截止时间（系统以服务器时间为准，建议提前半天提交以防网络问题）。逾期一般需向教师申请补交。提交后可在学情看板查看批阅状态。"
  },
  {
    keys: ["视频", "看不了", "播放", "网课", "上课", "课件"],
    answer: "课程视频：标「教师已上传」的可直接点击观看；显示「教师未上传」的章节暂未开放，可先看下方推荐视频自学。视频默认不自动播放，需手动点击；遇到卡顿可切换清晰度或刷新页面。"
  },
  {
    keys: ["签到", "考勤", "打卡"],
    answer: "签到：进入课程后点击「签到」按钮，在教师设定的时间窗口内完成即可，逾期不可补。签到记录会汇入学情看板，作为平时成绩参考之一。"
  },
  {
    keys: ["测验", "考试", "答题", "分数", "答案", "解析"],
    answer: "测验：在课程「测验」栏目进行，提交后即时显示得分与解析（未作答的题目不显示答案，避免泄漏）。可「重新测验」巩固。成绩计入平时分，请独立完成。"
  },
  {
    keys: ["讨论", "发帖", "回复", "论坛", "话题"],
    answer: "课程讨论区：可发帖提问或参与话题，AI 助教与同学都会看到。提问前建议先搜索是否已有类似问题。友善、具体的问题更容易得到高质量回复。"
  },
  {
    keys: ["平台", "登录", "账号", "密码", "用不了", "报错", "bug", "卡", "刷新"],
    answer: "平台使用问题：确认账号密码正确（演示账号见登录页提示）；登录状态保存在本机浏览器，清除缓存会退出。若页面异常，尝试刷新或清理浏览器缓存。其他问题可联系课程助教。"
  },
  {
    keys: ["你好", "您好", "hi", "hello", "在吗", "哈喽", "嗨"],
    answer: "你好！我是本课程的 AI 助教（演示版），可以回答关于课程内容、作业、视频、签到、测验等方面的问题。你现在最想了解哪一块呢？"
  },
];

// 兜底回复（未命中任何关键词时）
const AI_FALLBACK = "我是本课程的 AI 助教（当前为演示版，使用预设话术回答）。我可以帮你解答课程相关的基础问题，比如：学术写作规范、文献引用、数据科学方法、工程伦理，以及作业 / 视频 / 签到 / 测验的使用等。你可以换个说法，或问我更具体的问题～";

// 课程级默认推荐视频（当章节没有单独配置 recs 时作为兜底）
// 注意：key 必须与后端课程 id 一致（1=数据科学导论 / 2=科技伦理与人工智能 / 3=学术写作与规范）
const VIDEO_LINKS = {
  1: [
    { title: "数据科学导论（清华公开课）", url: "https://search.bilibili.com/all?keyword=数据科学导论%20清华", source: "Bilibili" },
    { title: "Python 数据分析入门", url: "https://search.bilibili.com/all?keyword=Python%20数据分析%20入门", source: "Bilibili" },
    { title: "数据可视化与故事讲述", url: "https://search.bilibili.com/all?keyword=数据可视化%20故事讲述", source: "Bilibili" },
  ],
  2: [
    { title: "工程伦理：公众安全与职业责任", url: "https://search.bilibili.com/all?keyword=工程伦理%20公众安全", source: "Bilibili" },
    { title: "自动驾驶的伦理困境", url: "https://search.bilibili.com/all?keyword=自动驾驶%20伦理困境", source: "Bilibili" },
    { title: "工程师的 whistleblowing 与社会责任", url: "https://search.bilibili.com/all?keyword=工程师%20社会责任%20举报", source: "Bilibili" },
  ],
  3: [
    { title: "学术写作入门：如何提出研究问题", url: "https://search.bilibili.com/all?keyword=学术写作%20研究问题", source: "Bilibili" },
    { title: "引用规范与学术诚信（通识讲座）", url: "https://search.bilibili.com/all?keyword=引用规范%20学术诚信", source: "Bilibili" },
    { title: "文献综述写作方法", url: "https://search.bilibili.com/all?keyword=文献综述%20写作方法", source: "Bilibili" },
  ],
};

// 课程数据（顺序与后端 seed 一致：id=1 数据科学导论 / id=2 科技伦理与人工智能 / id=3 学术写作与规范）
const COURSES = [
  {
    id: 1,
    title: "数据科学导论",
    teacher: "李教授 · 计算机学院",
    coverColor: "#A99CF5",
    coverText: "数",
    category: "理工通识",
    desc: "从数据思维到机器学习基础，建立跨学科的数据分析能力。",
    sections: [
      { stype: "video", title: "第1章 数据思维与问题定义", content: "", recs: [
        { title: "什么是数据思维：从业务问题到数据问题", url: "https://search.bilibili.com/all?keyword=数据思维%20业务问题", source: "Bilibili" },
        { title: "数据科学项目流程全解析", url: "https://search.bilibili.com/all?keyword=数据科学项目流程", source: "Bilibili" },
      ]},
      { stype: "video", title: "第2章 探索性数据分析", content: "assets/ch2.mp4", recs: [
        { title: "EDA 探索性数据分析实战（Python）", url: "https://search.bilibili.com/all?keyword=EDA%20探索性数据分析%20Python", source: "Bilibili" },
        { title: "数据清洗与特征工程入门", url: "https://search.bilibili.com/all?keyword=数据清洗%20特征工程", source: "Bilibili" },
      ]},
      { stype: "doc", title: "第1章课件·数据思维", content: "assets/slide1.html" },
      { stype: "quiz", title: "章节测验 1", questions: [
        { q: "数据科学的核心目标是什么？", options: ["收集最多数据", "从数据中提取洞见并支持决策", "制作精美图表", "编写最多代码"], answer: 1, explanation: "数据科学的核心是从数据中提取洞见并支持决策。" },
        { q: "EDA 是指？", options: ["探索性数据分析", "工程数据分析", "增强数据分析", "电子数据分析"], answer: 0, explanation: "EDA = Exploratory Data Analysis，探索性数据分析。" },
        { q: "过拟合的典型表现是？", options: ["训练集差测试集差", "训练集好测试集差", "训练集差测试集好", "训练集和测试集一样差"], answer: 1, explanation: "过拟合指模型在训练集上表现好，但在新数据上表现差。" },
        { q: "数据伦理不包括以下哪项？", options: ["隐私保护", "算法公平", "数据安全", "数据越多越好"], answer: 3, explanation: "数据伦理关注隐私、公平、安全，而非单纯追求数据量。" },
        { q: "特征工程的主要作用是？", options: ["让模型更容易学习有效模式", "减少训练时间", "增加数据量", "替代模型训练"], answer: 0, explanation: "特征工程通过构造有效特征帮助模型学习。" },
      ]},
    ],
    discussions: [],
    homeworks: [
      { title: "作业1：数据清洗实践", desc: "使用提供的数据集完成清洗并提交报告。", due: "2026-10-05" },
    ],
    analytics: { studyHours: 0, videoProgress: 0, avgScore: 0, weekly: [
      { label: "周一", val: 0 },
      { label: "周二", val: 0 },
      { label: "周三", val: 0 },
      { label: "周四", val: 0 },
      { label: "周五", val: 0 },
      { label: "周六", val: 0 },
      { label: "周日", val: 0 },
    ] },
  },
  {
    id: 2,
    title: "科技伦理与人工智能",
    teacher: "王老师 · 马克思主义学院",
    coverColor: "#62CBA0",
    coverText: "工",
    category: "理工通识",
    desc: "从真实工程事故出发，理解工程师的伦理责任与决策框架。",
    sections: [
      { stype: "video", title: "第1章 工程伦理导论", content: "assets/ch1.mp4", recs: [
        { title: "工程伦理导论：公众安全与职业责任", url: "https://search.bilibili.com/all?keyword=工程伦理%20公众安全%20职业责任", source: "Bilibili" },
        { title: "工程师伦理准则与职业行为规范", url: "https://search.bilibili.com/all?keyword=工程师%20伦理准则", source: "Bilibili" },
      ]},
      { stype: "doc", title: "第1章课件·伦理决策框架", content: "assets/slide1.html" },
      { stype: "quiz", title: "章节测验 1", questions: [
        { q: "工程师的首要责任对象通常是？", options: ["雇主利益", "公众安全与健康", "个人声誉", "项目利润"], answer: 1, explanation: "工程伦理强调公众安全与健康优先。" },
        { q: "自动驾驶中的「电车难题」主要用于讨论什么？", options: ["算法效率", "伦理决策", "车辆外观设计", "电池续航"], answer: 1, explanation: "电车难题式情境常用于讨论自动驾驶的伦理决策。" },
        { q: "Whistleblowing 在工程伦理中通常指？", options: ["举报不当行为", "加班赶工", "技术创新", "市场推广"], answer: 0, explanation: "Whistleblowing 指揭露组织内不道德或违法行为。" },
        { q: "伦理决策时应当？", options: ["只考虑技术可行性", "综合多方利益与价值", "只听雇主意见", "回避公众意见"], answer: 1, explanation: "伦理决策需要综合技术、利益相关者与价值判断。" },
        { q: "数据隐私保护的基本原则之一是？", options: ["数据最小化", "数据最大化", "无限制共享", "永不删除"], answer: 0, explanation: "数据最小化原则：只收集必要数据。" },
      ]},
    ],
    discussions: [
      { user: "林深夜", role: "student", content: "老师，自动驾驶的「电车难题」在工程中真的需要工程师决策吗？", ts: "2026-09-12 15:30" },
    ],
    homeworks: [],
    analytics: {
      studyHours: 8,
      videoProgress: 60,
      avgScore: 92,
      weekly: [
        { label: "周一", val: 20 },
        { label: "周二", val: 35 },
        { label: "周三", val: 50 },
        { label: "周四", val: 30 },
        { label: "周五", val: 65 },
        { label: "周六", val: 40 },
        { label: "周日", val: 25 },
      ],
    },
  },
  {
    id: 3,
    title: "学术写作与规范",
    teacher: "王怀安 · 人文学院",
    coverColor: "#5E82D8",
    coverText: "写",
    category: "人文通识",
    desc: "面向研究生的学术写作训练，涵盖文献综述、引用规范与论证结构。",
    sections: [
      { stype: "video", title: "第1章 文献检索与综述", content: "assets/ch1.mp4", recs: [
        { title: "文献检索技巧：从知网到 Web of Science", url: "https://search.bilibili.com/all?keyword=文献检索%20知网%20Web%20of%20Science", source: "Bilibili" },
        { title: "如何快速判断一篇论文是否值得读", url: "https://search.bilibili.com/all?keyword=如何判断论文是否值得读", source: "Bilibili" },
      ]},
      { stype: "video", title: "第2章 引用格式与学术诚信", content: "assets/ch2.mp4", recs: [
        { title: "GB/T 7714 参考文献格式详解", url: "https://search.bilibili.com/all?keyword=GB%2FT%207714%20参考文献", source: "Bilibili" },
        { title: "学术诚信与论文查重原理", url: "https://search.bilibili.com/all?keyword=学术诚信%20论文查重", source: "Bilibili" },
      ]},
      { stype: "video", title: "第3章 论证结构与逻辑", content: "", recs: [
        { title: "学术论文的论证结构：IMRAD 模式", url: "https://search.bilibili.com/all?keyword=学术论文%20IMRAD%20论证结构", source: "Bilibili" },
        { title: "批判性思维与逻辑谬误", url: "https://search.bilibili.com/all?keyword=批判性思维%20逻辑谬误", source: "Bilibili" },
      ]},
      { stype: "doc", title: "第1章课件·文献检索", content: "assets/slide1.html" },
      { stype: "doc", title: "第2章课件·引用规范", content: "assets/slide2.html" },
      { stype: "doc", title: "第3章课件·论证结构", content: "assets/slide3.html" },
      { stype: "quiz", title: "章节测验 1", questions: [
        { q: "直接引用他人原话时，必须标注什么？", options: ["作者姓名", "出版年份", "具体页码", "出版社"], answer: 2, explanation: "直接引用需要在引文后标注页码，以便读者核对原文。" },
        { q: "文献综述的核心目的是什么？", options: ["罗列尽可能多的文献", "梳理研究脉络并指出现有缺口", "直接复制摘要", "省略引用来源"], answer: 1, explanation: "文献综述重在梳理已有研究脉络，为自己的研究定位。" },
        { q: "下列哪一项不属于学术不端行为？", options: ["伪造数据", "正确引用", "一稿多投", "代写论文"], answer: 1, explanation: "正确引用是学术规范行为，其余均为学术不端。" },
        { q: "论证结构的三要素是什么？", options: ["论点、论据、论证", "引言、方法、结论", "背景、数据、致谢", "标题、摘要、关键词"], answer: 0, explanation: "论证=论点+论据+论证过程。" },
        { q: "间接引用时，正文标注通常需要包含？", options: ["仅作者", "作者与年份", "仅页码", "仅标题"], answer: 1, explanation: "间接引用需注明作者与年份，如（张三，2025）。" },
      ]},
      { stype: "quiz", title: "章节测验 2", questions: [
        { q: "学术论文中，结论部分不应做什么？", options: ["总结发现", "提出新观点", "重申研究意义", "建议未来方向"], answer: 1, explanation: "结论不应引入正文未讨论的新观点。" },
        { q: "引文格式混乱会导致什么问题？", options: ["影响可读性", "涉嫌抄袭", "降低可信度", "以上皆是"], answer: 3, explanation: "格式混乱会影响阅读、可信度，严重时被视为抄袭。" },
      ]},
    ],
    discussions: [
      { user: "陈嘉禾", role: "student", content: "老师，间接引用和直接引用在正文标注上有什么区别？", ts: "2026-09-10 09:12" },
      { user: "王怀安", role: "teacher", content: "间接引用需注明「据某某研究」，直接引用的话加上页码即可，详见第 2 章课件第 4 页。", ts: "2026-09-10 10:05" },
    ],
    homeworks: [
      { title: "作业1：文献综述初稿", desc: "围绕自选课题完成 1500 字综述，使用课程引用格式。", due: "2026-09-20" },
    ],
    analytics: {
      studyHours: 12.5,
      videoProgress: 68,
      avgScore: 88,
      weekly: [
        { label: "周一", val: 30 },
        { label: "周二", val: 55 },
        { label: "周三", val: 40 },
        { label: "周四", val: 72 },
        { label: "周五", val: 60 },
        { label: "周六", val: 88 },
        { label: "周日", val: 45 },
      ],
    },
  },
];
