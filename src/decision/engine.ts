/**
 * 升学规划 Agent — 决策规则引擎（纯函数，可单测、可被 API Routes / QA 脚本驱动）
 *
 * 关键约束（三条红线）：
 *  - 资格校验/概率档 = 确定性规则判定 + 算术，不交给 LLM。
 *  - LLM 只用于「对话建条件」(自然语言→结构化条件) 与「推荐理由」润色(基于本引擎输出)。
 *
 * 全部为纯函数：输入相同 → 输出相同，无副作用、无 I/O，便于 QA 脚本化驱动 6 步回归。
 * 唯一「时间相关」项是 trace.generated_at，通过 now 参数注入以保证可复现单测。
 *
 * 字段对齐：消费数据角色交付的 JSON（CandidateCard / Rule），少量表示差异由 adapter.ts 归一。
 */

import type {
  BatchLines,
  CandidateCard,
  CandidateConditions,
  Dataset,
  DecisionResponse,
  DecisionTrace,
  EligibilityCheckRequest,
  EligibilityResult,
  FlagMachine,
  HistoryRecord,
  Outcome,
  PresenceMachine,
  ProbabilityRef,
  ProbabilityTier,
  RankedCandidate,
  RecomputeRequest,
  RecomputeResponse,
  Rule,
  RuleEvaluation,
  ScoreThresholdMachine,
  Strategy,
  StrategyGroup,
  SubjectCategory,
  SubjectMatchMachine,
  VersionDiff,
} from './types';

// ----------------------------------------------------------------------------
// 可调阈值（位次差法 → 概率档；对齐 DATA-PACKAGE §3）
//   rank_diff = candidateRank - schoolMinRank   （位次数越小越好）
//   保底   : rank_diff <= -1500   （考生明显优于近3年投档线）
//   稳妥   : -1500 < rank_diff <= 0
//   冲刺   : 0 < rank_diff <= +1500
//   差距过大(不推荐): rank_diff > +1500
// ----------------------------------------------------------------------------

export const TIER_THRESHOLDS = {
  safetyUpper: -1500, // <=  → 保底
  stableUpper: 0, // <= (且 > safetyUpper) → 稳妥
  reachUpper: 1500, // <= (且 > stableUpper) → 冲刺；>  → 差距过大
} as const;

export const DEFAULT_DATA_YEARS = '2024'; // 样本目前仅 2024 一年（待补 2023/2025）
export const PROB_METHOD = '近3年位次差法';

// ============================================================================
// 1. 单条规则判定（按 machine.type 分派；数据待抽取/无法判定 → 不阻断 + caveat）
// ============================================================================

/**
 * 判定一条规则对某候选是否通过。
 * 设计：只有「能确定不满足硬条件」才阻断；数据缺失/待抽取/提示性规则一律不阻断，
 *      改为附 caveat 并标 needs_review（对应异常路径「需人工复核」「数据过期」）。
 */
