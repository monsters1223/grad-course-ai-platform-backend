import json, urllib.request, urllib.error
BASE = "http://127.0.0.1:8000"
def req(m, p, tok=None, body=None):
    r = urllib.request.Request(BASE+p, data=(json.dumps(body).encode() if body is not None else None), method=m)
    if body is not None: r.add_header("Content-Type","application/json")
    if tok: r.add_header("Authorization","Bearer "+tok)
    try:
        resp = urllib.request.urlopen(r, timeout=10); return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e: return e.code, e.read().decode()
def login(u,p):
    s,b = req("POST","/api/auth/login", body={"username":u,"password":p})
    return s, (json.loads(b).get("token") if b else None)
ok=[]
def ck(n,c,e=""):
    print(("PASS" if c else "FAIL"), n, e); ok.append(c)

s,tok = login("student01","123456")
ck("学生登录", s==200 and tok, f"({s})")
for path in ["/api/courses", "/api/dashboard", "/api/signin/me", "/api/groups", "/api/courses/1", "/api/courses/1/discussions"]:
    st,_ = req("GET", path, tok=tok)
    ck("GET "+path, st==200, f"({st})")
# 教师端仍可用 & 数据完整
s,t2 = login("teacher01","123456")
b = req("GET","/api/teacher/courses", tok=t2)[1]
n = len(json.loads(b)) if b else 0
ck("教师课程列表仍含原有数据", n>=3, f"(n={n})")
# 验证 teacher.py 关键行为：学生建课被拒(已由前述覆盖)；此处验证列表接口稳定
print("\n回归通过数:", sum(1 for x in ok if x), "/", len(ok), "ALL PASS" if all(ok) else "HAS FAIL")
raise SystemExit(0 if all(ok) else 1)
