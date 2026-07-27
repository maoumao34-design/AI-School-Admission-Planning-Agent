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
| **档案级**（同账号做 X 不串 Y） | 请求带 `profile_id`（= AI工程师「档案上下文」参数）；应用层校验该档案归属当前账号后，按 `profile_id` 过滤 plans/versions | QA |

> 说明：规划人员账号下可见其全部档案（这是"管多个客户"的需求）；"切换档案时不串"是请求级上下文，由应用层 + API 形状保证，RLS 兜底账号间不可见。

## 3. 鉴权（Supabase Auth）

- 注册/登录/会话走 Supabase Auth（不自造）。
- 浏览器端用 `@supabase/ssr` + Next.js 中间件维护会话 cookie（App Router 推荐）。
- 密钥：`NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` 进前端；`SUPABASE_SERVICE_ROLE_KEY` **只服务端/脚本**，绝不进前端 bundle。

## 4. Prisma vs Supabase Client（重要）

- **Prisma**：数据模型单一事实来源（`prisma/schema.prisma`）、生成 TS 类型、跑迁移、服务端 trusted 写（用 `DIRECT_DATABASE_URL`）。
- **用户态读写**（需 RLS 生效）：用 Supabase JS Client（带用户 JWT），RLS 自动生效；或在 API Route 里用 Prisma 时**显式按 `account_id` 过滤**（service_role 绕过 RLS，必须应用层过滤兜底）。
- ⚠️ Prisma 走 service_role 会**绕过 RLS**——所以涉及"当前用户数据"的查询，优先 Supabase Client；用 Prisma 时务必 `where: { accountId: userId }`。
- ⚠️ Prisma 迁移若重建表，需重新应用 `supabase/rls.sql`（RLS policy 不由 Prisma 管）。

## 5. 跑起来（前提：Supabase 项目已建）

```bash
cp .env.example .env   # 填好真实值
npx prisma migrate dev --name init          # 建表
psql "$DIRECT_DATABASE_URL" -f supabase/rls.sql   # 应用 RLS + 注册触发器
npx tsx scripts/seed-qa.ts                   # QA 测试账号 + 多档案（见脚本头）
npx tsx scripts/seed-qa.ts teardown          # 销毁
```

## 6. QA 验证要点

- 用 `qa-planner@example.com`（2 档案）+ `qa-student@example.com`（1 档案）分别登录：
  - 账号级：登录 A 看不到 B 的任何 profile/plan/version。
  - 档案级：规划人员切换到档案X时，plan/version 列表只属档案X，不混入档案Y。
- 异常路径：跨账号 `profile_id` 访问 → 应用层拒绝（403）；结构非法 → 提示。

## 7. 依赖 / 未决

- 依赖「数据」candidate card schema（draft 已出）→ 对齐 `PlanVersion.snapshot` 结构。
- 等待 AI工程师 typed API 契约（资格/比较/改条件）→ 决定 `Plan.conditionsSnapshot` 的精确字段。
- Supabase 项目由全栈建（URL/keys 进 `.env`，真实值不入库）。
