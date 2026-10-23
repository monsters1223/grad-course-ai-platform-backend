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
# 兼容旧库：补齐新增列（用 SQLAlchemy inspect 跨数据库通用，不能用 PRAGMA —— 那是 SQLite 专属）
_inspector = inspect(engine)
_existing_cols = [c["name"] for c in _inspector.get_columns("courses")]
with engine.connect() as _conn:
    if "ai_classroom_url" not in _existing_cols:
        _conn.execute(text("ALTER TABLE courses ADD COLUMN ai_classroom_url TEXT"))
    if "teacher_id" not in _existing_cols:
        _conn.execute(text("ALTER TABLE courses ADD COLUMN teacher_id INTEGER"))
    _conn.commit()

app = FastAPI(title="研究生通识课AI教育平台-学生端")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    # 前端用 Bearer Token 鉴权（非 cookie），无需凭据；
    # 通配符 origins 不能与 allow_credentials=True 同用（浏览器拒绝），故置 False。
    allow_credentials=False,
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

# 原生部署（Windows 直接跑 uvicorn、不经过 Nginx/Caddy）时，index.html 用相对路径
# 引用 styles.css / app.js / data.js 等，必须把静态目录挂到根路径才能加载。
# 该 mount 注册在所有路由之后，/api、/ws、/docs、/files 仍优先匹配，不影响原有行为。
app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="root")

if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
