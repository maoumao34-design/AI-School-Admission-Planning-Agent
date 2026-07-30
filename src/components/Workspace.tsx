"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  CandidateConditions,
  ComparisonResult,
  DecisionResponse,
  EligibilityResult,
  ProbabilityTier,
  RankedCandidate,
  Strategy,
  StrategyGroup,
} from "@/decision/types";
import CandidateCard from "./CandidateCard";
import ChatPanel from "./ChatPanel";
import ConditionForm from "./ConditionForm";
import ProfilePanel, { type PlannerProfile, type ProfilePanelHandle } from "./ProfilePanel";

type Status = "loading" | "error" | "ready";
type StrategyKey = Extract<Strategy, "院校优先" | "专业优先">;
const STRATEGIES: StrategyKey[] = ["院校优先", "专业优先"];

const INITIAL_CANDIDATE: CandidateConditions = {
  province: "江苏",
  year: 2026,
  subject: { category: "物理类", primary: "物理", secondary: ["化学"] },
  score: 637,
  rank: 5200,
};

type DisplayTier = Extract<ProbabilityTier, "稳妥" | "保底" | "冲刺">;

const DISPLAY_LIMITS: Record<DisplayTier, number> = {
  稳妥: 12,
  保底: 12,
  冲刺: 6,
};
const TIER_ORDER: DisplayTier[] = ["稳妥", "保底", "冲刺"];
const FILTER_SAMPLE_LIMIT = 10;
const TIER_MORE_STEP = 10;
const TIER_MAX_LIMIT = 30;

async function postDecision<T>(url: string, body: unknown): Promise<DecisionResponse<T>> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`${res.status} ${res.statusText || "非 JSON 响应"}：${text.slice(0, 120) || "接口未返回 JSON"}`);
  }
  return (await res.json()) as DecisionResponse<T>;
}

function tierBuckets(candidates: RankedCandidate[], limits: Record<DisplayTier, number> = DISPLAY_LIMITS) {
  return TIER_ORDER.map((tier) => {
    const all = candidates.filter((c) => c.probability_ref.tier === tier);
    const visibleLimit = Math.min(limits[tier], TIER_MAX_LIMIT);
    const visible = all.slice(0, visibleLimit);
    return { tier, total: all.length, visibleLimit, candidates: visible, hidden: Math.max(0, all.length - visible.length) };
  });
}

function defaultTopCandidates(candidates: RankedCandidate[]) {
  return tierBuckets(candidates).flatMap((bucket) => bucket.candidates);
}

/** 工作区：建条件(form) → 资格过滤 → 方案比较 → 改条件随动重算 → 确认导出（6 步端到端可演示）。
 *  全部吃服务端真引擎；条件一改即重算（debounce 300ms）。 */
