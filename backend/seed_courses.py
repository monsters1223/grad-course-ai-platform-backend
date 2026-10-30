"""示例课程内容种子：建 1-2 门示例课 + 章节/资料/作业 + 班级群/小组，并把已有学生加入房间。

用法：
    python seed_courses.py

说明：
    - 课程/班级群/学习小组只在首次（无课程时）创建；
    - 章节/作业/讨论每次运行都会按脚本定义的状态**幂等同步**
      （删除旧内容并按当前脚本重建），方便你调整示例课后重跑；
    - 每次运行都会把「当前已有的学生」补进所有房间（班级群/小组），
      因此无论先导入账号还是先跑种子，学生都能看到课程与群聊。
"""
from core.database import SessionLocal, Base, engine
import models  # noqa: F401
import json
from sqlalchemy import text, inspect
from models import (
    Course, Section, Discussion, Homework, ChatRoom, ChatMember,
    StudyGroup, Message, User, Question,
)


def _migrate():
    """兼容旧库：补齐新增列（用 SQLAlchemy inspect 跨数据库通用，不能用 PRAGMA —— 那是 SQLite 专属）。"""
    _ins = inspect(engine)
    cols = [c["name"] for c in _ins.get_columns("courses")]
    with engine.connect() as conn:
        if "teacher_id" not in cols:
            conn.execute(text("ALTER TABLE courses ADD COLUMN teacher_id INTEGER"))
        if "code" not in cols:
            conn.execute(text("ALTER TABLE courses ADD COLUMN code TEXT"))
        conn.commit()
    # 教师端：users.class/major、submissions.feedback/graded_at/status
    _u = [c["name"] for c in _ins.get_columns("users")]
    with engine.connect() as conn:
        for _col in ("class", "major"):
            if _col not in _u:
                conn.execute(text(f"ALTER TABLE users ADD COLUMN {_col} TEXT"))
        conn.commit()
    _s = [c["name"] for c in _ins.get_columns("submissions")]
    with engine.connect() as conn:
        for _col in ("feedback", "graded_at", "status"):
            if _col not in _s:
                conn.execute(text(f"ALTER TABLE submissions ADD COLUMN {_col} TEXT"))
        conn.commit()




def _first_student_id(db):
    u = db.query(User).filter(User.role == "student").first()
    return u.id if u else None


def _patch_content(db):
    """内容校正（幂等）：把视频指向本地 /files，并确保资料页存在。兼容旧库外链占位。"""
    vmap = {
        "第1章 数据思维": "/files/ch1.mp4",
        "第2章 数据收集与清洗": "/files/ch2.mp4",
        "第3章 描述统计与可视化": "/files/eth1.mp4",
    }
    for s in db.query(Section).filter(Section.stype == "video").all():
        if s.title in vmap:
            s.content = vmap[s.title]
    docs = [
        (1, "第1章课件·数据思维", "/files/slide1.html", 2),
        (1, "第2章课件·数据收集与清洗", "/files/slide2.html", 4),
        (1, "第3章课件·描述统计与可视化", "/files/slide3.html", 6),
    ]
    for cid, title, content, pos in docs:
        if not db.query(Section).filter_by(course_id=cid, title=title, stype="doc").first():
            db.add(Section(course_id=cid, title=title, stype="doc", content=content, position=pos))
    db.commit()
    print("内容校正完成（视频指向本地 /files，资料页已就绪）。")


