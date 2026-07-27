# QA 测试计划 v1 — 可测试性清单 + 档案级隔离验收（MAO-10）

> 作者：QA / 测试工程师 · 分支 `qa/testability-isolation` · Issue MAO-10
> 对齐：[TASK-SPEC.md](../TASK-SPEC.md) §3/§4/§6/§7、[PRD-v1 §9](./PRD-v1.md)、[DELIVERY-STANDARD §二/§三](../DELIVERY-STANDARD.md)、[COLLABORATION](../COLLABORATION.md)。
> 输入依赖（已就位，均在 review 分支）：
> - 数据：`data/jiangsu-2026`（候选卡全字段 + 可机读规则表 + 江苏 2026 物理类 3 档真实样本 637/5200）
> - API 契约：`ai-eng/api-contract`（`/api/eligibility`、`/api/compare`、`/api/recompute` + `DecisionResponse<T>` 外壳 + `trace` + `outcome`）
> - 数据模型/隔离：`fullstack/data-model-rls-auth`（`prisma/schema.prisma`、`supabase/rls.sql`、`scripts/seed-qa.ts`）

> ⚠️ **范围声明**：本 issue 交付 4 条验收项（可测试性清单 / 账号级隔离 / 档案级隔离 / 多档案增删切换回归）。端到端代表性案例（跨省/跨选科大矩阵）随 App 部署后补；本文已为脚本化驱动预留接口与断言，部署即可执行。

---

## 0. 验收口径（PRD-v1 §9 + DELIVERY-STANDARD §二 逐条映射）

| PRD-v1 §9 / DELIVERY 要点 | 由本计划的哪一组用例覆盖 |
|---|---|
| 6 步端到端真实跑通（换输入有不同结果，非写死/录像） | §2 可测试性清单 E2E-01~E2E-06 + §5 回归矩阵 |
| 至少真实调用一种数据/规则/模型 | E2E-02（数据）/ E2E-03、E2E-04（规则纯函数）/ LLM 对话建条件 |
| 改条件后候选与依据随动 | E2E-05（recompute + diff） |
| 失败/异常有提示（原因 + 下一步） | §3 异常路径 EX-1~EX-5（`outcome.status != 'ok'`） |
| 手机端无明显错位 | （前端用例，本文给判定口径，详见 §6，待 App 落地跑视测） |
| **登录 → 多账号数据隔离（含同账号下不同档案数据不串）** | §4 账号级隔离 + §5 档案级隔离 + §6 多档案增删/切换 |
| 三条红线：不承诺录取 / 三层分离 / 来源可追溯 | E2E-04（概率档只标方法+年份）、E2E-03（规则=纯函数）、E2E-02/06（source 链） |

> **三条红线 QA 断言（贯穿）**：
> 1. 不承诺录取：任何 `probability_ref` 必带 `method` + `data_years`，文案含「参考/非预测」语义，不得出现「必录/保证」字样。
> 2. 三层分离：规则判断走纯函数（`evaluateRule`），LLM 仅用于对话建条件 + 推荐理由润色；响应 `trace.rules_applied` 可见。
> 3. 来源可追溯：每张候选卡 `source{url,publisher,updated,accessed,status}` 非空；导出报告带官方复核入口。

---

## 1. 测试分层 & 执行前提

### 1.1 分层
| 层 | 范围 | 驱动方式 | 何时可跑 |
|---|---|---|---|
| L0 单元 | `src/decision/engine.ts` 纯函数（选科匹配/批次/学费/计划/位次差分桶/排序） | Vitest，直接 import | 引擎分支合并后即可（不依赖部署） |
| L1 API | 三个 API Route（eligibility/compare/recompute） | `fetch`/`curl` 脚本，断言 JSON | App Router 工程挂载端点后 |
| L2 隔离/数据 | Supabase RLS + 多档案增删切换 | Supabase JS Client（带用户 JWT）+ service_role 探针 | Supabase 项目建好 + 应用 rls.sql 后 |
| L3 端到端 | 6 步真实流程 + 手机端视测 | Playwright（桌面+移动视口） | App 部署到 Vercel 后 |

