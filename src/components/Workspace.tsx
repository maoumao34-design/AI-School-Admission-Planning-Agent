"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  CandidateCard as CandidateCardDTO,
  CandidateConditions,
  DecisionResponse,
  Strategy,
  StrategyGroup,
} from "@/decision/types";
// 真引擎 /api/compare 的请求体 = { candidate, candidates, strategies }（见 docs/API-CONTRACT.md §3）。
// 候选条件 + 候选卡原始结构来自数据角色交付的样本；概率档/位次差/理由/排序全部由服务端
// 决策核心(src/decision)重算，前端不自己算——这是「吃真引擎数据」的关键。
import sample from "../../data/sample-jiangsu-2026-phys.json";
import CandidateCard from "./CandidateCard";
import ChatPane from "./ChatPane";

type State =
  | { kind: "loading" }
  | { kind: "error"; message: string }
  | { kind: "ready"; data: DecisionResponse<StrategyGroup[]> };

type StrategyKey = Extract<Strategy, "院校优先" | "专业优先">;

const STRATEGIES: StrategyKey[] = ["院校优先", "专业优先"];

/** 工作区：POST /api/compare（真引擎）→ 展示策略组候选卡 + 决策 trace + 异常状态。
 *  覆盖 TASK-SPEC §3：加载/成功/失败状态；无结果/异常给原因+下一步；改策略随动重排序。 */
export default function Workspace() {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [strategy, setStrategy] = useState<StrategyKey>("院校优先");

  const candidate = sample.candidate_context as unknown as CandidateConditions;
  const candidates = (sample.cards ?? []) as unknown as CandidateCardDTO[];

  const buildRequest = useCallback(
    (): { candidate: CandidateConditions; candidates: CandidateCardDTO[]; strategies: Strategy[] } => ({
      candidate,
      candidates,
      strategies: [strategy],
    }),
    [candidate, candidates, strategy],
  );

  useEffect(() => {
    let alive = true;
    setState({ kind: "loading" });
    fetch("/api/compare", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildRequest()),
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return (await r.json()) as DecisionResponse<StrategyGroup[]>;
      })
      .then((data) => {
        if (alive) setState({ kind: "ready", data });
      })
      .catch((e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e);
        if (alive) setState({ kind: "error", message: msg });
      });
    return () => {
      alive = false;
    };
  }, [buildRequest]);

  const group = state.kind === "ready" ? state.data.data?.[0] : undefined;

  return (
    <div className="grid h-full grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
      {/* 左：对话区 */}
      <div className="min-h-[320px] lg:min-h-0">
        <ChatPane context={candidate} />
      </div>

      {/* 右：候选 + 比较 */}
      <div className="flex min-h-0 flex-col">
        {/* 策略切换：改策略 → 重调真引擎 → 排序随动 */}
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <span className="text-xs text-slate-500">方案策略：</span>
          {STRATEGIES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setStrategy(s)}
              className={`rounded-md border px-2.5 py-1 text-xs ${
                strategy === s
                  ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                  : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              }`}
            >
              {s}
            </button>
          ))}
          <span className="text-[11px] text-slate-400">（切换重调真引擎 /api/compare，按策略重排序）</span>
        </div>

        {state.kind === "loading" && (
          <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-slate-200 py-16 text-sm text-slate-400">
            正在按条件检索候选…
          </div>
        )}

        {state.kind === "error" && (
          <div className="flex-1 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">
            <div className="font-medium">检索失败</div>
            <div className="mt-1 text-xs">原因：{state.message}</div>
            <div className="mt-1 text-xs text-red-500">下一步：稍后重试，或检查数据来源是否可用。</div>
          </div>
        )}

        {state.kind === "ready" && <ReadyView data={state.data} group={group} />}
      </div>
    </div>
  );
}

function ReadyView({
  data,
  group,
}: {
  data: DecisionResponse<StrategyGroup[]>;
  group?: StrategyGroup;
}) {
  const { outcome, trace } = data;

  // 异常路径：info_insufficient / no_result / needs_manual_review / data_stale ...
  if (outcome.status !== "ok" || !group || group.candidates.length === 0) {
    return (
      <div className="flex-1 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
        <div className="font-medium">没有符合的候选</div>
        <div className="mt-1 text-xs">{outcome.reason || "当前条件下无匹配院校专业组。"}</div>
        {outcome.next_step && <div className="mt-1 text-xs">下一步：{outcome.next_step}</div>}
      </div>
    );
  }

  const cu = trace.conditions_used;

  return (
    <div className="flex-1 space-y-4">
      {/* 决策 trace：用了哪些条件 / 数据年份 / 生成时间（决策透明化） */}
      <details className="rounded-lg border border-slate-200 bg-white p-3 text-xs">
        <summary className="cursor-pointer font-medium text-slate-700">
          决策依据：用了哪些条件 / 数据年份 / 生成时间
        </summary>
        <div className="mt-2 space-y-1 text-slate-600">
          <div>
            <span className="text-slate-400">条件：</span>
            {cu.province}·{cu.year} {cu.subject.category}（{cu.subject.primary}+{cu.subject.secondary.join("+")}）
            分{cu.score}/位次{cu.rank.toLocaleString()}
          </div>
          {trace.rules_applied.length > 0 && (
            <div>
              <span className="text-slate-400">规则：</span>
              {trace.rules_applied.join("、")}
            </div>
          )}
          <div>
            <span className="text-slate-400">数据年份：</span>
            {trace.dataset_year} · <span className="text-slate-400">生成于</span>{" "}
            {new Date(trace.generated_at).toLocaleString("zh-CN")}
          </div>
          <div className="text-slate-400">（compare 端点不跑资格规则；资格过滤见 /api/eligibility）</div>
        </div>
      </details>

      {/* 候选卡列表（引擎按当前策略排好序） */}
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
        {group.candidates.map((c) => (
          <CandidateCard key={c.id} card={c} />
        ))}
      </div>

      <p className="text-[11px] text-slate-400">
        ⚠ 概率为「{group.candidates[0]?.probability_ref.method ?? "近3年位次差法"}」参考，非录取预测；最终以官方录取结果为准。
      </p>
    </div>
  );
}
