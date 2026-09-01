"""鉴权路由：登录 / 改密 / 当前用户；注册接口已关闭（返回 403）。"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import (
    hash_password, verify_password, create_token, get_current_user,
)
from models import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


class LoginIn(BaseModel):
    username: str
    password: str


class ChangePwdIn(BaseModel):
    old: str
    new: str


def user_out(u: User):
    return {"id": u.id, "username": u.username, "name": u.name,
            "avatar": u.avatar, "role": u.role}


@router.post("/login")
def login(body: LoginIn, db: Session = Depends(get_db)):
    u = db.query(User).filter(User.username == body.username).first()
    if not u or not verify_password(body.password, u.password_hash):
        raise HTTPException(400, "用户名或密码错误")
    return {"token": create_token(u.id, u.name), "user": user_out(u)}


@router.post("/register")
def register():
    # 封闭账号体系：账号由管理员通过 Excel 模板统一导入，不开放自助注册。
    raise HTTPException(
        status_code=403,
        detail="本平台账号由管理员统一下发，请联系管理员获取账号后登录。",
    )


@router.post("/change-password")
def change_password(body: ChangePwdIn, db: Session = Depends(get_db),
                   user: User = Depends(get_current_user)):
    if not verify_password(body.old, user.password_hash):
        raise HTTPException(400, "原密码错误")
    if len(body.new) < 6:
        raise HTTPException(400, "新密码至少 6 位")
    user.password_hash = hash_password(body.new)
    db.commit()
    return {"ok": True}


@router.get("/me")
def me(user: User = Depends(get_current_user)):
    return user_out(user)
