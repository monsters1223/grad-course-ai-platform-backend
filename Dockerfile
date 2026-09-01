# 研究生通识课 AI 教育平台 —— 学生端后端镜像
FROM python:3.13-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1

# 基础系统工具（健康检查 / 排障用）
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 先装 Python 依赖（利用 Docker 层缓存）
# 用清华 PyPI 镜像：国内直连官方源常卡在几十 KB/s，换源后从数十分钟降到 1-2 分钟。
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --no-cache-dir \
    -i https://pypi.tuna.tsinghua.edu.cn/simple \
    --trusted-host pypi.tuna.tsinghua.edu.cn \
    -r /app/backend/requirements.txt

# 复制后端代码与前端静态文件
COPY backend/ /app/backend/
COPY static/ /app/static/

WORKDIR /app/backend

# 入口：首次启动写入种子数据（幂等，已存在则跳过），随后启动服务
# 注意：种子脚本实际文件名是 seed_courses.py（不是 seed.py），写错会导致容器启动即退出。
# 用 `|| true` 而非 `&&`：种子失败时服务仍要起来，可事后手动补跑，避免小问题拖垮整个系统。
# 用 exec 让 uvicorn 成为 PID 1，才能正确接收 SIGTERM（优雅停机）。
CMD ["sh", "-c", "python seed_courses.py || true; exec uvicorn main:app --host 0.0.0.0 --port 8000"]
