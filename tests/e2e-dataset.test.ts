/**
 * 端到端：消费数据角色「正式交付」JSON 样本 → adapter → 三个决策端点 handler。
 * 核心断言（含「真实规则调用」红线）：
 *  - 资格校验：4 候选均过 subject_match/batch/tuition_le/plan_gt 四类规则（各自真判定，非空转）
 *  - 方案比较：SEU-06=差距过大 / SEU-08=稳妥 / NJUST-03=保底 / HHU-05=保底
 *  - 改条件重算：rank 改优 → SEU-08 由稳妥跨档为保底 → diff.changed 命中
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseDataset } from '../src/decision/adapter';
import { handleCompare, handleEligibility, handleRecompute } from '../src/decision/handlers';

const here = dirname(fileURLToPath(import.meta.url));
const sampleJson = JSON.parse(readFileSync(resolve(here, 'fixtures/sample-jiangsu-2026-phys.json'), 'utf8'));
const rulesFile = JSON.parse(readFileSync(resolve(here, 'fixtures/rules.example.json'), 'utf8'));
const rules = Array.isArray(rulesFile) ? rulesFile : rulesFile.rules;

const dataset = parseDataset(sampleJson, rules);
const candidate = dataset.candidate!;

describe('adapter · 消费真实 JSON 样本（正式交付）', () => {
  it('解析出样本考生 + 4 张候选卡 + 4 条规则', () => {
    expect(candidate).toBeTruthy();
    expect(candidate.subject.primary).toBe('物理');
    expect(candidate.subject.secondary).toContain('化学');
    expect(candidate.score).toBe(637);
    expect(candidate.rank).toBe(5200);
    expect(dataset.candidates).toHaveLength(4);
    expect(dataset.rules).toHaveLength(4);
  });
  it('recruitment 对齐：plan/tuition 为数值（已抽取）', () => {
    const seu08 = dataset.candidates.find((c) => c.id === 'SEU-08')!;
    expect(seu08.recruitment.plan).toBe(503);
    expect(seu08.recruitment.tuition).toBe(6380);
  });
  it('machine.type = canonical 4 类', () => {
    const types = dataset.rules.map((r) => r.machine.type).sort();
    expect(types).toEqual(['batch', 'plan_gt', 'subject_match', 'tuition_le']);
  });
});

describe('03 资格校验 · 真实样本（真实规则调用，非空转）', () => {
  const res = handleEligibility({ candidate, candidates: dataset.candidates, rules: dataset.rules });

  it('4 候选全部通过（数据齐全 → outcome=ok）', () => {
    expect(res.outcome.status).toBe('ok');
    expect(res.data!.filter((r) => r.passed)).toHaveLength(4);
  });
  it('★ batch/tuition_le/plan_gt 各自真判定、阻断=true（不再落 default 空转）', () => {
    for (const r of res.data!) {
      const byType = new Map(r.evaluated_rules.map((e) => [e.rule_id, e]));
      // 四类规则都在 evaluated_rules 里且 passed + blocking
      const allBlocking = r.evaluated_rules.filter((e) => e.blocking);
      expect(allBlocking.length).toBe(4); // 4 条都是真资格门
      for (const e of r.evaluated_rules) {
        expect(e.passed).toBe(true);
        expect(e.blocking).toBe(true);
      }
      void byType;
    }
  });
  it('trace 含决策透明化：条件/4 条规则/年份/时间', () => {
    expect(res.trace.conditions_used.rank).toBe(5200);
    expect(res.trace.rules_applied.length).toBe(4);
    expect(res.trace.dataset_year).toBe('2023-2025');
    expect(res.trace.generated_at).toBeTruthy();
  });
});

describe('04 方案比较 · 真实样本概率档（2025 最近年）', () => {
  const res = handleCompare({ candidate, candidates: dataset.candidates });
  const tierOf = (id: string) => {
    for (const g of res.data!) {
      const c = g.candidates.find((x) => x.id === id);
      if (c) return c.probability_ref.tier;
    }
    return null;
  };

  it('SEU-06=差距过大 / SEU-08=稳妥 / NJUST-03=保底 / HHU-05=保底', () => {
    expect(tierOf('SEU-06')).toBe('差距过大'); // diff +2582
    expect(tierOf('SEU-08')).toBe('稳妥'); // diff -1162
    expect(tierOf('NJUST-03')).toBe('保底'); // diff -1533
    expect(tierOf('HHU-05')).toBe('保底'); // diff -3637
  });
  it('院校优先排序：SEU-08(985+稳妥) 居首', () => {
    const group = res.data!.find((g) => g.strategy === '院校优先')!;
    expect(group.candidates[0].id).toBe('SEU-08');
  });
  it('每个候选 reason 含位次差 + 非预测声明', () => {
    for (const g of res.data!) {
      for (const c of g.candidates) {
        expect(c.reason).toContain('位次差');
        expect(c.reason).toContain('非录取预测');
      }
    }
  });
});

describe('05 改条件重算 · 版本差异', () => {
  const res = handleRecompute({
    baseline: candidate,
    changes: { rank: 4000 }, // 位次变优
    candidates: dataset.candidates,
    rules: dataset.rules,
  });

  it('SEU-08 由 稳妥 → 保底（跨档，进 diff.changed）', () => {
    const changed = res.data!.diff.changed.find((c) => c.candidate_id === 'SEU-08');
    expect(changed).toBeTruthy();
    expect(changed?.from).toBe('稳妥');
    expect(changed?.to).toBe('保底');
  });
  it('SEU-06 由 差距过大 → 冲刺（跨档）', () => {
    const changed = res.data!.diff.changed.find((c) => c.candidate_id === 'SEU-06');
    expect(changed?.from).toBe('差距过大');
    expect(changed?.to).toBe('冲刺');
  });
  it('新条件下 strategy_groups 含 4 候选', () => {
    expect(res.data!.strategy_groups[0].candidates.length).toBe(4);
  });
});

describe('异常路径 · outcome 显式产出', () => {
  it('信息不足：缺关键条件 → info_insufficient + next_step', () => {
    const res = handleEligibility({ candidate: { province: '江苏', year: 2026 } as never, candidates: dataset.candidates, rules: dataset.rules });
    expect(res.outcome.status).toBe('info_insufficient');
    expect(res.outcome.reason).toContain('选科');
    expect(res.outcome.next_step).toBeTruthy();
    expect(res.data).toBeUndefined();
  });
  it('无结果：无可比较候选 → no_result + next_step', () => {
    const res = handleCompare({ candidate: { ...candidate, subject: { category: '历史类', primary: '历史', secondary: ['政治'] } }, candidates: [] });
    expect(res.outcome.status).toBe('no_result');
    expect(res.outcome.next_step).toBeTruthy();
  });
});
