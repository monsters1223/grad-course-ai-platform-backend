"""数据库引擎与会话。

地址解析优先级：DATABASE_URL（PostgreSQL）> SQLITE_PATH > 默认 SQLite 文件。
未配置 DATABASE_URL 时，行为与迁移前完全一致，保证本地/未迁移环境仍可运行。
"""
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker, declarative_base

from core.config import settings

BACKEND_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _build_url() -> str:
    """解析数据库地址：优先 PostgreSQL，未配置则回落 SQLite。"""
    url = (settings.database_url or os.environ.get("DATABASE_URL") or "").strip()
    if url:
        return url
    # 默认把数据库放在后端目录；容器部署时用环境变量 SQLITE_PATH 指向持久卷
    db_path = (settings.sqlite_path
               or os.environ.get("SQLITE_PATH")
               or os.path.join(BACKEND_DIR, "app.db"))
    return f"sqlite:///{db_path}"


SQLALCHEMY_DATABASE_URL = _build_url()
IS_SQLITE = SQLALCHEMY_DATABASE_URL.startswith("sqlite")

# 课程资料/视频上传目录（与 main.py 挂载的 /files 对应）
UPLOAD_DIR = os.path.join(BACKEND_DIR, "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)

if IS_SQLITE:
    # check_same_thread 是 SQLite 专属参数，PostgreSQL 不接受
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        connect_args={"check_same_thread": False},
    )
else:
    # pool_pre_ping：取连接前先检测有效性，避免空闲连接被数据库断开后报错
    engine = create_engine(
        SQLALCHEMY_DATABASE_URL,
        pool_pre_ping=True,
    )
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
