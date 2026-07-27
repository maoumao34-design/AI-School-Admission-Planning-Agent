# 数据模型 + RLS + 鉴权方案（Issue MAO-2）

> 对应锁定决策：**D-002-B**（规划人员 = 一个账号管多个考生档案）、**D-003**（Next.js + Supabase + Prisma）。
> 与 [TASK-SPEC.md](../TASK-SPEC.md) §3（计划与版本）、§5（志愿卡）、[COLLABORATION.md](../COLLABORATION.md) 配套。

## 1. 模型总览

```
auth.users (Supabase 管理)
     │  1:1  id = auth.uid()
     ▼
Account(user: role=student|parent|planner)
     │  1:N
     ▼
Profile(考生档案: 省/年度/选科/分位次/偏好/预算)      ← 学生/家长 1 个；规划人员 多个
     │  1:N
     ▼
Plan(方案: 策略/条件快照/状态)
     │  1:N
     ▼
PlanVersion(版本: 不可变快照 + 与上版 diff)
```

- **Account** 与 Supabase `auth.users` 一一对应；注册时由 `supabase/rls.sql` 的 trigger 自动建行，前端不用手插。
- **Profile = 考生档案**：一个账号可有多条。`is_active` 标记规划人员当前选中的档案（切换用）。
- **Plan**：归某档案；`account_id` 冗余存放（RLS 单字段判断，免 join）。
- **PlanVersion**：不可变快照；候选卡列表以 `snapshot` (jsonb) 存，对齐「数据」交付的 candidate card schema（见频道/`data/DATA-PACKAGE.md`）；`diff` 记与上一版差异（TASK-SPEC §3「前后版本差异」）。

### 为什么候选卡放 jsonb 快照
每个版本是「某条件下的计算结果」的不可变快照；候选集规模可控（数十张），前端筛选/排序在内存做即可。若日后需要服务端复杂查询，再抽 `CandidateCard` 表。规则/概率由 AI工程师 的 TS 纯函数算出（按"单考生条件"），与本模型解耦。

## 2. 隔离策略（QA 必测）

| 层 | 机制 | 谁来验 |
|---|---|---|
| **账号级**（A 看不到 B） | Supabase **RLS**：所有表 `account_id = auth.uid()`（见 `supabase/rls.sql`） | QA |
| **档案级**（同账号做 X 不串 Y） | **DB 层强制**：`plans`/`plan_versions` 的 `WITH CHECK` 约束 `account_id` 必须等于所引用 `profile`/`plan` 的 `account_id`（`supabase/rls.sql` §4）；应用层再按请求 `profile_id` 过滤列表 | QA |

> 双层都在数据库层强制：账号间靠 RLS 不可见；同账号内靠「account↔profile 绑定一致」约束挡住串档写入——
> 即使应用层传错 `{account_id: X, profile_id: Y}`，DB 直接拒绝（QA 可复现）。
> 规划人员账号下仍可见其全部档案（"管多个客户"的需求）；"当前选哪个档案"是请求级上下文，由应用层 + API 形状（`profile_id` 参数）决定。

## 3. 鉴权（Supabase Auth）

- 注册/登录/会话走 Supabase Auth（不自造）。注册时 `supabase/rls.sql` 的触发器自动建 `Account` 行（`id = auth.uid()`）。
- 已提供可被 Next.js App Router 直接 `import` 的客户端（MAO-13 消费）：
  - `lib/supabase/client.ts` — 浏览器端（`createBrowserClient`），客户端组件登录/注册/读会话。
  - `lib/supabase/server.ts` — 服务端（`createServerClient` + `next/headers`），Server Component / Route Handler / Server Action 里读用户、用户态读写（RLS 自动生效）。
  - `lib/supabase/middleware.ts` — `updateSession`，在 `middleware.ts` 里刷新会话 cookie。
  - `lib/db.ts` — Prisma Client 单例（trusted 写；注意它绕过 RLS，涉当前用户数据要显式 `where: { accountId }` 兜底）。
- 密钥：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 进前端；`SUPABASE_SERVICE_ROLE_KEY` **只服务端/脚本**，绝不进前端 bundle。真实值走 `.env`（`.gitignore` 已排除，不入库）。

