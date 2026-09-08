"""通用工具。"""
from datetime import datetime, timedelta


def fmt(dt: datetime) -> str:
    if not dt:
        return ""
    # 数据库存的是 UTC（naive datetime），统一 +8 小时转北京时间再展示
    return (dt + timedelta(hours=8)).strftime("%m-%d %H:%M")
