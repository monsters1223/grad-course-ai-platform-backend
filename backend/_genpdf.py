"""一次性生成示例课件 PDF（自包含，不依赖外部服务）。"""
import os

def esc(s):
    return s.replace("\\", "\\\\").replace("(", "\\(").replace(")", "\\)")

def make_pdf(path, title, lines):
    content = "BT\n/F1 18 Tf\n50 790 Tm\n(%s) Tj\n" % esc(title)
    y = 755
    for ln in lines:
        content += "/F1 12 Tf\n50 %d Tm\n(%s) Tj\n" % (y, esc(ln))
        y -= 24
    content += "ET"
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] "
        "/Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
        "<< /Length %d >>\nstream\n%s\nendstream" % (len(content), content),
    ]
    out = b"%PDF-1.4\n"
    offsets = []
    for i, o in enumerate(objs, start=1):
        offsets.append(len(out))
        out += ("%d 0 obj\n%s\nendobj\n" % (i, o)).encode("latin-1")
    xref_pos = len(out)
    out += ("xref\n0 %d\n" % (len(objs) + 1)).encode()
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += ("%010d 00000 n \n" % off).encode()
    out += ("trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF\n"
            % (len(objs) + 1, xref_pos)).encode()
    with open(path, "wb") as f:
        f.write(out)
    print("wrote", path, len(out), "bytes")

base = os.path.join(os.path.dirname(os.path.abspath(__file__)), "uploads")
os.makedirs(base, exist_ok=True)
make_pdf(os.path.join(base, "slide1.pdf"),
         "数据科学导论 - 第1章 数据思维（课件）", [
    "1. 什么是数据思维：从问题出发，用数据回答。",
    "2. 描述统计：均值 / 方差 / 分布。",
    "3. 可视化：用图表把故事讲清楚。",
    "4. 本周作业：完成数据集清洗练习。",
])
make_pdf(os.path.join(base, "slide2.pdf"),
         "科技伦理与人工智能 - 导读课件", [
    "1. 科技伦理核心问题：公平、隐私、责任。",
    "2. AI 带来的社会影响与风险。",
    "3. 案例讨论：算法偏见。",
    "4. 小论文题目自拟，800 字。",
])
