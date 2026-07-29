/**
 * 升学规划 Agent — 决策规则引擎（纯函数，可单测、可被 API Routes / QA 脚本驱动）
 *
 * 关键约束（三条红线）：
 *  - 资格校验/概率档 = 确定性规则判定 + 算术，不交给 LLM。
 *  - LLM 只用于「对话建条件」与「推荐理由」润色。
 *
 * 全部为纯函数：输入相同 → 输出相同，无副作用、无 I/O。
 * 唯一「时间相关」项是 trace.generated_at，通过 now 参数注入以保证可复现单测。
 *
 * 规则 machine.type canonical 4 类（与数据角色 data/rules.example.json 对齐）：
 *   subject_match(params.required[]) / batch(params.allowed[]) / tuition_le(params.max) / plan_gt(params.min)。
 * 数据待抽取(tuition/plan=null) → 不阻断 + caveat + needs_review（不因样本缺值误杀）。
 */

import type {
  CandidateCard,
  CandidateConditions,
  ComparisonResult,
  ConditionBuildingRequest,
  ConditionBuildingResult,
  ConditionGap,
  Dataset,
  DecisionResponse,
  DecisionTrace,
  EligibilityCheckRequest,
  EligibilityResult,
  HistoryRecord,
  Outcome,
  ProbabilityRef,
  ProbabilityTier,
  RankedCandidate,
  RecomputeRequest,
  RecomputeResponse,
  Rule,
  RuleEvaluation,
  SecondarySubject,
  Strategy,
  StrategyGroup,
  VersionDiff,
} from './types';

// ----------------------------------------------------------------------------
// 可调阈值（位次差法 → 概率档；对齐 DATA-PACKAGE §3）
//   rank_diff = candidateRank - schoolMinRank （位次数越小越好）
//   保底   : rank_diff <= -1500
//   稳妥   : -1500 < rank_diff <= 0
//   冲刺   : 0 < rank_diff <= +1500
//   差距过大(不推荐): rank_diff > +1500
// ----------------------------------------------------------------------------

export const TIER_THRESHOLDS = {
  safetyUpper: -1500,
  stableUpper: 0,
  reachUpper: 1500,
} as const;

export const DEFAULT_DATA_YEARS = '2023-2025'; // 数据「正式交付」含近3年
export const PROB_METHOD = '近3年位次差法';

/** 再选科目上限（江苏 3+1+2：再选 2 门）。用于后端/API 兑底拦截，防绕过前端的脏请求。 */
export const SECONDARY_MAX = 2;

// ============================================================================
// 1. 单条规则判定（按 machine.type 分派；数据待抽取/无法判定 → 不阻断 + caveat）
// ============================================================================

/**
 * 判定一条规则对某候选是否通过。
 * 只有「能确定不满足硬条件」才阻断；数据缺失/待抽取/未知类型一律不阻断，
 * 改为附 caveat 并标 needs_review（对应异常路径「需人工复核」「数据过期」）。
 */
