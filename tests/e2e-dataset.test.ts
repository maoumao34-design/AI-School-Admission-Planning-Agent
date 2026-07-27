/**
 * 端到端：消费数据角色真实 JSON 样本 → adapter → 三个决策端点 handler。
 * 这是「消费数据 JSON」+「6 步回归」的核心断言：
 *  - 资格校验：样本考生(637/5200/物理+化学) 3 个候选均过选科；批次线/计划待抽取 → needs_review
 *  - 方案比较：SEU-08=稳妥 / NJUST-03=保底 / NJUST-02=冲刺
 *  - 改条件重算：rank 改优 → SEU-08 由稳妥跨档为保底 → diff.changed 命中
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { parseDataset, parseSampleCardsJson } from '../src/decision/adapter';
import { handleCompare, handleEligibility, handleRecompute } from '../src/decision/handlers';

const here = dirname(fileURLToPath(import.meta.url));
const samplePath = resolve(here, 'fixtures/sample-jiangsu-2026-phys.json');
const rulesPath = resolve(here, 'fixtures/rules.example.json');

const sampleJson = JSON.parse(readFileSync(samplePath, 'utf8'));
const rulesJson = JSON.parse(readFileSync(rulesPath, 'utf8'));

const dataset = parseDataset(sampleJson, rulesJson);
const candidate = dataset.candidate!;

describe('adapter · 消费真实 JSON 样本', () => {
  it('解析出样本考生上下文 + 3 张候选卡 + 4 条规则', () => {
    expect(candidate).toBeTruthy();
    expect(candidate.subject.primary).toBe('物理');
    expect(candidate.subject.secondary).toContain('化学');
    expect(candidate.score).toBe(637);
    expect(candidate.rank).toBe(5200);
    expect(dataset.candidates).toHaveLength(3);
    expect(dataset.rules).toHaveLength(4);
  });
  it('recruitment.plan_2024 归一到 plan_by_year', () => {
    const seu = dataset.candidates.find((c) => c.id === 'SEU-08')!;
    expect(seu.recruitment.plan_by_year?.['2024']).toBeNull(); // null = 待抽取
    expect(seu.recruitment.tuition).toBeNull();
  });
  it('选科要求对齐为对象', () => {
    const seu = dataset.candidates.find((c) => c.id === 'SEU-08')!;
    expect(seu.major_group.subject_requirement.preferred).toBe('物理');
    expect(seu.major_group.subject_requirement.reselect_required).toEqual(['化学']);
  });
});

describe('03 资格校验 · 真实样本', () => {
  const res = handleEligibility({
    candidate,
    candidates: dataset.candidates,
    rules: dataset.rules,
    batch_lines: dataset.batch_lines,
  });

  it('3 个候选均通过（选科匹配；批次线/计划待抽取不阻断）', () => {
    expect(res.outcome.status).toBe('needs_manual_review'); // 数据待抽取 → 需复核
    const passed = res.data!.filter((r) => r.passed);
    expect(passed).toHaveLength(3);
  });
  it('每个候选 needs_review=true（批次线待公布 + 计划待抽取）', () => {
    for (const r of res.data!) {
      expect(r.needs_review).toBe(true);
      expect(r.advisories.length).toBeGreaterThan(0);
    }
  });
  it('subject_match 规则全部判定通过', () => {
    for (const r of res.data!) {
      const subj = r.evaluated_rules.find((x) => x.rule_id.startsWith('SUBJ'));
      expect(subj?.passed).toBe(true);
    }
  });
  it('trace 含决策透明化：条件/规则/年份/时间', () => {
    expect(res.trace.conditions_used.rank).toBe(5200);
    expect(res.trace.rules_applied.length).toBe(4);
    expect(res.trace.dataset_year).toBeTruthy();
    expect(res.trace.generated_at).toBeTruthy();
  });
});

describe('04 方案比较 · 真实样本概率档', () => {
  const res = handleCompare({ candidate, candidates: dataset.candidates });
  const tierOf = (id: string) => {
    for (const g of res.data!) {
      const c = g.candidates.find((x) => x.id === id);
      if (c) return c.probability_ref.tier;
    }
    return null;
  };

  it('SEU-08=稳妥 / NJUST-03=保底 / NJUST-02=冲刺', () => {
    expect(tierOf('SEU-08')).toBe('稳妥'); // diff -745
    expect(tierOf('NJUST-03')).toBe('保底'); // diff -2433
    expect(tierOf('NJUST-02')).toBe('冲刺'); // diff +1213
  });
  it('院校优先排序：SEU-08(985,4标签) 居首', () => {
    const group = res.data!.find((g) => g.strategy === '院校优先')!;
    expect(group.candidates[0].id).toBe('SEU-08');
  });
  it('每个候选 reason 含位次差 + 方法 + 非预测声明', () => {
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
  it('新条件下的 strategy_groups 非空', () => {
    expect(res.data!.strategy_groups.length).toBeGreaterThan(0);
    expect(res.data!.strategy_groups[0].candidates.length).toBe(3);
  });
});

describe('异常路径 · outcome 显式产出', () => {
  it('信息不足：缺关键条件 → info_insufficient + next_step', () => {
    const res = handleEligibility({
      candidate: { province: '江苏', year: 2026 } as never,
      candidates: dataset.candidates,
      rules: dataset.rules,
    });
    expect(res.outcome.status).toBe('info_insufficient');
    expect(res.outcome.reason).toContain('选科');
    expect(res.outcome.next_step).toBeTruthy();
    expect(res.data).toBeUndefined();
  });
  it('无结果：选科全不匹配 → no_result + next_step', () => {
    const res = handleCompare({
      candidate: { ...candidate, subject: { category: '历史类', primary: '历史', secondary: ['政治'] } },
      candidates: [], // 无候选
    });
    expect(res.outcome.status).toBe('no_result');
    expect(res.outcome.next_step).toBeTruthy();
  });
});
