# -*- coding: utf-8 -*-
"""以「分离进程」方式启动后端，避免开发会话结束时服务被一起回收。

用法（在 backend 目录下）：
    C:/gradai/venv/Scripts/python.exe _serve.py
"""
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
LOG = r"C:\gradai\backend.log"
PY = r"C:/gradai/venv/Scripts/python.exe"

DETACHED_PROCESS = 0x00000008
CREATE_NEW_PROCESS_GROUP = 0x00000200

log = open(LOG, "ab", buffering=0)
proc = subprocess.Popen(
    [PY, "-m", "uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"],
    cwd=HERE,
    stdin=subprocess.DEVNULL,
    stdout=log,
    stderr=subprocess.STDOUT,
    creationflags=DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP,
    close_fds=True,
)
print("backend detached, pid =", proc.pid)
