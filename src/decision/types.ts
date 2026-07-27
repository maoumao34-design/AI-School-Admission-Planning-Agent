/**
 * 升学规划 Agent — 决策核心类型契约（typed API schema）
 *
 * 设计原则（对应三条红线）：
 *  1. 规则判断 = 确定性纯函数（不交给 LLM 凭感觉判）。「官方事实 / 规则判断 /
 *     AI 建议 / 个人决定」分层；资格校验/概率档/排序都是表查询 + 算术。
 *  2. 决策透明化：每个响应都带 trace（用了哪些条件、执行了哪些规则、数据年份、生成时间）。
 *  3. 异常显式：信息不足/无结果/数据过期/来源冲突/需人工复核 → outcome.reason + next_step。
 *  4. 与身份/档案归属无关：引擎按「单个考生条件」算；profileId 只在 plan 级端点作归属参数，不进判定。
 *
 * 字段对齐：CandidateCard / Rule 直接对齐数据角色「正式交付」的 JSON 形状
 * （data/sample-jiangsu-2026-phys.json、data/rules.example.json，见 DATA-PACKAGE.md §5）。
 * machine.type 的 4 类为数据角色与引擎共同认定的 canonical 集合：
 *   subject_match(params.required[]) / batch(params.allowed[]) / tuition_le(params.max) / plan_gt(params.min)。
 *
 * 本文件为纯类型定义，无运行时依赖，可被 Next.js 路由、规则引擎、QA 脚本共享。
 */

// ============================================================================
// 0. 基础枚举
// ============================================================================

export type PrimarySubject = '物理' | '历史';
export type SecondarySubject = '化学' | '生物' | '政治' | '地理';
export type SubjectCategory = '物理类' | '历史类';

/** 参考概率档（标注方法 + 数据年份，不是录取预测） */
export type ProbabilityTier = '冲刺' | '稳妥' | '保底' | '差距过大';

/** 规则类别 */
export type RuleCategory = '选科' | '批次' | '费用' | '计划' | '其他';

/** 规则适用对象 */
export type RuleAppliesTo = 'global' | 'major_group';

/** 策略（方案并排比较） */
export type Strategy = '院校优先' | '专业优先' | '均衡';

/** 决策结果状态（含异常路径） */
export type OutcomeStatus =
  | 'ok'
  | 'info_insufficient'
  | 'no_result'
  | 'data_stale'
  | 'source_conflict'
  | 'needs_manual_review';

// ============================================================================
// 1. 考生上下文（对话建条件的产物 = 决策引擎输入）
// ============================================================================

export interface SubjectSelection {
  category: SubjectCategory;
  primary: PrimarySubject;
  secondary: SecondarySubject[];
}

export interface CandidateConditions {
  province: string;
  year: number;
  subject: SubjectSelection;
  score: number;
  rank: number;
  preferences?: {
    region?: string[];
    schoolLevel?: string[];
    majorDirection?: string[];
    strategy?: Strategy;
  };
  budget?: {
    maxTuition?: number;
  };
}

export interface ConditionGap {
  field: keyof CandidateConditions | string;
  status: 'missing' | 'conflict';
  message: string;
}

// ============================================================================
// 2. 数据角色交付的结构（候选卡 / 历史 / 来源 / 规则）—— 引擎消费，不拥有
// ============================================================================

export interface SchoolInfo {
  name: string;
  code: string | null;
  region: string;
  level_tags: string[];
  batch: string; // 如「普通类本科批」（batch 规则据此过滤）
}

export interface MajorGroup {
  group_no: string;
  subject_requirement: string; // 原文，如「物理+化学」（展示用；选科判定走 subject_match 规则的 params.required）
  majors?: string[];
}

/** 招生信息（对齐数据 JSON：plan / duration / tuition；值可 null=待抽取） */
export interface Recruitment {
  plan: number | null; // 当年招生计划数（样本里为校·物理类总量，精确到组待计划汇编抽取）
  duration: number; // 学制（年）
  tuition: number | null; // 学费（元/年）；可 null=待抽取
  program_type?: string; // 办学类型，如「中外合作办学」
}

export interface HistoryRecord {
  year: number;
  plan: number | null;
  min_score: number;
  min_rank: number;
  rank_diff?: number;
}

export interface ProbabilityRef {
  tier: ProbabilityTier;
  pct_ref_band?: string;
  method: string;
  data_years: string;
}

