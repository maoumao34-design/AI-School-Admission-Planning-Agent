#!/usr/bin/env node
/**
 * QA 6 步回归脚本（黑盒，驱动真实 HTTP 路由）。
 *
 * 用法：
 *   1) 终端 A：npm run dev            （启动唯一服务：Next.js，暴露 /api/*）
 *   2) 终端 B：npm run qa             （本脚本，默认打 http://localhost:3000）
 *   也可：BASE_URL=http://localhost:3000 node scripts/qa-6step.mjs
 *
 * 6 步映射（TASK-SPEC §3）：
 *   01 对话建立条件 / 02 获取官方信息 / 06 确认导出  → 由全栈 + LLM 编排层负责（本脚本聚焦决策核心 03/04/05）
 *   03 资格校验   → POST /api/eligibility
 *   04 方案比较   → POST /api/compare
 *   05 改条件重算 → POST /api/recompute
 *
 * 退出码：全过=0，有失败=1。便于 CI / QA 断言。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

const sample = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/sample-jiangsu-2026-phys.json'), 'utf8'));
const rulesFile = JSON.parse(readFileSync(resolve(root, 'tests/fixtures/rules.example.json'), 'utf8'));
const rules = Array.isArray(rulesFile) ? rulesFile : rulesFile.rules;

// 01 对话建立条件（这里直接取样本考生上下文；线上由 LLM 从自然语言抽取）
const candidate = {
  province: sample.candidate_context.province,
  year: sample.candidate_context.year,
  subject: {
    category: sample.candidate_context.track,
    primary: sample.candidate_context.subjects[0],
    secondary: sample.candidate_context.subjects.slice(1),
  },
  score: sample.candidate_context.score,
  rank: sample.candidate_context.rank,
};
const candidates = sample.cards;

let failures = 0;
const step = (n, title) => console.log(`\n——— 步骤 ${n}：${title} ———`);

function assert(cond, msg) {
  if (cond) {
    console.log(`  ✅ ${msg}`);
  } else {
    console.error(`  ❌ ${msg}`);
    failures++;
  }
}

async function post(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  return { status: res.status, json };
}

console.log(`QA 6 步回归 · 目标服务 ${BASE}（端到端只跑一个服务）`);

// 03 资格校验 ----------------------------------------------------------------
step('03', '资格校验 POST /api/eligibility');
{
  const { status, json } = await post('/api/eligibility', { candidate, candidates, rules });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  assert(['ok', 'needs_manual_review'].includes(json.outcome?.status), `outcome 通过/需复核（实际 ${json.outcome?.status}）`);
  const passed = (json.data ?? []).filter((r) => r.passed);
  assert(passed.length === 3, `3 个候选通过资格（实际 ${passed.length}）`);
  assert(json.trace?.rules_applied?.length === 4, `trace 记录 4 条规则（实际 ${json.trace?.rules_applied?.length}）`);
}

// 04 方案比较 ----------------------------------------------------------------
step('04', '方案比较 POST /api/compare');
{
  const { status, json } = await post('/api/compare', { candidate, candidates });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  const groups = json.data ?? [];
  assert(groups.length >= 2, `至少 2 套策略（实际 ${groups.length}）`);
  const tier = (id) => groups[0]?.candidates.find((c) => c.id === id)?.probability_ref?.tier;
  assert(tier('SEU-08') === '稳妥', `SEU-08=稳妥（实际 ${tier('SEU-08')}）`);
  assert(tier('NJUST-03') === '保底', `NJUST-03=保底（实际 ${tier('NJUST-03')}）`);
  assert(tier('NJUST-02') === '冲刺', `NJUST-02=冲刺（实际 ${tier('NJUST-02')}）`);
}

// 05 改条件重算 --------------------------------------------------------------
step('05', '改条件重算 POST /api/recompute');
{
  const { status, json } = await post('/api/recompute', {
    baseline: candidate,
    changes: { rank: 4000 },
    candidates,
    rules,
  });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  const changed = (json.data?.diff?.changed ?? []).find((c) => c.candidate_id === 'SEU-08');
  assert(!!changed, `SEU-08 跨档进 diff.changed（稳妥→保底）`);
  assert(json.data?.new_conditions?.rank === 4000, `new_conditions.rank=4000`);
}

// 异常路径 ------------------------------------------------------------------
step('异常', '信息不足 → info_insufficient');
{
  const { json } = await post('/api/eligibility', {
    candidate: { province: '江苏', year: 2026 },
    candidates,
    rules,
  });
  assert(json.outcome?.status === 'info_insufficient', `缺条件 → info_insufficient（实际 ${json.outcome?.status}）`);
  assert(!!json.outcome?.next_step, `附 next_step`);
}

console.log('\n========================================');
if (failures === 0) {
  console.log('✅ QA 6 步回归全过');
  process.exit(0);
} else {
  console.error(`❌ ${failures} 项失败`);
  process.exit(1);
}
