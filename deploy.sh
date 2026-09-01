#!/usr/bin/env bash
# 研究生通识课 AI 教育平台 —— 云服务器一键部署脚本
# 用法：把 site/ 传到服务器后，登录服务器进入 site/ 目录，执行  bash deploy.sh
set -euo pipefail

echo "=================================================="
echo " 研究生通识课 AI 教育平台 · 一键部署"
echo "=================================================="

# ---------- 1. 安装 Docker ----------
if command -v docker >/dev/null 2>&1; then
  echo "[1/5] Docker 已安装，跳过"
else
  echo "[1/5] 正在安装 Docker ..."
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  echo "      Docker 已装。若后续 docker 命令报权限错误，请退出重登或执行: newgrp docker"
fi

# 确认 docker compose 可用
if ! docker compose version >/dev/null 2>&1; then
  echo "      未检测到 docker compose 插件，正在安装 ..."
  sudo apt-get update -y && sudo apt-get install -y docker-compose-plugin
fi

# ---------- 2. 配置 .env ----------
if [ -f .env ]; then
  echo "[2/5] 已存在 .env，跳过初始化"
else
  echo "[2/5] 初始化 .env ..."
  cp .env.example .env
  JWT=$(openssl rand -hex 32)
  if sed --version >/dev/null 2>&1; then
    sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  else
    sed -i '' "s|^JWT_SECRET=.*|JWT_SECRET=$JWT|" .env
  fi
  echo "      JWT_SECRET 已自动生成。"
  echo "      请编辑 .env 填入 OPENMAIC_ACCESS_CODE（sk- 开头的访问码）："
  echo "          nano .env"
  read -r -p "      填好后按回车继续（或 Ctrl+C 退出先去填） ..."
fi

# ---------- 3. 配置 Caddyfile ----------
echo "[3/5] 配置 Caddyfile ..."
read -r -p "      你有域名吗？（有则输入如 edu.example.com，没有请直接回车用IP访问）: " DOMAIN
if [ -n "$DOMAIN" ]; then
  cat > Caddyfile <<EOF
# 自动 HTTPS（Let's Encrypt 免费证书）
$DOMAIN {
    reverse_proxy web:8000
}
EOF
  echo "      已为 $DOMAIN 配置 HTTPS（Caddy 自动申请证书）"
else
  cat > Caddyfile <<'EOF'
# 无域名：纯 HTTP 演示（不安全，仅演示用）
:80 {
    reverse_proxy web:8000
}
EOF
  echo "      未配置域名，将用 http://服务器公网IP 直接访问"
fi

# ---------- 4. 构建并启动 ----------
echo "[4/5] 构建并启动容器（首次约 1-2 分钟）..."
docker compose up -d --build

# ---------- 5. 完成 ----------
echo "[5/5] 完成 ✅"
docker compose ps
echo ""
if [ -n "$DOMAIN" ]; then
  echo "  访问地址: https://$DOMAIN"
else
  echo "  访问地址: http://<你的服务器公网IP>"
fi
echo "  登录账号: student / 123456"
echo ""
echo "  常用命令:"
echo "    看日志: docker compose logs -f web"
echo "    停止:   docker compose down"
echo "    重启:   docker compose restart"
