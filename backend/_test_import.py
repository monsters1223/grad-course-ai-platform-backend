# -*- coding: utf-8 -*-
"""学生导入回归：模板原样导入 / 表头带说明与数字学号 / 表头不识别。

用法（服务已启动）：C:/gradai/venv/Scripts/python.exe _test_import.py
"""
import io
import json
import urllib.request
import uuid

from openpyxl import Workbook, load_workbook

BASE = "http://127.0.0.1:8000"
XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def api(path, method="GET", body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def upload(path, filename, content, fields=None, token=None):
    boundary = "----gradai" + uuid.uuid4().hex
    out = io.BytesIO()
    for k, v in (fields or {}).items():
        out.write(("--%s\r\nContent-Disposition: form-data; name=\"%s\"\r\n\r\n%s\r\n"
                   % (boundary, k, v)).encode())
    out.write(("--%s\r\nContent-Disposition: form-data; name=\"file\"; filename=\"%s\"\r\n"
               "Content-Type: %s\r\n\r\n" % (boundary, filename, XLSX)).encode())
    out.write(content)
    out.write(("\r\n--%s--\r\n" % boundary).encode())
    req = urllib.request.Request(BASE + path, data=out.getvalue(), method="POST")
    req.add_header("Content-Type", "multipart/form-data; boundary=" + boundary)
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, r.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


st, raw = api("/api/auth/login", "POST", {"username": "teacher01", "password": "123456"})
tok = json.loads(raw)["token"]
st, raw = api("/api/teacher/courses", token=tok)
courses = json.loads(raw)
cid = courses[0]["id"]
print("教师课程：", [(c["id"], c["title"], c["code"]) for c in courses], "→ 使用 cid", cid)

# ---- 1. 下载模板（带 cid，示例行应填该课程） ----
st, tpl = api("/api/teacher/students/template?cid=%d" % cid, token=tok)
print("\n[1] 下载模板 status=%s size=%d" % (st, len(tpl)))
wb = load_workbook(io.BytesIO(tpl))
ws = wb.active
print("    表头:", [c.value for c in ws[1]])
print("    示例:", [c.value for c in ws[2]])

# ---- 2. 模板原样上传（模拟用户“下载后直接导入”） ----
st, body = upload("/api/teacher/students/import", "student_template.xlsx", tpl,
                  {"course_id": str(cid)}, tok)
print("\n[2] 模板原样导入 status=%s\n    %s" % (st, body))

# ---- 3. 表头带（必填）、星号、数字学号 ----
wb2 = Workbook()
ws2 = wb2.active
ws2.append(["学号（必填）", "学生姓名*", "班级", "专业"])
ws2.append([20240199, "回归测试甲", "24级1班", "计算机科学"])
ws2.append([20240198, "回归测试乙", "24级2班", "软件工程"])
buf = io.BytesIO(); wb2.save(buf)
st, body = upload("/api/teacher/students/import", "students2.xlsx", buf.getvalue(),
                  {"course_id": str(cid)}, tok)
print("\n[3] 带说明的表头 + 数字学号 status=%s\n    %s" % (st, body))

# ---- 4. 表头完全不对，应给出可读错误 ----
wb3 = Workbook(); ws3 = wb3.active
ws3.append(["编号", "名字"])
ws3.append([1, "x"])
buf = io.BytesIO(); wb3.save(buf)
st, body = upload("/api/teacher/students/import", "bad.xlsx", buf.getvalue(),
                  {}, tok)
print("\n[4] 错误表头 status=%s\n    %s" % (st, body))

# ---- 5. 名单里应能看到新导入的学生 ----
st, raw = api("/api/teacher/courses/%d/students" % cid, token=tok)
names = [(s["username"], s["name"]) for s in json.loads(raw)]
print("\n[5] 课程学生名单:", names)