export default function Workspace() {
  const [candidate, setCandidate] = useState<CandidateConditions>(INITIAL_CANDIDATE);
  const [strategy, setStrategy] = useState<StrategyKey>("院校优先");
  const [activeProfileId, setActiveProfileId] = useState("");
  const [profiles, setProfiles] = useState<PlannerProfile[]>([]);
  const profileRef = useRef<ProfilePanelHandle>(null);
  const [condMode, setCondMode] = useState<"form" | "chat">("form");

  const [status, setStatus] = useState<Status>("loading");
  const [errMsg, setErrMsg] = useState("");
  const [compare, setCompare] = useState<DecisionResponse<ComparisonResult> | null>(null);
  const [elig, setElig] = useState<DecisionResponse<EligibilityResult[]> | null>(null);

  const handleActiveProfileChange = useCallback((profile: PlannerProfile) => {
    setActiveProfileId(profile.id);
    setCandidate(profile.conditions);
  }, []);

  const handleProfilesChange = useCallback((next: PlannerProfile[], nextActiveId: string) => {
    setProfiles(next);
    if (!activeProfileId && nextActiveId) setActiveProfileId(nextActiveId);
  }, [activeProfileId]);

  // 改条件 / 改策略 → 重调真引擎（debounce）
  useEffect(() => {
    const id = setTimeout(() => {
      setStatus("loading");
      setErrMsg("");
      const body = { candidate, strategies: STRATEGIES };
      const eligBody = { candidate };
      Promise.all([
        postDecision<ComparisonResult>("/api/compare", body),
        postDecision<EligibilityResult[]>("/api/eligibility", eligBody),
      ])
        .then(([c, e]) => {
          setCompare(c);
          setElig(e);
          setStatus("ready");
        })
        .catch((e: unknown) => {
          setErrMsg(e instanceof Error ? e.message : String(e));
          setStatus("error");
        });
    }, 300);
    return () => clearTimeout(id);
  }, [candidate, strategy]);

  const group = compare?.data?.groups.find((g) => g.strategy === strategy) ?? compare?.data?.groups[0];
  const groups = compare?.data?.groups ?? [];
  const outOfReach = compare?.data?.out_of_reach ?? [];
  const eligResults = elig?.data ?? [];
  const eligPassed = eligResults.filter((r) => r.passed).length;

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[360px_1fr]">
      {/* 左：登录/多档案 + 建条件（步骤 01） */}
      <div className="flex min-h-[320px] flex-col gap-3 lg:min-h-0">
        <ProfilePanel
          ref={profileRef}
          candidate={candidate}
          activeProfileId={activeProfileId}
          onActiveProfileChange={handleActiveProfileChange}
          onProfilesChange={handleProfilesChange}
        />
        <div className="flex min-h-[360px] flex-1 flex-col">
          <div className="mb-2 flex gap-1 text-xs">
            {(["form", "chat"] as const).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setCondMode(m)}
                className={`rounded-md border px-2 py-0.5 ${condMode === m ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-500 hover:bg-slate-50"}`}
              >
                {m === "form" ? "表单建条件" : "对话建条件"}
              </button>
            ))}
          </div>
          <div className="min-h-0 flex-1">
            {condMode === "form" ? (
              <ConditionForm value={candidate} onChange={setCandidate} />
            ) : (
              <ChatPanel
                onReady={(c) => {
                  setCandidate(c);
                  profileRef.current?.addProfileFromConditions(c);
                }}
                onConditionUpdate={(partial) => profileRef.current?.updateActiveFromConditions(partial)}
              />
            )}
          </div>
        </div>
      </div>

      {/* 右：资格过滤 → 方案比较 → 确认导出 */}
      <div className="flex min-h-0 flex-col">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">方案策略：</span>
          {STRATEGIES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStrategy(s)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                strategy === s ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
          <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500">
            当前档案：{profiles.find((p) => p.id === activeProfileId)?.name ?? "未命名"}
          </span>
          <button
            type="button"
            onClick={() => exportReport(candidate, strategy, group, outOfReach, eligPassed, eligResults.length, eligResults, compare?.trace)}
            className="ml-auto rounded-md bg-emerald-600 px-3 py-1 text-xs font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            disabled={!group || group.candidates.length === 0}
            title="确认并导出默认 Top30 + 过滤统计（步骤 06）"
          >
            确认 · 导出Top30
          </button>
        </div>

        {status === "loading" && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 py-16 text-sm text-slate-400">
            正在按条件检索 / 重算…
          </div>
        )}
        {status === "error" && (
          <div className="flex-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="font-medium">检索失败</div>
            <div className="mt-1 text-xs">原因：{errMsg}</div>
            <div className="mt-1 text-xs text-red-500">下一步：稍后重试，或检查数据来源是否可用。</div>
          </div>
        )}
        {status === "ready" && compare && (
          <ReadyView compare={compare} group={group} groups={groups} strategy={strategy} outOfReach={outOfReach} eligPassed={eligPassed} eligTotal={eligResults.length} elig={eligResults} />
        )}
      </div>
    </div>
  );
}

