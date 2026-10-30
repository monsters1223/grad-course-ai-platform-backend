# -*- coding: utf-8 -*-
"""复现并验证「跨课程导入模板」场景。

场景 A（用户遇到的）：从《数据科学导论》下载模板 → 在《数据结构》里导入
场景 B：从《数据结构》下载模板 → 在《数据结构》里导入
场景 C：重复导入同一份表
场景 D：把课程代码/名称两列清空后再导入
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
        with urllib.request.urlopen(req, timeout=20) as r:
            return r.status, json.loads(r.read().decode() or "null")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def upload(path, content, fields, token, filename="students.xlsx"):
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
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.status, json.loads(r.read().decode())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read().decode() or "null")


def show(tag, r):
    print("\n%s → 新建 %s / 加入 %s / 跳过 %s" % (tag, r.get("created"), r.get("updated"), r.get("skipped")))
    for d in r.get("details", []):
        print("    [%s] 第%s行 %s：%s" % (d["type"], d["row"], d.get("student") or "-", d["reason"]))


st, d = api("/api/auth/login", "POST", {"username": "teacher01", "password": "123456"})
tok = d["token"]

# 准备：新建《数据结构》课程
st, c = api("/api/teacher/courses", "POST",
            {"title": "数据结构（导入测试）", "code": "DS101", "category": "理工通识",
             "desc": "测试用课程，验证完会删除"}, tok)
new_cid = c["id"]
print("新建课程 id =", new_cid)

# 场景 A：用《数据科学导论》的模板导入到《数据结构》
st, tpl = urllib.request.urlopen(BASE + "/api/teacher/students/template?cid=1").read() if False else (None, None)
req = urllib.request.Request(BASE + "/api/teacher/students/template?cid=1")
req.add_header("Authorization", "Bearer " + tok)
tpl = urllib.request.urlopen(req, timeout=20).read()
print("模板示例行:", [c2.value for c2 in load_workbook(io.BytesIO(tpl)).active[2]])
st, r = upload("/api/teacher/students/import", tpl, {"course_id": str(new_cid)}, tok)
show("A 跨课程导入（数据科学导论模板 → 数据结构）", r)

# 场景 B：从《数据结构》下载模板再导入
req = urllib.request.Request(BASE + "/api/teacher/students/template?cid=%d" % new_cid)
req.add_header("Authorization", "Bearer " + tok)
tpl2 = urllib.request.urlopen(req, timeout=20).read()
print("\nB 模板示例行:", [c2.value for c2 in load_workbook(io.BytesIO(tpl2)).active[2]])
st, r = upload("/api/teacher/students/import", tpl2, {"course_id": str(new_cid)}, tok)
show("B 同课程导入", r)

# 场景 C：重复导入
st, r = upload("/api/teacher/students/import", tpl2, {"course_id": str(new_cid)}, tok)
show("C 重复导入", r)

# 场景 D：课程两列清空（只填学号姓名）
wb = load_workbook(io.BytesIO(tpl2))
ws = wb.active
ws.delete_rows(2)                       # 删掉示例张三，换两个真实学号
ws.append(["20249901", "导入测试甲", "24级1班", "计算机科学", None, None])
ws.append(["20249902", "导入测试乙", "24级2班", "软件工程", None, None])
buf = io.BytesIO(); wb.save(buf)
st, r = upload("/api/teacher/students/import", buf.getvalue(), {"course_id": str(new_cid)}, tok)
show("D 课程列留空", r)

# 名单核对
st, lst = api("/api/teacher/courses/%d/students" % new_cid, token=tok)
print("\n课程名单:", [(s["username"], s["name"]) for s in lst])
