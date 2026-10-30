"""清库 + 重建示例数据（演示/测试用）。

用法：
    python clear_seed.py            # 清空全部表后重新写入示例数据
    python clear_seed.py --keep-users   # 保留用户与选课，仅重置课程相关内容

说明：
    - 默认会 DROP 全部表并重建，属于「回到初始演示状态」的硬重置；
      生产环境（含真实课程/成绩/签到）慎用，会清空所有数据！
    - --keep-users 仅删除课程及其关联内容，保留 users / enrollments，
      适合只想刷新演示课程、又不想重导账号的场景。
    - 与后端共用同一 SQLITE_PATH，务必确认 .env 指向正确库。
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def _load_env():
    """把 .env 载入环境变量，保证 SQLITE_PATH 与运行中的后端指向同一库。"""
    p = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env")
    if os.path.exists(p):
        with open(p, encoding="utf-8") as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())


_load_env()

import models  # noqa: F401 注册所有表
from core.database import engine, Base
from sqlalchemy import text
import seed_courses


KEEP_USERS = "--keep-users" in sys.argv

if KEEP_USERS:
    # 仅重置课程及其关联内容（保留 users / enrollments）
    _course_related = [
        "signin_sessions", "sign_ins", "announcements", "study_logs",
        "quiz_results", "submissions", "homeworks", "questions",
        "sections", "discussions", "chat_members", "messages",
        "chat_rooms", "study_groups", "enrollments", "courses",
    ]
    with engine.connect() as conn:
        for t in _course_related:
            try:
                conn.execute(text(f"DELETE FROM {t}"))
            except Exception as e:  # 表可能不存在（极旧库），忽略
                print(f"  跳过表 {t}: {e}")
        conn.commit()
    print("已清空课程相关内容（保留用户与选课）。")
else:
    Base.metadata.drop_all(bind=engine)
    print("已清空全部表（硬重置）。")

# 重建：create_all + 迁移 + 示例数据
seed_courses.seed()
print("示例数据重建完成。")