export function evaluateRule(
  rule: Rule,
  candidate: CandidateConditions,
  card: CandidateCard,
  ctx: { batch_lines?: BatchLines; year?: number } = {},
): RuleEvaluation {
  const m = rule.machine;
  let passed = false;
  let blocking = true; // 默认阻断；下列分支按需改 false
  let detail = '';
  let caveat: string | undefined;

  switch (m.type) {
    case 'subject_match': {
      const sm = m as SubjectMatchMachine;
      const preferred = sm.preferred_required;
      const requiredReselect = sm.reselect_required ?? [];
      const primaryOk = candidate.subject.primary === preferred;
      const have = new Set<string>(candidate.subject.secondary);
      const reselectOk = requiredReselect.every((s) => have.has(s));
      passed = primaryOk && reselectOk;
      detail =
        `要求首选「${preferred}」+再选[${requiredReselect.join('/') || '无'}]，` +
        `考生首选「${candidate.subject.primary}」+再选[${candidate.subject.secondary.join('/')}]`;
      break;
    }

    case 'score_threshold': {
      const st = m as ScoreThresholdMachine;
      // ref 形如 batch_line.本科.物理类；志愿填报期当年批次线多未公布
      const threshold = resolveThreshold(st.ref, candidate.subject.category, ctx.batch_lines);
      if (threshold === undefined) {
        // 数据未公布 → 不阻断，标注需复核（不能因缺数据淘汰考生）
        passed = true;
        blocking = false;
        detail = `批次线引用「${st.ref}」暂不可得`;
        caveat = `批次线「${st.ref}」待官方公布/复核，本规则暂不阻断，填报后需确认过线`;
      } else {
        passed = compareNum(candidate.score, st.op, threshold);
        detail = `考生分数 ${candidate.score} ${st.op} 批次线 ${threshold}（${st.ref}）`;
      }
      break;
    }

    case 'flag': {
      const fl = m as FlagMachine;
      // 提示性标记（如中外合作办学高收费），advisory=true 永不阻断
      const fieldValue = readField(card, fl.field);
      const hit = fieldValue != null && String(fieldValue) === fl.equals;
      passed = true;
      blocking = false;
      detail = `字段 ${fl.field}=${fieldValue == null ? '（无）' : String(fieldValue)}，命中标记「${fl.equals}」=${hit}`;
      if (hit) caveat = `${rule.raw_text}（advisory：不影响资格，仅提示知悉）`;
      break;
    }

    case 'presence': {
      const pr = m as PresenceMachine;
      // 如 recruitment.plan_<year> > 0；样本里 plan 常为 null=待抽取
      const resolved = resolvePresenceField(pr.field, card, ctx.year ?? candidate.year);
      if (resolved.value === undefined || resolved.value === null) {
        passed = true; // 数据待抽取 → 不阻断
        blocking = false;
        detail = `字段 ${pr.field} 当前为空（待抽取）`;
        caveat = `${resolved.label}待从官方抽取，本规则暂不阻断；正式集应有值后复评`;
      } else {
        passed = applyPresenceOp(Number(resolved.value), pr.op);
        detail = `字段 ${pr.field}=${resolved.value} ${pr.op} → ${passed ? '满足' : '不满足'}`;
      }
      break;
    }

    default: {
      // 未知规则类型：不阻断，转人工复核（不静默放行也不误杀）
      passed = true;
      blocking = false;
      detail = `未知规则类型「${m.type}」，暂不阻断`;
      caveat = `规则 ${rule.rule_id} 类型未实现，需人工复核`;
    }
  }

  const reason = `${passed ? '通过' : '不通过'}：${detail}`;
  return {
    rule_id: rule.rule_id,
    category: rule.category,
    passed,
    blocking,
    reason,
    caveat,
    source: rule.source,
  };
}

// ---- 规则判定的小工具 -------------------------------------------------------

function resolveThreshold(
  ref: string,
  category: SubjectCategory,
  batch_lines?: BatchLines,
): number | undefined {
  // ref 形如 "batch_line.本科.物理类"
  if (!batch_lines) return undefined;
  const parts = ref.split('.');
  if (parts[0] !== 'batch_line') return undefined;
  const batch = parts[1]; // 本科 / 专科
  const cat = (parts[2] as SubjectCategory) ?? category;
  const node = (batch_lines as Record<string, unknown>)[batch];
  if (!node || typeof node !== 'object') return undefined;
  const v = (node as Record<string, unknown>)[cat];
  return typeof v === 'number' ? v : undefined;
}

function compareNum(a: number, op: string, b: number): boolean {
  switch (op) {
    case '>=':
      return a >= b;
    case '>':
      return a > b;
    case '<=':
      return a <= b;
    case '<':
      return a < b;
    default:
      return false;
  }
}

/** 读取 card 上的字段（用于 flag / presence）：支持点路径与裸键（自动查 card/recruitment/school/major_group） */
function readField(card: CandidateCard, field: string): unknown {
  if (field.includes('.')) {
    return field.split('.').reduce<unknown>((acc, key) => {
      if (acc && typeof acc === 'object' && key in (acc as Record<string, unknown>)) {
        return (acc as Record<string, unknown>)[key];
      }
      return undefined;
    }, card);
  }
  const containers: unknown[] = [card, card.recruitment, card.school, card.major_group];
  for (const c of containers) {
    if (c && typeof c === 'object' && field in (c as Record<string, unknown>)) {
      return (c as Record<string, unknown>)[field];
    }
  }
  return undefined;
}

/** presence 字段解析：recruitment.plan_<year> → 取 plan_by_year[year] */
function resolvePresenceField(
  field: string,
  card: CandidateCard,
  year: number,
): { value: unknown; label: string } {
  // 支持 "recruitment.plan_<year>" 与 "recruitment.plan_2024" 两种写法
  const m = /^recruitment\.plan_(?:<year>|(\d{4}))$/.exec(field);
  if (m) {
    const y = m[1] ? m[1] : String(year);
    const v = card.recruitment.plan_by_year?.[y];
    return { value: v, label: `${year}年招生计划` };
  }
  // 退化为通用点路径
  return { value: readField(card, field), label: field };
}

