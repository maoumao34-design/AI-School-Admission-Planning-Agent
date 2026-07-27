/**
 * 决策规则引擎单测（纯函数）。
 * 覆盖：canonical 4 类 machine 规则（subject_match/batch/tuition_le/plan_gt）、
 *      数据待抽取(null)不阻断、资格聚合(阻断/提示/需复核)、位次差→概率档阈值、
 *      策略排序、改条件重算+版本差异、条件校验。
 */
import { describe, expect, it } from 'vitest';
import {
  applyChanges,
  checkEligibility,
  evaluateRule,
  findMissingConditions,
  probabilityRef,
  rankCandidates,
  recompute,
  tierOf,
} from './engine';
import type { CandidateCard, CandidateConditions, Dataset, ProbabilityTier, Rule } from './types';

// ---- builders --------------------------------------------------------------

function candidate(over: Partial<CandidateConditions> = {}): CandidateConditions {
  return {
    province: '江苏',
    year: 2026,
    score: 637,
    rank: 5200,
    ...over,
    subject: { category: '物理类', primary: '物理', secondary: ['化学'], ...(over.subject ?? {}) },
  };
}

function makeCard(over: Partial<CandidateCard> & { id: string }): CandidateCard {
  return {
    school: { name: 'X大学', code: null, region: '江苏·南京', level_tags: ['211', '公办'], batch: '普通类本科批' },
    major_group: { group_no: '01', subject_requirement: '物理+化学' },
    recruitment: { plan: 10, duration: 4, tuition: 5000 },
    history: [{ year: 2024, plan: 10, min_score: 640, min_rank: 5500 }],
    source: { url: 'https://www.jseea.cn/', updated: '2024-07' },
    ...over,
  };
}

const subjRule = (over: Partial<Rule> = {}): Rule => ({
  rule_id: 'SUBJ-1',
  category: '选科',
  applies_to: 'major_group',
  raw_text: '首选物理+再选化学',
  machine: { type: 'subject_match', params: { required: ['物理', '化学'] } },
  source: { url: 'https://www.jseea.cn/', effective_period: '2024–2026' },
  ...over,
});

// ===========================================================================
// 1. 位次差 → 概率档阈值（对齐 DATA-PACKAGE §3）
// ===========================================================================

describe('probability tiers (位次差法)', () => {
  const cases: Array<[number | undefined, ProbabilityTier]> = [
    [-1500, '保底'],
    [-1501, '保底'],
    [-1499, '稳妥'],
    [0, '稳妥'],
    [1, '冲刺'],
    [1500, '冲刺'],
    [1501, '差距过大'],
    [undefined, '冲刺'],
  ];
  for (const [diff, expected] of cases) {
    it(`rank_diff=${diff} → ${expected}`, () => {
      expect(tierOf(diff)).toBe(expected);
    });
  }
  it('probabilityRef 标注方法 + 数据年份（非预测）', () => {
    const ref = probabilityRef(-745, '2023-2025');
    expect(ref.tier).toBe('稳妥');
    expect(ref.method).toBe('近3年位次差法');
    expect(ref.data_years).toBe('2023-2025');
  });
});

// ===========================================================================
// 2. evaluateRule — canonical 4 类 machine 类型
// ===========================================================================

describe('evaluateRule · subject_match (params.required[])', () => {
  it('要求科目 ⊆ 考生{首选∪再选} → 通过(阻断)', () => {
    const r = evaluateRule(subjRule(), candidate(), makeCard({ id: 'A' }));
    expect(r.passed).toBe(true);
    expect(r.blocking).toBe(true);
  });
  it('考生缺少要求科目 → 不通过(阻断)', () => {
    const r = evaluateRule(
      subjRule({ machine: { type: 'subject_match', params: { required: ['物理', '化学', '生物'] } } }),
      candidate(),
      makeCard({ id: 'A' }),
    );
    expect(r.passed).toBe(false);
    expect(r.blocking).toBe(true);
  });
  it('仅要求首选 → 通过', () => {
    const r = evaluateRule(
      subjRule({ machine: { type: 'subject_match', params: { required: ['物理'] } } }),
      candidate(),
      makeCard({ id: 'A' }),
    );
    expect(r.passed).toBe(true);
  });
});

