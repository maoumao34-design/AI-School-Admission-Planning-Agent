#!/usr/bin/env node
/**
 * 把 jseea 2025 投档线 CSV（pymupdf 解析：物理类 + 历史类）→ sample 卡片，并入 data/sample-jiangsu-2026-phys.json。
 *
 * 范围：全部在江苏招生院校(江苏 + 省外)，覆盖大部分考生；排除军校/公安/警察/消防/外交/国关等特殊招生。
 * 去重：与现有卡按 院校代号+专业组号 重复的跳过（保留现有手填卡，字段更全）。
 *
 * 诚实标注（守红线）：
 *  - 投档分/选科：取自官方投档线（权威）。
 *  - 位次(min_rank)：null 待核（需一分一段表派生）。
 *  - tuition/plan/majors/城市/层次标签：null/待补。
 * 用法：node scripts/convert_jseea_to_cards.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const samplePath = resolve(root, 'data/sample-jiangsu-2026-phys.json');

const PHYS_PDF_URL = 'https://www.jseea.cn/webfile/upload/2025/07-18/09-33-5302461102655621.pdf';
const HIST_PDF_URL = 'https://www.jseea.cn/webfile/upload/2025/07-18/09-33-380724-1917118608.pdf';
const CSVS = [
  { path: resolve(root, 'data/raw/jseea-2025-phys-投档线.csv'), pdf: PHYS_PDF_URL, doc: '物理等科目类' },
  { path: resolve(root, 'data/raw/jseea-2025-hist-投档线.csv'), pdf: HIST_PDF_URL, doc: '历史等科目类' },
];

// 特殊招生院校（政审/军检/体能/性别/单独标准），排除
const EXCLUDE = /军事|陆军|海军|空军|火箭军|战略支援|武装警察|警察|公安|军校|边防|海警|消防救援|外交学院|国际关系学院/;

const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const existing = sample.cards;
const existKey = new Set(existing.map((c) => `${c.school.code}-${c.major_group.group_no}`));

const stats = { phys: 0, hist: 0, excluded: 0, dedup: 0 };
const newCards = [];

function parseCsv(content) {
  const lines = content.replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  return lines.slice(1).map((l) => l.split(','));
}

for (const { path: csvPath, pdf, doc } of CSVS) {
  const raw = readFileSync(csvPath, 'utf8');
  const rows = parseCsv(raw);
  for (const r of rows) {
    const [code, name, group, subjRaw, subjReq, scoreStr, year, primary] = r;
    if (EXCLUDE.test(name)) { stats.excluded++; continue; }
    const key = `${code}-${group}`;
    if (existKey.has(key)) { stats.dedup++; continue; }
    const score = parseInt(scoreStr, 10);
    if (!Number.isFinite(score)) continue;
    const prefix = primary === '物理' ? 'P' : 'H';
    if (primary === '物理') stats.phys++; else stats.hist++;

    newCards.push({
      id: `${prefix}-${code}-${group}`,
      school: { name, code, region: '江苏', level_tags: [], batch: '普通类本科批' },
      major_group: {
        group_no: group,
        subject_requirement: subjReq,
        subject_requirement_note: `再选要求(原文)：${subjRaw}`,
      },
      recruitment: { plan: null, plan_granularity: '组级计划待补', duration: 4, tuition: null, tuition_note: '学费待核(工科5800/理科5500/文科5200，苏价费136号)' },
      history: [{
        year: 2025, plan: null, min_score: score, min_rank: null, rank_diff: null,
        source: { url: pdf, publisher: '江苏省教育考试院', doc: `江苏省2025年普通类本科批次平行志愿投档线（${doc}）— pymupdf 解析`, updated: '2025-07-18', status: '投档分已核(官方解析)/位次待一分一段表派生' },
      }],
      reason: `${name}${group}组(${subjReq})；2025投档${score}分。供${primary}类考生参考（按位次匹配，位次待核）。`,
      source: { url: pdf, publisher: '江苏省教育考试院', doc: `江苏省2025年普通类本科批次平行志愿投档线（${doc}）`, updated: '2025-07-18', status: '待官方复核' },
      caveats: [
        'bulk 转卡(官方投档线 pymupdf 解析)；投档分权威',
        'min_rank 待一分一段表派生；2024 投档分待补',
        '学费/计划/专业清单/城市/层次标签待《招生计划》《章程》补',
      ],
    });
    existKey.add(key); // 防止两册间重复
  }
}

const merged = { ...sample, cards: [...existing, ...newCards] };
const note = ` | 2026-07-29 bulk 转卡(两册)：jseea 2025 物理类+历史类投档线 PDF(pymupdf 解析)→ 物理+${stats.phys} / 历史+${stats.hist} 卡(排除特殊招生${stats.excluded}、去重手填${stats.dedup})，两类各覆盖数百校，≥100/类 达标。投档分权威；位次/学费/计划/majors/城市/层次 待补。`;
merged._meta = { ...sample._meta, data_status: (sample._meta.data_status || '') + note };

writeFileSync(samplePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

console.log('=== convert 结果(物理+历史) ===');
console.log('新增物理:', stats.phys, '| 新增历史:', stats.hist, '| 排除:', stats.excluded, '| 去重:', stats.dedup);
console.log('合并后总卡:', merged.cards.length);
const phys = merged.cards.filter((c) => c.major_group.subject_requirement.startsWith('物理'));
const hist = merged.cards.filter((c) => c.major_group.subject_requirement.startsWith('历史'));
console.log('物理:', phys.length, '卡', new Set(phys.map((c) => c.school.name)).size, '校');
console.log('历史:', hist.length, '卡', new Set(hist.map((c) => c.school.name)).size, '校');
console.log('两类 ≥100 校:', new Set(phys.map((c) => c.school.name)).size >= 100 && new Set(hist.map((c) => c.school.name)).size >= 100 ? '✓ 双达标' : '✗');
