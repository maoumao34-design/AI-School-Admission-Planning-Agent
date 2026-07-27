import Workspace from "@/components/Workspace";

export default function Page() {
  return (
    <main className="mx-auto flex h-screen max-w-7xl flex-col gap-3 p-3 sm:p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-lg font-bold text-slate-900 sm:text-xl">AI 升学规划 Agent · 高考志愿</h1>
          <p className="text-[11px] text-slate-500 sm:text-xs">
            江苏 · 2026 · 依据官方规则校验资格、过滤候选、比较方案（候选卡数据来自真引擎 /api/compare）
          </p>
        </div>
        <span className="hidden rounded-md bg-slate-900 px-2 py-1 text-[11px] text-white sm:inline">
          一账号 · 多考生档案（B）
        </span>
      </header>

      {/* 三红线提示条 */}
      <div className="redline-banner flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border px-3 py-1.5">
        <span>🚫 只规划，不承诺录取</span>
        <span>🗂 官方事实 / 规则判断 / AI 建议 分层可见</span>
        <span>🔗 最终以官方页面为准</span>
      </div>

      <div className="min-h-0 flex-1">
        <Workspace />
      </div>
    </main>
  );
}
