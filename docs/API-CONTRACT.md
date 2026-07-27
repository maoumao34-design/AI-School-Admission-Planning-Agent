# 决策核心 API 契约 — 升学规划 Agent（高考志愿）

> 作者：AI 工程师（决策核心） · 分支 `ai-eng/api-contract`
> 对齐：TASK-SPEC §3-7、PRD-v1、数据角色候选卡/规则表 schema。
> 状态：**v2 — 类型已对齐数据 JSON、路由已挂载、单测+QA 脚本就绪**。待 全栈/QA 联调。

本文件定义决策核心对外暴露的三个端点 + 数据结构，供全栈对接、QA 脚本驱动。
类型定义见 [`src/decision/types.ts`](../src/decision/types.ts)；纯函数引擎见 [`src/decision/engine.ts`](../src/decision/engine.ts)；
JSON 适配层（消费数据角色交付的 JSON）见 [`src/decision/adapter.ts`](../src/decision/adapter.ts)；
端点编排层（纯函数、可单测）见 [`src/decision/handlers.ts`](../src/decision/handlers.ts)。

---

## 0. 设计原则（对应三条红线）

1. **规则判断 = 确定性纯函数**，不交给 LLM 凭感觉判。资格校验/概率档/排序都是表查询 + 算术。
2. **LLM 只做两件事**：①「对话建条件」把自然语言抽成 `CandidateConditions`；②「推荐理由」基于引擎输出润色（可关，引擎自带默认 reason）。
3. **决策透明化**：每个响应带 `trace`（用了哪些条件、执行了哪些规则、数据年份、生成时间）。
4. **异常显式**：所有响应统一 `outcome` 外壳，信息不足/无结果/数据过期/来源冲突/需人工复核 → `reason + next_step`。
5. **与身份/档案归属无关**：引擎按单个考生条件算；`profileId` 只在 plan 级端点作归属参数，不进判定逻辑。

---

## 1. 端点（Next.js App Router · API Routes）

| 端点 | 方法 | 用途 | 6步映射 |
|---|---|---|---|
| `/api/eligibility` | POST | 资格校验：逐条规则判候选通过/不通过 | 03 资格过滤 |
| `/api/compare` | POST | 方案比较：按策略排序 + 概率档/位次差/理由 | 04 方案比较 |
| `/api/recompute` | POST | 改条件重算：新条件 → 新候选集 + 版本差异 | 05 改条件重算 |

> 「01 对话建条件」「02 获取官方信息」「06 确认导出」由全栈/LLM 编排层负责，不在本契约（LLM 选型见 §5）。
> 三个端点都是 `DecisionResponse<T>` 外壳，QA 可脚本化串起来驱动 6 步回归。

---

## 2. 资格校验 `POST /api/eligibility`

**Request** — `EligibilityCheckRequest`
```ts
{
  candidate: CandidateConditions,   // 考生条件（省份/年度/选科/分数/位次/偏好/预算）
  candidates: CandidateCard[],      // 待判定候选（或服务端从数据集取）
  rules: Rule[]                     // 可机读规则（选科/批次/费用/计划）
}
```

**Response** — `DecisionResponse<EligibilityResult[]>`
```ts
{
  outcome: { status: 'ok'|'no_result'|..., reason, next_step? },
  trace:   { conditions_used, rules_applied: [rule_id...], dataset_year, generated_at },
  data: [
    {
      candidate_id,
      passed: boolean,
      evaluated_rules: [{ rule_id, category, passed, reason, source }],
      blocking_rules: [...]          // 未通过的，前端高亮用
    }
  ]
}
```

---

## 3. 方案比较 `POST /api/compare`

**Request** — `ComparisonRequest`
```ts
{
  candidate: CandidateConditions,
  candidates: CandidateCard[],       // 通常传资格校验通过的
  strategies?: ['院校优先','专业优先'] // 默认两套并排
}
```

**Response** — `DecisionResponse<StrategyGroup[]>`
```ts
{
  outcome, trace,
  data: [
    { strategy: '院校优先', candidates: RankedCandidate[] },
    { strategy: '专业优先', candidates: RankedCandidate[] }
  ]
}
// RankedCandidate = CandidateCard + { probability_ref, rank_diff_vs_candidate, reason }
```

---

## 4. 改条件重算 `POST /api/recompute`

**Request** — `RecomputeRequest`
```ts
{
  profile_id?: string,                // 档案上下文（plan 归属，引擎不用）
  baseline: CandidateConditions,      // 原条件
  changes: Partial<CandidateConditions> // 改某项（分数/预算/地区/目标）
}
```