export interface SourceRef {
  publisher?: string;
  url: string;
  doc?: string;
  retrieved_via?: string;
  updated?: string;
  accessed?: string;
  status?: string;
}

export interface CandidateCard {
  id: string;
  school: SchoolInfo;
  major_group: MajorGroup;
  recruitment: Recruitment;
  history: HistoryRecord[];
  rank_diff_vs_candidate?: number;
  probability_ref?: ProbabilityRef;
  reason?: string;
  source: SourceRef;
  caveats?: string[];
}

// ----------------------------------------------------------------------------
// 可机读规则（对齐 data/rules.example.json：machine{type, params}）
//    canonical 4 类：subject_match / batch / tuition_le / plan_gt
// ----------------------------------------------------------------------------

/** 引擎支持的 canonical 机器判据类型 */
export type RuleMachineType = 'subject_match' | 'batch' | 'tuition_le' | 'plan_gt';

/** 规则参数（按 type 取用对应字段；多余字段忽略） */
export interface RuleParams {
  required?: string[]; // subject_match：要求科目，如 [物理,化学]
  allowed?: string[]; // batch：允许的批次，如 [普通类本科批]
  max?: number; // tuition_le：学费上限（元/年）
  min?: number; // plan_gt：计划数下限（通常 0）
  [key: string]: unknown;
}

export interface RuleMachine {
  type: RuleMachineType | string; // 未知 type → default 不阻断 + 转人工复核
  params: RuleParams;
}

export interface RuleSource {
  publisher?: string;
  url: string;
  doc?: string;
  alt_url?: string;
  effective_period: string;
  status?: string;
}

export interface Rule {
  rule_id: string;
  category: RuleCategory;
  applies_to?: RuleAppliesTo;
  raw_text: string;
  machine: RuleMachine;
  source: RuleSource;
}

// ============================================================================
// 3. 资格校验（03 执行资格过滤）
// ============================================================================

export interface RuleEvaluation {
  rule_id: string;
  category: RuleCategory;
  passed: boolean;
  blocking: boolean; // 是否阻断资格（数据待抽取 / 提示性 / 未知类型 → false）
  reason: string;
  caveat?: string; // 非阻断提示
  source: RuleSource;
}

export interface EligibilityResult {
  candidate_id: string;
  passed: boolean;
  evaluated_rules: RuleEvaluation[];
  blocking_rules: RuleEvaluation[];
  advisories: string[];
  needs_review: boolean;
}

export interface EligibilityCheckRequest {
  candidate: CandidateConditions;
  candidates: CandidateCard[];
  rules: Rule[];
  dataset_year?: string;
}

// ============================================================================
// 4. 方案比较（04）
// ============================================================================

export interface RankedCandidate extends CandidateCard {
  probability_ref: ProbabilityRef;
  rank_diff_vs_candidate: number;
  reason: string;
}

export interface ComparisonRequest {
  candidate: CandidateConditions;
  candidates: CandidateCard[];
  strategies?: Strategy[];
  dataset_year?: string;
}

export interface StrategyGroup {
  strategy: Strategy;
  candidates: RankedCandidate[];
}

// ============================================================================
// 5. 改条件重算（05）+ 版本差异
// ============================================================================

export interface RecomputeRequest {
  profile_id?: string;
  baseline: CandidateConditions;
  changes: Partial<CandidateConditions>;
}

export interface VersionDiff {
  added: string[];
  removed: string[];
  changed: { candidate_id: string; field: string; from: unknown; to: unknown }[];
}

export interface RecomputeResponse {
  new_conditions: CandidateConditions;
  strategy_groups: StrategyGroup[];
  diff: VersionDiff;
}

// ============================================================================
// 6. 决策透明化 + 异常外壳
// ============================================================================

export interface DecisionTrace {
  conditions_used: CandidateConditions;
  rules_applied: string[];
  dataset_year: string;
  generated_at: string;
}

export interface Outcome {
  status: OutcomeStatus;
  reason: string;
  next_step?: string;
}

export interface DecisionResponse<T> {
  outcome: Outcome;
  trace: DecisionTrace;
  data?: T;
}

export interface Dataset {
  candidate?: CandidateConditions;
  candidates: CandidateCard[];
  rules: Rule[];
  meta?: unknown;
}
