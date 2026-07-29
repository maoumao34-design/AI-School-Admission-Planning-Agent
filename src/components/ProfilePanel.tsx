"use client";

import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from "react";
import type { CandidateConditions, SubjectCategory } from "@/decision/types";
import { createClient } from "../../lib/supabase/client";

export interface PlannerProfile {
  id: string;
  name: string;
  email: string;
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

function makeProfile(name: string, email: string, base: CandidateConditions): PlannerProfile {
  return {
    id: `local-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name,
    email,
    conditions: base,
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

function fromDbProfile(row: Record<string, unknown>, email: string): PlannerProfile {
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
    conditions,
    persisted: true,
  };
}

export interface ProfilePanelHandle {
  /** 由「对话建条件」完成时调用：用抽到的条件新建一个考生档案并切为当前。 */
  addProfileFromConditions: (conditions: CandidateConditions) => void;
}

/** 登录 + 多档案面板。Supabase env 存在时走真实 Auth/RLS；缺 env 时提供本地演示态，不阻断核心 6 步。 */
const ProfilePanel = forwardRef<ProfilePanelHandle, ProfilePanelProps>(function ProfilePanel({
  candidate,
  activeProfileId,
  onActiveProfileChange,
  onProfilesChange,
}, ref) {
  const [email, setEmail] = useState(DEMO_EMAIL);
  const [password, setPassword] = useState("Demo123456");
  const [accountId, setAccountId] = useState<string>(HAS_SUPABASE ? "" : "local-account");
  const [profiles, setProfiles] = useState<PlannerProfile[]>(() => [makeProfile("考生 A", DEMO_EMAIL, candidate)]);
  const [message, setMessage] = useState(HAS_SUPABASE ? "请登录后读取账号档案" : "演示模式：缺 Supabase env，档案保存在本页内存中");

  const active = useMemo(
    () => profiles.find((p) => p.id === activeProfileId) ?? profiles[0],
    [activeProfileId, profiles],
  );

  useEffect(() => {
    onProfilesChange(profiles, active?.id ?? "");
  }, [active?.id, onProfilesChange, profiles]);

  useEffect(() => {
    if (!HAS_SUPABASE) return;
    const supabase = createClient();
    supabase.auth.getUser().then(({ data }) => {
      if (data.user?.id) {
        setAccountId(data.user.id);
        setEmail(data.user.email ?? email);
        void loadProfiles(data.user.id, data.user.email ?? email);
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
    const next = (data ?? []).map((row) => fromDbProfile(row, userEmail));
    if (next.length === 0) {
      const first = makeProfile("考生 A", userEmail, candidate);
      const saved = await saveProfile(first, userId, true);
      if (saved) return;
      setProfiles([first]);
      onActiveProfileChange(first);
      return;
    }
    const current = next.find((p, i) => Boolean(data?.[i]?.is_active)) ?? next[0];
    setProfiles(next);
    onActiveProfileChange(current);
    setMessage(`已读取 ${next.length} 个档案（账号级 RLS 隔离）`);
  }

  async function signIn() {
    if (!HAS_SUPABASE) {
      setAccountId("local-account");
      setMessage("已进入演示账号；配置 Supabase env 后自动切真实登录/RLS");
      return;
    }
    const supabase = createClient();
    const result = await supabase.auth.signInWithPassword({ email, password });
    if (result.error) {
      const signup = await supabase.auth.signUp({ email, password });
      if (signup.error) {
        setMessage(`登录/注册失败：${signup.error.message}`);
        return;
      }
      setMessage("注册成功；如项目要求邮箱验证，请验证后再登录");
      if (!signup.data.user?.id) return;
      setAccountId(signup.data.user.id);
      await loadProfiles(signup.data.user.id, signup.data.user.email ?? email);
      return;
    }
    if (result.data.user?.id) {
      setAccountId(result.data.user.id);
      await loadProfiles(result.data.user.id, result.data.user.email ?? email);
    }
  }

  async function signOut() {
    if (HAS_SUPABASE) await createClient().auth.signOut();
    const reset = makeProfile("考生 A", DEMO_EMAIL, candidate);
    setAccountId(HAS_SUPABASE ? "" : "local-account");
    setProfiles([reset]);
    onActiveProfileChange(reset);
    setMessage(HAS_SUPABASE ? "已退出" : "演示模式已重置");
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
    const saved = fromDbProfile(data, email);
    setProfiles((prev) => {
      const others = prev.filter((p) => p.id !== profile.id && p.id !== saved.id);
      return [...others, saved];
    });
    onActiveProfileChange(saved);
    setMessage("已保存到当前账号；切换档案不会串条件");
    return true;
  }

  async function addProfile() {
    const next = makeProfile(`考生 ${profiles.length + 1}`, email, cloneWithName(candidate, profiles.length + 1));
    const nextProfiles = [...profiles, next];
    setProfiles(nextProfiles);
    onActiveProfileChange(next);
    setMessage("已新增档案；默认复制当前条件并调整分/位次，便于观察候选随动");
    if (HAS_SUPABASE && accountId) await saveProfile(next, accountId, true);
  }

  async function deleteProfile(id: string) {
    if (profiles.length <= 1) {
      setMessage("至少保留 1 个档案");
      return;
    }
    if (HAS_SUPABASE && !id.startsWith("local-")) {
      const { error } = await createClient().from("profiles").delete().eq("id", id);
      if (error) {
        setMessage(`删除失败：${error.message}`);
        return;
      }
    }
    const next = profiles.filter((p) => p.id !== id);
    setProfiles(next);
    onActiveProfileChange(next[0]);
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
    setMessage("当前表单条件已写入该档案；其他档案不受影响");
  }

  useImperativeHandle(ref, () => ({
    addProfileFromConditions(conditions: CandidateConditions) {
      const next = makeProfile(`考生 ${profiles.length + 1}（对话）`, email, conditions);
      setProfiles([...profiles, next]);
      onActiveProfileChange(next);
      setMessage("已由「对话建条件」新增并切到该档案；右侧方案按此重算");
      if (HAS_SUPABASE && accountId) void saveProfile(next, accountId, true);
    },
  }), [profiles, email, accountId, onActiveProfileChange]);

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-3 text-xs">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-slate-900">账号 / 多考生档案</h2>
          <p className="text-[11px] text-slate-500">账号级 + 档案级隔离；profile_id 只管归属，不进判定逻辑</p>
        </div>
        <span className={`rounded px-2 py-0.5 text-[11px] ${HAS_SUPABASE ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
          {HAS_SUPABASE ? "Supabase" : "本地演示"}
        </span>
      </div>

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-[1fr_1fr_auto_auto]">
        <input value={email} onChange={(e) => setEmail(e.target.value)} className="rounded border border-slate-200 px-2 py-1" placeholder="邮箱" />
        <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" className="rounded border border-slate-200 px-2 py-1" placeholder="密码" />
        <button type="button" onClick={signIn} className="rounded bg-slate-900 px-3 py-1 font-medium text-white">登录/注册</button>
        <button type="button" onClick={signOut} className="rounded border border-slate-200 px-3 py-1 text-slate-600">退出</button>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {profiles.map((profile) => (
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
          <span className="text-[11px] text-slate-400">{accountId ? `账号：${email}` : "未登录"}</span>
        </div>
      )}

      <p className="mt-2 text-[11px] text-slate-500">{message}</p>
    </section>
  );
});

export default ProfilePanel;
