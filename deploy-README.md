# 研究生通识课 AI 教育平台 —— 云服务器部署说明

把网站部署到云服务器后，任何人通过域名（HTTPS）都能打开使用。本方案用 **Docker + Caddy**，
一条命令启动，Caddy 自动申请免费 HTTPS 证书。

---

## 一、准备

1. **一台云服务器**：阿里云 / 腾讯云「轻量应用服务器」即可（2 核 2G 起步，约 ¥60/月）。
   系统选 **Ubuntu 22.04 LTS**。
2. **一个域名**（建议，用于 HTTPS）：在域名控制台把 `A 记录` 指向服务器公网 IP。
   若暂时没有域名，可用 `:80` 纯 HTTP 临时演示（见下文）。
3. **服务器开放端口**：安全组放通 `80`、`443`（Caddy 用）以及 SSH `22`。
4. **登录服务器后安装 Docker**：
   ```bash
   curl -fsSL https://get.docker.com | sudo sh
   sudo usermod -aG docker $USER   # 退出重登后免 sudo
   docker --version && docker compose version   # 确认安装成功
   ```

## 二、上传代码

把本 `site/` 目录整个传到服务器，例如用 `scp` 或 Git：

```bash
# 在本机执行（示例）
scp -r site/ user@你的服务器IP:~/site
```

## 三、配置环境变量

```bash
cd ~/site
cp .env.example .env
nano .env          # 至少填 OPENMAIC_ACCESS_CODE 和 JWT_SECRET
```

- `OPENMAIC_ACCESS_CODE`：你在 https://open.maic.chat 拿到的访问码（`sk-` 开头）。
- `JWT_SECRET`：执行 `openssl rand -hex 32` 生成一段随机串填进去。
- 其余项保持默认即可。

## 四、修改域名（有域名时）

编辑 `Caddyfile`，把 `your-domain.com` 换成你的真实域名：

```bash
nano Caddyfile
```

> 没有域名想临时跑 HTTP：把 Caddyfile 内容换成
> ```
> :80 {
>     reverse_proxy web:8000
> }
> ```

## 五、启动

```bash
cd ~/site
docker compose up -d --build
```

首次构建会拉取 Python 镜像并安装依赖（约 1–2 分钟）。启动后：

- 打开 `https://你的域名`，用 `student / 123456` 登录。
- 看日志：`docker compose logs -f web`
- 停止：`docker compose down`
- 重启：`docker compose restart`

## 六、数据与持久化

- 数据库（SQLite）存在 Docker 卷 `app-data` 中，**容器重建/重启不会丢数据**。
- 想备份数据库：`docker compose exec web cp /app/data/app.db /tmp/app.db` 再 `docker cp` 出来。

## 七、生产加固建议（申报/正式上线前）

1. **HTTPS 必开**：Caddy 已自动处理，别用 `:80` 长期跑明文。
2. **JWT_SECRET 必须改**：已支持环境变量，切勿保留默认值。
3. **并发量高时换 PostgreSQL**：代码用 SQLAlchemy 抽象，只改 `db.py` 的
   `SQLALCHEMY_DATABASE_URL` 即可，其余不动。
4. **账号体系**：当前是演示用自助注册 + 预设 `student` 账号；正式校园平台建议对接
   学校 CAS / OAuth2 统一身份认证（原方案已规划）。
5. **访问码额度**：OpenMAIC 云端每码每日 10 次生成，正式环境建议申请独立码或私有化部署。

## 八、目录结构（部署视角）

```
site/
├── Dockerfile            # 后端镜像构建
├── docker-compose.yml    # 后端 + Caddy 编排
├── Caddyfile            # 反向代理 + 自动 HTTPS
├── .dockerignore
├── .env.example         # 配置模板（复制为 .env 后填值）
├── backend/             # FastAPI 后端（打进镜像）
└── static/              # 前端静态文件（打进镜像）
```
