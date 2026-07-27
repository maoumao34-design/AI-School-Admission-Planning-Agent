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
 * 字段对齐：本文件的 CandidateCard / Rule 直接对齐数据角色交付的 JSON 形状
 * （data/sample-jiangsu-2026-phys.json、data/rules.example.json，见 DATA-PACKAGE.md）。
 * 数据 JSON 的少量表示差异（candidate_context、plan_<year>）由 adapter.ts 归一，引擎类型保持稳定。
 *
 * 本文件为纯类型定义，无运行时依赖，可被 Next.js 路由、规则引擎、QA 脚本共享。
 */

// ============================================================================
// 0. 基础枚举
// ============================================================================

/** 江苏新高考 3+1+2 首选科目（决定物理类/历史类） */
export type PrimarySubject = '物理' | '历史';
/** 再选科目（任选 2） */
export type SecondarySubject = '化学' | '生物' | '政治' | '地理';
/** 选科类别（由首选决定） */
export type SubjectCategory = '物理类' | '历史类';

/** 参考概率档（标注方法 + 数据年份，不是录取预测） */
export type ProbabilityTier = '冲刺' | '稳妥' | '保底' | '差距过大';

/** 规则类别 */
export type RuleCategory = '选科' | '批次' | '批次/学历' | '学历' | '费用' | '计划' | '其他';

/** 规则适用对象 */
export type RuleAppliesTo = 'global' | 'major_group';

/** 策略（方案并排比较） */
export type Strategy = '院校优先' | '专业优先' | '均衡';

/** 决策结果状态（含异常路径） */
export type OutcomeStatus =
  | 'ok' // 正常出结果
  | 'info_insufficient' // 信息不足（缺关键条件）
  | 'no_result' // 无符合候选
  | 'data_stale' // 数据过期/年份不符
  | 'source_conflict' // 来源冲突
  | 'needs_manual_review'; // 需人工复核（如关键字段待抽取）

// ============================================================================
// 1. 考生上下文（对话建条件的产物 = 决策引擎输入）
// ============================================================================

export interface SubjectSelection {
  category: SubjectCategory; // 物理类 / 历史类
  primary: PrimarySubject; // 首选 1
  secondary: SecondarySubject[]; // 再选 2
}

/** 考生条件（6 步流程之「01 对话建立条件」的输出，由 LLM 抽取或表单收集） */
export interface CandidateConditions {
  province: string; // '江苏'
  year: number; // 2026
  subject: SubjectSelection;
  score: number; // 高考总分，如 637
  rank: number; // 全省位次，如 5200
  preferences?: {
    region?: string[]; // 地区偏好
    schoolLevel?: string[]; // 985/211/双一流/公办
    majorDirection?: string[]; // 专业方向
    strategy?: Strategy;
  };
  budget?: {
    maxTuition?: number; // 学费上限（元/年）
  };
}

/** 缺失/冲突条件（对话建条件时由 Agent 追问） */
export interface ConditionGap {
  field: keyof CandidateConditions | string;
  status: 'missing' | 'conflict';
  message: string; // 给用户的人话
}

// ============================================================================
// 2. 数据角色交付的结构（候选卡 / 历史 / 来源 / 规则）—— 引擎消费，不拥有
//    字段直接对齐 data/*.json（见 adapter.ts 处理少量表示差异）
// ============================================================================

export interface SchoolInfo {
  name: string;
  code: string | null; // 院校招生代码（样本里待核对，允许 null）
  region: string; // 地区
  level_tags: string[]; // 985/211/双一流/公办
  batch: string; // 批次，如「普通类本科批」
}

/** 选科要求（machine-checkable，对齐 DATA-PACKAGE §2） */
export interface SubjectRequirement {
  preferred: PrimarySubject; // 首选必选
  reselect_required: SecondarySubject[]; // 再选必选（可空）
  reselect_options?: SecondarySubject[][]; // 再选任选 N 选 M（可空）
  raw_text: string; // 规则原文
}

export interface MajorGroup {
  group_no: string; // 专业组号
  subject_requirement: SubjectRequirement; // 选科要求（对象）
  majors?: string[]; // 组内可报专业
}

