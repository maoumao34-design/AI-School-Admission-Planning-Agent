/**
 * QA seed：创建/销毁测试账号 + 多档案，用于验“账号级 + 档案级”隔离（Issue MAO-2）
 *
 * 用法（需先应用 prisma 迁移 + supabase/rls.sql；本地或远程 Supabase 均可，见 docs/DATA-MODEL.md §5）：
 *   1) 在 .env 设：
 *        SUPABASE_URL=https://<project>.supabase.co          # 本地 supabase 用 http://127.0.0.1:54321
 *        SUPABASE_SERVICE_ROLE_KEY=...                        # service_role，仅脚本/服务端用，绝不进前端
 *   2) npm run seed               # 建 2 个测试账号 + 多档案
 *      npm run seed:teardown      # 销毁（外键 cascade 自动清 profile/plan/version）
 *
 * 产出：
 *   - qa-planner@example.com（规划人员，2 个考生档案：档案X / 档案Y）  ← 验“同账号不同档案不串”
 *   - qa-student@example.com（学生，1 个考生档案）                      ← 验“账号间不可见”
 *   密码统一：qa-password-123
 *   打印各自 auth.uid()，供 QA 用对应账号登录验隔离。
 *
 * Profile 字段 ↔ AI工程师 CandidateConditions（ai-eng/api-contract src/decision/types.ts）：
 *   province→province, gaokaoYear→year, subjectTrack(physical|historical)→subject.category(物理类|历史类),
 *   selectedSubjects→subject.secondary, score→score, rank→rank, preferences→preferences, budget→budget
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY（见 .env.example）");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "qa-password-123";

type SeedProfile = {
  name: string;
  province: string;
  gaokao_year: number;
  subject_track: "physical" | "historical";
  selected_subjects: string[];
  score: number;
  rank: number; // Postgres bigint；JSON 传 number（位次远小于 2^53，安全）
  preferences?: Record<string, unknown>;
  budget?: Record<string, unknown>;
};

type SeedUser = {
  email: string;
  role: "planner" | "student";
  profiles: SeedProfile[];
};

const SEED_USERS: SeedUser[] = [
  {
    email: "qa-planner@example.com",
    role: "planner",
    profiles: [
      {
        name: "档案X(南大理科)",
        province: "江苏",
        gaokao_year: 2026,
        subject_track: "physical",
        selected_subjects: ["化学", "生物"],
        score: 637,
        rank: 5200,
        preferences: { region: ["江苏"], schoolLevel: ["985", "211"] },
        budget: { maxTuition: 8000 },
      },
      {
        name: "档案Y(东南文科)",
        province: "江苏",
        gaokao_year: 2026,
        subject_track: "historical",
        selected_subjects: ["政治", "地理"],
        score: 610,
        rank: 1800,
        preferences: { region: ["江苏"] },
        budget: { maxTuition: 10000 },
      },
    ],
  },
  {
    email: "qa-student@example.com",
    role: "student",
    profiles: [
      {
        name: "我自己",
        province: "江苏",
        gaokao_year: 2026,
        subject_track: "physical",
        selected_subjects: ["化学"],
        score: 637,
        rank: 5200,
      },
    ],
  },
];

// 空版本快照占位（结构对齐 ai-eng/api-contract 的 RecomputeResponse / DecisionTrace）：
//   snapshot = { strategy_groups: StrategyGroup[], trace?: DecisionTrace, conditions: CandidateConditions }
//   diff     = VersionDiff { added[], removed[], changed[] }
const emptySnapshot = {
  strategy_groups: [],
  trace: { conditions_used: null, rules_applied: [], dataset_year: "2023-2025", generated_at: new Date().toISOString() },
};
const emptyDiff = { added: [], removed: [], changed: [] };

async function upsertUser(email: string): Promise<string> {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (!error) return data.user.id;
  if (!/already/i.test(error.message)) throw error;
  // 已存在则取回
  const { data: list } = await supabase.auth.admin.listUsers();
  const found = list?.users.find((u) => u.email === email);
  if (!found) throw new Error(`用户已存在但找不到: ${email}`);
  return found.id;
}

async function seed() {
  for (const u of SEED_USERS) {
    const uid = await upsertUser(u.email);
    // 注册触发器应已建 account；这里兜底 upsert role（service_role 绕过 RLS）
    const { error: accErr } = await supabase
      .from("accounts")
      .upsert({ id: uid, email: u.email, role: u.role });
    if (accErr) throw accErr;
    // 清旧档案再插（幂等；plan/version 靠外键 cascade 连带清）
    const { error: delErr } = await supabase.from("profiles").delete().eq("account_id", uid);
    if (delErr) throw delErr;
    let i = 0;
    for (const p of u.profiles) {
      const { data: prof, error } = await supabase
        .from("profiles")
        .insert({ account_id: uid, ...p, is_active: i === 0 })
        .select("id")
        .single();
      if (error) throw error;
      const { data: plan, error: planErr } = await supabase
        .from("plans")
        .insert({
          profile_id: prof!.id,
          account_id: uid,
          name: `${p.name}-方案1`,
          strategy: "balanced",
          status: "draft",
        })
        .select("id")
        .single();
      if (planErr) throw planErr;
      const { error: vErr } = await supabase.from("plan_versions").insert({
        plan_id: plan!.id,
        account_id: uid,
        version_no: 1,
        snapshot: emptySnapshot,
        diff: emptyDiff,
      });
      if (vErr) throw vErr;
      i++;
    }
    console.log(`OK ${u.email} (${u.role}) uid=${uid} profiles=${u.profiles.length}`);
  }
  console.log("密码统一：", PASSWORD);
}

async function teardown() {
  const { data: list } = await supabase.auth.admin.listUsers();
  for (const u of SEED_USERS) {
    const found = list?.users.find((x) => x.email === u.email);
    if (!found) {
      console.log("skip (not found)", u.email);
      continue;
    }
    // profile/plan/version 靠外键 cascade 删；account 手动删
    const { error: accErr } = await supabase.from("accounts").delete().eq("id", found.id);
    if (accErr) throw accErr;
    const { error: uErr } = await supabase.auth.admin.deleteUser(found.id);
    if (uErr) throw uErr;
    console.log("deleted", u.email);
  }
}

const mode = process.argv[2];
if (mode === "teardown") {
  teardown().catch((e) => {
    console.error(e);
    process.exit(1);
  });
} else if (mode === "help" || mode === "--help") {
  console.log("用法: npm run seed | npm run seed:teardown");
} else {
  seed().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
