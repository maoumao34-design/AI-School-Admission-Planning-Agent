# -*- coding: utf-8 -*-
"""解析 jseea 2025 普通类本科批 平行志愿投档线 PDF → 结构化 CSV。
只做抽取（不编造），交数据角色核验。字段对齐数据 seq340 需求。
每行: 院校代号 | 院校名 | 专业组号 | 再选科目要求 | 投档最低分 | 年份 | 科类(首选)
注：PDF 分物理等科目类/历史等科目类两册；本脚本按传入的首选标注科类。
"""
import fitz, re, sys, csv

PDF = r'C:/Users/maozh2/multica_workspaces/442f00d7-5a63-4e1c-96e2-ee3c8d5253e9/29f69546/workdir/.agent_context/jseea-2025-phys.pdf'
PRIMARY = '物理'      # 本册是“物理等科目类” → 首选物理
YEAR = 2025
OUT = r'C:/Users/maozh2/multica_workspaces/442f00d7-5a63-4e1c-96e2-ee3c8d5253e9/29f69546/workdir/.agent_context/jseea-2025-phys-投档线.csv'

doc = fitz.open(PDF)
# 行模式: 院校代号(4位) 院校名(非数字) 专业组号(2-3位)专业组（再选要求）  投档分(3位)
REC = re.compile(r'(\d{4})\s+([^0-9（）()]+?)(\d{2,3})专业组[（(]([^)）]+)[)）]\s*(\d{3})')

rows = []
seen = set()
for i in range(doc.page_count):
    txt = doc[i].get_text()
    for m in REC.finditer(txt):
        code, school, group, req, score = m.group(1), m.group(2).strip(), m.group(3), m.group(4).strip(), int(m.group(5))
        # 再选要求 → subject_requirement: 首选 + 再选（不限/化学/政治...）
        req_norm = req if req and req != '不限' else ('' if req == '不限' else req)
        subj_req = PRIMARY if not req_norm else f'{PRIMARY}+{req_norm}'
        key = (code, group)
        if key in seen:
            continue
        seen.add(key)
        rows.append([code, school, group, req, subj_req, score, YEAR, PRIMARY])

with open(OUT, 'w', encoding='utf-8-sig', newline='') as f:
    w = csv.writer(f)
    w.writerow(['院校代号', '院校名', '专业组号', '再选科目要求(原文)', 'subject_requirement', '投档最低分', '年份', '首选(科类)'])
    w.writerows(rows)

print(f'parsed {len(rows)} records from {doc.page_count} pages → {OUT}')
# 抽样打印
for r in rows[:8]:
    print(r)
print('...')
# 科类/再选分布
from collections import Counter
print('再选要求 top:', Counter(r[3] for r in rows).most_common(8))
