/**
 * 升学规划 Agent — 数据适配层（消费数据角色交付的 JSON → 引擎类型）
 *
 * 这是引擎与「数据 JSON 草案形状」之间唯一的耦合点。数据字段名/结构若变化，
 * 只改本文件，引擎(types.ts/engine.ts)与 API Route 不动。对应红线「数据/规则/API 契约
 * 变更要通知受影响角色」——本文件即接收侧的契约消化处。
 *
 * 消费来源：
 *  - data/sample-jiangsu-2026-phys.json  （候选卡 + 样本考生上下文）
 *  - data/rules.example.json             （可机读规则表）
 *  说明文档：data/DATA-PACKAGE.md
 */

import type {
  BatchLines,
  CandidateCard,
  CandidateConditions,
  Dataset,
  HistoryRecord,
  PrimarySubject,
  ProbabilityRef,
  Rule,
  SecondarySubject,
  SubjectCategory,
  SubjectSelection,
} from './types';

type Raw = Record<string, unknown>;

const PRIMARY_SUBJECTS = new Set<PrimarySubject>(['物理', '历史']);
const SECONDARY_SUBJECTS = new Set<SecondarySubject>(['化学', '生物', '政治', '地理']);

function asString(v: unknown, fallback = ''): string {
  return typeof v === 'string' ? v : fallback;
}
function asNumberOrNull(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}
function asNumber(v: unknown, fallback = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
function asArray<T = unknown>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

function asPrimary(v: unknown): PrimarySubject {
  return v === '历史' ? '历史' : '物理';
}
function asSecondary(v: unknown): SecondarySubject[] {
  return asArray<unknown>(v)
    .filter((s): s is SecondarySubject => typeof s === 'string' && SECONDARY_SUBJECTS.has(s as SecondarySubject));
}

/** 由 track / 首选 推断选科类别 */
function categoryOf(track: unknown, primary: PrimarySubject): SubjectCategory {
  if (track === '历史类') return '历史类';
  if (track === '物理类') return '物理类';
  return primary === '历史' ? '历史类' : '物理类';
}

// ----------------------------------------------------------------------------
// 候选卡
// ----------------------------------------------------------------------------

function parseHistory(raw: unknown): HistoryRecord[] {
  return asArray<Raw>(raw).map((h) => ({
    year: asNumber(h.year),
    plan: asNumberOrNull(h.plan),
    min_score: asNumber(h.min_score),
    min_rank: asNumber(h.min_rank),
    rank_diff: asNumberOrNull(h.rank_diff) ?? undefined,
  }));
}

function parseProbabilityRef(raw: unknown): ProbabilityRef | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const r = raw as Raw;
  const tier = asString(r.tier) as ProbabilityRef['tier'];
  if (!tier) return undefined;
  const years = r.data_years;
  return {
    tier,
    pct_ref_band: asString(r.pct_ref_band) || undefined,
    method: asString(r.method, '位次差法'),
    data_years: Array.isArray(years) ? years.join('-') : asString(years, '2024'),
  };
}

function parseCard(raw: Raw): CandidateCard {
  const school = (raw.school ?? {}) as Raw;
  const mg = (raw.major_group ?? {}) as Raw;
  const sr = (mg.subject_requirement ?? {}) as Raw;
  const rec = (raw.recruitment ?? {}) as Raw;
  const source = (raw.source ?? {}) as Raw;

  // recruitment: 把 plan_<year> 形如 plan_2024 归一到 plan_by_year
  const plan_by_year: Record<string, number | null> = {};
  for (const k of Object.keys(rec)) {
    const m = /^plan_(\d{4})$/.exec(k);
    if (m) plan_by_year[m[1]] = asNumberOrNull(rec[k]);
  }

  return {
    id: asString(raw.id),
    school: {
      name: asString(school.name),
      code: school.code == null ? null : asString(school.code),
      region: asString(school.region),
      level_tags: asArray<string>(school.level_tags),
      batch: asString(school.batch),
    },
    major_group: {
      group_no: asString(mg.group_no),
      subject_requirement: {
        preferred: asPrimary(sr.preferred),
        reselect_required: asSecondary(sr.reselect_required),
        reselect_options: Array.isArray(sr.reselect_options) ? (sr.reselect_options as SecondarySubject[][]) : undefined,
        raw_text: asString(sr.raw_text),
      },
      majors: asArray<string>(mg.majors).length ? asArray<string>(mg.majors) : undefined,
    },
    recruitment: {
      duration_years: asNumber(rec.duration_years, 4),
      tuition: asNumberOrNull(rec.tuition),
      program_type: asString(rec.program_type) || undefined,
      plan_by_year: Object.keys(plan_by_year).length ? plan_by_year : undefined,
    },
    history: parseHistory(raw.history),
    rank_diff_vs_candidate: asNumberOrNull(raw.rank_diff_vs_candidate) ?? undefined,
    probability_ref: parseProbabilityRef(raw.probability_ref),
    reason: asString(raw.reason) || undefined,
    source: {
      publisher: asString(source.publisher),
      url: asString(source.url),
      retrieved_via: asString(source.retrieved_via) || undefined,
      updated: asString(source.updated) || undefined,
      accessed: asString(source.accessed) || undefined,
      status: asString(source.status) || undefined,
    },
    caveats: asArray<string>(raw.caveats).length ? asArray<string>(raw.caveats) : undefined,
  };
}

