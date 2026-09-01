"""通用工具。"""
from datetime import datetime


def fmt(dt: datetime) -> str:
    if not dt:
        return ""
    return dt.strftime("%m-%d %H:%M")
