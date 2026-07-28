/**
 * 决策端点编排层（纯函数，无 HTTP 依赖）。
 *
 * 路由(app/api 下各 route.ts) 只做：解析 JSON body → 调本文件 → 返回 JSON。
 * 业务编排（条件校验/调引擎/异常 outcome 组装/决策透明化 trace）集中在此，
 * 便于 vitest 直接单测「端点级行为」，QA 脚本则通过真实 HTTP 路由做黑盒回归。
 */

import {
  buildTrace,
  checkEligibilityPerCardSubject,
  compareFiltered,
  findMissingConditions,
  needsManualReview,
  noResult,
  ok,
  recompute,
  respond,
  DEFAULT_DATA_YEARS,
} from './engine';
import type {
  CandidateCard,
  CandidateConditions,
  ComparisonRequest,
  ComparisonResult,
  Dataset,
  DecisionResponse,
  EligibilityCheckRequest,
  EligibilityResult,
  Outcome,
  RecomputeRequest,
  RecomputeResponse,
  Rule,
  Strategy,
} from './types';

export interface HandlerOptions {
  dataset_year?: string;
  now?: string; // 注入时间，保证单测可复现
}

const REVIEW_NEXT = '数据补齐后复评；以官方页面为准';

/** 防御：请求体里的数组字段可能缺失或不是数组 → 统一归一为数组（避免 500） */
function arr<T>(x: unknown): T[] {
  return Array.isArray(x) ? (x as T[]) : [];
}

// ----------------------------------------------------------------------------
// 1. 资格校验
// ----------------------------------------------------------------------------

export function handleEligibility(
  req: EligibilityCheckRequest,
  opts: HandlerOptions = {},
): DecisionResponse<EligibilityResult[]> {
  const datasetYear = opts.dataset_year ?? DEFAULT_DATA_YEARS;
  const candidate = (req.candidate ?? {}) as CandidateConditions;
  const rules = arr<Rule>(req.rules);
  const candidates = arr<CandidateCard>(req.candidates);
  const trace = buildTrace(candidate, rules, datasetYear, opts.now);

  const missing = findMissingConditions(candidate);
  if (missing.length) {
    return respond(
      { status: 'info_insufficient', reason: `缺少关键条件：${missing.join('、')}`, next_step: '请在对话中补充上述条件后重试' },
      trace,
    );
  }

  const results = checkEligibilityPerCardSubject({ candidate, candidates, rules });
  const passed = results.filter((r) => r.passed);
  if (passed.length === 0) {
    const outcome: Outcome = noResult(
      '没有候选通过全部硬条件规则',
      '可放宽选科/批次/预算条件，或补充更多候选后重试',
    );
    return respond(outcome, trace, results);
  }

  const needsReview = results.some((r) => r.needs_review);
  const outcome: Outcome = needsReview
    ? needsManualReview(
        `${passed.length}/${results.length} 个候选通过资格校验，但部分候选存在数据待抽取/批次线待公布等，需人工复核`,
        REVIEW_NEXT,
      )
    : ok(`${passed.length}/${results.length} 个候选通过资格校验`);
  return respond(outcome, trace, results);
}

// ----------------------------------------------------------------------------
// 2. 方案比较
// ----------------------------------------------------------------------------

export interface CompareHandlerRequest extends ComparisonRequest {}

export function handleCompare(
  req: CompareHandlerRequest,
  opts: HandlerOptions = {},
): DecisionResponse<ComparisonResult> {
  const datasetYear = opts.dataset_year ?? DEFAULT_DATA_YEARS;
  const candidate = (req.candidate ?? {}) as CandidateConditions;
  const candidates = arr<CandidateCard>(req.candidates);
  const rules = arr<Rule>(req.rules);
  const trace = buildTrace(candidate, rules, datasetYear, opts.now);

  const missing = findMissingConditions(candidate);
  if (missing.length) {
    return respond(
      { status: 'info_insufficient', reason: `缺少关键条件：${missing.join('、')}`, next_step: '请在对话中补充上述条件后重试' },
      trace,
    );
  }

  if (!candidates?.length) {
    return respond(noResult('无可比较候选', '先调用资格校验获取通过候选，或传入候选列表'), trace, { groups: [], out_of_reach: [] });
  }

  const strategies: Strategy[] = req.strategies?.length ? req.strategies : ['院校优先', '专业优先'];
  const result = compareFiltered(candidate, candidates, rules, strategies, datasetYear);
  const mainCount = result.groups[0]?.candidates.length ?? 0;
  const oorCount = result.out_of_reach.length;
  const reason = oorCount
    ? `按 ${strategies.join('/')} 排序完成：主候选 ${mainCount}（资格通过且非差距过大），差距过大(不推荐) ${oorCount} 另列`
    : `按 ${strategies.join('/')} 排序完成：主候选 ${mainCount}`;
  return respond(ok(reason), trace, result);
}

// ----------------------------------------------------------------------------
// 3. 改条件重算 + 版本差异
// ----------------------------------------------------------------------------

export interface RecomputeHandlerRequest {
  profile_id?: string;
  baseline: CandidateConditions;
  changes: Partial<CandidateConditions>;
  // 数据集由调用方注入（服务端从 data/ 装配，不入判定逻辑）
  candidates: CandidateCard[];
  rules: Rule[];
}

export function handleRecompute(
  req: RecomputeHandlerRequest,
  opts: HandlerOptions = {},
): DecisionResponse<RecomputeResponse> {
  const datasetYear = opts.dataset_year ?? DEFAULT_DATA_YEARS;
  const baseline = (req.baseline ?? {}) as CandidateConditions;
  const rules = arr<Rule>(req.rules);
  const trace = buildTrace(baseline, rules, datasetYear, opts.now);

  const missing = findMissingConditions(baseline);
  if (missing.length) {
    return respond(
      { status: 'info_insufficient', reason: `baseline 缺少关键条件：${missing.join('、')}`, next_step: '请在对话中补充上述条件后重试' },
      trace,
    );
  }

  const dataset: Dataset = {
    candidates: arr<CandidateCard>(req.candidates),
    rules,
  };
  const result = recompute({ profile_id: req.profile_id, baseline, changes: req.changes }, dataset, datasetYear);

  const totalEligible = result.strategy_groups[0]?.candidates.length ?? 0;
  if (totalEligible === 0) {
    return respond(
      noResult('改条件后无候选通过资格校验', '回退条件或放宽硬条件后重试'),
      trace,
      result,
    );
  }

  const diffParts: string[] = [];
  if (result.diff.added.length) diffParts.push(`新增 ${result.diff.added.length}`);
  if (result.diff.removed.length) diffParts.push(`减少 ${result.diff.removed.length}`);
  if (result.diff.changed.length) diffParts.push(`档位变化 ${result.diff.changed.length}`);
  const reason = diffParts.length ? `重算完成：${diffParts.join('、')}` : '重算完成：候选集合未变';
  return respond(ok(reason), trace, result);
}