export function evaluateRule(
  rule: Rule,
  candidate: CandidateConditions,
  card: CandidateCard,
): RuleEvaluation {
  const { type, params } = rule.machine;
  let passed = false;
  let blocking = true;
  let detail = '';
  let caveat: string | undefined;

  switch (type) {
    case 'subject_match': {
      // params.required: [物理, 化学] → 考生 {首选}∪{再选} 须包含全部要求科目
      const required = params.required ?? [];
      const have = new Set<string>([candidate.subject.primary, ...candidate.subject.secondary]);
      passed = required.every((s) => have.has(s));
      detail =
        `要求选科 [${required.join('+') || '无'}]，` +
        `考生 ${candidate.subject.primary}+${candidate.subject.secondary.join('+')}`;
      break;
    }

    case 'batch': {
      // params.allowed: [普通类本科批] → 该卡批次须在允许集合内（仅推荐指定批次的专业组）
      const allowed = params.allowed ?? [];
      const cb = card.school.batch;
      passed = allowed.length === 0 || allowed.includes(cb);
      detail = `批次要求 [${allowed.join('/') || '无'}]，该组 ${cb}`;
      break;
    }

    case 'tuition_le': {
      // params.max: 学费上限 → 院校学费 ≤ max；null(待抽取) → 不阻断
      const max = params.max;
      const tuition = card.recruitment.tuition;
      if (tuition == null) {
        passed = true;
        blocking = false;
        detail = `学费待抽取(null)，上限 ${max}`;
        caveat = '该组学费待从官方抽取，本规则暂不阻断；补齐后复评';
      } else {
        passed = max == null || tuition <= max;
        detail = `学费 ${tuition} ≤ 上限 ${max} → ${passed ? '通过' : '超预算'}`;
      }
      break;
    }

    case 'plan_gt': {
      // params.min: 计划数下限(通常0) → 当年计划 > min；null(待抽取) → 不阻断
      const min = params.min ?? 0;
      const plan = card.recruitment.plan;
      if (plan == null) {
        passed = true;
        blocking = false;
        detail = `计划数待抽取(null)，下限 ${min}`;
        caveat = '该组当年精确计划待计划汇编抽取，本规则暂不阻断；补齐后复评';
      } else {
        passed = plan > min;
        detail = `计划数 ${plan} > ${min} → ${passed ? '有计划' : '无计划(停招/缩招)'}`;
      }
      break;
    }

    default: {
      // 未知规则类型：不阻断，转人工复核（不静默放行也不误杀）
      passed = true;
      blocking = false;
      detail = `未知规则类型「${type}」，暂不阻断`;
      caveat = `规则 ${rule.rule_id} 类型「${type}」未实现，需人工复核`;
    }
  }

  return {
    rule_id: rule.rule_id,
    category: rule.category,
    passed,
    blocking,
    reason: `${passed ? '通过' : '不通过'}：${detail}`,
    caveat,
    source: rule.source,
  };
}

// ============================================================================
// 2. 资格过滤（03）：逐条规则 → 每候选资格结果（含阻断/提示/需复核）
// ============================================================================