function ReadyView({
  compare,
  group,
  groups,
  strategy,
  outOfReach,
  eligPassed,
  eligTotal,
  elig,
}: {
  compare: DecisionResponse<ComparisonResult>;
  group?: StrategyGroup;
  groups: StrategyGroup[];
  strategy: Strategy;
  outOfReach: RankedCandidate[];
  eligPassed: number;
  eligTotal: number;
  elig: EligibilityResult[];
}) {
  const { outcome, trace } = compare;
  const [visibleLimits, setVisibleLimits] = useState<Record<DisplayTier, number>>({ ...DISPLAY_LIMITS });

  useEffect(() => {
    setVisibleLimits({ ...DISPLAY_LIMITS });
  }, [strategy, trace.generated_at]);

  // 异常路径：信息不足 / 无结果 / 需人工复核。差距过大另列，不再误判为主列表候选。
  if (outcome.status !== "ok" || !group || (group.candidates.length === 0 && outOfReach.length === 0)) {
    return (
      <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-medium">{outcome.status === "info_insufficient" ? "信息不足" : "没有符合的候选"}</div>
        <div className="mt-1 text-xs">{outcome.reason}</div>
        {outcome.next_step && <div className="mt-1 text-xs">下一步：{outcome.next_step}</div>}
      </div>
    );
  }

  const cu = trace.conditions_used;

  return (
    <div className="flex-1 space-y-4 overflow-y-auto pr-1">
      {/* 步骤 03 资格过滤：X/Y 通过 */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <span className="font-medium text-slate-700">资格过滤</span>
        <span className="rounded bg-emerald-50 px-2 py-0.5 text-emerald-700">{eligPassed}/{eligTotal} 候选通过硬条件</span>
        <span className="rounded bg-slate-100 px-2 py-0.5 text-slate-600">主推荐候选池 {group.candidates.length}</span>
        <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">默认主列表 Top30=稳12/保12/冲6</span>
        <span className="rounded bg-amber-50 px-2 py-0.5 text-amber-700">不推荐折叠 {outOfReach.length}</span>
        <details className="ml-1">
          <summary className="cursor-pointer text-slate-500">逐条规则</summary>
          <ul className="mt-1 space-y-0.5 text-slate-600">
            {elig.slice(0, FILTER_SAMPLE_LIMIT).map((r) => (
              <li key={r.candidate_id}>
                <b>{r.candidate_id}</b>：{r.passed ? "通过" : "未通过"}
                {r.blocking_rules.length > 0 && `（阻断：${r.blocking_rules.map((b) => b.rule_id).join("、")}）`}
                {r.advisories.length > 0 && <span className="text-amber-600"> · {r.advisories.join("；")}</span>}
              </li>
            ))}
            {elig.length > FILTER_SAMPLE_LIMIT && <li className="text-slate-400">仅展示前 {FILTER_SAMPLE_LIMIT} 条规则样例，其余已折叠。</li>}
          </ul>
        </details>
      </div>

      {/* 步骤 04 方案比较：两套策略并排（§3「并排比较至少两套方案」） */}
      {groups.length > 0 ? (
        <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
          {groups.map((g) => {
            const buckets = tierBuckets(g.candidates, visibleLimits);
            const shown = buckets.reduce((sum, b) => sum + b.candidates.length, 0);
            return (
              <div
                key={g.strategy}
                className={`rounded-xl border p-3 ${g.strategy === strategy ? "border-indigo-300 bg-indigo-50/30" : "border-slate-200 bg-white"}`}
              >
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="font-medium text-slate-700">{g.strategy}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">当前展示 {shown}</span>
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 text-slate-500">总可推荐 {g.candidates.length}</span>
                  <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-indigo-700">默认 Top30=稳12/保12/冲6</span>
                  {g.strategy === strategy && <span className="text-indigo-500">· 当前选中</span>}
                </div>
                {g.candidates.length > 0 ? (
                  <div className="space-y-4">
                    {buckets.map((b) => (
                      <section key={b.tier} className="space-y-2">
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <span className="font-medium">{b.tier}</span>
                          <span className="rounded bg-slate-100 px-1.5 py-0.5">展示 {b.candidates.length}/{b.total}</span>
                          {b.total === 0 && <span className="text-amber-600">本档可推荐不足，不硬凑</span>}
                          {b.hidden > 0 && <span className="text-slate-400">仍折叠 {b.hidden} 个</span>}
                        </div>
                        <div className="grid grid-cols-1 gap-3">
                          {b.candidates.map((c) => (
                            <CandidateCard key={c.id} card={c} />
                          ))}
                        </div>
                        {b.candidates.length < b.total && b.candidates.length < TIER_MAX_LIMIT && (
                          <button
                            type="button"
                            onClick={() =>
                              setVisibleLimits((prev) => ({
                                ...prev,
                                [b.tier]: Math.min(TIER_MAX_LIMIT, prev[b.tier] + TIER_MORE_STEP),
                              }))
                            }
                            className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600 hover:bg-slate-50"
                          >
                            查看更多{b.tier} +{Math.min(TIER_MORE_STEP, b.total - b.candidates.length, TIER_MAX_LIMIT - b.candidates.length)}（最多30/档）
                          </button>
                        )}
                        {b.total > TIER_MAX_LIMIT && b.candidates.length >= TIER_MAX_LIMIT && (
                          <p className="text-xs text-slate-400">已达每档最多 30 个展示上限，剩余候选继续折叠。</p>
                        )}
                      </section>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                    该策略下无可进主推荐的候选。
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          当前条件下没有可进入主推荐列表的候选；差距过大候选已收起到“不推荐”组。
        </div>
      )}

      {outOfReach.length > 0 && (
        <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs">
          <summary className="cursor-pointer font-medium text-slate-700">
            差距过大 · 不推荐（{outOfReach.length} 个，未混入主推荐列表）
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {outOfReach.slice(0, FILTER_SAMPLE_LIMIT).map((c) => (
              <CandidateCard key={c.id} card={c} />
            ))}
          </div>
          {outOfReach.length > FILTER_SAMPLE_LIMIT && (
            <p className="mt-2 text-slate-500">仅展示前 {FILTER_SAMPLE_LIMIT} 个不推荐原因样例，其余默认不显示。</p>
          )}
        </details>
      )}

      {/* 决策 trace（透明化：用了哪些条件 / 数据年份 / 生成时间） */}
      <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">决策依据：用了哪些条件 / 数据年份 / 生成时间</summary>
        <div className="mt-2 space-y-1 text-slate-600">
          <div>
            <span className="text-slate-400">条件：</span>
            {cu.province}·{cu.year} {cu.subject.category}（{cu.subject.primary}+{cu.subject.secondary.join("+")}） 分{cu.score}/位次{cu.rank.toLocaleString()}
          </div>
          <div><span className="text-slate-400">数据年份：</span>{trace.dataset_year} · 生成于 {new Date(trace.generated_at).toLocaleString("zh-CN")}</div>
        </div>
      </details>

      {/* 计划与版本（§3 功能④）：关键日期 + 风险提醒 + 版本随动 */}
      <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">计划与版本：关键日期 · 风险提醒 · 版本随动</summary>
        <div className="mt-2 space-y-2 text-slate-600">
          <div>
            <span className="text-slate-400">关键日期（{cu.year} 江苏）：</span>
            <span>志愿填报 / 录取查询等时间节点<strong>待官方公布</strong>，以江苏省教育考试院为准 · </span>
            <a href="https://www.jseea.cn/" target="_blank" rel="noreferrer" className="text-indigo-600 underline">jseea.cn</a>
          </div>
          <div>
            <span className="text-slate-400">风险提醒：</span>
            <ul className="ml-4 list-disc">
              <li>概率/档位为「{group.candidates[0]?.probability_ref.method ?? outOfReach[0]?.probability_ref.method ?? "近3年位次差法"}」参考，<strong>非录取预测</strong>。</li>
              <li>部分院校位次(min_rank)待《一分一段表》派生，当前按投档分差兜底分档（{trace.dataset_year}），位次回填后自动切回更精的位次差法。</li>
              <li>学费/计划/专业清单部分待核，见各卡提示；样本年份与来源见各卡。</li>
            </ul>
          </div>
          <div>
            <span className="text-slate-400">版本随动：</span>修改任何条件（分数/位次/选科/预算/策略）→ 方案即时重算（步骤 05），确认导出后可对比前后版本。
          </div>
        </div>
      </details>

      <p className="text-[11px] text-slate-400">
        ⚠ 概率为「{group.candidates[0]?.probability_ref.method ?? outOfReach[0]?.probability_ref.method ?? "近3年位次差法"}」参考，非录取预测；最终以官方录取结果为准。
      </p>
    </div>
  );
}

// —— 确认导出（步骤 06）：生成 Markdown 行动方案并下载 ——
function exportReport(
  candidate: CandidateConditions,
  strategy: Strategy,
  group: StrategyGroup | undefined,
  outOfReach: RankedCandidate[],
  eligPassed: number,
  eligTotal: number,
  elig: EligibilityResult[],
  trace: DecisionResponse<unknown>["trace"] | undefined,
) {
  if (!group) return;
  const when = new Date().toLocaleString("zh-CN");
  const buckets = tierBuckets(group.candidates);
  const topCandidates = defaultTopCandidates(group.candidates);
  const blocked = elig.filter((r) => !r.passed);
  const blockingSamples = blocked.slice(0, FILTER_SAMPLE_LIMIT);
  const outOfReachSamples = outOfReach.slice(0, FILTER_SAMPLE_LIMIT);
  const lines: string[] = [];
  lines.push(`# 升学规划方案（${candidate.province} · ${candidate.year}）`);
  lines.push("");
  lines.push(`> 生成时间：${when}`);
  lines.push(`> 数据年份：${trace?.dataset_year ?? "2023-2025"} · 概率方法：近3年位次差法（参考，非录取预测）`);
  lines.push(`> 三红线：只规划不承诺录取；官方事实/规则判断/AI建议分层；最终以官方页面为准。`);
  lines.push("");
  lines.push("## 考生条件");
  lines.push(`- 省份/年度：${candidate.province} · ${candidate.year}`);
  lines.push(`- 选科：${candidate.subject.category}（${candidate.subject.primary}+${candidate.subject.secondary.join("+")}）`);
  lines.push(`- 分数/位次：${candidate.score} / ${candidate.rank.toLocaleString()}`);
  if (candidate.budget?.maxTuition) lines.push(`- 学费预算上限：¥${candidate.budget.maxTuition}/年`);
  lines.push("");
  lines.push("## 资格过滤与展示统计");
  lines.push(`- ${eligPassed}/${eligTotal} 候选通过硬条件规则（选科/批次/费用/计划），未通过 ${blocked.length} 个。`);
  lines.push(`- 主推荐候选池：${group.candidates.length} 个；默认导出/主列表 Top30 口径=稳12/保12/冲6，实际导出 ${topCandidates.length} 个（不足不硬凑）。`);
  buckets.forEach((b) => lines.push(`- ${b.tier}：导出 ${b.candidates.length}/${b.total} 个；页面可“查看更多”每次 +10，最多 30/档。`));
  lines.push(`- 差距过大不推荐候选：${outOfReach.length} 个，未进入主推荐列表；导出仅保留最多 ${FILTER_SAMPLE_LIMIT} 个原因样例。`);
  if (blockingSamples.length) {
    lines.push(`- 硬条件未通过样例（最多 ${FILTER_SAMPLE_LIMIT} 条）：${blockingSamples.map((r) => `${r.candidate_id}:${r.blocking_rules.map((b) => b.rule_id).join("/") || "未通过"}`).join("；")}`);
  }
  lines.push("");
  lines.push(`## 方案：${strategy}（默认 Top30）`);
  topCandidates.forEach((c, i) => {
    lines.push(`${i + 1}. **${c.school.name} ${c.major_group.group_no}组**（${c.school.code ?? "—"}）— ${c.probability_ref.tier}（${c.probability_ref.pct_ref_band ?? ""}）`);
    lines.push(`   - 位次差(考生−校线)：${c.rank_diff_vs_candidate.toLocaleString()}（正=冲、负=稳/保）`);
    lines.push(`   - 选科：${c.major_group.subject_requirement} · 学制${c.recruitment.duration}年 · 学费¥${c.recruitment.tuition ?? "—"}/年`);
    lines.push(`   - 理由：${c.reason}`);
    lines.push(`   - 官方来源：${c.source.url} （${c.source.publisher ?? ""}，更新 ${c.source.updated ?? "—"}）`);
    if (c.caveats && c.caveats.length) lines.push(`   - 提示：${c.caveats.join("；")}`);
  });
  if (outOfReachSamples.length) {
    lines.push("");
    lines.push(`## 不推荐原因样例（差距过大，最多 ${FILTER_SAMPLE_LIMIT} 条）`);
    outOfReachSamples.forEach((c) => lines.push(`- ${c.school.name} ${c.major_group.group_no}组：${c.rank_diff_vs_candidate.toLocaleString()} 位次/分差，${c.reason}，${c.source.url}`));
    if (outOfReach.length > outOfReachSamples.length) lines.push(`- 其余 ${outOfReach.length - outOfReachSamples.length} 个不推荐候选默认折叠，不进入主方案。`);
  }
  lines.push("");
  lines.push("## 计划与版本");
  lines.push(`- 关键日期（${candidate.year} 江苏）：志愿填报/录取查询等时间节点**待官方公布**，以江苏省教育考试院(jseea.cn)为准。`);
  lines.push(`- 风险提醒：概率/档位为参考、**非录取预测**；部分院校位次(min_rank)待《一分一段表》派生，当前按投档分差兜底分档(${trace?.dataset_year ?? "2023-2025"})，回填后切回位次差法；学费/计划/专业清单部分待核(见各卡)。`);
  lines.push(`- 版本随动：修改条件 → 方案即时重算；本导出为当前版本快照。`);
  lines.push("");
  lines.push("---");
  lines.push("⚠ 本方案为规划辅助，不承诺录取。最终填报前必须回到官方页面核对。");
  const md = lines.join("\n");

  const blob = new Blob([md], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `升学规划方案-${candidate.province}${candidate.year}.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
