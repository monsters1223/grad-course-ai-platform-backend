# -*- coding: utf-8 -*-
"""课件在线预览。

问题背景
--------
教师上传的多半是 .pptx / .docx / .xlsx，浏览器**原生无法渲染**，
学生点「在线预览」和「下载」都会变成下载到本地，还得再打开本地软件。

解决思路
--------
提供 `GET /api/preview?path=/files/xxx.pptx`，在服务端把文件解析成一份
可在浏览器里直接阅读的 HTML 页面：

  - PDF / 图片 / HTML / 音视频 → 直接内嵌（浏览器原生能力）
  - PPTX / DOCX / XLSX        → 提取文字、表格、图片，重新排版成阅读版
  - TXT / MD / CSV / 代码     → 等宽排版
  - 旧版 .doc/.ppt 或解析失败 → 给出明确说明 + 下载原文件按钮

安全：只允许读取 `core.database.UPLOAD_DIR` 下的文件（basename 白名单），
      不接受任意路径，避免目录穿越。
"""
import base64
import html
import os

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import HTMLResponse

from core.database import UPLOAD_DIR

router = APIRouter(prefix="/api", tags=["preview"])

_MAX_PARSE_BYTES = 40 * 1024 * 1024      # 超过 40MB 不解析，直接给下载入口
_CACHE = {}                              # (name, mtime, size) -> html
_CACHE_MAX = 24

_TEXT_EXT = {".txt", ".md", ".csv", ".log", ".json", ".xml", ".yml", ".yaml",
             ".py", ".js", ".java", ".c", ".cpp", ".h", ".css", ".sql", ".sh"}
_IMG_EXT = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"}
_VIDEO_EXT = {".mp4", ".webm", ".ogv", ".mov", ".m4v"}
_AUDIO_EXT = {".mp3", ".wav", ".m4a", ".aac", ".ogg", ".flac"}

_PAGE_CSS = """
*{box-sizing:border-box}
body{margin:0;background:#f5f7fb;color:#1f2937;
  font-family:"Noto Sans SC","PingFang SC","Microsoft YaHei",system-ui,-apple-system,sans-serif;line-height:1.75}
header{position:sticky;top:0;z-index:10;display:flex;align-items:center;justify-content:space-between;gap:16px;
  padding:12px 22px;background:rgba(255,255,255,.92);backdrop-filter:blur(12px);border-bottom:1px solid #e6eaf2}
header .t{font-size:15px;font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
header .meta{font-size:12px;color:#8a94a6;margin-left:10px;font-weight:400;white-space:nowrap}
.acts{display:flex;gap:10px;flex-shrink:0}
.btn{display:inline-block;padding:7px 14px;border-radius:10px;font-size:13px;font-weight:700;text-decoration:none;
  background:linear-gradient(135deg,#2563EB,#1D4ED8);color:#fff;box-shadow:0 6px 16px rgba(37,99,235,.28)}
.btn.ghost{background:#fff;color:#475569;border:1px solid #dbe2ef;box-shadow:none}
main{padding:22px;max-width:1080px;margin:0 auto}
.slide{background:#fff;border:1px solid #e6eaf2;border-radius:14px;padding:22px 26px 26px;margin-bottom:18px;
  box-shadow:0 6px 20px rgba(30,41,59,.05);position:relative}
.slide .no{position:absolute;right:14px;top:10px;font-size:11px;color:#9aa4b5;letter-spacing:.5px}
.slide h3{margin:0 0 4px;font-size:12px;color:#8b95a7;font-weight:700;letter-spacing:.6px}
.slide p{margin:0 0 8px;font-size:15px}
.slide .st{font-size:19px;font-weight:800;color:#0f172a;margin:0 0 14px;padding-bottom:9px;border-bottom:1px solid #eef1f7}
.slide ul{margin:0 0 8px 20px}
.slide img{max-width:100%;border-radius:10px;margin:8px 0;border:1px solid #eef1f7}
table{width:100%;border-collapse:collapse;margin:10px 0;font-size:13px}
th,td{border:1px solid #e6eaf2;padding:7px 10px;text-align:left;vertical-align:top}
th{background:#f1f5fb;font-weight:700}
pre{background:#0f172a;color:#e2e8f0;padding:18px;border-radius:12px;overflow:auto;font-size:13px;line-height:1.65}
.doc h1{font-size:20px}.doc h2{font-size:17px}.doc h3{font-size:15px}
.doc p{margin:0 0 10px;font-size:14px}
.note{background:#fff;border:1px dashed #dbe2ef;border-radius:14px;padding:26px;text-align:center;color:#64748b;font-size:14px}
.note b{display:block;color:#1f2937;font-size:15px;margin-bottom:6px}
iframe.pdf,iframe.web{width:100%;height:calc(100vh - 96px);border:0;background:#fff;border-radius:12px}
.media{text-align:center;padding:20px}
.sheet-title{font-size:13px;font-weight:700;color:#475569;margin:18px 0 6px}
.scroll{overflow:auto;max-height:70vh;border-radius:12px;border:1px solid #e6eaf2}
"""