### 1.2 执行前提（fixtures）
- 复用全栈已交付的 `scripts/seed-qa.ts`（幂等，自带 teardown）：
  - `qa-planner@example.com`（规划人员，2 档案：**档案X** 南大理科 637/物理+化学、**档案Y** 东南文科 610/历史+政治+地理）
  - `qa-student@example.com`（学生，1 档案：我自己 637/物理+化学）
  - 密码统一 `qa-password-123`
- 真实数据样本：`data/sample-jiangsu-2026-phys.json`（SEU-08 稳妥、NJUST-03 保底、NJUST-02 冲刺）。
- 规则表：`data/rules.example.json`（`subject_match` / `batch` / `tuition_le` / `plan_gt`）。
- ⚠️ 运行前确认 `.env` 含 `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY`（脚本/服务端用，不入前端）。

> 断言语言：本计划用「**断言点**」描述可脚本化的期望。脚本化骨架见 [§7](#7-脚本化驱动骨架可自动化的断言集)。

---

## 2. 可测试性清单 — 6 步脚本化回归（**AC-1**）

> 目标：6 步能被脚本顺序串起来，换输入得不同结果，非写死/录像。每步给出「可断言点」。
> 真实输入：考生 = 江苏 2026 物理类 637 分 / 位次 5200 / 物理+化学。

| # | 步骤 | 驱动 | 关键断言点（脚本可判） |
|---|---|---|---|
| **E2E-01** | 对话建条件 | 全栈/LLM 编排（NL→`CandidateConditions`） | ① 输出符合 `CandidateConditions` schema，必填字段 `province/year/subject/score/rank` 齐；② 缺关键条件 → 产出 `ConditionGap[]{status:'missing'}` 并追问；③ 冲突（如首选物理却选历史类）→ `status:'conflict'`。 |
| **E2E-02** | 获取官方信息 | 数据层取候选卡 | ① 每张卡 `source` 字段非空（`url/publisher/updated/accessed/status`）；② `history[]` 近 3 年结构在位（draft 期可仅 2024，`caveats` 须标注「样本年份」）；③ `status` 透明（如「待官方复核」）。 |
| **E2E-03** | 资格过滤 | `POST /api/eligibility` | ① `outcome.status==='ok'`；② `trace.rules_applied` 含应用到的 `rule_id`；③ 每结果含 `passed + evaluated_rules + blocking_rules`；④ 样本（物理+化学，3 卡均要求物理+化学）→ **全 passed**；⑤ 反例：历史类考生 → `subject_match` 判 `passed:false`，`blocking_rules` 非空且带 `reason + source`。 |
| **E2E-04** | 方案比较 | `POST /api/compare` | ① 默认 ≥2 套策略（院校优先/专业优先）；② 每个 `RankedCandidate` 必带 `probability_ref{tier,method,data_years}` + `rank_diff_vs_candidate` + `reason`；③ 档位与阈值一致：SEU-08(-745)→**稳妥**、NJUST-03(-2433)→**保底**、NJUST-02(+1213)→**冲刺**（阈值 `matchUpper=0`/`safetyUpper=-1500`）；④ 概率文案含「参考/非预测」，无「保证录取」。 |
| **E2E-05** | 改条件重算 | `POST /api/recompute` | ① `new_conditions` 反映改动（如分数 590）；② `strategy_groups` 随之变化；③ `diff{added,removed,changed}` 非空且合理（降分 → 冲刺/稳妥卡 `removed`，保底仍 in）；④ `trace.generated_at` 为新时间戳；⑤ profile 上下文：`profile_id` 仅作归属，不进判定（同一条件跨档案算出一致结果）。 |
| **E2E-06** | 确认导出 | 全栈：存 `PlanVersion` + 导出报告 | ① `plan_versions` 新增一行，`version_no` 递增、`snapshot` 含候选卡[]+依据+规则执行记录；② `diff` 记与上一版差异；③ 导出物含每候选的官方来源链接 + 更新时间；④ 前后版本可并排对比。 |

### 2.1 断点回归脚本契约（串联顺序）
```
建条件 → 取数据 → eligibility → compare → recompute → 存版本/导出
（Step1/2/6 由全栈编排；3/4/5 直接打 API Route，QA 用 fetch 串）
```

---

## 3. 异常路径（**AC-1 的一部分**：异常有提示、可断言）

> 全部映射到 `outcome.status != 'ok'`，且必须 `outcome.reason + next_step` 非空、不抛 5xx、UI 展示「原因 + 下一步」。

| # | 触发 | 期望 `outcome.status` | 断言点 |
|---|---|---|---|
| **EX-1** | 信息不足（缺省份/位次/选科） | `info_insufficient` | reason 指明缺哪个字段；next_step 引导补全；不 crash。 |
| **EX-2** | 无符合候选（位次过低/选科全不符） | `no_result` | reason 说明无候选；next_step 建议「放宽条件/降批次」；data 为空数组。 |
| **EX-3** | 数据过期/年份不符（查 2025 数据或数据 status=过期） | `data_stale` | reason 标注数据年份/状态；next_step 引导核对官方最新。 |
| **EX-4** | 来源冲突（同一专业组多源数值不一致） | `source_conflict` | reason 列冲突项；next_step 引导以官方为准/人工复核。 |
| **EX-5** | 需人工复核（边界/异常选科组合） | `needs_manual_review` | reason 说明；next_step 给人工入口；不自动下结论。 |

> 额外稳定性断言（DELIVERY「基本稳定可用」）：网络/LLM 超时、无效 JSON、未授权 → 返回明确错误状态 + 可重试/返回，不白屏。

---

## 4. 账号级隔离用例（**AC-2**：A 的 plan/档案/版本对 B 不可见 — **直接验 RLS**）

> 机制：Supabase **RLS**，所有表 `account_id = auth.uid()`（见 `supabase/rls.sql §3`）。本组**直接打数据库/RLS**，不依赖应用是否正确过滤——RLS 是兜底强约束。

| # | 场景 | 操作 | 断言（Pass 标准） |
|---|---|---|---|
| **ISO-A1** | A 看不到 B 的档案 | 以 `qa-planner`(A) JWT `select * from profiles` | 仅返回档案X、档案Y；**不包含** `qa-student`(B) 的「我自己」。 |
| **ISO-A2** | A 看不到 B 的方案/版本 | A JWT `select * from plans / plan_versions` | 全部 `account_id = A.uid`；B 的 plan/version **0 行**。 |
| **ISO-A3** | B 看不到 A | 以 `qa-student`(B) JWT 反查 | 仅「我自己」；A 的档案X/Y、其 plan/version **0 行**。 |
| **ISO-A4** | **RLS 直穿探针**：A 显式查 B 的行 | A JWT `select * from plans where account_id = <B.uid>` | **0 行**（RLS 在 using 阶段过滤，无法绕过）。 |
| **ISO-A5** | **写入越权**：A 试图插 B 名下的 plan | A JWT `insert into plans(account_id=<B.uid>, profile_id=<B某档案>)` | 被 RLS `WITH CHECK` 拒绝（`account_id = auth.uid()` 失败）→ 报错/0 行。 |
| **ISO-A6** | **改写越权**：A 试图改 B 的行 | A JWT `update plans set ... where account_id=<B.uid>` | `affected_rows = 0`（using 不匹配，无法定位 B 的行）。 |
| **ISO-A7** | 未认证访问 | 无 JWT `select * from profiles` | 0 行 / 鉴权错误（任何匿名都无法读用户数据）。 |
| **ISO-A8** | API 层跨账号 profile_id | A 调 `/api/recompute{profile_id:<B档案>}` | 应用层判归属不符 → **403**（且即便漏判，RLS 兜底也返回 0 数据，不泄露）。 |

---

## 5. 档案级隔离用例（**AC-3**：同账号下做 X 不串进 Y）

> ⚠️ **关键诚实声明（QA 必须讲清）**：档案级隔离**不是由 RLS 强制的**。
> 依据 `supabase/rls.sql §4` 与 `DATA-MODEL.md §2`：「规划人员账号下可见其全部档案」是产品需求（管多个客户），RLS 因此允许一个账号读到自己所有 profiles/plans/versions。
> 「做 X 不串 Y」是**请求级上下文**：每个请求带 `profile_id`（= AI 工程师的「档案上下文」参数），**应用层**校验该档案归属当前账号后，按 `profile_id` 过滤 plans/versions。
> 因此本组用例验**应用层 scoping**，不是验 RLS。

| # | 场景 | 操作 | 断言（Pass 标准） |
|---|---|---|---|
| **ISO-P1** | 切到档案X只看X的方案 | planner 选档案X → 列 plans | 仅 `profile_id = X` 的方案；档案Y 的方案**不在列表**。 |
| **ISO-P2** | 在X操作不污染Y | planner 在档案X 跑 recompute / 建 plan | 新 plan/version 的 `profile_id = X`；档案Y 的 plans/versions **行数与内容不变**（无串入）。 |
| **ISO-P3** | 条件随档案切换而变 | X(637/物理+化学) → 切 Y(610/历史/政治+地理) | 工作区候选/条件快照随 active profile 切换；X 的候选集**不混入** Y 的结果。 |
| **ISO-P4** | 越权写另一档案 | planner 在档案X，但请求体传 `profile_id = Y` | 应用层**拒绝或忽略**（按 active profile 归属），不得把数据写到 Y。 |
| **ISO-P5** | 版本归档不串 | X 存 v2 版本 | `plan_versions.profile_id`(经 plan) 属 X；Y 的版本序列不受影响。 |

> 🛡️ **QA 建议（非阻塞，defense-in-depth）**：当前 `plans.profile_id` 与 `plans.account_id` 的归属一致性**仅靠应用层**保证。建议补一条 DB 级约束（如触发器或额外 RLS `WITH CHECK` 校验 `profiles.account_id = plans.account_id`），使「跨档案写」在数据库层也被拦。这能把 AC-3 从「应用正确即安全」提升为「即使应用写错也不串」。已记入 §8 风险/建议。

---

## 6. 多档案增删 / 切换回归（**AC-4**）

> 主体：规划人员账号 `qa-planner`（已有档案X、档案Y），新增/删除/切换档案并回归。

| # | 场景 | 操作 | 断言 |
|---|---|---|---|
| **MP-1** | 新增档案Z | planner 新建档案Z（条件同 X） | 档案列表出现 Z；Z 的 plans 初始为空；可设 `is_active=true`。 |
| **MP-2** | 切换不串 | 依次切 X→Y→Z 为 active | 每次工作区只显示当前 active 档案的 conditions/plans/versions；无上一档案残留。 |
| **MP-3** | 删除档案级联 | 删档案Y | Y 的 plans + plan_versions **级联删除**（schema `onDelete: Cascade`）；X、Z **不受影响**；Y 数据不泄入 X/Z。 |
| **MP-4** | 同名重建不复活 | 删 Y 后再建同名「档案Y」 | 新 `profile_id`；**不复活**旧方案/版本（干净初始态）。 |
| **MP-5** | 多档案各自跑通 6 步 | 对 X、Z 分别跑 E2E-01~06 | 各档案独立产出方案/版本，互不串；版本号各自从 1 起。 |
| **MP-6** | 单档案用户回归 | `qa-student`（1 档案）跑 6 步 | 学生/家长形态正常；增删档案入口按角色隐藏（不做后台）。 |
| **MP-7** | 手机端视测 | Playwright 移动视口过档案切换/比较/导出 | 主要页面无明显错位/遮挡（DELIVERY §二「手机端」）。 |

---

## 7. 脚本化驱动骨架（可自动化的断言集）

> 落地选型建议：L0 用 **Vitest**（引擎纯函数）；L1/L2 用 **fetch + 小断言库**（或 Vitest 的 API 模式）；L3 用 **Playwright**。部署前 L0 可先跑。

### 7.1 L0 引擎单测示例（Vitest，引擎合并后即可跑）
```ts
import { describe, it, expect } from 'vitest';
import { evaluateRule, rankToTier } from '../src/decision/engine';
import { SAMPLE_CARDS, SAMPLE_RULES } from './fixtures/jiangsu-2026'; // 取自 data/ 样本
import type { CandidateConditions } from '../src/decision/types';

const candidate: CandidateConditions = {
  province: '江苏', year: 2026,
  subject: { category: '物理类', primary: '物理', secondary: ['化学'] },
  score: 637, rank: 5200,
};

describe('资格校验纯函数', () => {
  it('物理+化学考生满足三卡选科要求（样本全 passed）', () => {
    const subjRule = SAMPLE_RULES.find(r => r.machine.type === 'subject_match')!;
    for (const card of SAMPLE_CARDS) {
      const ev = evaluateRule({ ...subjRule, machine: { type:'subject_match', params:{ required:['物理','化学'] } } }, candidate, card);
      expect(ev.passed).toBe(true);
    }
  });
  it('历史类考生不满足物理+化学（subject_match=false，带 reason+source）', () => {
    const hist = { ...candidate, subject: { category:'历史类', primary:'历史', secondary:['政治','地理'] } };
    const ev = evaluateRule({ ...SAMPLE_RULES[0], machine:{ type:'subject_match', params:{ required:['物理','化学'] } } }, hist, SAMPLE_CARDS[0]);
    expect(ev.passed).toBe(false);
    expect(ev.reason).toBeTruthy();
    expect(ev.source.url).toBeTruthy();
  });
});

describe('位次差分桶（概率档，只标方法+年份，非预测）', () => {
  // rank_diff = candidateRank - minRank；正=冲刺，<-1500=保底
  it.each([
    ['SEU-08', 5200, 5945, '稳妥'],   // -745
    ['NJUST-03', 5200, 7633, '保底'], // -2433
    ['NJUST-02', 5200, 3987, '冲刺'], // +1213
  ])('%s 档位正确', (_id, rank, minRank, tier) => {
    const t = rankToTier(rank - minRank);
    expect(t.tier).toBe(tier);
    expect(t.method).toBeTruthy();      // 标注方法
    expect(t.data_years).toBeTruthy();  // 标注数据年份
  });
});
```

### 7.2 L1 API 断言骨架（串联 3→4→5，换输入得不同结果）
```ts
// 伪代码：部署后把 BASE 换成 Vercel URL
const eligibility = await post(`${BASE}/api/eligibility`, { candidate, candidates: CARDS, rules: RULES });
assert(eligibility.outcome.status === 'ok');
assert(eligibility.trace.rules_applied.length > 0);

const compare = await post(`${BASE}/api/compare`, { candidate, candidates: eligibility.data!.filter(r=>r.passed).map(...) });
assert(compare.data!.length >= 2);                 // ≥2 套策略
assert(compare.data!.every(g => g.candidates.every(c => c.probability_ref.method && c.probability_ref.data_years)));

const recompute = await post(`${BASE}/api/recompute`, { profile_id: X, baseline: candidate, changes: { score: 590 } });
assert(recompute.data!.diff.removed.length > 0 || recompute.data!.diff.changed.length > 0); // 改条件随动
assert(recompute.trace.generated_at !== eligibility.trace.generated_at);
```

### 7.3 L2 RLS 直穿探针（账号级隔离，强约束）
```ts
// 用 Supabase JS Client 带用户 JWT（自动走 RLS）
const asA = createClient(URL, ANON, { global:{ headers:{ Authorization:`Bearer ${await signIn('qa-planner@...','qa-password-123')}` } } });
const { data: aProfiles } = await asA.from('profiles').select('*');
assert(aProfiles!.every(p => p.account_id === A_UID));          // 不含 B
assert(!aProfiles!.some(p => p.name === '我自己'));               // B 的档案不可见

// 越权写入
const { error } = await asA.from('plans').insert({ account_id: B_UID, profile_id: B_PROFILE, name:'越权' });
assert(error);                                                     // RLS WITH CHECK 拒绝
```

---

## 8. 依赖、风险与 QA 建议

### 8.1 执行依赖（现状）
- ✅ 数据样本 / API 契约 / 数据模型+RLS+seed：均在 review 分支，字段已对齐，**断言可写不可全跑**（App/Supabase 项目尚未部署）。
- ⏳ L0 引擎单测：引擎分支合并到 main 后即可立即跑（不依赖部署）——**建议优先合引擎**。
- ⏳ L1/L2/L3：待 App Router 工程挂端点 + Supabase 项目建好 + Vercel 部署后跑。

### 8.2 风险（QA 必须盯）
1. **档案级隔离仅应用层**（§5）：若某条服务端写路径漏判 `profile_id` 归属，可能「同账号跨档案串」。`DATA-MODEL.md §4` 已提示 Prisma 走 service_role 会**绕过 RLS**——任何用 Prisma 处理「当前用户数据」的路径必须显式 `where:{ accountId, profileId }`。**回归必加一条：对每个服务端写路径断言其按 account+profile 过滤。**
2. **service_role 泄露面**：`SUPABASE_SERVICE_ROLE_KEY` 绕过 RLS，务必只在服务端/脚本、绝不进前端 bundle；QA 在构建产物里 grep 该 key 字符串应为 0 命中。
3. **数据 draft 状态**：样本仅 2024 一年，`status=待官方复核`；E2E-02 要显式断言「caveats 标注样本年份 + 提供官方复核入口」，避免把 draft 当成事实。

### 8.3 QA 建议（非阻塞）
- **defense-in-depth**（§5 ISO-P5）：补 DB 级 `profile↔account` 归属一致性约束，把档案级隔离从应用正确提升为 DB 强制。
- 引擎阈值（`TIER_THRESHOLDS`）做成可配置并纳入数据校准范围，避免硬编码漂移。

---

## 9. 验收结论模板（执行后填）

| 验收项 (AC) | 用例集 | 状态 | 证据 |
|---|---|---|---|
| AC-1 可测试性清单（6步脚本化 + 异常） | §2 E2E-01~06 + §3 EX-1~5 | ☐ Pass / ☐ Fail | _（贴 L0/L1 报告链接或截图）_ |
| AC-2 账号级隔离（A 对 B 不可见） | §4 ISO-A1~A8 | ☐ Pass / ☐ Fail | _（RLS 探针日志）_ |
| AC-3 档案级隔离（X 不串 Y） | §5 ISO-P1~P5 | ☐ Pass / ☐ Fail | _（应用层 scoping 断言）_ |
| AC-4 多档案增删/切换回归 | §6 MP-1~MP7 | ☐ Pass / ☐ Fail | _（Playwright/接口报告）_ |

**红线复核**：不承诺录取 ☐ / 三层分离可见 ☐ / 来源可追溯 ☐（贯穿 §2~§6 断言）。

---

## 🔴 已知阻塞：规则契约不一致（build-time，阻塞 E2E-03 正确执行）

> **严重度：高**（直接破坏 TASK-SPEC §3「资格校验」与红线「资格条件不能凭感觉」）。
> **状态：已定位，需 数据 + AI工程师 对齐**（属 build-time 契约对齐，不是本 QA issue 的验收缺口；但它是 §2 E2E-03 能否真跑通的前提，故在此强标）。

**现象**：把数据交付的 `rules.example.json` 喂给 AI工程师 的 `engine.ts::evaluateRule`，**所有候选都会被判通过**，与选科无关——资格过滤形同虚设。

**根因（两处不一致）**：
1. **`machine.type` 命名分叉**
   - 数据（`DATA-PACKAGE.md §5` / `rules.example.json`）：`subject_match | score_threshold | flag | presence`
   - 引擎（`engine.ts` switch）：`subject_match | batch | tuition_le | plan_gt`
   - 仅 `subject_match` 重合；其余 3 类落入引擎 `default` 分支 → `passed=true`（「未知规则类型，暂不阻断」）。
2. **参数形状分叉**
   - 数据：字段**直接挂在 `machine` 上**，如 `{type:'subject_match', preferred_required:'物理', reselect_required:['化学']}`，**无 `params`**。
   - 引擎/类型（`types.ts` `Rule.machine = {type, params}`）：读 `machine.params.required`。`params` 为 `undefined` → `params.required` 取不到 → 回退 `[]` → `[].every()` 恒为 `true` → **选科规则空转通过**。

**次要字段差异**（同源问题，建议一并对齐）：`Recruitment.plan`(number, types) vs `recruitment.plan_<year>`(data)；`MajorGroup.subject_requirement`(string, types) vs object(data)；`Account.rank` BigInt(seed) vs `CandidateConditions.rank`(number, types)。API-CONTRACT §6 已预留「字段不同回我一句」的对接口，走它即可。

**QA 建议（路由）**：
- **数据** 与 **AI工程师** 以 `types.ts` 为单一事实来源对齐 `machine.type` 枚举 + `params` 结构（或反过来，二选一，只改一处）。建议保留引擎已实现的 `{subject_match, batch, tuition_le, plan_gt}` + `params.{required,allowed,max,min}`，数据改 rules 表结构。
- 对齐后 QA 补一条 L0 单测：用 `rules.example.json` 真实规则跑 `checkEligibility`，断言「物理+化学考生全 passed、历史类考生被 `subject_match` 挡掉」——**这正是 §7.1 已写好的用例**，契约一通即可直接执行。
- 不阻塞本 issue 的 4 条 AC 交付（清单/用例已出），但标记为 E2E-03 执行前置。建议群管理/PM 起一条对齐 issue（数据↔AI工程师）。
