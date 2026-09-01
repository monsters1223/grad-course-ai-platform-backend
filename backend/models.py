"""数据模型：仅学生端相关的实体。"""
from datetime import datetime
from sqlalchemy import (
    Column, Integer, String, Text, DateTime, ForeignKey, Boolean, Float
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
    role = Column(String(16), default="student")  # 仅学生端，固定 student
    created_at = Column(DateTime, default=datetime.utcnow)

    messages = relationship("Message", back_populates="user")
    submissions = relationship("Submission", back_populates="user")
    signins = relationship("SignIn", back_populates="user")


class Course(Base):
    __tablename__ = "courses"
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(128), nullable=False)
    teacher = Column(String(64))
    cover = Column(String(16), default="📘")
    category = Column(String(32), default="通识课")
    desc = Column(Text)
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
    score = Column(String(8))
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