/**
 * 招生信息。对齐 JSON：duration_years / tuition / program_type；
 * plan_<year> 由 adapter 归一进 plan_by_year（key 为年份字符串，值可 null=待抽取）。
 */
export interface Recruitment {
  duration_years: number; // 学制（年）
  tuition: number | null; // 学费（元/年）；样本里可 null=待抽取
  program_type?: string; // 办学类型，如「中外合作办学」（flag 规则用）
  plan_by_year?: Record<string, number | null>; // { "2024": 494, "2025": null }
}

/** 近 3 年某年记录 */
export interface HistoryRecord {
  year: number;
  plan: number | null;
  min_score: number; // 最低投档分
  min_rank: number; // 最低投档位次
  rank_diff?: number; // 与当前位次差（正=位次高于该年最低，越冲；负=优于，越稳）
}

/** 参考概率（标注方法 + 数据年份，非预测） */
export interface ProbabilityRef {
  tier: ProbabilityTier;
  pct_ref_band?: string; // 参考百分比区间，如 "40-75%"
  method: string; // 方法说明，如「近3年位次差法」
  data_years: string; // 数据年份，如 "2023-2025" 或 "2024"
}

export interface SourceRef {
  publisher: string; // 发布方，如「江苏省教育考试院」
  url: string;
  retrieved_via?: string; // 检索途径（聚合站等），便于追溯
  updated?: string; // 更新时间
  accessed?: string; // 访问时间 ISO
  status?: string; // 可用性/状态，如「待官方复核」
}

/** 候选卡 = 决策引擎最小单元 = 前端志愿卡（字段对齐数据角色） */
export interface CandidateCard {
  id: string; // 院校专业组唯一 id，如 SEU-08
  school: SchoolInfo;
  major_group: MajorGroup;
  recruitment: Recruitment;
  history: HistoryRecord[]; // 近 3 年
  rank_diff_vs_candidate?: number; // 引擎计算：最近年位次差
  probability_ref?: ProbabilityRef; // 引擎计算：概率档
  reason?: string; // 推荐理由（可展开「为什么推荐」）
  source: SourceRef;
  caveats?: string[]; // 异常提示（样本年份、需按实际录取等）
}

// ----------------------------------------------------------------------------
// 可机读规则（对齐 data/rules.example.json）
// ----------------------------------------------------------------------------

/** subject_match：首选 == preferred_required 且 reselect_required ⊆ 考生再选 */
export interface SubjectMatchMachine {
  type: 'subject_match';
  preferred_required: PrimarySubject;
  reselect_required: SecondarySubject[];
}

/** score_threshold：考生分数 op 阈值；ref 指向 batch_lines（如 batch_line.本科.物理类） */
export interface ScoreThresholdMachine {
  type: 'score_threshold';
  field: string; // 如 "candidate.score"
  op: '>=' | '>' | '<=' | '<';
  ref: string; // 如 "batch_line.本科.物理类"
}

/** flag：提示性标记（如中外合作办学高收费），advisory=true 不阻断 */
export interface FlagMachine {
  type: 'flag';
  field: string; // 如 "program_type"
  equals: string; // 如 "中外合作办学"
  advisory?: boolean;
}

/** presence：某字段存在/大于阈值（如当年招生计划 > 0） */
export interface PresenceMachine {
  type: 'presence';
  field: string; // 如 "recruitment.plan_<year>"
  op: string; // 如 "> 0"
}

/** 未知规则类型：不阻断，转人工复核 */
export interface UnknownMachine {
  type: string;
  [key: string]: unknown;
}

export type RuleMachine =
  | SubjectMatchMachine
  | ScoreThresholdMachine
  | FlagMachine
  | PresenceMachine
  | UnknownMachine;

export interface RuleSource {
  publisher?: string;
  url: string;
  doc?: string;
  effective_period: string; // 适用周期，如 "2024–2026"
  status?: string; // 如「待官方复核」
}

export interface Rule {
  rule_id: string;
  category: RuleCategory;
  applies_to?: RuleAppliesTo;
  raw_text: string; // 官方原文
  machine: RuleMachine;
  source: RuleSource;
}

