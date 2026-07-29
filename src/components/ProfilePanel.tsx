"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { CandidateConditions, SubjectCategory } from "@/decision/types";
import { createClient } from "../../lib/supabase/client";

export interface PlannerProfile {
  id: string;
  name: string;
  email: string;
  account: string; // 伪登录账户名（档案按此分桶隔离，互不可见）
  conditions: CandidateConditions;
  persisted?: boolean;
}

interface ProfilePanelProps {
  candidate: CandidateConditions;
  activeProfileId: string;
  onActiveProfileChange: (profile: PlannerProfile) => void;
  onProfilesChange: (profiles: PlannerProfile[], activeProfileId: string) => void;
}

const HAS_SUPABASE = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
);

const DEMO_EMAIL = "demo-planner@example.com";
const DEFAULT_ACCOUNT = "用户A";

function makeProfile(name: string, email: string, account: string, base: CandidateConditions): PlannerProfile {
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    email,
    account,
    conditions: base,
  };
}

/** 把对话每轮抽到的部分条件深合并进既有完整条件(subject 嵌套合并；未提供字段保留原值)。 */
function mergeConditions(base: CandidateConditions, partial: Partial<CandidateConditions>): CandidateConditions {
  return {
    ...base,
    ...partial,
    subject: partial.subject
      ? {
          category: partial.subject.category ?? base.subject.category,
          primary: partial.subject.primary ?? base.subject.primary,
          secondary: partial.subject.secondary ?? base.subject.secondary,
        }
      : base.subject,
    preferences: partial.preferences ?? base.preferences,
    budget: partial.budget ?? base.budget,
  };
}

function cloneWithName(base: CandidateConditions, index: number): CandidateConditions {
  const rank = Math.max(1, base.rank + index * 900);
  return {
    ...base,
    rank,
    score: Math.max(0, base.score - index * 6),
    subject: { ...base.subject, secondary: [...base.subject.secondary] },
  };
}

function toDbProfile(profile: PlannerProfile, accountId: string, isActive: boolean) {
  const c = profile.conditions;
  return {
    id: profile.persisted ? profile.id : undefined,
    account_id: accountId,
    name: profile.name,
    province: c.province,
    gaokao_year: c.year,
    subject_track: c.subject.category === "物理类" ? "physical" : "historical",
    selected_subjects: c.subject.secondary,
    score: c.score || null,
    rank: c.rank || null,
    preferences: c.preferences ?? null,
    budget: c.budget ?? null,
    is_active: isActive,
  };
}

function fromDbProfile(row: Record<string, unknown>, email: string, account: string): PlannerProfile {
  const category: SubjectCategory = row.subject_track === "historical" ? "历史类" : "物理类";
  const conditions: CandidateConditions = {
    province: String(row.province ?? "江苏"),
    year: Number(row.gaokao_year ?? 2026),
    subject: {
      category,
      primary: category === "物理类" ? "物理" : "历史",
      secondary: Array.isArray(row.selected_subjects) ? (row.selected_subjects as CandidateConditions["subject"]["secondary"]) : [],
    },
    score: Number(row.score ?? 0),
    rank: Number(row.rank ?? 0),
    preferences: (row.preferences ?? undefined) as CandidateConditions["preferences"],
    budget: (row.budget ?? undefined) as CandidateConditions["budget"],
  };
  return {
    id: String(row.id),
    name: String(row.name ?? "未命名档案"),
    email,
    account,
    conditions,
    persisted: true,
  };
}

export interface ProfilePanelHandle {
  /** 由「对话建条件」完成时调用：用抽到的条件新建一个考生档案并切为当前。 */
  addProfileFromConditions: (conditions: CandidateConditions) => void;
  /** 对话每轮调用：把本轮抽到的部分条件实时合并进当前档案(右侧随之重算)。 */
  updateActiveFromConditions: (partial: Partial<CandidateConditions>) => void;
}

/** 伪登录 + 多考生档案面板。账户名即登录态（不做真实鉴权）；档案按账户分桶隔离。
 *  Supabase env 存在时走真实 Auth/RLS（账户名=邮箱）；缺 env 时本地分桶演示，不阻断核心 6 步。 */