describe('evaluateRule · batch (params.allowed[])', () => {
  const rule: Rule = {
    rule_id: 'BATCH',
    category: '批次',
    applies_to: 'global',
    raw_text: '仅本科批',
    machine: { type: 'batch', params: { allowed: ['普通类本科批'] } },
    source: { url: '', effective_period: '2026' },
  };
  it('卡批次 ∈ allowed → 通过(阻断)', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A' }));
    expect(r.passed).toBe(true);
    expect(r.blocking).toBe(true);
  });
  it('卡批次 ∉ allowed(专科) → 不通过(阻断)', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', school: { name: 'Y', code: null, region: '', level_tags: [], batch: '普通类专科批' } }));
    expect(r.passed).toBe(false);
    expect(r.blocking).toBe(true);
  });
});

describe('evaluateRule · tuition_le (params.max)', () => {
  const rule: Rule = {
    rule_id: 'FEE',
    category: '费用',
    raw_text: '学费上限硬过滤',
    machine: { type: 'tuition_le', params: { max: 60000 } },
    source: { url: '', effective_period: '' },
  };
  it('学费 ≤ max → 通过(阻断)', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', recruitment: { plan: 10, duration: 4, tuition: 6380 } }));
    expect(r.passed).toBe(true);
    expect(r.blocking).toBe(true);
  });
  it('学费 > max → 不通过(阻断，挡超预算/中外合作)', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', recruitment: { plan: 10, duration: 4, tuition: 70000, program_type: '中外合作办学' } }));
    expect(r.passed).toBe(false);
    expect(r.blocking).toBe(true);
  });
  it('学费 null(待抽取) → 不阻断 + caveat（不因缺值误杀）', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', recruitment: { plan: 10, duration: 4, tuition: null } }));
    expect(r.passed).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.caveat).toContain('待从官方抽取');
  });
});

describe('evaluateRule · plan_gt (params.min)', () => {
  const rule: Rule = {
    rule_id: 'PLAN',
    category: '计划',
    raw_text: '当年须有招生计划',
    machine: { type: 'plan_gt', params: { min: 0 } },
    source: { url: '', effective_period: '2026' },
  };
  it('计划数 > min → 通过(阻断)', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', recruitment: { plan: 503, duration: 4, tuition: 5000 } }));
    expect(r.passed).toBe(true);
  });
  it('计划数 = 0 → 不通过(阻断，停招/缩招)', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', recruitment: { plan: 0, duration: 4, tuition: 5000 } }));
    expect(r.passed).toBe(false);
    expect(r.blocking).toBe(true);
  });
  it('计划数 null(待抽取) → 不阻断 + caveat', () => {
    const r = evaluateRule(rule, candidate(), makeCard({ id: 'A', recruitment: { plan: null, duration: 4, tuition: 5000 } }));
    expect(r.passed).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.caveat).toContain('待计划汇编抽取');
  });
});

describe('evaluateRule · unknown type', () => {
  it('未知规则类型 → 不阻断 + 转人工复核 caveat', () => {
    const r = evaluateRule(
      { rule_id: 'X', category: '其他', raw_text: '', machine: { type: 'mystery_check', params: { foo: 1 } }, source: { url: '', effective_period: '' } },
      candidate(),
      makeCard({ id: 'A' }),
    );
    expect(r.passed).toBe(true);
    expect(r.blocking).toBe(false);
    expect(r.caveat).toContain('人工复核');
  });
});

// ===========================================================================
// 3. checkEligibility — 聚合 阻断/提示/需复核
// ===========================================================================