function applyPresenceOp(value: number, op: string): boolean {
  // op 形如 "> 0"
  const mm = /^\s*(>=|<=|>|<|=|==)\s*(-?\d+(?:\.\d+)?)\s*$/.exec(op);
  if (!mm) return value > 0; // 无法解析时按「>0」处理
  return compareNum(value, mm[1] === '=' || mm[1] === '==' ? '==' : mm[1], Number(mm[2]));
}

// ============================================================================
// 2. 资格过滤（03）：逐条规则 → 每候选资格结果（含阻断/提示/需复核）
// ============================================================================

export function checkEligibility(req: EligibilityCheckRequest): EligibilityResult[] {
  return req.candidates.map((card) => {
    const evaluated = req.rules.map((r) =>
      evaluateRule(r, req.candidate, card, { batch_lines: req.batch_lines, year: req.candidate.year }),
    );
    const blocking_rules = evaluated.filter((r) => !r.passed && r.blocking);
    const advisories = evaluated
      .map((r) => r.caveat)
      .filter((x): x is string => typeof x === 'string');
    const needs_review = evaluated.some((r) => r.passed && r.blocking === false && !!r.caveat);
    return {
      candidate_id: card.id,
      passed: blocking_rules.length === 0,
      evaluated_rules: evaluated,
      blocking_rules,
      advisories,
      needs_review,
    };
  });
}

// ============================================================================
// 3. 位次差 → 概率档（确定性算术，对齐 DATA-PACKAGE §3）
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
export function probabilityRef(
  rankDiffValue: number | undefined,
  dataYears: string = DEFAULT_DATA_YEARS,
): ProbabilityRef {
  const tier = tierOf(rankDiffValue);
  return {
    tier,
    pct_ref_band: pctBand(tier),
    method: PROB_METHOD,
    data_years: dataYears,
  };
}

export function tierOf(rankDiffValue: number | undefined): ProbabilityTier {
  if (rankDiffValue === undefined) return '冲刺'; // 无历史数据 → 默认保守归冲刺并提示
  if (rankDiffValue <= TIER_THRESHOLDS.safetyUpper) return '保底';
  if (rankDiffValue <= TIER_THRESHOLDS.stableUpper) return '稳妥';
  if (rankDiffValue <= TIER_THRESHOLDS.reachUpper) return '冲刺';
  return '差距过大';
}

