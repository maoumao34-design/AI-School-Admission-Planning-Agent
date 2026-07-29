"use client";

import { useState } from "react";
import type { CandidateConditions } from "@/decision/types";

/**
 * 对话建条件（§3 核心功能①）—— 对话 UI，连真实引擎。
 * 用户自然语言说目标 → Agent 追问缺项/冲突 → ready 后 onReady(candidate) 触发资格+比较。
 *
 * 对接 AI 工程师 POST /api/condition-building（确定性引擎，无需 LLM key）：
 *   入 { message, conditions: Partial<CandidateConditions>, history? }
 *   出 { reply, conditions, filled_fields[], missing[], conflicts[{field,status,message}], ready, next_question? }
 *   ready=true → 前端再走 /api/eligibility + /api/compare。
 */
type Msg = { role: "user" | "agent"; text: string };

export default function ChatPanel({
  onReady,
}: {
  onReady?: (c: CandidateConditions) => void;
}) {
  const [messages, setMessages] = useState<Msg[]>([
    {
      role: "agent",
      text: "你好，我是升学规划助手。先用一句话说说你的情况吧，比如：我是江苏物理类考生，637 分位次 5200，想找计算机相关专业。",
    },
  ]);
  const [input, setInput] = useState("");
  // 默认江苏/2026（场景范围已定），其余由对话补全
  const [conditions, setConditions] = useState<Partial<CandidateConditions>>({ province: "江苏", year: 2026 });
  const [busy, setBusy] = useState(false);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setBusy(true);
    const nextMessages: Msg[] = [...messages, { role: "user", text }];

    let reply = "已收到。";
    let updated: Partial<CandidateConditions> = { ...conditions };
    let ready = false;
    let conflictNote = "";
    try {
      const res = await fetch("/api/condition-building", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, conditions: updated }),
      });
      const data = await res.json();
      reply = data.reply ?? reply;
      updated = data.conditions ?? updated;
      ready = !!data.ready;
      if (Array.isArray(data.conflicts) && data.conflicts.length > 0) {
        conflictNote = "⚠ " + data.conflicts.map((c: { message: string }) => c.message).join("；");
      }
    } catch {
      reply = "对话引擎暂时连不上，可在左侧用表单建条件；或稍后重试。";
    }

    const agentText = conflictNote ? `${reply}\n${conflictNote}` : reply;
    nextMessages.push({ role: "agent", text: agentText });
    setMessages(nextMessages);
    setConditions(updated);
    setBusy(false);
    if (ready && isComplete(updated) && onReady) onReady(updated as CandidateConditions);
  }

  return (
    <section className="flex h-full flex-col rounded-xl border border-slate-200 bg-white">
      <header className="border-b border-slate-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-slate-900">对话建条件（步骤 01 · 自然语言）</h2>
        <p className="text-[11px] text-slate-500">说目标 → 我追问缺项 → 凑齐自动出方案</p>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
        {messages.map((m, i) => (
          <div key={i} className={`flex whitespace-pre-wrap ${m.role === "user" ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-3 py-2 ${
                m.role === "user" ? "bg-indigo-600 text-white" : "bg-slate-100 text-slate-800"
              }`}
            >
              {m.text}
            </div>
          </div>
        ))}
        {busy && <div className="text-center text-xs text-slate-400">助手思考中…</div>}
      </div>

      <div className="flex gap-2 border-t border-slate-100 p-3">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") send();
          }}
          placeholder="例如：637 分，位次 5200，物理类选了化学和生物"
          className="flex-1 rounded-md border border-slate-200 px-3 py-1.5 text-sm outline-none focus:border-indigo-400"
        />
        <button
          type="button"
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-md bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
        >
          发送
        </button>
      </div>
    </section>
  );
}

/** 引擎 ready 已保证 missing/conflicts 空；这里只做类型收窄前的结构校验。 */
function isComplete(c: Partial<CandidateConditions>): boolean {
  return !!(
    c.province &&
    c.year &&
    c.subject?.primary &&
    c.subject?.secondary?.length &&
    c.score != null &&
    c.rank != null
  );
}