// ----------------------------------------------------------------------------
// 规则
// ----------------------------------------------------------------------------

function parseRule(raw: Raw): Rule {
  const machine = (raw.machine ?? {}) as Raw;
  const source = (raw.source ?? {}) as Raw;
  const type = asString(machine.type);
  // 直接对齐 JSON 的扁平 machine 结构（subject_match/score_threshold/flag/presence）
  const machineOut: Rule['machine'] = { type, ...machine } as Rule['machine'];

  return {
    rule_id: asString(raw.rule_id),
    category: asString(raw.category, '其他') as Rule['category'],
    applies_to: (asString(raw.applies_to) || undefined) as Rule['applies_to'],
    raw_text: asString(raw.raw_text),
    machine: machineOut,
    source: {
      publisher: asString(source.publisher) || undefined,
      url: asString(source.url),
      doc: asString(source.doc) || undefined,
      effective_period: asString(source.effective_period),
      status: asString(source.status) || undefined,
    },
  };
}

// ----------------------------------------------------------------------------
// 考生上下文（样本里的 candidate_context → CandidateConditions）
// ----------------------------------------------------------------------------

export function parseCandidateContext(raw: unknown): CandidateConditions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Raw;
  const subjects = asArray<unknown>(c.subjects);
  const primary = asPrimary(subjects[0] ?? c.preferred);
  const secondary = asSecondary(subjects.slice(1));
  const track = asString(c.track);
  const subject: SubjectSelection = {
    category: categoryOf(track, primary),
    primary,
    secondary,
  };
  const score = asNumber(c.score);
  const rank = asNumber(c.rank);
  if (!score && !rank) return undefined;
  return {
    province: asString(c.province, '江苏'),
    year: asNumber(c.year, 2026),
    subject,
    score,
    rank,
  };
}

// ----------------------------------------------------------------------------
// 数据集入口
// ----------------------------------------------------------------------------

/**
 * 解析「候选卡样本 JSON」（含 candidate_context + cards）。
 * 形如 data/sample-jiangsu-2026-phys.json。
 */
export function parseSampleCardsJson(raw: unknown): { candidate?: CandidateConditions; candidates: CandidateCard[] } {
  if (!raw || typeof raw !== 'object') return { candidates: [] };
  const r = raw as Raw;
  return {
    candidate: parseCandidateContext(r.candidate_context),
    candidates: asArray<Raw>(r.cards).map(parseCard),
  };
}

/**
 * 解析「规则表 JSON」。
 * 形如 data/rules.example.json：{ _meta, rules: [...] }
 */
export function parseRulesJson(raw: unknown): Rule[] {
  if (!raw || typeof raw !== 'object') return [];
  const r = raw as Raw;
  return asArray<Raw>(r.rules).map(parseRule);
}

/**
 * 一次性装配 Dataset：候选卡样本 + 规则表（+ 可选 batch_lines）。
 * 调用方（API Route / QA 脚本）传入两个已 parse 的 JSON 对象即可。
 */
export function parseDataset(
  sampleJson: unknown,
  rulesJson: unknown,
  batchLines?: BatchLines,
): Dataset {
  const { candidate, candidates } = parseSampleCardsJson(sampleJson);
  const rules = parseRulesJson(rulesJson);
  return { candidate, candidates, rules, batch_lines: batchLines };
}