def _sync_course_content(db):
    """按当前脚本定义，幂等同步两门课的章节/作业/讨论。
    左侧课（数据科学导论）内容完整；右侧课（科技伦理与人工智能）仅留壳。"""
    c1 = db.query(Course).filter_by(title="数据科学导论").first()
    c2 = db.query(Course).filter_by(title="科技伦理与人工智能").first()
    c3 = db.query(Course).filter_by(title="学术写作与规范").first()
    if not c1:
        return

    # 清空左侧课旧内容并重建
    db.query(Section).filter_by(course_id=c1.id).delete()
    db.query(Homework).filter_by(course_id=c1.id).delete()
    db.query(Discussion).filter_by(course_id=c1.id).delete()
    db.add_all([
        Section(course_id=c1.id, title="第1章 数据思维", stype="video",
                content="/files/ch1.mp4", position=1),
        Section(course_id=c1.id, title="第1章课件·数据思维", stype="doc",
                content="/files/slide1.html", position=2),
        Section(course_id=c1.id, title="第2章 数据收集与清洗", stype="video",
                content="/files/ch2.mp4", position=3),
        Section(course_id=c1.id, title="第2章课件·数据收集与清洗", stype="doc",
                content="/files/slide2.html", position=4),
        Section(course_id=c1.id, title="第3章 描述统计与可视化", stype="video",
                content="/files/eth1.mp4", position=5),
        Section(course_id=c1.id, title="第3章课件·描述统计与可视化", stype="doc",
                content="/files/slide3.html", position=6),
        Section(course_id=c1.id, title="章节测验1", stype="quiz",
                content="5道单选题，涵盖第1-3章核心概念，限时20分钟。", position=7),
    ])
    db.add(Discussion(course_id=c1.id, user_id=_first_student_id(db) or 0,
                      content="老师，第2章的方差公式能再讲一下吗？"))
    db.add(Homework(course_id=c1.id, title="作业1：数据清洗实践",
                    desc="使用提供的数据集完成清洗并提交报告。", due="2026-09-10"))
    c1.progress = 60

    # 右侧课（科技伦理与人工智能）仅留壳
    if c2:
        db.query(Section).filter_by(course_id=c2.id).delete()
        db.query(Homework).filter_by(course_id=c2.id).delete()
        db.query(Discussion).filter_by(course_id=c2.id).delete()
        c2.progress = 0

    # 第三门课：学术写作与规范（完整示例）
    if c3:
        db.query(Section).filter_by(course_id=c3.id).delete()
        db.query(Homework).filter_by(course_id=c3.id).delete()
        db.query(Discussion).filter_by(course_id=c3.id).delete()
        db.add_all([
            Section(course_id=c3.id, title="第1章 文献检索与综述", stype="video",
                    content="/files/ch1.mp4", position=1),
            Section(course_id=c3.id, title="第1章课件·文献检索", stype="doc",
                    content="/files/slide1.html", position=2),
            Section(course_id=c3.id, title="第2章 引用格式与学术诚信", stype="video",
                    content="/files/ch2.mp4", position=3),
            Section(course_id=c3.id, title="第2章课件·引用规范", stype="doc",
                    content="/files/slide2.html", position=4),
            Section(course_id=c3.id, title="章节测验1", stype="quiz",
                    content="5道单选题，涵盖文献检索与引用规范，限时15分钟。", position=5),
            Section(course_id=c3.id, title="章节测验2", stype="quiz",
                    content="2道单选题，考察结论写作与引文规范，限时10分钟。", position=6),
        ])
        db.add(Discussion(course_id=c3.id, user_id=_first_student_id(db) or 0,
                          content="老师，间接引用和直接引用在正文标注上有什么区别？"))
        db.add(Homework(course_id=c3.id, title="作业1：文献综述初稿",
                        desc="围绕自选课题完成1500字综述，使用课程引用格式。", due="2026-09-20"))
        c3.progress = 0

    db.commit()
    print("课程内容已幂等同步：数据科学导论完整，科技伦理/学术写作为示例壳。")


