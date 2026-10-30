# -*- coding: utf-8 -*-
"""改密链路验证 + 清理导入测试产生的临时学生。

1) 建一个临时学生（走教师导入接口），默认密码 = 学号后 6 位
2) 用默认密码登录 → 调改密接口 → 用新密码重新登录
3) 删除临时学生与前面 _test_import.py 造的三条测试数据
"""
import io
import json
import sqlite3
import urllib.request
import uuid

BASE = "http://127.0.0.1:8000"
DB = r"C:/gradai/data/app.db"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"

from openpyxl import Workbook


def api(path, method="GET", body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def upload(path, filename, content, fields, token):
    b = "----t" + uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in fields.items():
        out.write(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n" % (b, k, v)).encode())
    out.write(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\nContent-Type: %s\r\n\r\n"
               % (b, filename, XLSX)).encode())
    out.write(content)
    out.write(("\r\n--%s--\r\n" % b).encode())
    req = urllib.request.Request(BASE + path, data=out.getvalue(), method="POST")
    req.add_header("Content-Type", "multipart/form-data; boundary=" + b)
    req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


st, d = api("/api/auth/login", "POST", {"username": "teacher01", "password": "123456"})
tok = d["token"]

# 1) 导入临时学号
wb = Workbook(); ws = wb.active
ws.append(["学号", "姓名", "班级", "专业"])
ws.append([20990001, "临时改密测试", "测试班", "测试专业"])
buf = io.BytesIO(); wb.save(buf)
print("[1] 导入:", upload("/api/teacher/students/import", "t.xlsx", buf.getvalue(), {"course_id": "1"}, tok))

# 2) 默认密码登录
st, d = api("/api/auth/login", "POST", {"username": "20990001", "password": "990001"})
print("[2] 默认密码（学号后6位）登录:", st, (d or {}).get("user", {}).get("name"))
utok = (d or {}).get("token")

# 3) 改密
st, d = api("/api/auth/change-password", "POST", {"old": "990001", "new": "abc123456"}, utok)
print("[3] 改密:", st, d)

# 4) 新密码登录
st, d = api("/api/auth/login", "POST", {"username": "20990001", "password": "abc123456"})
print("[4] 新密码登录:", st, "OK" if st == 200 else d)

# 5) 旧密码应失败
st, d = api("/api/auth/login", "POST", {"username": "20990001", "password": "990001"})
print("[5] 旧密码应 400:", st, (d or {}).get("detail"))

# 6) 清理
c = sqlite3.connect(DB)
ids = [r[0] for r in c.execute(
    "select id from users where username in ('20990001','20240101','20240199','20240198')").fetchall()]
for uid in ids:
    c.execute("delete from enrollments where student_id=?", (uid,))
    c.execute("delete from submissions where user_id=?", (uid,))
    c.execute("delete from notifications where user_id=?", (uid,))
    c.execute("delete from users where id=?", (uid,))
c.commit()
print("[6] 已清理测试账号:", ids)
print("    剩余学生:", [r for r in c.execute("select id,username,name from users where role='student'")])