**Response** — `DecisionResponse<RecomputeResponse>`
```ts
{
  outcome, trace,
  data: {
    new_conditions: CandidateConditions,
    strategy_groups: StrategyGroup[],
    diff: { added:[id], removed:[id], changed:[...] }  // 相对 baseline 版本差异
  }
}
```

---

## 5. LLM 编排层（同仓 TS，不另起 Python）

- **选型（AI 工程师建议，待确认）**：
  - **首选：通义千问 Qwen-Plus / Qwen-Max（阿里云 DashScope）** — 中文强、结构化输出（function calling / JSON mode）成熟、国内可得性好、有免费额度；OpenAI 兼容接口，可用 Vercel AI SDK 的 OpenAI provider 指定 baseURL 接入。
  - **备选：DeepSeek** — 中文 + 推理强、JSON 输出、成本极低、国内可得；同样 OpenAI 兼容。
  - OpenAI gpt-4o(-mini) 结构化输出最成熟，但国内可得性需代理，作兜底。
- **LLM 只用于**：①对话建条件（NL → `CandidateConditions`，缺项追问）；②推荐理由润色（输入引擎的 `rank_diff/tier/source`，产出可展开的「为什么推荐」，可关）。
- **绝不用于**：资格判定、概率档计算（确定性纯函数负责）。
- 密钥留服务端（Vercel 环境变量），前端不接触。

---

## 6. 对齐请求（状态：数据已交付，类型已对齐）

- **数据**：✅ 已对齐。`types.ts` 的 `CandidateCard` / `Rule` 现直接消费 `data/sample-jiangsu-2026-phys.json`、`data/rules.example.json`（少量表示差异由 `adapter.ts` 归一：`candidate_context.subjects`→`SubjectSelection`、`recruitment.plan_<year>`→`plan_by_year`）。字段名若再变，只改 `adapter.ts`。
  - 规则 `machine.type` 实际为：`subject_match | score_threshold | flag | presence`（数据角色交付值），引擎均已分派实现。
- **全栈**：`src/decision/` 是纯 TS、无 Next.js 依赖；API Routes 已挂为 `app/api/{eligibility,compare,recompute}/route.ts`（Next.js App Router），直接放进你的工程即可。`profileId` 我预留了（recompute 端点），plan 表挂 Profile 下由你管。
- **QA**：三端点可直接脚本驱动；`npm run qa` 跑 6 步黑盒回归（见下「快速验证」）；异常路径（`outcome.status != 'ok'`）有 `reason + next_step`，可断言。

---

## 7. 快速验证（端到端只跑一个服务）

```bash
npm install
npm run typecheck   # tsc --noEmit
npm test            # vitest：引擎单测 + 消费真实 JSON 样本的端到端断言（44 用例）
npm run dev         # 终端 A：启动唯一服务（Next.js，暴露 /api/*）
npm run qa          # 终端 B：6 步黑盒回归，打 http://localhost:3000
```

QA 脚本（`scripts/qa-6step.mjs`）覆盖：03 资格校验 → 04 方案比较（断言 SEU-08=稳妥/NJUST-03=保底/NJUST-02=冲刺）→ 05 改条件重算（断言跨档进 diff.changed）→ 异常路径（信息不足 → info_insufficient + next_step）。

## 8. 设计要点（对应验收）

- **可单测**：引擎与端点编排(`handlers.ts`)均为纯函数；`now`/`dataset_year` 可注入保证可复现。
- **数据待抽取不误杀**：样本里 `plan=null`/批次线待公布 → 规则不阻断，改附 `caveat` + `needs_review`（对应异常路径「需人工复核」「数据过期」），不被样本缺值污染资格结论。
- **三红线**：资格判定=确定性纯函数；概率档标「位次差法 + 数据年份，非预测」；LLM 只做建条件+理由润色（见 §5，待 provider 确认后接入）。

## 9. 待办（本分支之后）

- [x] ~~数据 48h 样本字段对齐后，补一份 `__tests__` 用真实样本跑通资格+比较。~~（已做：`tests/e2e-dataset.test.ts` + `tests/fixtures/`）
- [x] ~~API Route 薄封装（等全栈 App Router 工程就位后挂上）。~~（已挂：`app/api/*/route.ts`，含最小 Next.js 骨架）
- [ ] LLM 编排模块（选定 provider 后）：对话建条件 + 推荐理由润色。见 MAO-14。
- [ ] 全栈联调：鉴权/RLS、plan 表挂 Profile、前端志愿卡。
