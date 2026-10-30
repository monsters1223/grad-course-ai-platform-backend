import json, time, urllib.request, urllib.error

BASE = "http://127.0.0.1:8000"

def req(method, path, token=None, body=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method)
    if data:
        r.add_header("Content-Type", "application/json")
    if token:
        r.add_header("Authorization", "Bearer " + token)
    try:
        resp = urllib.request.urlopen(r, timeout=10)
        return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

def login(u, p):
    s, b = req("POST", "/api/auth/login", body={"username": u, "password": p})
    return s, (json.loads(b).get("token") if b else None)

ok = []
def check(name, cond, extra=""):
    print(("PASS" if cond else "FAIL"), name, extra)
    ok.append(cond)

# 等待后端就绪
for _ in range(20):
    s, _ = req("GET", "/")
    if s == 200:
        break
    time.sleep(1)
else:
    print("后端未就绪，终止"); raise SystemExit(1)
check("后端健康 / -> 200", s == 200)

# 无 token 访问教师接口 -> 401
s, _ = req("GET", "/api/teacher/courses")
check("教师接口未登录 -> 401", s == 401, f"(status={s})")

st, stok = login("student01", "123456")
check("学生登录成功", st == 200 and bool(stok), f"(status={st})")

# 学生访问教师接口 -> 403 角色守卫
s, _ = req("GET", "/api/teacher/courses", token=stok)
check("学生访问教师接口 -> 403", s == 403, f"(status={s})")

tt, ttok = login("teacher01", "123456")
check("教师登录成功", tt == 200 and bool(ttok), f"(status={tt})")

# 教师列课程 -> 200
s, b = req("GET", "/api/teacher/courses", token=ttok)
check("教师列课程 -> 200", s == 200, f"(n={len(json.loads(b)) if b else 0})")

# 行级隔离：用 student01 的 token 试建课程应 403（已由上面覆盖）；另测教师建课
s, b = req("POST", "/api/teacher/courses", token=ttok,
           body={"title": "验证课程_临时", "code": "VERIFY1", "teacher": "演示老师", "category": "测试"})
check("教师建课程 -> 200/201", s in (200, 201), f"(status={s})")
cid = json.loads(b).get("id") if b else None

if cid:
    # 章节
    s, b = req("POST", f"/api/teacher/courses/{cid}/sections", token=ttok,
               body={"title": "第1章", "stype": "video", "content": "/files/x.mp4", "position": 1})
    check("教师加章节 -> 200", s in (200, 201), f"(status={s})")
    # 学生名单-手动添加
    s, b = req("POST", "/api/teacher/students", token=ttok,
               body={"username": "VERIFY2024", "name": "临时生", "klass": "24级1班", "major": "CS", "course_id": cid})
    check("教师加学生 -> 200", s in (200, 201), f"(status={s})")
    s, b = req("GET", f"/api/teacher/courses/{cid}/students", token=ttok)
    check("教师列学生 -> 200", s == 200 and len(json.loads(b)) >= 1, f"(n={len(json.loads(b)) if b else 0})")
    # 签到
    s, _ = req("POST", f"/api/teacher/courses/{cid}/signin/open", token=ttok)
    check("开启签到 -> 200", s in (200, 201), f"(status={s})")
    s, b = req("GET", f"/api/teacher/courses/{cid}/signin/list", token=ttok)
    check("签到列表 -> 200 且 session_open=True", s == 200 and json.loads(b).get("session_open") is True, f"(status={s})")
    s, _ = req("POST", f"/api/teacher/courses/{cid}/signin/close", token=ttok)
    check("关闭签到 -> 200", s in (200, 201), f"(status={s})")
    # 学情
    s, b = req("GET", f"/api/teacher/courses/{cid}/dashboard", token=ttok)
    check("学情看板 -> 200", s == 200 and "total_students" in json.loads(b), f"(status={s})")
    # 公告
    s, b = req("POST", f"/api/teacher/courses/{cid}/announcements", token=ttok,
               body={"title": "临时公告", "content": "内容"})
    check("发布公告 -> 200", s in (200, 201), f"(status={s})")
    s, b = req("GET", f"/api/teacher/courses/{cid}/announcements", token=ttok)
    check("列公告 -> 200", s == 200 and len(json.loads(b)) >= 1, f"(status={s})")
    # 清理：级联删除
    s, _ = req("DELETE", f"/api/teacher/courses/{cid}", token=ttok)
    check("级联删课程 -> 200", s in (200, 204), f"(status={s})")

print("\n结果：", sum(ok), "/", len(ok), "通过" if all(ok) else "存在失败")
raise SystemExit(0 if all(ok) else 1)