// ============================================================================
// 3. 资格校验（03 执行资格过滤）
// ============================================================================

/** 批次线（score_threshold 规则 ref 解析用；志愿填报期当年线多未公布） */
export interface BatchLines {
  本科?: Partial<Record<SubjectCategory, number>>;
  专科?: Partial<Record<SubjectCategory, number>>;
  [key: string]: unknown;
}

/** 单条规则对一个候选的判定 */
export interface RuleEvaluation {
  rule_id: string;
  category: RuleCategory;
  passed: boolean; // 是否通过该条判定
  blocking: boolean; // 是否阻断资格（advisory / 数据待抽取 → false）
  reason: string; // 人话原因（为什么通过/不通过/为何不阻断）
  caveat?: string; // 非阻断提示（数据待抽取 / 提示性 / 待复核）
  source: RuleSource;
}

/** 单个候选的资格结果 */
export interface EligibilityResult {
  candidate_id: string;
  passed: boolean; // 无阻断规则即通过
  evaluated_rules: RuleEvaluation[];
  blocking_rules: RuleEvaluation[]; // 阻断的规则（前端高亮）
  advisories: string[]; // 非阻断提示集合
  needs_review: boolean; // 存在数据待抽取/无法判定 → 需人工复核
}

export interface EligibilityCheckRequest {
  candidate: CandidateConditions;
  candidates: CandidateCard[];
  rules: Rule[];
  batch_lines?: BatchLines; // score_threshold 解析用（可选；缺则该规则不阻断+标注）
  dataset_year?: string;
}

// ============================================================================
// 4. 方案比较（04 比较多套方案）
// ============================================================================

/** 排序后的候选（带必填的概率档/位次差/理由） */
export interface RankedCandidate extends CandidateCard {
  probability_ref: ProbabilityRef;
  rank_diff_vs_candidate: number;
  reason: string;
}

export interface ComparisonRequest {
  candidate: CandidateConditions;
  candidates: CandidateCard[]; // 通常传入资格校验通过的候选
  strategies?: Strategy[]; // 默认 ['院校优先','专业优先']
  dataset_year?: string;
}

export interface StrategyGroup {
  strategy: Strategy;
  candidates: RankedCandidate[]; // 按该策略排序
}

// ============================================================================
// 5. 改条件重算（05 修改关键条件）+ 计划与版本（版本差异）
// ============================================================================

export interface RecomputeRequest {
  profile_id?: string; // 档案上下文（plan 归属，引擎不依赖）
  baseline: CandidateConditions; // 原条件
  changes: Partial<CandidateConditions>; // 改的条件（分数/预算/地区/目标）
}

/** 版本差异（确认导出时对比前后版本） */
export interface VersionDiff {
  added: string[]; // 新增候选 id
  removed: string[]; // 消失候选 id
  changed: { candidate_id: string; field: string; from: unknown; to: unknown }[];
}

export interface RecomputeResponse {
  new_conditions: CandidateConditions;
  strategy_groups: StrategyGroup[];
  diff: VersionDiff; // 相对 baseline 的差异
}

// ============================================================================
// 6. 决策透明化 + 异常外壳（所有响应统一包裹）
// ============================================================================

/** 决策透明化：本次结果用了哪些条件、执行了哪些规则 */
export interface DecisionTrace {
  conditions_used: CandidateConditions;
  rules_applied: string[]; // rule_id 列表
  dataset_year: string; // 数据年份
  generated_at: string; // ISO 时间
}

export interface Outcome {
  status: OutcomeStatus;
  reason: string; // 为什么是这个状态（含异常原因）
  next_step?: string; // 下一步建议（异常时必填）
}

/** 所有决策端点的统一响应外壳 */
export interface DecisionResponse<T> {
  outcome: Outcome;
  trace: DecisionTrace;
  data?: T;
}

/** 数据集（adapter 产出，可注入端点） */
export interface Dataset {
  candidate?: CandidateConditions; // 样本自带考生上下文（可选）
  candidates: CandidateCard[];
  rules: Rule[];
  batch_lines?: BatchLines;
  meta?: unknown;
}
