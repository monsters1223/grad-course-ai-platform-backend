"""鉴权：JWT 与密码哈希。"""
import os
import hashlib
import secrets
from datetime import datetime, timedelta
from typing import Optional
from jose import JWTError, jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session
from core.database import SessionLocal
from models import User

# 生产部署请通过环境变量 JWT_SECRET 设置一个强随机值（如 openssl rand -hex 32）
SECRET_KEY = os.environ.get("JWT_SECRET", "change-me-in-production-graduate-ai-platform")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60 * 24

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="api/auth/login", auto_error=False)


def hash_password(p: str) -> str:
    salt = secrets.token_hex(16)
    dk = hashlib.pbkdf2_hmac("sha256", p.encode("utf-8"), salt.encode("utf-8"), 100000)
    return f"pbkdf2${salt}${dk.hex()}"


def verify_password(p: str, h: str) -> bool:
    try:
        algo, salt, digest = h.split("$")
        if algo != "pbkdf2":
            return False
        dk = hashlib.pbkdf2_hmac("sha256", p.encode("utf-8"), salt.encode("utf-8"), 100000)
        return secrets.compare_digest(dk.hex(), digest)
    except Exception:
        return False


def create_token(user_id: int, name: str) -> str:
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    payload = {"sub": str(user_id), "name": name, "exp": expire}
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)


def decode_token(token: str) -> Optional[dict]:
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def get_current_user(token: Optional[str] = Depends(oauth2_scheme)) -> User:
    cred_exc = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="未登录或登录已过期",
        headers={"WWW-Authenticate": "Bearer"},
    )
    if not token:
        raise cred_exc
    payload = decode_token(token)
    if not payload:
        raise cred_exc
    db: Session = SessionLocal()
    try:
        user = db.query(User).filter(User.id == int(payload["sub"])).first()
    finally:
        db.close()
    if not user:
        raise cred_exc
    return user