# 题库（与 data.js 原硬编码一致）：course_title -> { section_title -> [题目] }
# 每题：(题干, [选项], 正确下标, 解析)
_QUIZ_BANK = {
    "数据科学导论": {
        "章节测验1": [
            ("数据科学的核心目标是什么？",
             ["收集最多数据", "从数据中提取洞见并支持决策", "制作精美图表", "编写最多代码"], 1,
             "数据科学的核心是从数据中提取洞见并支持决策。"),
            ("EDA 是指？",
             ["探索性数据分析", "工程数据分析", "增强数据分析", "电子数据分析"], 0,
             "EDA = Exploratory Data Analysis，探索性数据分析。"),
            ("过拟合的典型表现是？",
             ["训练集差测试集差", "训练集好测试集差", "训练集差测试集好", "训练集和测试集一样差"], 1,
             "过拟合指模型在训练集上表现好，但在新数据上表现差。"),
            ("数据伦理不包括以下哪项？",
             ["隐私保护", "算法公平", "数据安全", "数据越多越好"], 3,
             "数据伦理关注隐私、公平、安全，而非单纯追求数据量。"),
            ("特征工程的主要作用是？",
             ["让模型更容易学习有效模式", "减少训练时间", "增加数据量", "替代模型训练"], 0,
             "特征工程通过构造有效特征帮助模型学习。"),
        ],
    },
    "学术写作与规范": {
        "章节测验1": [
            ("直接引用他人原话时，必须标注什么？",
             ["作者姓名", "出版年份", "具体页码", "出版社"], 2,
             "直接引用需要在引文后标注页码，以便读者核对原文。"),
            ("文献综述的核心目的是什么？",
             ["罗列尽可能多的文献", "梳理研究脉络并指出现有缺口", "直接复制摘要", "省略引用来源"], 1,
             "文献综述重在梳理已有研究脉络，为自己的研究定位。"),
            ("下列哪一项不属于学术不端行为？",
             ["伪造数据", "正确引用", "一稿多投", "代写论文"], 1,
             "正确引用是学术规范行为，其余均为学术不端。"),
            ("论证结构的三要素是什么？",
             ["论点、论据、论证", "引言、方法、结论", "背景、数据、致谢", "标题、摘要、关键词"], 0,
             "论证=论点+论据+论证过程。"),
            ("间接引用时，正文标注通常需要包含？",
             ["仅作者", "作者与年份", "仅页码", "仅标题"], 1,
             "间接引用需注明作者与年份，如（张三，2025）。"),
        ],
        "章节测验2": [
            ("学术论文中，结论部分不应做什么？",
             ["总结发现", "提出新观点", "重申研究意义", "建议未来方向"], 1,
             "结论不应引入正文未讨论的新观点。"),
            ("引文格式混乱会导致什么问题？",
             ["影响可读性", "涉嫌抄袭", "降低可信度", "以上皆是"], 3,
             "格式混乱会影响阅读、可信度，严重时被视为抄袭。"),
        ],
    },
}


def _sync_questions(db):
    """幂等写入题库：按脚本定义重建各 quiz section 的题目（先删后插）。"""
    for course_title, sections in _QUIZ_BANK.items():
        c = db.query(Course).filter_by(title=course_title).first()
        if not c:
            continue
        for section_title, items in sections.items():
            s = db.query(Section).filter_by(
                course_id=c.id, title=section_title, stype="quiz").first()
            if not s:
                continue
            db.query(Question).filter_by(section_id=s.id).delete()
            for order, (q_text, options, answer, explanation) in enumerate(items):
                db.add(Question(
                    section_id=s.id, q_order=order, q_text=q_text,
                    options=json.dumps(options, ensure_ascii=False),
                    answer=int(answer), explanation=explanation,
                ))
    db.commit()
    total = db.query(Question).count()
    print(f"题库已幂等同步：共 {total} 道题。")


def _ensure_demo_teacher(db):
    """确保存在演示老师 teacher01/123456，返回其 id。"""
    from core.security import hash_password
    t = db.query(User).filter(User.username == "teacher01").first()
    if not t:
        t = User(username="teacher01", name="演示老师",
                 password_hash=hash_password("123456"),
                 avatar="师", role="teacher", email="teacher01@demo.edu")
        db.add(t)
        db.flush()
        print("已创建演示老师：teacher01 / 123456")
    else:
        t.role = "teacher"
    return t.id


def _ensure_demo_student(db):
    """确保至少存在一个演示学生 student01/123456（建群/小组需要 owner）。"""
    from core.security import hash_password
    s = db.query(User).filter(User.username == "student01").first()
    if not s:
        s = User(username="student01", name="演示同学",
                 password_hash=hash_password("123456"),
                 avatar="学", role="student", email="student01@demo.edu")
        db.add(s)
        db.flush()
        print("已创建演示学生：student01 / 123456")
    return s.id


