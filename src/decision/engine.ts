/**
 * 升学规划 Agent — 决策规则引擎（纯函数，可单测、可被 API Routes / QA 脚本驱动）
 *
 * 关键约束（三条红线）：
 *  - 资格校验/概率档 = 确定性规则判定 + 算术，不交给 LLM。
 *  - LLM 只用于「对话建条件」(自然语言→结构化条件) 与「推荐理由」(基于本引擎输出)。
 *
 * 全部为纯函数：输入相同 → 输出相同，无副作用、无 I/O，便于 QA 脚本化驱动 6 步回归。
 */

import type {
  CandidateCard,
  CandidateConditions,
  EligibilityCheckRequest,
  EligibilityResult,
  HistoryRecord,
  Outcome,
  ProbabilityRef,
  RankedCandidate,
  RecomputeRequest,
  RecomputeResponse,
  Rule,
  RuleEvaluation,
  Strategy,
  StrategyGroup,
  VersionDiff,
} from './types';

// ----------------------------------------------------------------------------
// 可调阈值（位次差法 → 概率档；数据年份内可由数据角色校准）
//   rank_diff = candidateRank - schoolMinRank
//   >0  = 考生位次高于(差于)该年最低 → 冲刺
//   略负 = 考生位次略好 → 稳妥
//   深负 = 考生位次明显更好 → 保底
// ----------------------------------------------------------------------------

export const TIER_THRESHOLDS = {
  matchUpper: 0, // rank_diff >= 0 → 冲刺
  safetyUpper: -1500, // rank_diff < -1500 → 保底；中间为稳妥
};

export const DATA_YEARS = '2023-2025';
export const PROB_METHOD = '近3年位次差法';

// ============================================================================
// 1. 单条规则判定
// ============================================================================

/** 判定一条规则对某候选是否通过（按 machine.type 分派） */
export function evaluateRule(
  rule: Rule,
  candidate: CandidateConditions,
  card: CandidateCard,
): RuleEvaluation {
  const { type, params } = rule.machine;
  let passed = false;
  let detail = '';

  switch (type) {
    case 'subject_match': {
      const required = (params.required as string[]) ?? [];
      const have = new Set<string>([candidate.subject.primary, ...candidate.subject.secondary]);
      passed = required.every((s) => have.has(s));
      detail = `要求选科 [${required.join('+')}]，考生为 ${candidate.subject.primary}+${candidate.subject.secondary.join('+')}`;
      break;
    }
    case 'batch': {
      const allowed = (params.allowed as string[]) ?? [];
      passed = allowed.includes(card.school.batch);
      detail = `批次要求 [${allowed.join('/')}]，该组为 ${card.school.batch}`;
      break;
    }
    case 'tuition_le': {
      const max = (params.max as number) ?? candidate.budget?.maxTuition ?? Number.POSITIVE_INFINITY;
      passed = card.recruitment.tuition <= max;
      detail = `学费上限 ${max}，该组 ${card.recruitment.tuition}`;
      break;
    }
    case 'plan_gt': {
      const min = (params.min as number) ?? 0;
      passed = card.recruitment.plan > min;
      detail = `计划数要求 >${min}，该组 ${card.recruitment.plan}`;
      break;
    }
    default:
      passed = true; // 未知规则类型不阻断（由人工复核）
      detail = `未知规则类型 ${type}，暂不阻断`;
  }

  return {
    rule_id: rule.rule_id,
    category: rule.category,
    passed,
    reason: `${passed ? '通过' : '不通过'}：${detail}`,
    source: {
      url: rule.source.url,
      publisher: '官方规则',
      updated: rule.source.effective_period,
      status: rule.source.effective_period,
    },
  };
}

// ============================================================================
// 2. 资格过滤（03）
// ============================================================================

/** 对一组候选逐条执行规则，返回每个候选的资格结果 */
export function checkEligibility(req: EligibilityCheckRequest): EligibilityResult[] {
  return req.candidates.map((card) => {
    const evaluated = req.rules.map((r) => evaluateRule(r, req.candidate, card));
    const blocking = evaluated.filter((r) => !r.passed);
    return {
      candidate_id: card.id,
      passed: blocking.length === 0,
      evaluated_rules: evaluated,
      blocking_rules: blocking,
    };
  });
}

// ============================================================================
// 3. 位次差 → 概率档（确定性算术）
// ============================================================================

/** 取最近一年的历史记录 */
export function latestYear(history: HistoryRecord[]): HistoryRecord | undefined {
  return [...history].sort((a, b) => b.year - a.year)[0];
}

/** 计算候选相对某卡的位次差（candidateRank - latestMinRank） */
export function rankDiff(card: CandidateCard, candidateRank: number): number | undefined {
  const latest = latestYear(card.history);
  if (!latest) return undefined;
  return candidateRank - latest.min_rank;
}

