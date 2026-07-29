#!/usr/bin/env node
/**
 * QA 6 步回归脚本（黑盒，驱动真实 HTTP 路由）。
 *
 * 数据源：直接读 data/sample-jiangsu-2026-phys.json + data/rules.example.json
 *   ——与线上/运行时(adapter)同一份 canonical 数据，避免 tests/fixtures 副本漂移。
 *   （tests/fixtures 副本仅供 vitest e2e-dataset 单测；黑盒回归须与部署一致。）
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
 *   + 选科维度   → 物理+生物 考生只命中「物理(再选不限)」组，验证 per-card subject_requirement
 *
 * 退出码：全过=0，有失败=1。便于 CI / QA 断言。
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = process.env.BASE_URL ?? 'http://localhost:3000';
const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');

// ★ 黑盒回归与运行时同源：读 data/（部署时 adapter 也读 data/），不再读 tests/fixtures 副本
const sample = JSON.parse(readFileSync(resolve(root, 'data/sample-jiangsu-2026-phys.json'), 'utf8'));
const rulesFile = JSON.parse(readFileSync(resolve(root, 'data/rules.example.json'), 'utf8'));
const rules = Array.isArray(rulesFile) ? rulesFile : rulesFile.rules;

// 01 对话建立条件（这里直接取样本考生上下文；线上由 LLM 从自然语言抽取）
const candidate = sample.candidate_context; // {province,year,subject{...},score,rank}
const candidates = sample.cards;

let failures = 0;
const step = (n, title) => console.log(`\n——— 步骤 ${n}：${title} ———`);
function assert(cond, msg) {
  if (cond) console.log(`  ✅ ${msg}`);
  else { console.error(`  ❌ ${msg}`); failures++; }
}
async function post(path, body) {
  const res = await fetch(BASE + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  return { status: res.status, json: await res.json() };
}

console.log(`QA 6 步回归 · 目标服务 ${BASE}（端到端只跑一个服务）`);
console.log(`数据源 data/sample（${candidates.length} 卡，与运行时同源）`);

// 03 资格校验 ----------------------------------------------------------------
step('03', '资格校验 POST /api/eligibility（4 类规则真判定 · per-card 选科 · 数据感知）');
{
  const { status, json } = await post('/api/eligibility', { candidate, candidates, rules });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  // 样本含待抽取字段(tuition/plan=null)→outcome=needs_manual_review；规则仍真判定。两种"成功"状态都接受。
  assert(json.outcome?.status === 'ok' || json.outcome?.status === 'needs_manual_review',
    `outcome 为 ok/needs_manual_review（实际 ${json.outcome?.status}）`);
  const passed = (json.data ?? []).filter((r) => r.passed);
  // 数据感知：物理类考生只匹配物理类卡（历史类被 per-card subject 过滤）；通过数=物理类卡数
  const expectedPassed = candidates.filter((c) => (c.major_group.subject_requirement || '').startsWith('物理')).length;
  const histLeaked = passed.some((r) => {
    const card = candidates.find((c) => c.id === r.candidate_id);
    return (card?.major_group.subject_requirement || '').startsWith('历史');
  });
  assert(!histLeaked, `历史类卡被 per-card subject 正确过滤（不进 passed）`);
  assert(passed.length === expectedPassed, `通过数=物理类卡数 ${expectedPassed}（实际 ${passed.length}）`);
  // 真实规则调用：首卡(SEU-06，字段齐全) batch/tuition_le/plan_gt 不落 default
  const sample0 = (json.data ?? []).find((r) => r.candidate_id === 'SEU-06');
  const blockingCount = sample0?.evaluated_rules?.filter((e) => e.blocking)?.length ?? 0;
  assert(blockingCount === 4, `SEU-06 四类规则均为真资格门 blocking（实际 ${blockingCount}）`);
  assert(json.trace?.rules_applied?.length === 4, `trace 记录 4 条规则（实际 ${json.trace?.rules_applied?.length}）`);
}

// 选科维度（per-card subject_requirement 黑盒覆盖）--------------------------
step('03b', '选科维度：物理+生物考生 → 只命中「物理(再选不限)」组（SEU-07）');
{
  const bioCandidate = { ...candidate, subject: { category: '物理类', primary: '物理', secondary: ['生物'] } };
  const { status, json } = await post('/api/eligibility', { candidate: bioCandidate, candidates, rules });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  const passed = (json.data ?? []).filter((r) => r.passed);
  // 数据感知：物理+生物考生只命中「物理(再选不限)」组(物理/物理+不限)，物理+化学组被过滤
  const expectedBio = candidates
    .filter((c) => {
      const r = (c.major_group.subject_requirement || '').split('+').map((s) => s.trim());
      if (r[0] !== '物理') return false;
      const sec = r.slice(1);
      return sec.length === 0 || sec.includes('不限');
    })
    .map((c) => c.id);
  assert(passed.length === expectedBio.length, `通过数=物理(再选不限)组数 ${expectedBio.length}（实际 ${passed.length}）`);
  assert(expectedBio.every((id) => passed.find((r) => r.candidate_id === id)), `通过的恰为物理(再选不限)组：${expectedBio.join('/')}`);
  const chemCards = candidates.filter((c) => (c.major_group.subject_requirement || '').split('+').map((s) => s.trim()).includes('化学')).map((c) => c.id);
  const chemFailed = chemCards.every((id) => !(json.data ?? []).find((r) => r.candidate_id === id)?.passed);
  assert(chemFailed, `${chemCards.length} 个 物理+化学 组全部因缺化学被过滤（per-card subject 生效）`);
}

// 04 方案比较 ----------------------------------------------------------------
step('04', '方案比较 POST /api/compare（含差距过大分离 out_of_reach）');
{
  const { status, json } = await post('/api/compare', { candidate, candidates, rules });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  const groups = json.data?.groups ?? [];
  const outOfReach = json.data?.out_of_reach ?? [];
  assert(groups.length >= 2, `至少 2 套策略（实际 ${groups.length}）`);
  const tier = (id) => groups[0]?.candidates.find((c) => c.id === id)?.probability_ref?.tier;
  const oorTier = (id) => outOfReach.find((c) => c.id === id)?.probability_ref?.tier;
  assert(tier('SEU-08') === '稳妥', `SEU-08=稳妥（实际 ${tier('SEU-08')}）`);
  assert(tier('NJUST-03') === '保底', `NJUST-03=保底（实际 ${tier('NJUST-03')}）`);
  assert(tier('HHU-05') === '保底', `HHU-05=保底（实际 ${tier('HHU-05')}）`);
  // 扩样覆盖：3 个差距过大组(SEU-06/NJU-07/SEU-07)进 out_of_reach，不混入主推荐
  const oorIds = outOfReach.map((c) => c.id);
  assert(['SEU-06', 'NJU-07', 'SEU-07'].every((id) => oorIds.includes(id)),
    `out_of_reach 含 SEU-06/NJU-07/SEU-07 三差距过大组（实际 ${oorIds.join('/') || '空'}）`);
  assert(oorTier('SEU-06') === '差距过大', `SEU-06=差距过大（实际 ${oorTier('SEU-06')}）`);
  assert(!groups.some((g) => g.candidates.some((c) => ['SEU-06', 'NJU-07', 'SEU-07'].includes(c.id))),
    '差距过大组不混入主推荐列表');
}

// 05 改条件重算 --------------------------------------------------------------
step('05', '改条件重算 POST /api/recompute');
{
  const { status, json } = await post('/api/recompute', { baseline: candidate, changes: { rank: 4000 }, candidates, rules });
  assert(status === 200, `HTTP 200（实际 ${status}）`);
  const changed = (json.data?.diff?.changed ?? []).find((c) => c.candidate_id === 'SEU-08');
  assert(!!changed, `SEU-08 跨档进 diff.changed（稳妥→保底）`);
  assert(json.data?.new_conditions?.rank === 4000, `new_conditions.rank=4000`);
}

// 异常路径 ------------------------------------------------------------------
step('异常', '信息不足 → info_insufficient');
{
  const { json } = await post('/api/eligibility', { candidate: { province: '江苏', year: 2026 }, candidates, rules });
  assert(json.outcome?.status === 'info_insufficient', `缺条件 → info_insufficient（实际 ${json.outcome?.status}）`);
  assert(!!json.outcome?.next_step, `附 next_step`);
}

console.log('\n========================================');
if (failures === 0) { console.log('✅ QA 6 步回归全过'); process.exit(0); }
else { console.error(`❌ ${failures} 项失败`); process.exit(1); }
