# -*- coding: utf-8 -*-
"""快速以教师身份发布一条公告（联调脚本）。用法：python _notify_demo.py <cid> <title> <content>"""
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
    with urllib.request.urlopen(req, timeout=10) as r:
        raw = r.read().decode("utf-8")
        return json.loads(raw) if raw else None


cid = int(sys.argv[1]) if len(sys.argv) > 1 else 2
title = sys.argv[2] if len(sys.argv) > 2 else "关于期末论文选题的说明"
content = sys.argv[3] if len(sys.argv) > 3 else "请在本周五前提交论文选题，选题需与科技伦理相关，字数不少于 5000 字。"
tok = call("/api/auth/login", "POST", {"username": "teacher01", "password": "123456"})["token"]
print(call("/api/teacher/courses/%d/announcements" % cid, "POST",
           {"title": title, "content": content}, tok))