def _esc(s) -> str:
    return html.escape(str(s if s is not None else ""))


def _resolve(path: str) -> str:
    """把 /files/xxx.pptx 或 xxx.pptx 解析成 UPLOAD_DIR 内的绝对路径。"""
    if not path:
        raise HTTPException(400, "缺少 path 参数")
    name = os.path.basename(path.replace("\\", "/").split("?")[0])
    full = os.path.abspath(os.path.join(UPLOAD_DIR, name))
    if os.path.dirname(full) != os.path.abspath(UPLOAD_DIR) or not os.path.isfile(full):
        raise HTTPException(404, "文件不存在或不在资料目录中")
    return full


def _wrap(title: str, body: str, src: str, size_kb: int) -> str:
    return (
        '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        "<title>%s · 在线预览</title><style>%s</style></head><body>"
        '<header><div class="t">%s<span class="meta">%d KB</span></div>'
        '<div class="acts"><a class="btn ghost" href="%s" download>下载原文件</a>'
        '<a class="btn ghost" href="javascript:window.close()">关闭</a></div></header>'
        "<main>%s</main></body></html>"
    ) % (_esc(title), _PAGE_CSS, _esc(title), size_kb, _esc(src), body)


# ---------------------------------------------------------------------------
# 各类格式 → HTML 片段
# ---------------------------------------------------------------------------
def _pptx_body(full: str) -> str:
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    prs = Presentation(full)
    total = len(prs.slides)
    out = []
    for idx, slide in enumerate(prs.slides, 1):
        blocks = []
        first_para = [True]        # 每页第一段按「页标题」排版，页面立刻有层次

        def para_html(para):
            runs = [r for r in para.runs if (r.text or "").strip()]
            if not runs:
                return ""
            text = "".join(r.text for r in para.runs).strip()
            inner = _esc(text)
            if any(bool(r.font.bold) for r in runs):
                inner = "<strong>%s</strong>" % inner
            if first_para[0]:
                first_para[0] = False
                return '<div class="st">%s</div>' % inner
            lvl = para.level or 0
            style = ' style="margin-left:%dpx"' % (lvl * 20) if lvl else ""
            return "<p%s>%s</p>" % (style, inner)

        for shape in slide.shapes:
            # 表格
            if getattr(shape, "has_table", False):
                rows = []
                for row in shape.table.rows:
                    rows.append("<tr>" + "".join("<td>%s</td>" % _esc(c.text) for c in row.cells) + "</tr>")
                blocks.append("<table>%s</table>" % "".join(rows))
                continue
            # 图片
            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE or hasattr(shape, "image"):
                try:
                    img = shape.image
                    b64 = base64.b64encode(img.blob).decode("ascii")
                    blocks.append('<img src="data:%s;base64,%s" alt="">' % (img.content_type, b64))
                except Exception:
                    pass
            # 文本
            if getattr(shape, "has_text_frame", False):
                for para in shape.text_frame.paragraphs:
                    h = para_html(para)
                    if h:
                        blocks.append(h)
        if not blocks:
            blocks.append('<p style="color:#9aa4b5">（本页为图形或空白页）</p>')
        out.append('<section class="slide"><div class="no">%d / %d</div>%s</section>'
                   % (idx, total, "".join(blocks)))
    return "".join(out)


def _docx_body(full: str) -> str:
    from docx import Document

    doc = Document(full)
    out = ['<div class="doc">']
    for p in doc.paragraphs:
        text = (p.text or "").strip()
        if not text:
            continue
        style = (p.style.name or "").lower()
        if "heading 1" in style or style == "title":
            out.append("<h1>%s</h1>" % _esc(text))
        elif "heading 2" in style:
            out.append("<h2>%s</h2>" % _esc(text))
        elif "heading" in style:
            out.append("<h3>%s</h3>" % _esc(text))
        else:
            out.append("<p>%s</p>" % _esc(text))
    for t in doc.tables:
        rows = []
        for row in t.rows:
            rows.append("<tr>" + "".join("<td>%s</td>" % _esc(c.text) for c in row.cells) + "</tr>")
        out.append("<table>%s</table>" % "".join(rows))
    # 文档内图片（顺序可能与原文不同，统一放在末尾）
    imgs = []
    for rel in doc.part.rels.values():
        if "image" in rel.reltype:
            try:
                b64 = base64.b64encode(rel.target_part.blob).decode("ascii")
                imgs.append('<img src="data:image/*;base64,%s" alt="">' % b64)
            except Exception:
                pass
    if imgs:
        out.append("<h3>文档中的图片</h3>" + "".join(imgs))
    out.append("</div>")
    return "".join(out)