describe('checkEligibility · aggregation', () => {
  it('有阻断规则 → passed=false', () => {
    const rules = [subjRule({ machine: { type: 'subject_match', params: { required: ['历史'] } } })];
    const results = checkEligibility({ candidate: candidate(), candidates: [makeCard({ id: 'A' })], rules });
    expect(results[0].passed).toBe(false);
    expect(results[0].blocking_rules).toHaveLength(1);
  });
  it('仅待抽取规则 → passed=true 且 needs_review=true，提示进 advisories', () => {
    const rules: Rule[] = [
      { rule_id: 'FEE', category: '费用', raw_text: '', machine: { type: 'tuition_le', params: { max: 60000 } }, source: { url: '', effective_period: '' } },
      { rule_id: 'PLAN', category: '计划', raw_text: '', machine: { type: 'plan_gt', params: { min: 0 } }, source: { url: '', effective_period: '' } },
    ];
    const results = checkEligibility({
      candidate: candidate(),
      candidates: [makeCard({ id: 'A', recruitment: { plan: null, duration: 4, tuition: null } })],
      rules,
    });
    expect(results[0].passed).toBe(true);
    expect(results[0].needs_review).toBe(true);
    expect(results[0].advisories.length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// 4. rankCandidates · 策略排序（确定性）
// ===========================================================================

describe('rankCandidates · strategy sort', () => {
  const cards = [
    makeCard({ id: 'PRESTIGE', school: { name: 'P', code: null, region: '', level_tags: ['985', '211', '双一流', '公办'], batch: '' }, history: [{ year: 2024, plan: 1, min_score: 1, min_rank: 5000 }] }),
    makeCard({ id: 'SAFE', history: [{ year: 2024, plan: 1, min_score: 1, min_rank: 8000 }] }),
  ];
  it('院校优先：层次标签多优先', () => {
    expect(rankCandidates(cards, candidate(), '院校优先')[0].id).toBe('PRESTIGE');
  });
  it('专业优先：位次差越小(越稳)越前', () => {
    expect(rankCandidates(cards, candidate(), '专业优先')[0].id).toBe('SAFE');
  });
  it('每个候选都带概率档+位次差+理由', () => {
    for (const c of rankCandidates(cards, candidate(), '均衡')) {
      expect(c.probability_ref.tier).toBeTruthy();
      expect(typeof c.rank_diff_vs_candidate).toBe('number');
      expect(c.reason).toContain('位次差');
    }
  });
});

// ===========================================================================
// 5. recompute + 版本差异
// ===========================================================================

describe('recompute · version diff', () => {
  it('改 rank 使某候选跨档 → diff.changed 非空', () => {
    const dataset: Dataset = {
      candidates: [makeCard({ id: 'A', history: [{ year: 2024, plan: 1, min_score: 1, min_rank: 5200 }] })], // diff 0 → 稳妥
      rules: [],
    };
    const res = recompute({ baseline: candidate({ rank: 5200 }), changes: { rank: 4000 } }, dataset);
    expect(res.new_conditions.rank).toBe(4000);
    // 跨档：rank 改到 7000 → diff=1800 → 差距过大（原稳妥）
    const res2 = recompute({ baseline: candidate({ rank: 5200 }), changes: { rank: 7000 } }, dataset);
    const changed = res2.diff.changed.find((c) => c.candidate_id === 'A');
    expect(changed).toBeTruthy();
    expect(changed?.from).toBe('稳妥');
    expect(changed?.to).toBe('差距过大');
  });
});

// ===========================================================================
// 6. findMissingConditions + applyChanges
// ===========================================================================

describe('conditions validation', () => {
  it('缺关键条件 → 返回缺失项', () => {
    const missing = findMissingConditions({ province: '江苏', year: 2026 });
    expect(missing).toContain('选科');
    expect(missing).toContain('分数');
    expect(missing).toContain('位次');
  });
  it('齐全 → 空', () => {
    expect(findMissingConditions(candidate())).toEqual([]);
  });
  it('applyChanges 浅合并 + 嵌套合并', () => {
    const merged = applyChanges(
      candidate({ preferences: { region: ['南京'], schoolLevel: ['211'] } }),
      { score: 700, preferences: { schoolLevel: ['985'] } },
    );
    expect(merged.score).toBe(700);
    expect(merged.preferences!.region).toEqual(['南京']);
    expect(merged.preferences!.schoolLevel).toEqual(['985']);
  });
});
