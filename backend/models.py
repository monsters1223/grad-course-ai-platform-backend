"""数据模型：仅学生端相关的实体。"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Float, UniqueConstraint
)
from sqlalchemy.orm import relationship
from core.database import Base


class User(Base):
    __tablename__ = "users"
    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(64), unique=True, index=True, nullable=False)
    name = Column(String(64), nullable=False)
    password_hash = Column(String(128), nullable=False)
    avatar = Column(String(8), default="学")
    email = Column(String(128), nullable=True)
    role = Column(String(16), default="student")  # student / teacher
    klass = Column("class", String(64), nullable=True)  # 班级（映射 DB 列 class）
    major = Column(String(64), nullable=True)  # 专业
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("Message", back_populates="user")
    submissions = relationship("Submission", back_populates="user")
    signins = relationship("SignIn", back_populates="user")


class Enrollment(Base):
    """选课关系：学生与课程的关联（行级隔离基础）。"""
    __tablename__ = "enrollments"
    id = Column(Integer, primary_key=True, index=True)
    student_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    __table_args__ = (UniqueConstraint("student_id", "course_id", name="uq_enroll"),)
    student = relationship("User", backref="enrollments")
    course = relationship("Course", backref="enrollments")


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(128), nullable=False)
    teacher = Column(String(64))
    teacher_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    cover = Column(String(16), default="📘")
    category = Column(String(32), default="通识课")
    desc = Column(Text)
    code = Column(String(32), nullable=True)  # 课程代码，如 CS101
    progress = Column(Integer, default=0)  # 示例进度（演示用，真实按学习记录算）
    ai_classroom_url = Column(String(512), nullable=True)  # OpenMAIC 生成的互动课堂 URL


class Section(Base):
    __tablename__ = "sections"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    title = Column(String(128), nullable=False)
    stype = Column(String(16), default="video")  # video / quiz
    content = Column(Text)  # 视频地址或测验说明
    position = Column(Integer, default=0)


class Question(Base):
    """测验题库：仅服务端持有标准答案（answer），前端取题时绝不返回该字段。"""
    __tablename__ = "questions"
    id = Column(Integer, primary_key=True, index=True)
    section_id = Column(Integer, ForeignKey("sections.id"), nullable=False, index=True)
    q_order = Column(Integer, default=0)        # 题目序号（同 section 内）
    q_text = Column(Text, nullable=False)        # 题干
    options = Column(Text, nullable=False)       # JSON 数组，如 ["A","B","C","D"]
    answer = Column(Integer, default=0)          # 正确选项下标（仅服务端）
    explanation = Column(Text)                   # 解析（提交后下发前端）


class Discussion(Base):
    __tablename__ = "discussions"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    content = Column(Text, nullable=False)
    parent_id = Column(Integer, ForeignKey("discussions.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)


class Homework(Base):
    __tablename__ = "homeworks"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    title = Column(String(128), nullable=False)
    desc = Column(Text)
    due = Column(String(32))


class Submission(Base):
    __tablename__ = "submissions"
    id = Column(Integer, primary_key=True, index=True)
    homework_id = Column(Integer, ForeignKey("homeworks.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    answer = Column(Text)
    file_path = Column(String(512), nullable=True)   # 上传的作业文件相对路径（存于 /app/data/uploads）
    file_name = Column(String(256), nullable=True)    # 原始文件名（展示用）
    score = Column(String(8))
    feedback = Column(Text, nullable=True)   # 批改反馈
    graded_at = Column(DateTime, nullable=True)  # 批改时间
    status = Column(String(16), default="ungraded")  # ungraded / graded
    submitted_at = Column(DateTime, default=datetime.utcnow)
    user = relationship("User", back_populates="submissions")


class ChatRoom(Base):
    __tablename__ = "chat_rooms"
    id = Column(Integer, primary_key=True, index=True)
    rtype = Column(String(16), default="class")  # class / group
    name = Column(String(128), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("Message", back_populates="room", cascade="all,delete")


class ChatMember(Base):
    __tablename__ = "chat_members"
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("chat_rooms.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    role = Column(String(16), default="member")  # owner / member


class Message(Base):
    __tablename__ = "messages"
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("chat_rooms.id"), nullable=False)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    mtype = Column(String(16), default="text")  # text / image / file
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="messages")
    room = relationship("ChatRoom", back_populates="messages")


class StudyGroup(Base):
    __tablename__ = "study_groups"
    id = Column(Integer, primary_key=True, index=True)
    room_id = Column(Integer, ForeignKey("chat_rooms.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)
    name = Column(String(128), nullable=False)
    visibility = Column(String(16), default="public")  # public / private
    desc = Column(Text)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class SignIn(Base):
    __tablename__ = "signins"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False)
    method = Column(String(16), nullable=False)  # location / gesture / photo / qr
    status = Column(String(16), default="success")  # success / abnormal
    lat = Column(Float, nullable=True)
    lng = Column(Float, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="signins")


class SigninSession(Base):
    """教师开启的签到窗口：一次开/关为一个会话，用于判定学生在窗口内是否签到。"""
    __tablename__ = "signin_sessions"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    opened_at = Column(DateTime, default=datetime.utcnow)
    closed_at = Column(DateTime, nullable=True)
    opened_by = Column(Integer, ForeignKey("users.id"), nullable=True)


class Announcement(Base):
    __tablename__ = "announcements"
    id = Column(Integer, primary_key=True, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)  # 空=全局公告
    author_id = Column(Integer, ForeignKey("users.id"), nullable=False)
    title = Column(String(128), nullable=False)
    content = Column(Text, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)


class Notification(Base):
    """站内通知：教师端与学生端之间唯一的交互通道。

    一行 = 一个收件人的一条通知（写入时扇出）。这样做的好处：
      - 未读数 / 已读状态是单表查询，无需额外关联表；
      - 每条通知可携带自己的跳转目标（课程 / 页面 / tab），前端点开即达；
      - 学生转班/退课不影响历史通知的可见性（与邮件语义一致）。
    """
    __tablename__ = "notifications"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)  # 收件人
    actor_id = Column(Integer, ForeignKey("users.id"), nullable=True)              # 触发者
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=True)           # 关联课程
    kind = Column(String(24), default="system", index=True)
    # kind: announcement / homework / grade / signin / content / submission / discussion / system
    title = Column(String(160), nullable=False)
    body = Column(Text)
    page = Column(String(32), nullable=True)   # 前端路由：learn / signin / dashboard / t_courses ...
    tab = Column(String(32), nullable=True)    # 课程详情内 tab：homework / quiz / announcements ...
    ref_id = Column(Integer, nullable=True)    # 关联业务 id（作业/公告等）
    created_at = Column(DateTime, default=datetime.utcnow, index=True)
    read_at = Column(DateTime, nullable=True, index=True)


class StudyLog(Base):
    """学情：单用户·单课程·单章节的视频观看记录（按 user+course+section 唯一）。"""
    __tablename__ = "study_logs"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    section_index = Column(Integer, default=0)        # 章节在课程 sections 中的序号
    section_title = Column(String(128))
    progress = Column(Integer, default=0)             # 视频完成百分比 0-100（取最大值）
    watch_seconds = Column(Integer, default=0)        # 已观看秒数（取最大播放位置近似）
    last_at = Column(DateTime, default=datetime.utcnow)


class QuizResult(Base):
    """学情：单用户·单课程·单份章节测验的成绩（按 user+course+quiz 唯一）。"""
    __tablename__ = "quiz_results"
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False, index=True)
    course_id = Column(Integer, ForeignKey("courses.id"), nullable=False, index=True)
    quiz_index = Column(Integer, default=0)           # 测验在课程 sections 中的序号
    quiz_title = Column(String(128))
    score = Column(Integer, default=0)                # 答对题数
    total = Column(Integer, default=0)                # 总题数
    answers = Column(Text, nullable=True)             # JSON：用户作答选项下标（回显解析用）
    submitted_at = Column(DateTime, default=datetime.utcnow)
