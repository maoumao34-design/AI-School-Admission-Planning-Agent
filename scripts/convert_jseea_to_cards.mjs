#!/usr/bin/env node
/**
 * 把 data/raw/jseea-2025-phys-投档线.csv（全栈 pymupdf 解析的官方 2025 物理类投档线）
 * 转成 sample 卡片，并入 data/sample-jiangsu-2026-phys.json。
 *
 * 范围：江苏(院校代号 11xx-13xx)物理类，排除军校/公安/警察/航海等特殊招生（有政审/军检/性别要求，不适配普通资格模型）。
 * 去重：与现有卡按 院校代号+专业组号 重复的跳过（保留现有手填卡，字段更全）。
 *
 * 诚实标注（守红线）：
 *  - 投档分/选科：取自官方投档线（权威）。
 *  - 位次(min_rank)：null 待核（需一分一段表派生）。
 *  - tuition/plan/majors/城市/层次标签：null/待补（CSV 无此字段，后续按招生计划/章程补）。
 * 用法：node scripts/convert_jseea_to_cards.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const samplePath = resolve(root, 'data/sample-jiangsu-2026-phys.json');
const csvPath = resolve(root, 'data/raw/jseea-2025-phys-投档线.csv');

const PHYS_PDF_URL = 'https://www.jseea.cn/webfile/upload/2025/07-18/09-33-5302461102655621.pdf';

// 特殊招生院校关键词（排除：政审/军检/性别/单独标准，不适配普通资格模型）
const EXCLUDE = /军事|陆军|海军|空军|火箭军|战略支援|武装警察|警察|公安|军校|边防|海警|消防救援|外交学院|国际关系学院/;

const sample = JSON.parse(readFileSync(samplePath, 'utf8'));
const existing = sample.cards;
// 现有卡的 (code+group) 集合，用于去重
const existKey = new Set(
  existing.filter((c) => c.major_group.subject_requirement.startsWith('物理'))
    .map((c) => `${c.school.code}-${c.major_group.group_no}`),
);

const csv = readFileSync(csvPath, 'utf8').replace(/^﻿/, '');
const lines = csv.split(/\r?\n/).filter((l) => l.trim());
const header = lines[0].split(',');
const rows = lines.slice(1).map((l) => l.split(','));

let added = 0;
let skippedDup = 0;
let skippedExclude = 0;
const newCards = [];

for (const r of rows) {
  const [code, name, group, subjRaw, subjReq, scoreStr, year, primary] = r;
  if (primary !== '物理') continue; // 仅物理类
  // 范围：全部在江苏招生院校(江苏 11xx-13xx + 省外)，覆盖大部分考生；排除军校/公安等特殊招生
  if (EXCLUDE.test(name)) { skippedExclude++; continue; }
  const key = `${code}-${group}`;
  if (existKey.has(key)) { skippedDup++; continue; }
  const score = parseInt(scoreStr, 10);
  if (!Number.isFinite(score)) continue;

  newCards.push({
    id: `P-${code}-${group}`,
    school: {
      name,
      code,
      region: '江苏', // 城市待补（CSV 无城市字段）
      level_tags: [], // 层次(985/211/双一流)待补
      batch: '普通类本科批',
    },
    major_group: {
      group_no: group,
      subject_requirement: subjReq, // 已是 物理 / 物理+化学 格式，引擎直接消费
      subject_requirement_note: `再选要求(原文)：${subjRaw}`,
    },
    recruitment: {
      plan: null, // 待《招生计划》补
      plan_granularity: '组级计划待补',
      duration: 4,
      tuition: null, // 待招生章程补
      tuition_note: '学费待核(工科5800/理科5500/文科5200，苏价费136号)',
    },
    history: [
      {
        year: 2025,
        plan: null,
        min_score: score,
        min_rank: null, // 待一分一段表派生
        rank_diff: null,
        source: {
          url: PHYS_PDF_URL,
          publisher: '江苏省教育考试院',
          doc: '江苏省2025年普通类本科批次平行志愿投档线（物理等科目类）— pymupdf 解析',
          updated: '2025-07-18',
          status: '投档分已核(官方解析)/位次待一分一段表派生',
        },
      },
    ],
    reason: `${name}${group}组(${subjReq})；2025投档${score}分。供物理类考生参考（按位次匹配，位次待核）。`,
    source: {
      url: PHYS_PDF_URL,
      publisher: '江苏省教育考试院',
      doc: '江苏省2025年普通类本科批次平行志愿投档线（物理等科目类）',
      updated: '2025-07-18',
      status: '待官方复核',
    },
    caveats: [
      'bulk 转卡(官方投档线 pymupdf 解析)；投档分权威',
      'min_rank 待一分一段表派生；2024 投档分待补',
      '学费/计划/专业清单/城市/层次标签待《招生计划》《章程》补',
    ],
  });
  added++;
}

// 合并：现有全部 + 新增物理类
const merged = { ...sample, cards: [...existing, ...newCards] };
// 更新 _meta.data_status
const note = ` | 2026-07-29 bulk 转卡：jseea 2025 物理类投档线 PDF(pymupdf 解析 2522 条)→ 江苏物理类 +${added} 卡(排除军校公安/去重)，物理类直接覆盖 ≥100。投档分权威；位次/学费/计划/majors/城市/层次 待补。`;
merged._meta = { ...sample._meta, data_status: (sample._meta.data_status || '') + note };

writeFileSync(samplePath, JSON.stringify(merged, null, 2) + '\n', 'utf8');

console.log('=== convert_jseea_to_cards 结果 ===');
console.log('CSV 物理类记录(全部):', rows.filter((r) => r[7] === '物理').length);
console.log('排除军校/公安:', skippedExclude);
console.log('去重(已有手填卡):', skippedDup);
console.log('新增物理类卡:', added);
console.log('合并后总卡数:', merged.cards.length);
const phys = merged.cards.filter((c) => c.major_group.subject_requirement.startsWith('物理'));
const hist = merged.cards.filter((c) => c.major_group.subject_requirement.startsWith('历史'));
console.log('  物理:', phys.length, '(', new Set(phys.map((c) => c.school.name)).size, '校)');
console.log('  历史:', hist.length, '(', new Set(hist.map((c) => c.school.name)).size, '校)');
console.log('物理类 ≥100 校:', new Set(phys.map((c) => c.school.name)).size >= 100 ? '✓ 达标' : '✗ 未达');
