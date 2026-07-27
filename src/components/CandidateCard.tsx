import type { RankedCandidate } from "@/decision/types";

/** 概率档徽标配色（对齐 ProbabilityTier：冲刺/稳妥/保底/差距过大） */
const TIER_STYLE: Record<string, string> = {
  冲刺: "bg-amber-100 text-amber-800 border-amber-300",
  稳妥: "bg-blue-100 text-blue-800 border-blue-300",
  保底: "bg-green-100 text-green-800 border-green-300",
  "差距过大": "bg-slate-200 text-slate-600 border-slate-300",
};

/**
 * 位次差格式化。
 * engine 约定（src/decision/engine.ts）：rank_diff = 考生位次 − 校线(最近年)位次；
 *   正=冲(位次靠后)、负=稳/保(优于校线)；Infinity=缺历史数据。
 */
function fmtRankDiff(d: number | null | undefined): { text: string; cls: string } {
  if (d == null || !Number.isFinite(d)) return { text: "—", cls: "text-slate-400" };
  const cls = d > 0 ? "text-amber-700" : "text-green-700";
  const sign = d > 0 ? "+" : "";
  return { text: `${sign}${Math.round(d).toLocaleString()}`, cls };
}

/**
 * 候选卡组件 —— 渲染 TASK-SPEC §5 全字段。
 * 直接消费决策核心的 RankedCandidate（= CandidateCard + 引擎算出的 probability_ref/rank_diff/reason），
 * 类型来自 @/decision/types，与引擎同源、不会漂移。
 */
export default function CandidateCard({ card }: { card: RankedCandidate }) {
  const tier = card.probability_ref.tier;
  const tierCls = TIER_STYLE[tier] ?? "bg-slate-100 text-slate-700 border-slate-300";
  const rd = fmtRankDiff(card.rank_diff_vs_candidate);

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition-shadow hover:shadow-md">
      {/* 头：院校专业组 + 概率徽标 */}
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-base font-semibold text-slate-900">
            {card.school.name}
            <span className="ml-1 font-normal text-slate-500">
              {card.school.code ? `· ${card.school.code}` : ""} 组 {card.major_group.group_no}
            </span>
          </h3>
          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs">
            <span className="text-slate-500">{card.school.region}</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">{card.school.batch}</span>
          </div>
          {card.school.level_tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {card.school.level_tags.map((t) => (
                <span key={t} className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11px] text-indigo-700">{t}</span>
              ))}
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <span className={`inline-block rounded-md border px-2 py-1 text-sm font-semibold ${tierCls}`}>{tier}</span>
          {card.probability_ref.pct_ref_band && (
            <div className="mt-1 text-[11px] text-slate-500">参考 {card.probability_ref.pct_ref_band}</div>
          )}
          <div className="mt-0.5 text-[11px] text-slate-400">{card.probability_ref.data_years}</div>
        </div>
      </header>

      {/* 位次差（engine 约定：正=冲、负=稳/保） */}
      <div className="mt-3 flex items-center gap-2 text-sm">
        <span className="text-slate-500">位次差(考生−校线)</span>
        <span className={`font-semibold ${rd.cls}`}>{rd.text}</span>
        <span className="text-[11px] text-slate-400">（正=向上够、负=优于校线）</span>
      </div>

      {/* 近 3 年 */}
      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="text-slate-500">
            <tr className="text-left">
              <th className="py-1 pr-2 font-medium">年份</th>
              <th className="py-1 pr-2 font-medium">投档分</th>
              <th className="py-1 pr-2 font-medium">位次</th>
              <th className="py-1 pr-2 font-medium">位次差</th>
              <th className="py-1 font-medium">计划</th>
            </tr>
          </thead>
          <tbody className="text-slate-700">
            {card.history.map((h) => {
              const hd = fmtRankDiff(h.rank_diff);
              return (
                <tr key={h.year} className="border-t border-slate-100">
                  <td className="py-1 pr-2">{h.year}</td>
                  <td className="py-1 pr-2">{h.min_score ?? "—"}</td>
                  <td className="py-1 pr-2">{h.min_rank?.toLocaleString() ?? "—"}</td>
                  <td className={`py-1 pr-2 ${hd.cls}`}>{hd.text}</td>
                  <td className="py-1">{h.plan ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 选科 / 学制学费 */}
      <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-slate-600 sm:grid-cols-3">
        <div><dt className="text-slate-400">选科要求</dt><dd>{card.major_group.subject_requirement}</dd></div>
        <div><dt className="text-slate-400">学制</dt><dd>{card.recruitment.duration} 年</dd></div>
        <div>
          <dt className="text-slate-400">学费</dt>
          <dd>{card.recruitment.tuition != null ? `¥${card.recruitment.tuition.toLocaleString()}/年` : "待抽取"}</dd>
        </div>
      </dl>

      {/* 引擎推荐理由（可展开） */}
      {card.reason && (
        <details className="mt-3 text-xs">
          <summary className="cursor-pointer text-slate-600 hover:text-slate-900">为什么推荐（引擎理由）</summary>
          <p className="mt-1 leading-relaxed text-slate-600">{card.reason}</p>
          {card.major_group.majors && card.major_group.majors.length > 0 && (
            <p className="mt-1 text-slate-500">组内专业：{card.major_group.majors.join("、")}</p>
          )}
        </details>
      )}

      {/* 异常提示（数据待抽取 / 需复核等） */}
      {card.caveats && card.caveats.length > 0 && (
        <ul className="mt-3 space-y-1">
          {card.caveats.map((caveat, i) => (
            <li key={i} className="flex gap-1.5 text-[11px] text-amber-700">
              <span aria-hidden>⚠</span>
              <span>{caveat}</span>
            </li>
          ))}
        </ul>
      )}

      {/* 官方来源 */}
      <footer className="mt-3 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-100 pt-2 text-[11px] text-slate-500">
        {card.source.publisher && <span>{card.source.publisher}</span>}
        <a href={card.source.url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline">
          官方来源
        </a>
        {card.source.updated && <span>· 更新 {card.source.updated}</span>}
        {card.source.status && <span className="text-amber-600">· {card.source.status}</span>}
      </footer>

      <p className="mt-2 text-[10px] text-slate-400">
        概率方法：{card.probability_ref.method} · {card.probability_ref.data_years}。参考非预测，最终以官方录取为准。
      </p>
    </article>
  );
}
