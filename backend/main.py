"""研究生通识课 AI 教育平台 —— 学生端后端入口（模块化）。

结构：
  core/        配置 / 数据库 / 安全 / 工具
  models.py    数据模型（学生端实体）
  routers/     按资源拆分的路由
  import_users.py  从 Excel 模板导入学生账号（封闭账号体系）
  seed_courses.py  示例课程内容种子
"""
import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from sqlalchemy import text, inspect

from core.database import engine, Base
import models  # 注册所有表
from routers import (
    auth, courses, discussion, assignments, groups, checkin, analytics, ai_classroom, chat,
)

# 显式加载 .env 到环境变量（与原有行为一致）
def _load_env_file():
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env_file()

Base.metadata.create_all(bind=engine)
# 兼容旧库：补齐 ai_classroom_url 列
# 注意：不能用 PRAGMA table_info() —— 那是 SQLite 专属语法，PostgreSQL 会报语法错误
# 用 SQLAlchemy 的 inspect() API 跨数据库通用
_inspector = inspect(engine)
_existing_cols = [c["name"] for c in _inspector.get_columns("courses")]
if "ai_classroom_url" not in _existing_cols:
    with engine.connect() as _conn:
        _conn.execute(text("ALTER TABLE courses ADD COLUMN ai_classroom_url TEXT"))
        _conn.commit()

app = FastAPI(title="研究生通识课AI教育平台-学生端")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
for r in (auth, courses, discussion, assignments, groups, checkin, analytics, ai_classroom, chat):
    app.include_router(r.router)


@app.get("/")
def index():
    return FileResponse(os.path.join(STATIC_DIR, "index.html"))


app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# 本地课程资料 / 视频静态服务（seed 写入 uploads/，Section.content 指向 /files/...）
UPLOAD_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(UPLOAD_DIR, exist_ok=True)
app.mount("/files", StaticFiles(directory=UPLOAD_DIR), name="files")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, reload=False)
