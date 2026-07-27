import type { CandidateConditions } from "@/decision/types";

/**
 * 对话区（占位）：说目标 → Agent 追问缺失/冲突条件 → 确认后触发资格校验与方案比较。
 * 真实对话建条件由 AI 工程师的 LLM 编排（MAO-14，/api/eligibility 等）接入；
 * 此处先展示引擎已识别的条件（CandidateConditions，对齐 src/decision/types.ts）+ 追问占位。
 */
export default function ChatPane({ context }: { context?: CandidateConditions }) {
  const c = context;
  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">对话建条件</h2>
        <p className="text-[11px] text-slate-500">说目标，Agent 追问影响资格的缺失/冲突条件</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4 text-sm">
        <div className="rounded-lg bg-slate-50 p-3 text-slate-700">
          你好，我先了解基本情况——<b>省份、年度、选科、分数/位次、偏好、预算</b>都会影响资格判断。
        </div>

        {c ? (
          <div className="rounded-lg border border-indigo-100 bg-indigo-50/50 p-3">
            <div className="text-[11px] font-medium text-indigo-700">已识别条件</div>
            <ul className="mt-1 space-y-0.5 text-xs text-slate-700">
              <li>省份/年度：{c.province} · {c.year}</li>
              <li>选科：{c.subject.category}（{c.subject.primary}+{c.subject.secondary.join("+")}）</li>
              <li>分数/位次：{c.score} / {c.rank.toLocaleString()}</li>
            </ul>
          </div>
        ) : (
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3 text-xs text-amber-800">
            ⚠ 信息不足：尚未识别完整条件。请补充分数/位次等。
          </div>
        )}

        <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-600">
          <b>Agent 追问（占位）：</b>有没有明确的院校地区偏好或专业方向？预算上限是多少？
          <div className="mt-2 flex gap-2">
            <input
              className="flex-1 rounded border border-slate-200 px-2 py-1 text-xs outline-none focus:border-indigo-400"
              placeholder="补充偏好/预算…"
              disabled
            />
            <button
              type="button"
              disabled
              className="rounded bg-indigo-600 px-3 py-1 text-xs font-medium text-white opacity-60"
            >
              确认并比较
            </button>
          </div>
          <p className="mt-1 text-[10px] text-slate-400">（LLM 对话建条件待 AI工程师 MAO-14 接入后启用）</p>
        </div>
      </div>
    </section>
  );
}
