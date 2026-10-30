"""通知中心路由：教师端与学生端共用的消息通道。

接口
----
GET    /api/notifications              通知列表（默认最近 30 条）+ 未读数
GET    /api/notifications/summary      轻量轮询用：只有未读数与最新一条
POST   /api/notifications/{nid}/read   单条已读
POST   /api/notifications/read-all     全部已读
DELETE /api/notifications/{nid}        删除单条
DELETE /api/notifications              清空「已读」通知

安全：所有接口严格以 `get_current_user().id` 作为收件人过滤，越权读取/修改他人通知返回 404。
"""
from datetime import datetime, timedelta
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.orm import Session

from core.database import get_db
from core.security import get_current_user
from models import Notification, User, Course

router = APIRouter(prefix="/api/notifications", tags=["notifications"])

_KIND_META = {
    "announcement": {"label": "公告", "icon": "megaphone"},
    "homework": {"label": "作业", "icon": "clipboard"},
    "grade": {"label": "批改", "icon": "check-circle"},
    "signin": {"label": "签到", "icon": "map-pin"},
    "content": {"label": "课程更新", "icon": "book-open"},
    "submission": {"label": "学生提交", "icon": "clipboard"},
    "discussion": {"label": "讨论", "icon": "message"},
    "system": {"label": "系统", "icon": "bell"},
}


def _bj(dt: datetime) -> str:
    return (dt + timedelta(hours=8)).strftime("%Y-%m-%d %H:%M") if dt else ""


def _ago(dt: datetime) -> str:
    """相对时间：以「数据库 UTC 时间」为基准，直接用服务器当前 UTC 计算。"""
    if not dt:
        return ""
    diff = (datetime.utcnow() - dt).total_seconds()
    if diff < 0:
        diff = 0
    if diff < 60:
        return "刚刚"
    if diff < 3600:
        return "%d 分钟前" % (diff // 60)
    if diff < 86400:
        return "%d 小时前" % (diff // 3600)
    if diff < 86400 * 7:
        return "%d 天前" % (diff // 86400)
    return (dt + timedelta(hours=8)).strftime("%m-%d")


def _serialize(n: Notification, course_titles: dict) -> dict:
    meta = _KIND_META.get(n.kind or "system", _KIND_META["system"])
    return {
        "id": n.id,
        "kind": n.kind,
        "kind_label": meta["label"],
        "icon": meta["icon"],
        "title": n.title,
        "body": n.body or "",
        "course_id": n.course_id,
        "course_title": course_titles.get(n.course_id, ""),
        "page": n.page,
        "tab": n.tab,
        "ref_id": n.ref_id,
        "read": n.read_at is not None,
        "created_at": _bj(n.created_at),
        "ago": _ago(n.created_at),
    }


def _course_titles(db: Session, items) -> dict:
    ids = {n.course_id for n in items if n.course_id}
    if not ids:
        return {}
    return {c.id: c.title for c in db.query(Course).filter(Course.id.in_(ids)).all()}


@router.get("")
def list_notifications(limit: int = Query(30, ge=1, le=100),
                       unread_only: bool = False,
                       db: Session = Depends(get_db),
                       user: User = Depends(get_current_user)):
    q = db.query(Notification).filter(Notification.user_id == user.id)
    unread = q.filter(Notification.read_at.is_(None)).count()
    if unread_only:
        q = q.filter(Notification.read_at.is_(None))
    items = q.order_by(Notification.created_at.desc(), Notification.id.desc()) \
             .limit(limit).all()
    titles = _course_titles(db, items)
    return {"unread": unread, "items": [_serialize(n, titles) for n in items]}


@router.get("/summary")
def summary(db: Session = Depends(get_db), user: User = Depends(get_current_user)):
    """轮询专用：只返回未读数与最新通知（用于角标 + 新消息提示）。"""
    base = db.query(Notification).filter(Notification.user_id == user.id)
    unread = base.filter(Notification.read_at.is_(None)).count()
    latest = base.order_by(Notification.created_at.desc(), Notification.id.desc()).first()
    titles = _course_titles(db, [latest] if latest else [])
    return {"unread": unread,
            "latest": _serialize(latest, titles) if latest else None}


@router.post("/{nid}/read")
def mark_read(nid: int, db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(
        Notification.id == nid, Notification.user_id == user.id).first()
    if not n:
        raise HTTPException(404, "通知不存在")
    if not n.read_at:
        n.read_at = datetime.utcnow()
        db.commit()
    return {"ok": True}


@router.post("/read-all")
def mark_all_read(db: Session = Depends(get_db),
                  user: User = Depends(get_current_user)):
    now = datetime.utcnow()
    cnt = db.query(Notification).filter(
        Notification.user_id == user.id, Notification.read_at.is_(None)) \
        .update({Notification.read_at: now}, synchronize_session=False)
    db.commit()
    return {"ok": True, "updated": cnt}


@router.delete("/{nid}")
def delete_notification(nid: int, db: Session = Depends(get_db),
                        user: User = Depends(get_current_user)):
    n = db.query(Notification).filter(
        Notification.id == nid, Notification.user_id == user.id).first()
    if not n:
        raise HTTPException(404, "通知不存在")
    db.delete(n)
    db.commit()
    return {"ok": True}


@router.delete("")
def clear_read(db: Session = Depends(get_db),
               user: User = Depends(get_current_user)):
    cnt = db.query(Notification).filter(
        Notification.user_id == user.id, Notification.read_at.isnot(None)) \
        .delete(synchronize_session=False)
    db.commit()
    return {"ok": True, "deleted": cnt}