def seed():
    Base.metadata.create_all(bind=engine)
    _migrate()
    db = SessionLocal()
    try:
        teacher_id = _ensure_demo_teacher(db)
        _ensure_demo_student(db)
        # ---- 首次：建课程、班级群、学习小组 ----
        if db.query(Course).count() == 0:
            c1 = Course(title="数据科学导论", teacher="李教授", teacher_id=teacher_id,
                        cover="📊", category="理工通识",
                        desc="面向研究生的数据科学通识课，涵盖统计、可视化与机器学习基础。",
                        progress=60)
            c2 = Course(title="科技伦理与人工智能", teacher="王老师", teacher_id=teacher_id,
                        cover="🤖", category="人文通识",
                        desc="探讨AI发展中的伦理、隐私与社会影响。",
                        progress=0)
            c3 = Course(title="学术写作与规范", teacher="王怀安", teacher_id=teacher_id,
                        cover="✍️", category="人文通识",
                        desc="面向研究生的学术写作训练，涵盖文献检索、引用规范与论证结构。",
                        progress=0)
            db.add_all([c1, c2, c3])
            db.flush()

            # 班级群
            for c in (c1, c2, c3):
                room = ChatRoom(rtype="class", name=f"{c.title}·班级群",
                                course_id=c.id, owner_id=_first_student_id(db))
                db.add(room)
                db.flush()
                sid = _first_student_id(db)
                if sid:
                    db.add(Message(room_id=room.id, user_id=sid, mtype="text",
                                   content=f"欢迎大家来到《{c.title}》班级群！"))
            # 学习小组
            groom = ChatRoom(rtype="group", name="Python打卡小组",
                             course_id=c1.id, owner_id=_first_student_id(db))
            db.add(groom)
            db.flush()
            sid = _first_student_id(db)
            if sid:
                db.add(Message(room_id=groom.id, user_id=sid, mtype="text",
                               content="每天打卡一段Python练习，欢迎加入！"))
            db.add(StudyGroup(room_id=groom.id, course_id=c1.id,
                              name="Python打卡小组", visibility="public",
                              desc="每天打卡一段Python练习，欢迎加入！",
                              owner_id=_first_student_id(db)))
            db.commit()
            print("首次：课程、班级群与学习小组已创建。")
        else:
            print("课程已存在，跳过课程创建。")

        # ---- 幂等补充：若旧库只有 2 门课，补充第三门（学术写作与规范）----
        if db.query(Course).filter_by(title="学术写作与规范").first() is None:
            c3n = Course(title="学术写作与规范", teacher="王怀安", teacher_id=teacher_id,
                         cover="✍️", category="人文通识",
                         desc="面向研究生的学术写作训练，涵盖文献检索、引用规范与论证结构。",
                         progress=0)
            db.add(c3n)
            db.flush()
            room3 = ChatRoom(rtype="class", name=f"{c3n.title}·班级群",
                             course_id=c3n.id, owner_id=_first_student_id(db))
            db.add(room3)
            db.flush()
            sid = _first_student_id(db)
            if sid:
                db.add(Message(room_id=room3.id, user_id=sid, mtype="text",
                               content=f"欢迎大家来到《{c3n.title}》班级群！"))
            db.commit()
            print("已补充第三门课：学术写作与规范（含班级群）。")

        # ---- 幂等同步：章节/作业/讨论 ----
        _sync_course_content(db)

        # ---- 幂等同步：题库（落库，答案仅服务端持有）----
        _sync_questions(db)

        # ---- 内容校正（幂等，兼容旧库/外链占位）----
        _patch_content(db)

        # ---- 每次：把现有学生补进所有房间（幂等） ----
        students = db.query(User).filter(User.role == "student").all()
        rooms = db.query(ChatRoom).all()
        added = 0
        for room in rooms:
            for s in students:
                exists = db.query(ChatMember).filter_by(
                    room_id=room.id, user_id=s.id).first()
                if not exists:
                    db.add(ChatMember(room_id=room.id, user_id=s.id, role="member"))
                    added += 1
        db.commit()
        print(f"学生入群同步完成：本次新增成员关系 {added} 条，"
              f"当前学生 {len(students)} 人。")
    finally:
        db.close()


if __name__ == "__main__":
    seed()