function pctBand(tier: ProbabilityTier): string {
  switch (tier) {
    case '保底':
      return '>75%';
    case '稳妥':
      return '40-75%';
    case '冲刺':
      return '<40%';
    case '差距过大':
      return '极低（不推荐）';
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
  dataYears: string = DEFAULT_DATA_YEARS,
): RankedCandidate[] {
  const ranked = cards.map((card) => {
    const diff = rankDiff(card, candidate.rank) ?? Number.POSITIVE_INFINITY;
    const probability_ref = probabilityRef(diff, dataYears);
    return {
      ...card,
      rank_diff_vs_candidate: diff,
      probability_ref,
      reason: buildReason(card, candidate, diff, probability_ref.tier),
    };
  });

  return ranked.sort((a, b) => sortByStrategy(strategy, a, b));
}

/**
 * 排序键随策略变化（确定性、可单测）：
 *  - 院校优先：层次标签数多优先 → 位次差越小(越稳)越前
 *  - 专业优先：位次差越小(越稳)越前 → 学费越低越前（可达性 + 经济性）
 *  - 均衡    ：位次差越小越前
 */
function sortByStrategy(strategy: Strategy, a: RankedCandidate, b: RankedCandidate): number {
  const da = a.rank_diff_vs_candidate;
  const db = b.rank_diff_vs_candidate;
  if (strategy === '院校优先') {
    const sa = a.school.level_tags.length;
    const sb = b.school.level_tags.length;
    if (sb !== sa) return sb - sa;
    return da - db;
  }
  if (strategy === '专业优先') {
    if (da !== db) return da - db;
    const ta = a.recruitment.tuition ?? Number.POSITIVE_INFINITY;
    const tb = b.recruitment.tuition ?? Number.POSITIVE_INFINITY;
    return ta - tb;
  }
  return da - db; // 均衡
}

/** 默认两套策略并排比较 */
export function compare(
  eligible: CandidateCard[],
  candidate: CandidateConditions,
  strategies: Strategy[] = ['院校优先', '专业优先'],
  dataYears: string = DEFAULT_DATA_YEARS,
): StrategyGroup[] {
  return strategies.map((s) => ({
    strategy: s,
    candidates: rankCandidates(eligible, candidate, s, dataYears),
  }));
}

function buildReason(
  card: CandidateCard,
  _candidate: CandidateConditions,
  diff: number,
  tier: ProbabilityTier,
): string {
  if (!Number.isFinite(diff)) {
    return `${card.school.name} ${card.major_group.group_no}组：缺历史位次数据，概率档为保守估计（${PROB_METHOD}），需补近3年数据。`;
  }
  const sign = diff > 0 ? '+' : '';
  return (
    `${card.school.name} ${card.major_group.group_no}组：` +
    `考生位次相对该组最近年投档线位次差 ${sign}${diff}，归为「${tier}」` +
    `（${PROB_METHOD}，参考用，非录取预测）。`
  );
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
  dataset: Dataset,
  dataYears: string = DEFAULT_DATA_YEARS,
): RecomputeResponse {
  const newConditions = applyChanges(req.baseline, req.changes);
  const newEligible = eligibleCardsFor(newConditions, dataset);
  const baselineEligible = eligibleCardsFor(req.baseline, dataset);

  const strategy_groups = compare(newEligible, newConditions, undefined, dataYears);
  const diff = diffEligibleSets(baselineEligible, newEligible, req.baseline, newConditions);

  return { new_conditions: newConditions, strategy_groups, diff };
}

/** 给定条件 + 数据集，返回资格通过的候选卡 */
export function eligibleCardsFor(candidate: CandidateConditions, dataset: Dataset): CandidateCard[] {
  const results = checkEligibility({
    candidate,
    candidates: dataset.candidates,
    rules: dataset.rules,
    batch_lines: dataset.batch_lines,
  });
  const passIds = new Set(results.filter((r) => r.passed).map((r) => r.candidate_id));
  return dataset.candidates.filter((c) => passIds.has(c.id));
}

/**
 * 计算两组候选集合的差异（added/removed/changed）。
 * - added   : 新条件通过、baseline 未通过
 * - removed : baseline 通过、新条件未通过
 * - changed : 两边都通过，但概率档随条件变化（如分数改了→档位变化）
 */
export function diffEligibleSets(
  baselineEligible: CandidateCard[],
  newEligible: CandidateCard[],
  baseline: CandidateConditions,
  next: CandidateConditions,
): VersionDiff {
  const baseMap = new Map(baselineEligible.map((c) => [c.id, c]));
  const newMap = new Map(newEligible.map((c) => [c.id, c]));
  const added = [...newMap.keys()].filter((id) => !baseMap.has(id));
  const removed = [...baseMap.keys()].filter((id) => !newMap.has(id));

  const changed: VersionDiff['changed'] = [];
  for (const id of [...newMap.keys()].filter((id) => baseMap.has(id))) {
    const card = newMap.get(id)!;
    const fromTier = tierOf(rankDiff(card, baseline.rank));
    const toTier = tierOf(rankDiff(card, next.rank));
    if (fromTier !== toTier) {
      changed.push({ candidate_id: id, field: 'probability_ref.tier', from: fromTier, to: toTier });
    }
  }
  return { added, removed, changed };
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
export function dataStale(reason: string, nextStep: string): Outcome {
  return { status: 'data_stale', reason, next_step: nextStep };
}
export function needsManualReview(reason: string, nextStep: string): Outcome {
  return { status: 'needs_manual_review', reason, next_step: nextStep };
}

// ============================================================================
// 7. 条件校验 + 响应组装（API Route 薄层共用）
// ============================================================================

const REQUIRED_FIELDS: Array<{ key: keyof CandidateConditions; label: string }> = [
  { key: 'province', label: '省份' },
  { key: 'year', label: '年度' },
  { key: 'subject', label: '选科' },
  { key: 'score', label: '分数' },
  { key: 'rank', label: '位次' },
];

/** 校验考生条件是否齐全（对话建条件后、进引擎前） */
export function findMissingConditions(candidate: Partial<CandidateConditions> | undefined): string[] {
  if (!candidate) return REQUIRED_FIELDS.map((f) => f.label);
  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = candidate[f.key];
    if (v === undefined || v === null || v === '') missing.push(f.label);
  }
  if (
    candidate.subject &&
    (!candidate.subject.primary || !Array.isArray(candidate.subject.secondary))
  ) {
    missing.push('选科(首选/再选)');
  }
  return missing;
}

/** 组装统一响应外壳（带决策透明化 trace） */
export function buildTrace(
  candidate: CandidateConditions,
  rules: Rule[],
  datasetYear: string,
  now: string = new Date().toISOString(),
): DecisionTrace {
  return {
    conditions_used: candidate,
    rules_applied: rules.map((r) => r.rule_id),
    dataset_year: datasetYear,
    generated_at: now,
  };
}

export function respond<T>(
  outcome: Outcome,
  trace: DecisionTrace,
  data?: T,
): DecisionResponse<T> {
  return { outcome, trace, data };
}
