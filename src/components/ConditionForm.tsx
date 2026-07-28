"use client";

import type {
  CandidateConditions,
  PrimarySubject,
  SecondarySubject,
  SubjectCategory,
} from "@/decision/types";

const SECONDARY: SecondarySubject[] = ["化学", "生物", "政治", "地理"];
const CATEGORIES: SubjectCategory[] = ["物理类", "历史类"];

function NumField({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: number;
  onChange: (n: number) => void;
  placeholder?: string;
}) {
  return (
    <label className="block text-xs">
      <span className="text-slate-500">{label}</span>
      <input
        type="number"
        inputMode="numeric"
        value={Number.isFinite(value) ? value : ""}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value === "" ? 0 : Number(e.target.value))}
        className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-indigo-400"
      />
    </label>
  );
}

/** 对话建条件（结构化表单）= 6 步之 01。
 *  自然语言对话建条件由 AI工程师 LLM 编排（后接）；此处先把「影响资格判断的条件」结构化可编辑，
 *  缺分/位次等会让引擎返回 info_insufficient（演示异常路径）。 */
export default function ConditionForm({
  value,
  onChange,
}: {
  value: CandidateConditions;
  onChange: (c: CandidateConditions) => void;
}) {
  const setSubject = (patch: Partial<CandidateConditions["subject"]>) =>
    onChange({ ...value, subject: { ...value.subject, ...patch } });

  const secondary = value.subject.secondary;
  const SECONDARY_MAX = 2; // 江苏 3+1+2：再选 化/生/政/地 取 2
  const toggleSecondary = (s: SecondarySubject) => {
    const has = secondary.includes(s);
    if (has) {
      setSubject({ secondary: secondary.filter((x) => x !== s) });
      return;
    }
    // 已满 2 门再点第三个：自动顶替最早选的（不超过 2）
    const next =
      secondary.length >= SECONDARY_MAX ? [...secondary.slice(1), s] : [...secondary, s];
    setSubject({ secondary: next });
  };

  const setCategory = (cat: SubjectCategory) => {
    const primary: PrimarySubject = cat === "物理类" ? "物理" : "历史";
    setSubject({ category: cat, primary });
  };

  const budget = value.budget?.maxTuition ?? 0;

  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">建条件（对话建条件 · 步骤 01）</h2>
        <p className="text-[11px] text-slate-500">改任何条件 → 右侧方案随动重算（步骤 05）</p>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <div className="grid grid-cols-2 gap-2">
          <label className="block text-xs">
            <span className="text-slate-500">省份</span>
            <input
              value={value.province}
              onChange={(e) => onChange({ ...value, province: e.target.value })}
              className="mt-0.5 w-full rounded border border-slate-200 px-2 py-1 text-sm outline-none focus:border-indigo-400"
            />
          </label>
          <NumField label="年度" value={value.year} onChange={(year) => onChange({ ...value, year })} />
        </div>

        <div className="text-xs">
          <span className="text-slate-500">科类（首选）</span>
          <div className="mt-1 flex gap-2">
            {CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={`rounded-md border px-2.5 py-1 text-xs ${
                  value.subject.category === c
                    ? "border-indigo-500 bg-indigo-50 text-indigo-700"
                    : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                }`}
              >
                {c}（{c === "物理类" ? "物理" : "历史"}）
              </button>
            ))}
          </div>
        </div>

        <div className="text-xs">
          <span className="text-slate-500">
            再选科目（江苏 3+1+2，选 2 门）
            <span className="ml-1 text-slate-400">
              已选 {secondary.length}/{SECONDARY_MAX}{secondary.length >= SECONDARY_MAX ? " · 再选将替换最早" : ""}
            </span>
          </span>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {SECONDARY.map((s) => {
              const on = secondary.includes(s);
              const willReplace = !on && secondary.length >= SECONDARY_MAX;
              return (
                <button
                  key={s}
                  type="button"
                  onClick={() => toggleSecondary(s)}
                  title={willReplace ? "已满 2 门，点击将替换最早选的" : undefined}
                  className={`rounded-md border px-2 py-1 text-xs ${
                    on ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  } ${willReplace ? "opacity-60" : ""}`}
                >
                  {s}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-2">
          <NumField label="高考分数" value={value.score} onChange={(score) => onChange({ ...value, score })} placeholder="如 637" />
          <NumField label="位次" value={value.rank} onChange={(rank) => onChange({ ...value, rank })} placeholder="如 5200" />
        </div>

        <NumField
          label="学费预算上限（元/年，可选）"
          value={budget}
          onChange={(n) =>
            onChange({ ...value, budget: n > 0 ? { maxTuition: n } : undefined })
          }
          placeholder="不限"
        />

        <p className="text-[10px] leading-relaxed text-slate-400">
          条件直接驱动服务端决策核心（src/decision）：资格校验→位次差法分档(冲刺/稳妥/保底)→按策略排序。改条件即重算。
        </p>
      </div>
    </section>
  );
}