def _xlsx_body(full: str) -> str:
    from openpyxl import load_workbook

    wb = load_workbook(full, data_only=True)
    out = []
    for ws in wb.worksheets:
        # 用实际使用范围裁剪，避免把 300×30 的空白单元格都渲染出来
        max_row = min(ws.max_row or 0, 300)
        max_col = min(ws.max_column or 0, 30)
        rows = list(ws.iter_rows(values_only=True, max_row=max_row, max_col=max_col)) if max_row else []
        if not rows:
            continue
        html_rows = []
        for r in rows[:300]:
            cells = "".join("<td>%s</td>" % _esc("" if v is None else v) for v in r)
            html_rows.append("<tr>%s</tr>" % cells)
        out.append('<div class="sheet-title">工作表：%s</div><div class="scroll"><table>%s</table></div>'
                   % (_esc(ws.title), "".join(html_rows)))
    return "".join(out) or '<div class="note"><b>工作表为空</b></div>'


def _render_html(full: str, title: str = "") -> str:
    name = os.path.basename(full)
    src = "/files/" + name
    ext = os.path.splitext(name)[1].lower()
    size = os.path.getsize(full)
    display = (title or "").strip() or name      # 有章节标题就显示标题，而不是哈希文件名

    if size > _MAX_PARSE_BYTES:
        return _wrap(display, '<div class="note"><b>文件较大（%.1f MB）</b>'
                           "为保证流畅，不在线解析，请下载后查看。</div>" % (size / 1048576.0), src, size // 1024)

    if ext == ".pdf":
        body = '<iframe class="pdf" src="%s#view=FitH"></iframe>' % _esc(src)
    elif ext == ".html" or ext == ".htm":
        body = '<iframe class="web" src="%s"></iframe>' % _esc(src)
    elif ext in _IMG_EXT:
        body = '<div style="text-align:center"><img src="%s" style="max-width:100%;border-radius:12px"></div>' % _esc(src)
    elif ext in _VIDEO_EXT:
        body = '<div class="media"><video src="%s" controls autoplay style="max-width:100%%;max-height:72vh;border-radius:12px"></video></div>' % _esc(src)
    elif ext in _AUDIO_EXT:
        body = '<div class="media"><audio src="%s" controls></audio></div>' % _esc(src)
    elif ext == ".pptx":
        body = _pptx_body(full)
    elif ext == ".docx":
        body = _docx_body(full)
    elif ext == ".xlsx":
        body = _xlsx_body(full)
    elif ext in _TEXT_EXT:
        with open(full, "r", encoding="utf-8", errors="replace") as f:
            body = "<pre>%s</pre>" % _esc(f.read()[:200000])
    elif ext in (".doc", ".ppt", ".xls"):
        body = ('<div class="note"><b>旧版 Office 格式暂不支持在线预览</b>'
                "请让老师在 Office 中「另存为」.docx / .pptx / .xlsx，或导出为 PDF 后重新上传。"
                "也可以直接下载后用本地软件打开。</div>")
    else:
        body = '<div class="note"><b>该格式暂不支持在线预览</b>可直接下载原文件查看。</div>'
    return _wrap(display, body, src, size // 1024)


@router.get("/preview")
def preview(path: str = Query(..., description="形如 /files/xxx.pptx"),
            title: str = Query("", description="展示用标题（一般传章节名）")):
    """返回可在浏览器中直接阅读的 HTML 预览页。"""
    full = _resolve(path)
    name = os.path.basename(full)
    display = (title or "").strip() or name
    st = os.stat(full)
    key = (name, int(st.st_mtime), st.st_size, display)   # 标题不同 → 页头不同，缓存要分开

    cached = _CACHE.get(key)
    if cached:
        return HTMLResponse(cached)

    try:
        page = _render_html(full, display)
    except Exception as e:                       # 解析失败不能让用户看 500
        page = _wrap(display,
                     '<div class="note"><b>在线预览失败</b>文件可能已损坏或加密（%s）。'
                     "请下载原文件后用本地软件打开。</div>" % _esc(type(e).__name__),
                     "/files/" + name, st.st_size // 1024)

    if len(_CACHE) >= _CACHE_MAX:
        _CACHE.pop(next(iter(_CACHE)))           # 简单 FIFO，避免内存无限增长
    _CACHE[key] = page
    return HTMLResponse(page)


@router.get("/preview/kind")
def preview_kind(path: str = Query(...)):
    """给前端判断用：返回该文件是否支持在线预览。"""
    full = _resolve(path)
    ext = os.path.splitext(full)[1].lower()
    native = ext in ({".pdf", ".html", ".htm"} | _IMG_EXT | _VIDEO_EXT | _AUDIO_EXT)
    office = ext in (".pptx", ".docx", ".xlsx")
    return {"name": os.path.basename(full), "ext": ext,
            "previewable": bool(native or office or ext in _TEXT_EXT),
            "mode": "native" if native else ("office" if office else ("text" if ext in _TEXT_EXT else "none"))}
