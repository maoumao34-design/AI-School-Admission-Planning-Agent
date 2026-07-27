/**
 * QA seed：创建/销毁测试账号 + 多档案，用于验"账号级 + 档案级"隔离（Issue MAO-2）
 *
 * 用法（需先建好 Supabase 项目并应用 prisma 迁移 + supabase/rls.sql）：
 *   1) 在 .env 设：
 *        SUPABASE_URL=https://<project>.supabase.co
 *        SUPABASE_SERVICE_ROLE_KEY=...   # service_role，仅脚本/服务端用，绝不进前端
 *   2) npx tsx scripts/seed-qa.ts            # 建 2 个测试账号 + 多档案
 *      npx tsx scripts/seed-qa.ts teardown   # 销毁
 *
 * 产出：
 *   - qa-planner@example.com（规划人员，2 个考生档案：档案X / 档案Y）
 *   - qa-student@example.com（学生，1 个考生档案）
 *   密码统一：qa-password-123
 *   打印各自 auth.uid()，供 QA 用对应账号登录验隔离。
 */
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = process.env.SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("缺少 SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PASSWORD = "qa-password-123";

const SEED_USERS = [
  {
    email: "qa-planner@example.com",
    role: "planner" as const,
    profiles: [
      { name: "档案X(南大理科)", province: "江苏", gaokao_year: 2026, subject_track: "physical", selected_subjects: ["化学", "生物"], score: 637, rank: "5200" },
      { name: "档案Y(东南文科)", province: "江苏", gaokao_year: 2026, subject_track: "historical", selected_subjects: ["政治", "地理"], score: 610, rank: "1800" },
    ],
  },
  {
    email: "qa-student@example.com",
    role: "student" as const,
    profiles: [
      { name: "我自己", province: "江苏", gaokao_year: 2026, subject_track: "physical", selected_subjects: ["化学"], score: 637, rank: "5200" },
    ],
  },
];

async function upsertUser(email: string) {
  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already/i.test(error.message)) throw error;
  // 若已存在，取回
  if (error) {
    const { data: list } = await supabase.auth.admin.listUsers();
    const found = list?.users.find((u) => u.email === email);
    return found!.id;
  }
  return data.user.id;
}

async function seed() {
  for (const u of SEED_USERS) {
    const uid = await upsertUser(u.email);
    // 触发器应已建 account；这里兜底 upsert role
    await supabase.from("accounts").upsert({ id: uid, email: u.email, role: u.role });
    // 清旧档案再插（幂等）
    await supabase.from("profiles").delete().eq("account_id", uid);
    for (const p of u.profiles) {
      const { data: prof, error } = await supabase
        .from("profiles")
        .insert({ account_id: uid, ...p, rank: BigInt(p.rank), is_active: false })
        .select("id")
        .single();
      if (error) throw error;
      // 每档案建一个 draft 方案 + 一个版本快照
      const { data: plan } = await supabase
        .from("plans")
        .insert({ profile_id: prof!.id, account_id: uid, name: `${p.name}-方案1`, strategy: "balanced", status: "draft" })
        .select("id")
        .single();
      await supabase.from("plan_versions").insert({
        plan_id: plan!.id,
        account_id: uid,
        version_no: 1,
        snapshot: { candidates: [], rules: [], note: "seed placeholder" },
        diff: null,
      });
    }
    console.log(`OK ${u.email} (${u.role}) uid=${uid} profiles=${u.profiles.length}`);
  }
  console.log("密码统一：", PASSWORD);
}

async function teardown() {
  for (const u of SEED_USERS) {
    const { data: list } = await supabase.auth.admin.listUsers();
    const found = list?.users.find((x) => x.email === u.email);
    if (found) {
      // profile/plan/version 靠外键 cascade 删；account 手动删
      await supabase.from("accounts").delete().eq("id", found.id);
      await supabase.auth.admin.deleteUser(found.id);
      console.log("deleted", u.email);
    }
  }
}

const mode = process.argv[2];
mode === "teardown" ? teardown() : seed();
