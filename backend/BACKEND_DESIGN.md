# 后端设计草稿（学生端优先 · SQLite + 模块化）

> 状态：草稿，待你过目确认后再落地为代码。
> 决策：数据库先用 SQLite（SQLAlchemy 抽象，后期可切 PostgreSQL）；工程结构模块化拆分。
> 范围：本稿聚焦"学生端"核心流，教师/管理端仅留表结构与角色位，后续阶段补。

---

## 1. 工程结构（模块化）

```
backend/
  main.py                 # 入口：挂载 routers、CORS、静态文件
  core/
    config.py             # 配置(pydantic-settings，读 .env)
    security.py           # 密码哈希(hashlib.pbkdf2)、JWT 生成/校验
    database.py           # SQLAlchemy engine / SessionLocal（复用现有 db.py 思路）
  models/                 # SQLAlchemy 表模型
    user.py  course.py  chapter.py  material.py
    assignment.py  submission.py  group.py  checkin.py
    analytics.py  message.py  ai_classroom.py
  schemas/                # Pydantic 请求/响应模型
    user.py  course.py  assignment.py  group.py  analytics.py
  routers/                # 按资源分文件
    auth.py  courses.py  materials.py  assignments.py
    groups.py  checkin.py  analytics.py  discussion.py  ai_classroom.py
  services/               # 业务逻辑（先轻量，按需扩展）
  static/                 # 前端（现有唯美版，增量迭代）
```

---

## 2. 数据模型（ER 要点）

### User（用户）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| username | str unique | 登录名 |
| password_hash | str | hashlib.pbkdf2 |
| email | str nullable | |
| role | str | student / teacher / admin（MVP 先只激活 student） |
| display_name | str | 昵称 |
| avatar | str nullable | 头像 URL |
| created_at | datetime | |

### Course（课程）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| title | str | |
| description | text | |
| cover | str nullable | 封面 URL |
| teacher_id | int FK→User | 授课教师 |
| semester | str nullable | 学期 |
| ai_classroom_url | str nullable | OpenMAIC 课堂地址 |
| status | str | draft / published |
| created_at | datetime | |

### Enrollment（选课，学生↔课程 多对多）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| user_id | int FK→User | |
| course_id | int FK→Course | |
| enrolled_at | datetime | |
| progress | float | 0~1 总进度 |

### Chapter（章节，支持子章节）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| course_id | int FK→Course | |
| parent_id | int nullable | 父章节（子章节） |
| title | str | |
| order | int | 排序 |

### Material（资料）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| chapter_id | int FK→Chapter | |
| title | str | |
| type | str | video / doc / link |
| url | str | 资源地址 |
| duration | int nullable | 视频时长(秒) |

### Assignment（作业）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| course_id | int FK→Course | |
| title | str | |
| description | text | |
| due_at | datetime nullable | 截止 |
| max_score | float | 满分 |

### Submission（作业提交）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| assignment_id | int FK→Assignment | |
| user_id | int FK→User | |
| content | text nullable | 文本作答 |
| file_url | str nullable | 附件 |
| score | float nullable | 批改分 |
| feedback | text nullable | 评语 |
| submitted_at | datetime | |
| graded_at | datetime nullable | |

### StudyGroup（学习小组）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| course_id | int FK→Course | |
| name | str | |
| description | text | |
| created_by | int FK→User | |

### GroupMembership（小组成员）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| group_id | int FK→StudyGroup | |
| user_id | int FK→User | |
| joined_at | datetime | |

### CheckIn（签到）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| course_id | int FK→Course | |
| user_id | int FK→User | |
| checked_at | datetime | |
| status | str | present / late |

### LearningAnalytics（学情，按用户×课程）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| user_id | int FK→User | |
| course_id | int FK→Course | |
| study_time | int | 累计学习秒数 |
| video_progress | float | 视频完成度 |
| avg_score | float nullable | 作业均分 |
| last_active | datetime | |

