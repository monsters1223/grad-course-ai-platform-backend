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
from core.security import hash_password
from models import (
    Course, Section, Discussion, Homework, ChatRoom, ChatMember,
    StudyGroup, Message, User,
)


def _first_student_id(db):
    u = db.query(User).filter(User.role == "student").first()
    if u:
        return u.id
    # 新数据库无学生用户：seed 后续步骤（建班级群/StudyGroup）的 owner_id 都是 NOT NULL，
    # 必须先有一个用户可指，否则会触发 IntegrityError。这里幂等创建一个 demo 用户兜底。
    demo = User(
        username="demo_student",
        name="演示学生",
        password_hash=hash_password("demo123"),
        role="student",
    )
    db.add(demo)
    db.flush()
    return demo.id


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
    if not c1 or not c2:
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
                content="10道单选题，涵盖第1-3章核心概念，限时20分钟。", position=7),
    ])
    db.add(Discussion(course_id=c1.id, user_id=_first_student_id(db) or 0,
                      content="老师，第2章的方差公式能再讲一下吗？"))
    db.add(Homework(course_id=c1.id, title="作业1：数据清洗实践",
                    desc="使用提供的数据集完成清洗并提交报告。", due="2026-09-10"))
    c1.progress = 60

    # 右侧课仅留壳：删除所有章节/作业/讨论
    db.query(Section).filter_by(course_id=c2.id).delete()
    db.query(Homework).filter_by(course_id=c2.id).delete()
    db.query(Discussion).filter_by(course_id=c2.id).delete()
    c2.progress = 0

    db.commit()
    print("课程内容已幂等同步：左侧课完整，右侧课为空壳。")


def seed():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        # ---- 首次：建课程、班级群、学习小组 ----
        if db.query(Course).count() == 0:
            c1 = Course(title="数据科学导论", teacher="李教授", cover="📊",
                        category="理工通识",
                        desc="面向研究生的数据科学通识课，涵盖统计、可视化与机器学习基础。",
                        progress=60)
            c2 = Course(title="科技伦理与人工智能", teacher="王老师", cover="🤖",
                        category="人文通识",
                        desc="探讨AI发展中的伦理、隐私与社会影响。",
                        progress=0)
            db.add_all([c1, c2])
            db.flush()

            # 班级群
            for c in (c1, c2):
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

        # ---- 幂等同步：章节/作业/讨论 ----
        _sync_course_content(db)

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
