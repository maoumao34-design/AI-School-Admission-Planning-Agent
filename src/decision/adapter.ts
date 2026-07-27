/**
 * 升学规划 Agent — 数据适配层（消费数据角色交付的 JSON → 引擎类型）
 *
 * 引擎与「数据 JSON 形状」之间唯一的耦合点。数据字段名/结构若变化，只改本文件，
 * 引擎(types.ts/engine.ts)与 API Route 不动。对应红线「数据/规则/API 契约变更要通知
 * 受影响角色」——本文件即接收侧的契约消化处。
 *
 * 消费来源（数据角色「正式交付」commit fff0a87）：
 *  - data/sample-jiangsu-2026-phys.json  （候选卡 + 样本考生上下文）
 *  - data/rules.example.json             （machine{type, params} 可机读规则表）
 *  说明文档：data/DATA-PACKAGE.md
 */

import type {
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
  return asArray<unknown>(v).filter(
    (s): s is SecondarySubject => typeof s === 'string' && SECONDARY_SUBJECTS.has(s as SecondarySubject),
  );
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
    data_years: Array.isArray(years) ? years.join('-') : asString(years, '2023-2025'),
  };
}

function parseCard(raw: Raw): CandidateCard {
  const school = (raw.school ?? {}) as Raw;
  const mg = (raw.major_group ?? {}) as Raw;
  const rec = (raw.recruitment ?? {}) as Raw;
  const source = (raw.source ?? {}) as Raw;

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
      subject_requirement: asString(mg.subject_requirement), // 原文串，如「物理+化学」
      majors: asArray<string>(mg.majors).length ? asArray<string>(mg.majors) : undefined,
    },
    recruitment: {
      plan: asNumberOrNull(rec.plan),
      duration: asNumber(rec.duration, 4),
      tuition: asNumberOrNull(rec.tuition),
      program_type: asString(rec.program_type) || undefined,
    },
    history: parseHistory(raw.history),
    rank_diff_vs_candidate: asNumberOrNull(raw.rank_diff_vs_candidate) ?? undefined,
    probability_ref: parseProbabilityRef(raw.probability_ref),
    reason: asString(raw.reason) || undefined,
    source: {
      publisher: asString(source.publisher) || undefined,
      url: asString(source.url),
      doc: asString(source.doc) || undefined,
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
  return {
    rule_id: asString(raw.rule_id),
    category: asString(raw.category, '其他') as Rule['category'],
    applies_to: (asString(raw.applies_to) || undefined) as Rule['applies_to'],
    raw_text: asString(raw.raw_text),
    machine: {
      type: asString(machine.type),
      params: (machine.params ?? {}) as Rule['machine']['params'],
    },
    source: {
      publisher: asString(source.publisher) || undefined,
      url: asString(source.url),
      doc: asString(source.doc) || undefined,
      alt_url: asString(source.alt_url) || undefined,
      effective_period: asString(source.effective_period),
      status: asString(source.status) || undefined,
    },
  };
}

// ----------------------------------------------------------------------------
// 考生上下文（样本 candidate_context → CandidateConditions）
// ----------------------------------------------------------------------------

/**
 * 解析样本考生上下文。兼容两种形状：
 *  - 新（正式交付）：candidate_context.subject = {category, primary, secondary}
 *  - 旧（draft）：candidate_context.subjects = [物理,化学] + track
 */
export function parseCandidateContext(raw: unknown): CandidateConditions | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const c = raw as Raw;

  let subject: SubjectSelection | undefined;
  if (c.subject && typeof c.subject === 'object') {
    const s = c.subject as Raw;
    const primary = asPrimary(s.primary);
    subject = {
      category: (asString(s.category) as SubjectCategory) || (primary === '历史' ? '历史类' : '物理类'),
      primary,
      secondary: asSecondary(s.secondary),
    };
  } else if (Array.isArray(c.subjects)) {
    const primary = asPrimary(c.subjects[0]);
    const track = asString(c.track);
    subject = {
      category: track === '历史类' ? '历史类' : track === '物理类' ? '物理类' : primary === '历史' ? '历史类' : '物理类',
      primary,
      secondary: asSecondary((c.subjects as unknown[]).slice(1)),
    };
  }
  if (!subject) return undefined;

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

export function parseSampleCardsJson(raw: unknown): { candidate?: CandidateConditions; candidates: CandidateCard[] } {
  if (!raw || typeof raw !== 'object') return { candidates: [] };
  const r = raw as Raw;
  return {
    candidate: parseCandidateContext(r.candidate_context),
    candidates: asArray<Raw>(r.cards).map(parseCard),
  };
}

export function parseRulesJson(raw: unknown): Rule[] {
  // 兼容两种传入：规则数组 或 {_meta, rules:[]} 信封
  const list = Array.isArray(raw) ? raw : raw && typeof raw === 'object' ? asArray<Raw>((raw as Raw).rules) : [];
  return list.map(parseRule);
}

export function parseDataset(sampleJson: unknown, rulesJson: unknown): Dataset {
  const { candidate, candidates } = parseSampleCardsJson(sampleJson);
  const rules = parseRulesJson(rulesJson);
  return { candidate, candidates, rules };
}
