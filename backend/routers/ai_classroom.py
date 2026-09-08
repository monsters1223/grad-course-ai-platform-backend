"""AI 课堂：模拟助教 + OpenMAIC 互动课堂接入（云端托管 / 校内私有化 双模式，已联调验证）。

部署模式说明：
- 云端托管：在 .env 配置 OPENMAIC_ACCESS_CODE（访问码），OPENMAIC_BASE_URL 保持默认 https://open.maic.chat
   —— 接口自动带 `Authorization: Bearer {码}` 鉴权头，受每码每日 10 次额度限制。
- 校内私有化：OPENMAIC_ACCESS_CODE 留空，把 OPENMAIC_BASE_URL 改成校内服务器地址（如 http://10.x.x.x:8080）
   —— 接口不带鉴权头，走内网 OpenMAIC，彻底无次数限制。
前端与业务代码无需任何改动，仅后端 .env 切换即可。
"""
import json
import urllib.request
import urllib.error
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session
from core.database import get_db
from core.security import get_current_user
from core.config import settings
from models import Course, User

router = APIRouter(prefix="/api", tags=["ai"])

AI_BACKEND = settings.ai_backend
OPENMAIC_BASE_URL = settings.openmaic_base_url.rstrip("/")
OPENMAIC_ACCESS_CODE = settings.openmaic_access_code


class AIChatIn(BaseModel):
    message: str
    course_id: Optional[int] = None


class CourseGenIn(BaseModel):
    course_id: int


@router.post("/ai/chat")
def ai_chat(body: AIChatIn, db: Session = Depends(get_db),
            user: User = Depends(get_current_user)):
    q = body.message.strip()
    if AI_BACKEND == "mock":
        reply = (
            f"【AI 助教 · 模拟回复】关于你的问题「{q}」："
            "这是基于课程知识库的示例回答。实际部署时，本接口会调用校内私有化部署的 "
            "OpenMAIC 多智能体（vLLM + Qwen3-32B / DeepSeek-R1-32B），并带来源引用。"
        )
        citations = [
            {"title": "《课程讲义》第3章", "source": "课件/第3章.pdf", "page": 12},
            {"title": "相关论文示例", "source": "参考文献/RAG示例.docx", "page": 3},
        ]
        return {"reply": reply, "citations": citations, "backend": "mock"}
    raise HTTPException(501, "未配置真实 AI 后端（请设置环境变量 AI_BACKEND）")


def _omaic_headers():
    # 云端托管模式带 Bearer 鉴权头；校内私有化（无访问码）模式不带，走内网。
    headers = {"Content-Type": "application/json"}
    if OPENMAIC_ACCESS_CODE:
        headers["Authorization"] = "Bearer " + OPENMAIC_ACCESS_CODE
    return headers


def _omaic_generate(requirement: str) -> str:
    """提交生成任务，返回 jobId。云端(有码)走 Bearer 鉴权；私有化(无码)走内网无鉴权。"""
    # 私有化模式守卫：无访问码且 base_url 仍是云端默认地址 -> 明确提示去改 .env
    if not OPENMAIC_ACCESS_CODE and "open.maic.chat" in OPENMAIC_BASE_URL:
        raise HTTPException(
            400,
            "私有化部署模式未配置：请将 .env 的 OPENMAIC_BASE_URL 改为校内服务器地址"
            "（OPENMAIC_ACCESS_CODE 留空即走内网，无需访问码）",
        )
    payload = json.dumps({"requirement": requirement}).encode("utf-8")
    req = urllib.request.Request(
        OPENMAIC_BASE_URL + "/api/generate-classroom",
        data=payload, headers=_omaic_headers(), method="POST")
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            d = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise HTTPException(401, "OpenMAIC 访问码无效")
        if e.code == 403:
            raise HTTPException(403, "OpenMAIC 今日生成额度已用完（每码每日10次）")
        raise HTTPException(502, f"OpenMAIC 返回错误 {e.code}")
    if not d.get("success"):
        raise HTTPException(502, "OpenMAIC 提交失败：" + str(d.get("error", "未知错误")))
    job_id = d.get("jobId")
    if not job_id:
        raise HTTPException(502, "OpenMAIC 未返回 jobId：" + json.dumps(d, ensure_ascii=False))
    return job_id


def _omaic_poll(job_id: str) -> dict:
    """轮询生成状态，返回完整响应 dict。云端(有码)带鉴权；私有化(无码)无鉴权。"""
    req = urllib.request.Request(
        f"{OPENMAIC_BASE_URL}/api/generate-classroom/{job_id}",
        headers=_omaic_headers(), method="GET")
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        if e.code == 401:
            raise HTTPException(401, "OpenMAIC 访问码无效")
        if e.code == 403:
            raise HTTPException(403, "OpenMAIC 今日生成额度已用完")
        raise HTTPException(502, f"OpenMAIC 返回错误 {e.code}")


@router.post("/ai/generate")
def ai_generate(body: CourseGenIn, db: Session = Depends(get_db),
                user: User = Depends(get_current_user)):
    c = db.query(Course).filter(Course.id == body.course_id).first()
    if not c:
        raise HTTPException(404, "课程不存在")
    # 幂等复用：该课程若已生成过课堂，直接返回已有 URL，
    # 不再调用 OpenMAIC —— 避免重复生成白白消耗每码每日 10 次的额度。
    if c.ai_classroom_url:
        return {
            "jobId": None,
            "url": c.ai_classroom_url,
            "reused": True,
            "message": "该课程 AI 课堂已存在，已自动复用",
        }
    requirement = c.title + (("：" + c.desc) if c.desc else "")
    job_id = _omaic_generate(requirement)
    return {"jobId": job_id, "pollUrl": f"/api/ai/status/{job_id}?course_id={c.id}"}


@router.get("/ai/status/{job_id}")
def ai_status(job_id: str, course_id: Optional[int] = None,
              db: Session = Depends(get_db),
              user: User = Depends(get_current_user)):
    d = _omaic_poll(job_id)
    status = d.get("status")
    result = d.get("result") or {}
    url = result.get("url") or d.get("classroomUrl") or d.get("url")
    classroom_id = result.get("classroomId") or d.get("classroomId")
    if status in ("succeeded", "completed", "done") and url and course_id:
        c = db.query(Course).filter(Course.id == course_id).first()
        if c and not c.ai_classroom_url:
            c.ai_classroom_url = url
            db.commit()
    return {"status": status, "url": url, "classroomId": classroom_id}
