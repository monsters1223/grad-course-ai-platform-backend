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
    auth, courses, discussion, assignments, groups, checkin, analytics, ai_classroom, chat, quizzes, teacher,
    notifications, preview,
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

# 兼容旧库：quiz_results 新增 answers 列（用户作答回显用）
_qr_cols = [c["name"] for c in _inspector.get_columns("quiz_results")]
with engine.connect() as _conn:
    if "answers" not in _qr_cols:
        _conn.execute(text("ALTER TABLE quiz_results ADD COLUMN answers TEXT"))
    _conn.commit()

# 兼容旧库：教师端所需新增列（users.class/major、courses.code、submissions.feedback/graded_at/status）
_users_cols = [c["name"] for c in _inspector.get_columns("users")]
with engine.connect() as _conn:
    for _col in ("class", "major"):
        if _col not in _users_cols:
            _conn.execute(text(f"ALTER TABLE users ADD COLUMN {_col} TEXT"))
    _conn.commit()

_courses_cols = [c["name"] for c in _inspector.get_columns("courses")]
with engine.connect() as _conn:
    if "code" not in _courses_cols:
        _conn.execute(text("ALTER TABLE courses ADD COLUMN code TEXT"))
    _conn.commit()

_sub_cols = [c["name"] for c in _inspector.get_columns("submissions")]
with engine.connect() as _conn:
    for _col in ("feedback", "graded_at", "status"):
        if _col not in _sub_cols:
            _conn.execute(text(f"ALTER TABLE submissions ADD COLUMN {_col} TEXT"))
    _conn.commit()

app = FastAPI(title="研究生通识课AI教育平台-学生端")
# CORS：仅放行白名单来源，避免 `*` 向所有外部网站开放接口。
# 优先级：环境变量 CORS_ORIGINS（逗号分隔多个域名）> 未配置时回落本地同源（供开发/测试）。
_cors_raw = (os.environ.get("CORS_ORIGINS") or "").strip()
if _cors_raw:
    ALLOWED_ORIGINS = [o.strip() for o in _cors_raw.split(",") if o.strip()]
else:
    # 本地开发/测试同源回退：前端经后端根路径同源提供，故仅放开 localhost/127.0.0.1。
    # 注意：同源请求浏览器本就不查 CORS，这里放开仅为兼容跨域开发场景，不影响安全。
    ALLOWED_ORIGINS = ["http://localhost:8000", "http://127.0.0.1:8000"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,
    # 前端用 Bearer Token 鉴权（非 cookie），无需凭据；
    # 通配符 origins 不能与 allow_credentials=True 同用（浏览器拒绝），故置 False。
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

STATIC_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "static")
for r in (auth, courses, discussion, assignments, groups, checkin, analytics, ai_classroom, chat, quizzes, teacher, notifications, preview):
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


@app.on_event("startup")
def _auto_seed_on_first_run():
    """首次启动自动写入示例数据（仅当课程表为空）。

    安全约束：seed() 会按脚本幂等重建章节/作业/题库，若每次启动都跑会清掉
    教师端新增内容。因此只在「库里一门课都没有」时触发，已存在数据的库不受影响。
    """
    from core.database import SessionLocal
    import seed_courses

    db = SessionLocal()
    try:
        has_course = db.query(models.Course).count() > 0
    finally:
        db.close()
    if not has_course:
        try:
            seed_courses.seed()
            print("首次启动：已自动写入示例课程数据。")
        except Exception as e:  # 自动种子失败不应阻断服务启动
            print(f"⚠️ 自动种子失败（已忽略，不影响服务启动）：{e}")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run(app, host="0.0.0.0", port=port, reload=False)