const ProfilePanel = forwardRef<ProfilePanelHandle, ProfilePanelProps>(function ProfilePanel({
  candidate,
  activeProfileId,
  onActiveProfileChange,
  onProfilesChange,
}, ref) {
  const [account, setAccount] = useState<string>(DEFAULT_ACCOUNT); // 当前伪登录账户（= 隔离桶 key）
  const [accountInput, setAccountInput] = useState<string>(DEFAULT_ACCOUNT);
  const [accountId, setAccountId] = useState<string>(HAS_SUPABASE ? "" : `pseudo-${DEFAULT_ACCOUNT}`);
  // 全部档案（跨账户）；展示/操作只取当前 account 的子集 → 隔离
  const [profiles, setProfiles] = useState<PlannerProfile[]>(() => [makeProfile("考生 A", DEMO_EMAIL, DEFAULT_ACCOUNT, candidate)]);
  const [message, setMessage] = useState(
    HAS_SUPABASE ? "请登录后读取账号档案" : "伪登录模式：输用户名即登录，档案按账户隔离（不依赖 Supabase/key）",
  );

  const visibleProfiles = useMemo(() => profiles.filter((p) => p.account === account), [profiles, account]);
  const active = useMemo(
    () => visibleProfiles.find((p) => p.id === activeProfileId) ?? visibleProfiles[0],
    [activeProfileId, visibleProfiles],
  );

  useEffect(() => {
    onProfilesChange(visibleProfiles, active?.id ?? "");
  }, [active?.id, onProfilesChange, visibleProfiles]);

  // 切到某账户后若该桶为空，补一个默认档案（保证总有可操作的当前档案）
  useEffect(() => {
    if (visibleProfiles.length === 0) {
      const seed = makeProfile("考生 A", DEMO_EMAIL, account, candidate);
      setProfiles((prev) => [...prev, seed]);
      onActiveProfileChange(seed);
    }
  }, [account]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!HAS_SUPABASE) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) {
        setAccountId(data.user.id);
        setAccount(data.user.email ?? DEFAULT_ACCOUNT);
        void loadProfiles(data.user.id, data.user.email ?? DEFAULT_ACCOUNT);
      }
    });
  }, []);

  async function loadProfiles(userId: string, userEmail: string) {
    const supabase = createClient();
    const { data, error } = await supabase.from("profiles").select("*").order("created_at", { ascending: true });
    if (error) {
      setMessage(`读取档案失败：${error.message}`);
      return;
    }
    const next = (data ?? []).map((row) => fromDbProfile(row, userEmail, userEmail));
    if (next.length === 0) {
      const first = makeProfile("考生 A", userEmail, userEmail, candidate);
      const saved = await saveProfile(first, userId, true);
      if (saved) return;
      setProfiles((prev) => [...prev.filter((p) => p.account !== userEmail), first]);
      onActiveProfileChange(first);
      return;
    }
    setProfiles((prev) => [...prev.filter((p) => p.account !== userEmail), ...next]);
    const current = next.find((p, i) => Boolean(data?.[i]?.is_active)) ?? next[0];
    onActiveProfileChange(current);
    setMessage(`已读取 ${next.length} 个档案（账号级 RLS 隔离）`);
  }

  /** 伪登录：输用户名即登录（不做鉴权）；切到该账户的档案桶。 */
  async function signIn() {
    const name = accountInput.trim() || DEFAULT_ACCOUNT;
    setAccount(name);
    setAccountId(HAS_SUPABASE ? accountId : `pseudo-${name}`);
    setMessage(`已伪登录「${name}」；只显示该账户的档案，与其他账户隔离`);
    if (HAS_SUPABASE && accountId) {
      // Supabase 增强路径：按邮箱加载该账户档案（account=邮箱）
      void loadProfiles(accountId, name);
    }
  }

  function signOut() {
    setAccount(DEFAULT_ACCOUNT);
    setAccountInput(DEFAULT_ACCOUNT);
    setAccountId(HAS_SUPABASE ? "" : `pseudo-${DEFAULT_ACCOUNT}`);
    setMessage("已切回默认账户");
  }

  async function saveProfile(profile: PlannerProfile, userId = accountId, isActive = profile.id === active?.id) {
    if (!HAS_SUPABASE || !userId) return false;
    const supabase = createClient();
    const payload = toDbProfile(profile, userId, isActive);
    const { data, error } = await supabase.from("profiles").upsert(payload).select("*").single();
    if (error) {
      setMessage(`保存失败：${error.message}`);
      return false;
    }
    const saved = fromDbProfile(data, profile.email, profile.account);
    setProfiles((prev) => {
      const others = prev.filter((p) => p.id !== profile.id && p.id !== saved.id);
      return [...others, saved];
    });
    onActiveProfileChange(saved);
    setMessage("已保存到当前账户；切换档案/账户不会串条件");
    return true;
  }

  async function addProfile() {
    const next = makeProfile(`考生 ${visibleProfiles.length + 1}`, DEMO_EMAIL, account, cloneWithName(candidate, visibleProfiles.length + 1));
    setProfiles((prev) => [...prev, next]);
    onActiveProfileChange(next);
    setMessage("已新增档案（属当前账户）；默认复制当前条件并调整分/位次，便于观察候选随动");
    if (HAS_SUPABASE && accountId) await saveProfile(next, accountId, true);
  }

  async function deleteProfile(id: string) {
    if (visibleProfiles.length <= 1) {
      setMessage("每个账户至少保留 1 个档案");
      return;
    }
    if (HAS_SUPABASE && !id.startsWith("local-")) {
      const { error } = await createClient().from("profiles").delete().eq("id", id);
      if (error) {
        setMessage(`删除失败：${error.message}`);
        return;
      }
    }
    setProfiles((prev) => prev.filter((p) => p.id !== id));
    const remain = visibleProfiles.filter((p) => p.id !== id);
    if (remain[0]) onActiveProfileChange(remain[0]);
    setMessage("已删除档案；剩余档案条件保持独立");
  }

  function selectProfile(profile: PlannerProfile) {
    onActiveProfileChange(profile);
    setMessage(`已切换到 ${profile.name}；右侧方案按该档案重算`);
  }

  function renameActive(name: string) {
    setProfiles((prev) => prev.map((p) => (p.id === active?.id ? { ...p, name } : p)));
  }

  function syncActiveFromForm() {
    if (!active) return;
    const synced = { ...active, conditions: candidate };
    setProfiles((prev) => prev.map((p) => (p.id === active.id ? synced : p)));
    void saveProfile(synced);
    setMessage("当前表单条件已写入该档案；其他档案/账户不受影响");
  }

  useImperativeHandle(ref, () => ({
    addProfileFromConditions(conditions: CandidateConditions) {
      const next = makeProfile(`考生 ${visibleProfiles.length + 1}（对话）`, DEMO_EMAIL, account, conditions);
      setProfiles((prev) => [...prev, next]);
      onActiveProfileChange(next);
      setMessage("已由「对话建条件」新增并切到该档案；右侧方案按此重算");
      if (HAS_SUPABASE && accountId) void saveProfile(next, accountId, true);
    },
    updateActiveFromConditions(partial: Partial<CandidateConditions>) {
      if (!active) return;
      const merged = mergeConditions(active.conditions, partial);
      const updated = { ...active, conditions: merged };
      setProfiles((prev) => prev.map((p) => (p.id === active.id ? updated : p)));
      onActiveProfileChange(updated);
      if (HAS_SUPABASE && accountId) void saveProfile(updated);
    },
  }), [profiles, account, accountId, onActiveProfileChange, active, visibleProfiles]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">账号 / 多考生档案</h2>
          <p className="text-[11px] text-slate-500">伪登录（输用户名）+ 账户级档案隔离；账户/档案只管归属，不进判定</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] ${HAS_SUPABASE ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {HAS_SUPABASE ? "Supabase" : "伪登录"}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          value={accountInput}
          onChange={(e) => setAccountInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") signIn(); }}
          className="flex-1 rounded border border-slate-200 px-2 py-1"
          placeholder="用户名（如 用户A / 用户B）"
        />
        <button type="button" onClick={signIn} className="rounded bg-slate-900 px-3 py-1 font-medium text-white">登录</button>
        <button type="button" onClick={signOut} className="rounded border border-slate-200 px-3 py-1 text-slate-600">默认</button>
        <span className="rounded bg-indigo-50 px-2 py-0.5 text-indigo-700">当前账户：{account}</span>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {visibleProfiles.map((profile) => (
          <button
            key={profile.id}
            type="button"
            onClick={() => selectProfile(profile)}
            className={`rounded-lg border px-2.5 py-1 text-left ${profile.id === active?.id ? "border-indigo-500 bg-indigo-50 text-indigo-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}
          >
            <span className="font-medium">{profile.name}</span>
            <span className="ml-1 text-[10px] opacity-70">{profile.conditions.score}分 / {profile.conditions.rank.toLocaleString()}位</span>
          </button>
        ))}
        <button type="button" onClick={addProfile} className="rounded-lg border border-dashed border-slate-300 px-2.5 py-1 text-slate-500 hover:bg-slate-50">+ 新增档案</button>
      </div>

      {active && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
          <span className="text-slate-500">当前档案</span>
          <input value={active.name} onChange={(e) => renameActive(e.target.value)} className="w-28 rounded border border-slate-200 px-2 py-1" />
          <button type="button" onClick={syncActiveFromForm} className="rounded bg-emerald-600 px-2.5 py-1 font-medium text-white">保存当前条件</button>
          <button type="button" onClick={() => deleteProfile(active.id)} className="rounded border border-red-200 px-2.5 py-1 text-red-600">删除档案</button>
          <span className="text-[11px] text-slate-400">账户：{account}（档案隔离：仅显示本账户）</span>
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-500">{message}</p>
    </section>
  );
});

export default ProfilePanel;