export function checkEligibility(req: EligibilityCheckRequest): EligibilityResult[] {
  return req.candidates.map((card) => {
    const evaluated = req.rules.map((r) => evaluateRule(r, req.candidate, card));
    const blocking_rules = evaluated.filter((r) => !r.passed && r.blocking);
    const advisories = evaluated.map((r) => r.caveat).filter((x): x is string => typeof x === 'string');
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

function evaluatePerCardSubjectRule(
  rule: Rule,
  candidate: CandidateConditions,
  card: CandidateCard,
): RuleEvaluation {
  const passed = cardSubjectOk(card, candidate);
  const req = card.major_group.subject_requirement || '未标注';
  return {
    rule_id: rule.rule_id,
    category: rule.category,
    passed,
    blocking: true,
    reason:
      `${passed ? '通过' : '不通过'}：该组要求选科「${req}」，` +
      `考生 ${candidate.subject.primary}+${candidate.subject.secondary.join('+')}`,
    source: rule.source,
  };
}

/**
 * 资格校验的 subject_match 与 compare 保持一致：按每张卡自己的 subject_requirement 判定。
 * 其他规则仍按规则表 machine 判定，保留规则 trace/source，不用全局 required 误杀「不限」组。
 */
export function checkEligibilityPerCardSubject(req: EligibilityCheckRequest): EligibilityResult[] {
  return req.candidates.map((card) => {
    const evaluated = req.rules.map((r) =>
      r.machine.type === 'subject_match'
        ? evaluatePerCardSubjectRule(r, req.candidate, card)
        : evaluateRule(r, req.candidate, card),
    );
    const blocking_rules = evaluated.filter((r) => !r.passed && r.blocking);
    const advisories = evaluated.map((r) => r.caveat).filter((x): x is string => typeof x === 'string');
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

export function latestYear(history: HistoryRecord[]): HistoryRecord | undefined {
  return [...history].sort((a, b) => b.year - a.year)[0];
}

export function rankDiff(card: CandidateCard, candidateRank: number): number | undefined {
  const latest = latestYear(card.history);
  if (!latest) return undefined;
  return candidateRank - latest.min_rank;
}

export function probabilityRef(
  rankDiffValue: number | undefined,
  dataYears: string = DEFAULT_DATA_YEARS,
): ProbabilityRef {
  const tier = tierOf(rankDiffValue);
  return { tier, pct_ref_band: pctBand(tier), method: PROB_METHOD, data_years: dataYears };
}

export function tierOf(rankDiffValue: number | undefined): ProbabilityTier {
  if (rankDiffValue === undefined) return '冲刺'; // 无历史数据 → 保守归冲刺并提示
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
// 4. 方案比较（04）：按策略排序 + 组装候选卡（差距过大保留并标注，不隐藏）
// ============================================================================

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
      reason: buildReason(card, diff, probability_ref.tier),
    };
  });
  return ranked.sort((a, b) => sortByStrategy(strategy, a, b));
}

/**
 * 排序键随策略变化（确定性、可单测）：
 *  - 院校优先：层次标签数多优先 → 位次差越小(越稳)越前
 *  - 专业优先：位次差越小(越稳)越前 → 学费越低越前
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
  return da - db;
}

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

/**
 * 方案比较（带资格过滤 + 差距过大分离）——修补「换分/换选科候选集不变」红线。
 *  1) 若传入 rules：先过 checkEligibility(含 subject_match) → 只留资格通过的候选；
 *  2) 每策略排序；tier=差距过大(rank_diff>+1500) 的移出主列表、单独入 out_of_reach（保留透明度）。
 * tier 只依赖 rank_diff（与策略无关），故 out_of_reach 取首策略排序去重即可。
 */
/**
 * 按各卡自己的 subject_requirement 逐卡判定考生选科是否满足（per-card）。
 * 数据侧约定：subject_requirement 按「+」拆——首段=首选、其余=再选必选；
 * 只写「物理」(无 +) 或含「不限」= 再选不限。避免全局 subject_match 规则误杀「不限」组。
 */
export function cardSubjectOk(card: CandidateCard, candidate: CandidateConditions): boolean {
  const req = card.major_group.subject_requirement;
  if (!req || !req.trim()) return true; // 无标注 → 不阻断（转 caveat/人工复核）
  const parts = req.split('+').map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) return true;
  const [primary, ...secondaryReq] = parts;
  if (primary && primary !== candidate.subject.primary) return false; // 首选须匹配
  // 再选：无要求 或 含「不限」→ 不限；否则考生再选须含全部要求
  if (secondaryReq.length > 0 && !secondaryReq.includes('不限')) {
    const have = new Set<string>(candidate.subject.secondary);
    if (!secondaryReq.every((s) => have.has(s))) return false;
  }
  return true;
}

export function compareFiltered(
  candidate: CandidateConditions,
  candidates: CandidateCard[],
  rules: Rule[] | undefined,
  strategies: Strategy[] = ['院校优先', '专业优先'],
  dataYears: string = DEFAULT_DATA_YEARS,
): ComparisonResult {
  // subject 按各卡 subject_requirement 逐卡判（per-card）；其他硬条件(批次/学费/计划)走规则表。
  const nonSubjectRules = (rules ?? []).filter((r) => r.machine.type !== 'subject_match');
  const eligible: CandidateCard[] = candidates.filter((c) => {
    if (!cardSubjectOk(c, candidate)) return false;
    if (nonSubjectRules.length) {
      return checkEligibility({ candidate, candidates: [c], rules: nonSubjectRules }).some((r) => r.passed);
    }
    return true;
  });

  const rankedByStrategy = strategies.map((s) => ({
    strategy: s,
    candidates: rankCandidates(eligible, candidate, s, dataYears),
  }));

  const groups: StrategyGroup[] = rankedByStrategy.map((g) => ({
    strategy: g.strategy,
    candidates: g.candidates.filter((c) => c.probability_ref.tier !== '差距过大'),
  }));

  // 差距过大：tier 不随策略变，取首策略排序结果过滤即可（去重）
  const outOfReach =
    (rankedByStrategy[0]?.candidates ?? []).filter(
      (c) => c.probability_ref.tier === '差距过大',
    ) ?? [];

  return {
    groups,
    out_of_reach: outOfReach,
  };
}

function buildReason(card: CandidateCard, diff: number, tier: ProbabilityTier): string {
  if (!Number.isFinite(diff)) {
    return `${card.school.name} ${card.major_group.group_no}组：缺历史位次数据，概率档为保守估计（${PROB_METHOD}），需补近3年数据。`;
  }
  const sign = diff > 0 ? '+' : '';
  const tail = tier === '差距过大' ? '，差距过大，不推荐' : '';
  return (
    `${card.school.name} ${card.major_group.group_no}组：` +
    `考生位次相对该组最近年投档线位次差 ${sign}${diff}，归为「${tier}」` +
    `（${PROB_METHOD}，参考用，非录取预测）${tail}。`
  );
}

// ============================================================================
// 5. 改条件重算（05）+ 版本差异
// ============================================================================

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

export function eligibleCardsFor(candidate: CandidateConditions, dataset: Dataset): CandidateCard[] {
  const results = checkEligibility({ candidate, candidates: dataset.candidates, rules: dataset.rules });
  const passIds = new Set(results.filter((r) => r.passed).map((r) => r.candidate_id));
  return dataset.candidates.filter((c) => passIds.has(c.id));
}

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

export function findMissingConditions(candidate: Partial<CandidateConditions> | undefined): string[] {
  if (!candidate) return REQUIRED_FIELDS.map((f) => f.label);
  const missing: string[] = [];
  for (const f of REQUIRED_FIELDS) {
    const v = candidate[f.key];
    if (v === undefined || v === null || v === '') missing.push(f.label);
  }
  if (candidate.subject && (!candidate.subject.primary || !Array.isArray(candidate.subject.secondary))) {
    missing.push('选科(首选/再选)');
  }
  return missing;
}

/**
 * 条件「值校验」（非缺失）：再选科目数超上限(>SECONDARY_MAX) → 返回错误信息。
 * 只拦超限、不拦不足/不等于：避免样本或历史 candidate(secondary≠2) 被 info_insufficient 阻断，
 * 不破坏候选随动；subject_match 仍按各卡 subject_requirement 逐卡过滤。
 * 后端/API 兑底用：防绕过前端表单的脏请求(secondary>2) 进入决策引擎。
 */
export function findConditionErrors(candidate: Partial<CandidateConditions> | undefined): string[] {
  if (!candidate?.subject || !Array.isArray(candidate.subject.secondary)) return [];
  if (candidate.subject.secondary.length > SECONDARY_MAX) {
    return [`再选科目最多 ${SECONDARY_MAX} 门，当前 ${candidate.subject.secondary.length} 门（请去掉超出的科目）`];
  }
  return [];
}

// ============================================================================
// 7. 对话建立条件（步骤 01）：自然语言 → 抽取/缺失/冲突/追问（确定性，不依赖 LLM）
//    红线：本模块只做「建条件 + 追问 + 标冲突」；资格判定/方案比较仍走确定性规则引擎。
//    LLM 仅作可选增强（自然语言理解/回复润色）；无 provider 时模板兜底，保证功能可用。
// ============================================================================

const KNOWN_PROVINCES = [
  '江苏', '浙江', '上海', '安徽', '福建', '江西', '山东', '河南', '湖北', '湖南',
  '广东', '北京', '天津', '河北', '山西', '四川', '重庆', '陕西',
];
const RESELECT_SUBJECTS = ['化学', '生物', '政治', '地理'] as const;

/**
 * 从用户自然语言抽取已知条件，合并进 current（已填字段不覆盖，本轮明确提到的选科增量合并）。
 * 确定性正则抽取；LLM 增强可替换/补充本函数。
 */
export function extractConditions(
  message: string,
  current: Partial<CandidateConditions>,
): Partial<CandidateConditions> {
  const text = (message ?? '').replace(/\s+/g, '');
  const next: Partial<CandidateConditions> = { ...current };

  if (!next.province) {
    const p = KNOWN_PROVINCES.find((x) => text.includes(x));
    if (p) next.province = p;
  }
  if (next.year == null) {
    const m = text.match(/(20\d{2})年?/);
    if (m) next.year = Number(m[1]);
  }
  if (next.score == null) {
    const m = text.match(/(\d{2,3})分/);
    if (m) next.score = Number(m[1]);
  }
  if (next.rank == null) {
    const m = text.match(/(?:位次|排名|名次|第)(\d{2,6})|(\d{2,6})(?:位|名)/);
    if (m) next.rank = Number(m[1] ?? m[2]);
  }

  // 类别与首选分别检测（用户输入矛盾时保留，交 findConflicts 标记）
  const catWuli = /物理类/.test(text);
  const catLishi = /历史类/.test(text);
  const priWuli = /(?:选|首选)物理/.test(text);
  const priLishi = /(?:选|首选)历史/.test(text);
  const baseSubj = next.subject ? { ...next.subject } : undefined;
  const category = baseSubj?.category ?? (catWuli ? '物理类' : catLishi ? '历史类' : undefined);
  const primary = baseSubj?.primary ?? (priWuli ? '物理' : priLishi ? '历史' : undefined);
  if (category || primary) {
    next.subject = {
      category: category ?? (primary === '物理' ? '物理类' : '历史类'),
      primary: primary ?? (category === '物理类' ? '物理' : '历史'),
      secondary: baseSubj?.secondary ?? [],
    };
  }
  // 再选：本轮提到的增量合并（去重，排除首选）
  if (next.subject) {
    const found = RESELECT_SUBJECTS.filter((s) => text.includes(s)); // RESELECT 已不含首选(物/历)，无需排除
    if (found.length) {
      const merged = Array.from(new Set([...(next.subject.secondary ?? []), ...found]));
      next.subject = { ...next.subject, secondary: merged as SecondarySubject[] };
    }
  }
  return next;
}

/**
 * 条件冲突检测：选科类别/首选·再选一致性、再选重复、分数位次越界。
 * 返回 ConditionGap[]（status='conflict'）；不阻断，交给对话层提示用户修正。
 */
export function findConflicts(conditions: Partial<CandidateConditions> | undefined): ConditionGap[] {
  const gaps: ConditionGap[] = [];
  const subj = conditions?.subject;
  if (subj) {
    const sec = (subj.secondary ?? []) as readonly string[];
    if (subj.primary && sec.includes(subj.primary)) {
      gaps.push({ field: 'subject', status: 'conflict', message: `首选「${subj.primary}」不能同时作为再选科目` });
    }
    if (subj.category && subj.primary && (subj.category === '物理类') !== (subj.primary === '物理')) {
      gaps.push({ field: 'subject.category', status: 'conflict', message: `选科类别「${subj.category}」与首选「${subj.primary}」不一致` });
    }
    if (subj.secondary && new Set(subj.secondary).size !== subj.secondary.length) {
      gaps.push({ field: 'subject.secondary', status: 'conflict', message: '再选科目有重复' });
    }
  }
  if (conditions?.score != null && (conditions.score < 0 || conditions.score > 750)) {
    gaps.push({ field: 'score', status: 'conflict', message: `分数 ${conditions.score} 越界（合理范围 0–750）` });
  }
  if (conditions?.rank != null && conditions.rank <= 0) {
    gaps.push({ field: 'rank', status: 'conflict', message: '位次必须为正数' });
  }
  return gaps;
}

const ASK_FOR: Record<string, string> = {
  省份: '你是哪个省份的考生？',
  年度: '要规划哪个招生年度（如 2026）？',
  选科: '你的选科组合？首选 物理还是历史，再选哪几门（化/生/政/地）',
  分数: '你的高考分数是多少？',
  位次: '你的全省位次（排名）是多少？',
};

/**
 * 对话建立条件主函数（确定性）：抽取 → 缺失 → 冲突 → 追问决策 → Agent 回复。
 * 输出「回复 + 更新的条件 state + 缺失/冲突 + 下一步问题」；ready=true 时可进资格校验。
 */
export function buildConditionConversation(req: ConditionBuildingRequest): ConditionBuildingResult {
  const merged = extractConditions(req.message, req.conditions ?? {});
  const missing = findMissingConditions(merged);
  const conflicts = findConflicts(merged);
  const ready = missing.length === 0 && conflicts.length === 0;

  const filled = REQUIRED_FIELDS.filter((f) => {
    const v = merged[f.key];
    return !(v === undefined || v === null || v === '');
  }).map((f) => f.label);

  let reply: string;
  let nextQuestion: string | undefined;
  if (conflicts.length) {
    nextQuestion = conflicts[0].message;
    reply =
      `核对一下，发现 ${conflicts.length} 处冲突：\n` +
      `${conflicts.map((c) => `- ${c.message}`).join('\n')}\n请修正后再继续。`;
  } else if (missing.length) {
    nextQuestion = ASK_FOR[missing[0]] ?? `请补充「${missing[0]}」`;
    reply = `已记录：${filled.length ? filled.join('、') : '（暂无）'}。还缺 ${missing.join('、')}。先回答：${nextQuestion}`;
  } else {
    reply = '条件已齐全、无冲突，可以开始资格校验和方案比较了。';
  }

  return { reply, conditions: merged, filled_fields: filled, missing, conflicts, ready, next_question: nextQuestion };
}

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

export function respond<T>(outcome: Outcome, trace: DecisionTrace, data?: T): DecisionResponse<T> {
  return { outcome, trace, data };
}