/** 由位次差推断概率档（标注方法 + 数据年份，非预测） */
export function probabilityRef(rankDiffValue: number | undefined): ProbabilityRef {
  const tier =
    rankDiffValue === undefined
      ? '冲刺'
      : rankDiffValue >= TIER_THRESHOLDS.matchUpper
        ? '冲刺'
        : rankDiffValue < TIER_THRESHOLDS.safetyUpper
          ? '保底'
          : '稳妥';
  return {
    tier,
    pct_ref_band: pctBand(tier),
    method: PROB_METHOD,
    data_years: DATA_YEARS,
  };
}

function pctBand(tier: ProbabilityRef['tier']): string {
  switch (tier) {
    case '冲刺':
      return '<40%';
    case '稳妥':
      return '40-75%';
    case '保底':
      return '>75%';
  }
}

// ============================================================================
// 4. 方案比较（04）：按策略排序 + 组装候选卡
// ============================================================================

/** 把通过资格的候选卡组装成带概率档/理由的排序列表 */
export function rankCandidates(
  cards: CandidateCard[],
  candidate: CandidateConditions,
  strategy: Strategy,
): RankedCandidate[] {
  const ranked = cards.map((card) => {
    const diff = rankDiff(card, candidate.rank) ?? Number.POSITIVE_INFINITY;
    return {
      ...card,
      rank_diff_vs_candidate: diff,
      probability_ref: probabilityRef(diff),
      reason: buildReason(card, candidate, diff),
    };
  });

  // 排序键随策略变化（院校优先 → 层次标签 + 位次差；专业优先 → 学费/计划可达性 + 位次差）
  return ranked.sort((a, b) => {
    if (strategy === '院校优先') {
      const sa = a.school.level_tags.length;
      const sb = b.school.level_tags.length;
      if (sb !== sa) return sb - sa; // 标签多优先
    }
    return a.rank_diff_vs_candidate - b.rank_diff_vs_candidate; // 位次差越小(越负=越稳)越前
  });
}

/** 默认两套策略并排比较 */
export function compare(
  eligible: CandidateCard[],
  candidate: CandidateConditions,
  strategies: Strategy[] = ['院校优先', '专业优先'],
): StrategyGroup[] {
  return strategies.map((s) => ({ strategy: s, candidates: rankCandidates(eligible, candidate, s) }));
}

function buildReason(card: CandidateCard, _candidate: CandidateConditions, diff: number): string {
  const tier = probabilityRef(diff).tier;
  return `${card.school.name} ${card.major_group.group_no}组：近3年最低位次差 ${diff > 0 ? '+' : ''}${diff}，归为「${tier}」（${PROB_METHOD}，${DATA_YEARS}）。`;
}

// ============================================================================
// 5. 改条件重算（05）+ 版本差异
// ============================================================================

/** 合并条件变更（浅合并 + 嵌套对象合并） */
export function applyChanges(
  baseline: CandidateConditions,
  changes: Partial<CandidateConditions>,
): CandidateConditions {
  return {
    ...baseline,
    ...changes,
    preferences: { ...baseline.preferences, ...(changes.preferences ?? {}) },
    budget: { ...baseline.budget, ...(changes.budget ?? {}) },
    subject: changes.subject ?? baseline.subject,
  };
}

/** 改条件后重算，并产出相对 baseline 候选集合的版本差异 */
export function recompute(
  req: RecomputeRequest,
  dataset: { candidates: CandidateCard[]; rules: Rule[] },
): RecomputeResponse {
  const newConditions = applyChanges(req.baseline, req.changes);
  const eligibleCards = checkEligibility({
    candidate: newConditions,
    candidates: dataset.candidates,
    rules: dataset.rules,
  })
    .filter((r) => r.passed)
    .map((r) => dataset.candidates.find((c) => c.id === r.candidate_id)!)
    .filter(Boolean);

  const strategyGroups = compare(eligibleCards, newConditions);
  const diff = diffVsBaseline(dataset.candidates, eligibleCards, req.baseline, dataset.rules);

  return { new_conditions: newConditions, strategy_groups: strategyGroups, diff };
}

/** 计算新候选集合相对 baseline 条件下候选集合的差异 */
export function diffVsBaseline(
  allCards: CandidateCard[],
  newEligible: CandidateCard[],
  baseline: CandidateConditions,
  rules: Rule[],
): VersionDiff {
  const baselineEligibleIds = new Set(
    checkEligibility({ candidate: baseline, candidates: allCards, rules })
      .filter((r) => r.passed)
      .map((r) => r.candidate_id),
  );
  const newIds = new Set(newEligible.map((c) => c.id));
  return {
    added: [...newIds].filter((id) => !baselineEligibleIds.has(id)),
    removed: [...baselineEligibleIds].filter((id) => !newIds.has(id)),
    changed: [],
  };
}

// ============================================================================
// 6. 异常外壳构造（统一 outcome）
// ============================================================================

export function ok(reason = '正常'): Outcome {
  return { status: 'ok', reason };
}
export function noResult(reason: string, nextStep: string): Outcome {
  return { status: 'no_result', reason, next_step: nextStep };
}
export function infoInsufficient(missing: string[]): Outcome {
  return {
    status: 'info_insufficient',
    reason: `缺少关键条件：${missing.join('、')}`,
    next_step: '请在对话中补充上述条件后重试',
  };
}
