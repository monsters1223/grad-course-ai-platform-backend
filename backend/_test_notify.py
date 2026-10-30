# -*- coding: utf-8 -*-
"""通知链路端到端自测：教师发布 → 学生接收 → 已读 → 学生提交 → 教师接收。"""
import json
import sys
import urllib.request

BASE = "http://127.0.0.1:8000"


def call(path, method="GET", body=None, token=None):
    data = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    req.add_header("Content-Type", "application/json; charset=utf-8")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as e:
        print("HTTP", e.code, path, e.read().decode("utf-8")[:300])
        raise


def login(u, p="123456"):
    return call("/api/auth/login", "POST", {"username": u, "password": p})["token"]


tt = login("teacher01")
st = login("student01")

print("== 1. 教师发布公告 ==")
call("/api/teacher/courses/1/announcements", "POST",
     {"title": "第5周课程调整通知", "content": "本周四课程调整至周五下午 14:00，地点 A305，请同学们按时到课。"}, tt)

print("== 2. 教师布置作业 ==")
hw = call("/api/teacher/courses/1/homeworks", "POST",
          {"title": "第三章 数据可视化实践", "desc": "用 matplotlib 绘制一组箱线图并写 300 字分析。", "due": "2026-11-06 23:59"}, tt)
print("   homework id =", hw["id"])

print("== 3. 教师开启签到 ==")
call("/api/teacher/courses/1/signin/open", "POST", {}, tt)

print("== 4. 教师新增章节 ==")
call("/api/teacher/courses/1/sections", "POST",
     {"title": "第4章 统计推断入门", "stype": "video", "content": "", "position": 9}, tt)

print("== 5. 学生端通知 ==")
d = call("/api/notifications", token=st)
print("   unread =", d["unread"])
for i in d["items"]:
    print("   -", i["kind"], "|", i["title"], "|", i["ago"], "|", i["course_title"], "| page=", i["page"], "tab=", i["tab"])

print("== 6. 学生提交作业（触发教师通知） ==")
call("/api/homeworks/submit", "POST", {"homework_id": hw["id"], "answer": "已完成箱线图绘制，分析见附件。"}, st)

print("== 7. 教师批改（触发学生通知） ==")
subs = call("/api/teacher/homeworks/%d/submissions" % hw["id"], token=tt)
sid = subs[0]["id"]
call("/api/teacher/homework/%d/submissions/%d/grade" % (hw["id"], sid), "POST",
     {"score": "92", "feedback": "图表清晰，分析到位。"}, tt)

print("== 8. 学生再次查看通知 ==")
d2 = call("/api/notifications", token=st)
print("   unread =", d2["unread"])
for i in d2["items"]:
    print("   -", i["kind"], "|", i["title"], "|", i["body"][:40], "| read=", i["read"])

print("== 9. 教师端通知（学生提交） ==")
dt = call("/api/notifications", token=tt)
print("   teacher unread =", dt["unread"])
for i in dt["items"]:
    print("   -", i["kind"], "|", i["title"], "|", i["tab"])

print("== 10. 单条已读 + 全部已读 ==")
first = d2["items"][0]["id"]
call("/api/notifications/%d/read" % first, "POST", {}, st)
print("   after one read:", call("/api/notifications/summary", token=st))
print("   read-all:", call("/api/notifications/read-all", "POST", {}, st))
print("   summary:", call("/api/notifications/summary", token=st))

print("== 11. 学生端课程公告接口 ==")
anns = call("/api/courses/1/announcements", token=st)
print("   共", len(anns), "条，最新：", anns[0]["title"] if anns else None)
print("\nALL OK")