### Message（讨论/群聊消息）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| group_id | int FK→StudyGroup nullable | 小组消息 |
| course_id | int FK→Course nullable | 课程讨论 |
| user_id | int FK→User | |
| content | text | |
| created_at | datetime | |

### AIClassroomSession（AI 课堂生成记录）
| 字段 | 类型 | 说明 |
|---|---|---|
| id | int PK | |
| course_id | int FK→Course | |
| requirement | text | 生成需求 |
| job_id | str nullable | OpenMAIC 任务 ID |
| status | str | pending / succeeded / failed |
| result_url | str nullable | 课堂地址 |
| created_at | datetime | |

---

## 3. 接口契约（学生核心流）

### 认证 auth.py
| 方法 | 路径 | 说明 | 请求 | 响应 |
|---|---|---|---|---|
| POST | /api/register | 注册 | {username,password,email?} | {token,user} |
| POST | /api/login | 登录 | {username,password} | {token,user} |
| POST | /api/change-password | 改密(需登录) | {old,new} | {ok} |
| GET | /api/me | 当前用户 | — | user |

### 课程 courses.py
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/courses | 我选修的课程列表 |
| GET | /api/courses/{id} | 课程详情 |
| POST | /api/courses/{id}/enroll | 选课 |

### 章节与资料 materials.py
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/courses/{id}/chapters | 章节树(含资料) |
| GET | /api/materials/{id} | 资料详情 |

### 作业 assignments.py
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/courses/{id}/assignments | 作业列表 |
| GET | /api/assignments/{id} | 作业详情 |
| POST | /api/assignments/{id}/submit | 提交作业 |
| GET | /api/assignments/{id}/mine | 我的提交与批改 |

### 小组 groups.py
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/courses/{id}/groups | 课程小组列表 |
| POST | /api/groups | 建小组 |
| POST | /api/groups/{id}/join | 加入小组 |

### 签到 checkin.py
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/courses/{id}/checkin | 签到 |
| GET | /api/courses/{id}/my-checkins | 我的签到记录 |

### 学情 analytics.py
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/courses/{id}/analytics/me | 我的学情看板数据 |

### 讨论 discussion.py
| 方法 | 路径 | 说明 |
|---|---|---|
| GET | /api/groups/{id}/messages | 小组消息历史 |
| WS | /ws/group/{id} | 实时群聊（复用现有 WebSocket） |

### AI 课堂 ai_classroom.py（保留现有 OpenMAIC 接入）
| 方法 | 路径 | 说明 |
|---|---|---|
| POST | /api/ai/generate | 生成课堂（{course_id, requirement}） |
| GET | /api/ai/status/{job_id} | 轮询状态取 result_url |

---

## 4. 落地顺序（垂直切片，前后端一起做）

- **切片 1 · 账号地基**：User 表 + 注册/登录/改密 + JWT。→ 替换现有写死账号。
- **切片 2 · 课程中心**：Course/Enrollment/Chapter/Material + 课程列表/详情/选课/章节资料。
- **切片 3 · 作业闭环**：Assignment/Submission + 列表/提交/查看批改。
- **切片 4 · 学情看板**：LearningAnalytics + 看板接口（前端已有看板 UI，接真实数据）。
- **切片 5 · 小组/签到/讨论**：补完现有模块的真实数据层。
- **AI 课堂**：保留 OpenMAIC 接入不动，后续阶段做提额/RAG。

---

## 5. 待你确认 / 补充

1. **角色**：MVP 是否先只激活 `student`，teacher/admin 仅留表结构、后续阶段补后台？
2. **资料存储**：资料先用 URL 外链，还是现在就接 MinIO/对象存储？
3. **找回密码 / 邮箱验证**：MVP 是否先不做（仅改密），答辩前再补？
4. **种子数据**：是否要一套示例课程+资料+作业，方便你本地立刻看到"有内容"的页面？