## 4. Prisma vs Supabase Client（重要）

- **Prisma**：数据模型单一事实来源（`prisma/schema.prisma`）、生成 TS 类型、跑迁移、服务端 trusted 写（用 `DIRECT_DATABASE_URL`）。
- **用户态读写**（需 RLS 生效）：用 Supabase JS Client（带用户 JWT），RLS 自动生效；或在 API Route 里用 Prisma 时**显式按 `account_id` 过滤**（service_role 绕过 RLS，必须应用层过滤兜底）。
- ⚠️ Prisma 走 service_role 会**绕过 RLS**——所以涉及"当前用户数据"的查询，优先 Supabase Client；用 Prisma 时务必 `where: { accountId: userId }`。
- ⚠️ Prisma 迁移若重建表，需重新应用 `supabase/rls.sql`（RLS policy 不由 Prisma 管）。

## 5. 跑起来

### 5.1 一键脚本（`package.json`）

```bash
cp .env.example .env        # 填好真实值（见下两种环境）
npm install
npm run db:setup            # = prisma generate + migrate deploy + 应用 supabase/rls.sql
npm run seed                # QA 测试账号 + 多档案（规划人员2 / 学生1）
npm run seed:teardown       # 销毁（外键 cascade 连带清）
```

### 5.2 环境 A：本地 Supabase（推荐 QA 用，无需远程项目 / keys）

```bash
# 需已装 supabase CLI + Docker
npm run supabase:start      # 起本地 Postgres + Auth + Studio
# 把 .env 指向本地（supabase/config.toml 头部已列端口与默认 key）
npm run db:setup && npm run seed
# Studio UI: http://127.0.0.1:54323  直接看表/RLS
npm run supabase:stop       # 收摊
```

### 5.3 环境 B：远程 Supabase 项目（上线用）

`supabase start` 替换为在 Supabase 控制台建项目，把 URL/anon/service_role/数据库连接串填进 `.env`（对应 `.env.example`），其余命令不变。远程项目由全栈建，keys 进 `.env` 不入库。

> ⚠️ Prisma 迁移若重建表，需重跑 `npm run db:rls`（RLS policy 不由 Prisma 管）。

## 6. QA 验证要点

- 用 `qa-planner@example.com`（2 档案）+ `qa-student@example.com`（1 档案）分别登录：
  - 账号级：登录 A 看不到 B 的任何 profile/plan/version。
  - 档案级：规划人员切换到档案X时，plan/version 列表只属档案X，不混入档案Y。
- 异常路径：跨账号 `profile_id` 访问 → 应用层拒绝（403）；结构非法 → 提示。
- DB 层串档拒绝（新增）：用 service_role 之外的客户端尝试 `insert into plans (account_id=X, profile_id=Y的档案)` → DB 拒绝（`plans_profile_consistent` 策略），证明档案级隔离不依赖应用层。

## 7. 依赖 / 对齐

- **字段已对齐** AI工程师 typed API 契约（`ai-eng/api-contract` `src/decision/types.ts`）：
  - `Profile` 字段 ↔ `CandidateConditions`（`province / gaokaoYear→year / subjectTrack→subject.category / selectedSubjects→subject.secondary / score / rank / preferences / budget`）。
  - `Plan.conditionsSnapshot` = `CandidateConditions`；`PlanVersion.snapshot` = `{ strategy_groups: StrategyGroup[], trace?, conditions }`；`PlanVersion.diff` = `VersionDiff {added,removed,changed}`。
  - `subject_track` 枚举 `physical|historical` ↔ `subject.category` `物理类|历史类`（API 边界翻译，见 `scripts/seed-qa.ts` 头注）。
- **字段已对齐** 数据角色候选卡 schema（`data/jiangsu-2026` `DATA-PACKAGE.md`）：候选卡 `CandidateCard` 以 jsonb 存于 `PlanVersion.snapshot.strategy_groups[].candidates`。
- 待办（不阻塞本 issue 验收）：远程 Supabase 项目由全栈建（拿 URL/keys 进 `.env`）；近 3 年位次/学费正式集到位后精修 snapshot 样例。
