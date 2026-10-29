from html import escape
from pathlib import Path

from markdown_it import MarkdownIt


SOURCE = Path(__file__).with_name("Jev-Switch-product-positioning-2026-10-19.md")
OUTPUT = SOURCE.with_suffix(".html")


def render() -> None:
    '''从研究底稿生成可携带的 HTML；底稿是唯一内容源。

    🤖 本脚本由 Agent 编写，尚未经维护者代码细审。
    '''
    markdown = MarkdownIt("default", {"html": False}).enable("table").enable("strikethrough")
    tokens = markdown.parse(SOURCE.read_text(encoding="utf-8"))
    sections: list[tuple[str, str]] = []
    heading_number = 0

    for index, token in enumerate(tokens):
        if token.type != "heading_open":
            continue
        level = int(token.tag[1:])
        title = tokens[index + 1].content
        if level == 1:
            token.attrSet("id", "report-title")
            continue
        heading_number += 1
        section_id = f"section-{heading_number}"
        token.attrSet("id", section_id)
        if level == 2:
            sections.append((section_id, title))

    for token in tokens:
        if token.type == "link_open":
            token.attrSet("target", "_blank")
            token.attrSet("rel", "noopener noreferrer")

    body = markdown.renderer.render(tokens, markdown.options, {})
    navigation = "".join(
        f'<a href="#{section_id}"><span>{index:02d}</span>{escape(title)}</a>'
        for index, (section_id, title) in enumerate(sections, 1)
    )
    document = f'''<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>Jev Switch 产品重定位、生态位与命名探索</title>
<style>
:root {{ color-scheme:light; --paper:#f3f1eb; --white:#fffefa; --ink:#192525; --muted:#62716f; --line:#d9ded6; --accent:#087f78; --accent-dark:#075e59; --accent-wash:#e0f1eb; --gold:#b36e22; --gold-wash:#fff1d9; }}
* {{ box-sizing:border-box; }} html {{ scroll-behavior:smooth; }}
body {{ margin:0; background:var(--paper); color:var(--ink); font-family:"Segoe UI","Noto Sans CJK SC","Microsoft YaHei",sans-serif; line-height:1.72; }}
a {{ color:var(--accent-dark); text-underline-offset:3px; overflow-wrap:anywhere; }} a:hover {{ color:#034b47; }}
.topline {{ height:7px; background:linear-gradient(90deg,#087f78 0 28%,#d99543 28% 33%,#e1e8df 33% 100%); }}
.shell {{ display:grid; grid-template-columns:260px minmax(0,1fr); max-width:1440px; margin:0 auto; min-height:100vh; }}
aside {{ position:sticky; top:0; align-self:start; height:100vh; overflow:auto; padding:28px 18px 24px 26px; border-right:1px solid var(--line); background:#eeece5; }}
.brand {{ color:var(--accent-dark); font:700 11px/1.3 ui-monospace,monospace; letter-spacing:.13em; text-transform:uppercase; }}
aside h2 {{ margin:20px 0 10px; color:var(--muted); font-size:12px; letter-spacing:.1em; text-transform:uppercase; }}
nav {{ display:grid; gap:3px; }} nav a {{ display:grid; grid-template-columns:27px 1fr; gap:6px; padding:7px 8px; border-radius:7px; color:#334542; font-size:12px; line-height:1.35; text-decoration:none; }}
nav a:hover,nav a:focus-visible {{ background:var(--white); outline:2px solid #93c6bd; }} nav a span {{ color:var(--accent); font:600 10px/1.5 ui-monospace,monospace; }}
.aside-note {{ margin-top:20px; padding:11px; border-left:2px solid var(--gold); background:var(--gold-wash); color:#5e5447; font-size:11px; }}
main {{ min-width:0; padding:40px clamp(20px,5vw,72px) 72px; }} .kicker {{ color:var(--accent); font:700 11px/1.2 ui-monospace,monospace; letter-spacing:.14em; text-transform:uppercase; }}
#report-title {{ max-width:900px; margin:10px 0 12px; font-family:Georgia,"Noto Serif CJK SC","Songti SC",serif; font-size:clamp(36px,5.2vw,67px); line-height:1.08; letter-spacing:-.04em; }}
main > blockquote:first-of-type {{ margin:18px 0 30px; padding:0; border:0; color:var(--muted); font-size:13px; }} main > blockquote:first-of-type p {{ margin:0; }}
.lede {{ max-width:850px; margin:0 0 30px; padding:22px 25px; border:1px solid #bad8d0; border-radius:10px; background:var(--accent-wash); }} .lede strong {{ color:var(--accent-dark); }}
.lanes {{ display:grid; grid-template-columns:repeat(4,minmax(0,1fr)); gap:10px; margin:28px 0 50px; }} .lane {{ min-height:112px; padding:15px; border:1px solid var(--line); border-radius:8px; background:var(--white); }} .lane b {{ display:block; margin-bottom:6px; color:var(--accent-dark); font-size:13px; }} .lane span {{ color:var(--muted); font-size:12px; }}
article {{ max-width:930px; }} h2 {{ margin:58px 0 17px; padding-top:17px; border-top:1px solid var(--line); font-family:Georgia,"Noto Serif CJK SC","Songti SC",serif; font-size:clamp(25px,3vw,35px); line-height:1.25; letter-spacing:-.025em; }} h3 {{ margin:32px 0 10px; color:var(--accent-dark); font-size:19px; line-height:1.35; }} h4 {{ margin:25px 0 8px; font-size:15px; }}
p {{ margin:10px 0 17px; }} strong {{ color:#172f2d; }} blockquote:not(:first-of-type) {{ margin:22px 0; padding:12px 18px; border-left:3px solid var(--gold); background:var(--gold-wash); color:#514537; }}
ul,ol {{ padding-left:1.35em; }} li {{ margin:6px 0; }} table {{ width:100%; table-layout:fixed; margin:22px 0 27px; border:1px solid var(--line); border-radius:8px; border-spacing:0; background:var(--white); font-size:12px; line-height:1.58; overflow-wrap:anywhere; }}
th {{ padding:10px; background:#183d3a; color:#f7f7ef; text-align:left; font-size:11px; }} td {{ padding:10px; border-top:1px solid var(--line); vertical-align:top; }} tr:nth-child(even) td {{ background:#f7f6f0; }}
code {{ padding:.12em .35em; border-radius:4px; background:#e9eee7; color:#254845; font-size:.88em; overflow-wrap:anywhere; }} pre {{ max-width:100%; padding:17px; border-radius:8px; background:#172625; color:#edf4ee; font-size:12px; line-height:1.55; white-space:pre-wrap; overflow-wrap:anywhere; }} pre code {{ padding:0; background:transparent; color:inherit; }} hr {{ margin:44px 0; border:0; border-top:1px solid var(--line); }} .foot {{ margin-top:70px; padding-top:15px; border-top:1px solid var(--line); color:var(--muted); font-size:11px; }}
@media(max-width:900px) {{ .shell {{ grid-template-columns:1fr; }} aside {{ position:relative; height:auto; padding:13px 16px; border-right:0; border-bottom:1px solid var(--line); }} aside h2,.aside-note,.brand {{ display:none; }} nav {{ grid-template-columns:repeat(2,minmax(0,1fr)); gap:5px; }} nav a {{ min-width:0; padding:7px; background:var(--white); border:1px solid var(--line); }} main {{ padding:25px 18px 50px; }} .lanes {{ grid-template-columns:repeat(2,minmax(0,1fr)); }} }}
@media(max-width:520px) {{ .lanes {{ gap:7px; }} .lane {{ min-height:100px; padding:11px; }} table {{ font-size:10px; }} th,td {{ padding:6px; }} }}
@media(prefers-reduced-motion:reduce) {{ html {{ scroll-behavior:auto; }} }}
@media print {{ body {{ background:white; }} .shell {{ display:block; }} aside {{ display:none; }} main {{ padding:15mm; }} .lanes {{ break-inside:avoid; }} a {{ color:inherit; }} }}
</style>
</head>
<body><div class="topline"></div><div class="shell">
<aside><div class="brand">Research / 2026.10</div><h2>目录</h2><nav>{navigation}</nav><div class="aside-note">阅读顺序：先看赛道边界，再看 Magpie 的真实重叠，最后回到 Jev Switch 的产品故事与命名。</div></aside>
<main><div class="kicker">Product Positioning · Ecosystem · Naming</div>
<div class="lede"><strong>核心判断</strong><br>把 Jev Switch 从“只有配置者看得懂的上游切换台”推进为“人可以直接发起 typed decision、开发者可稳定接入、同一张图可解释路由”的 Jev / System One 决策工作台。品牌可以不叫 Jev；产品赛道仍只做 Jev 与兼容的 System One 决策服务。</div>
<div class="lanes" aria-label="产品结构"><div class="lane"><b>开始：给人使用</b><span>描述情境，选择要判断的问题，直接得到类型化决策。</span></div><div class="lane"><b>实验：比较结果</b><span>用相同 state / questions 对比本地与云端决策服务。</span></div><div class="lane"><b>路由：组织决策服务</b><span>DAG 连接入口、中间节点和 System One providers。</span></div><div class="lane"><b>API：给软件使用</b><span>应用和 Agent 读取同一份 schema、图、状态和调用证据。</span></div></div>
<article>{body}<div class="foot">研究快照：2026-10-19。产品事实以仓库当前资料与链接的一手文档为准；竞品能力仅表示其公开承诺，不代替独立性能测试。</div></article></main>
</div></body></html>'''
    OUTPUT.write_text(document, encoding="utf-8")
    print(f"Created {OUTPUT} ({len(sections)} sections, {len(document):,} HTML chars)")


if __name__ == "__main__":
    render()
