# AI 升学规划 Agent（高考志愿）

方向 05 · 决策型 Agent。本项目选定场景：**高考志愿规划**。

> 🌐 **Live**：<https://ai-school-admission-planning-agent.vercel.app/> · 仓库：[GitHub](https://github.com/maoumao34-design/AI-School-Admission-Planning-Agent)
>
> 核心流程（资格校验 / 方案比较 / 改条件重算）**只依赖 JSON 数据 + 纯函数引擎，零环境变量即可部署**；
> Supabase（登录/数据隔离）是增强项，可后置。部署步骤见下方[「部署 (Vercel)」](#部署-vercel)。

## 任务说明

仓库里四份文档配套看：

👉 **[TASK-SPEC.md](./TASK-SPEC.md)** — 做什么（范围/核心功能/流程/志愿卡/验收）
👉 **[DELIVERY-STANDARD.md](./DELIVERY-STANDARD.md)** — 怎么交、交到什么程度（完整交付/评分流程）
👉 **[RND-PROCESS.md](./RND-PROCESS.md)** — 怎么研发（四阶段路径）
👉 **[COLLABORATION.md](./COLLABORATION.md)** — 怎么协作（分支/提交/评审合并/部署）

> 所有 agent 接到任务后，请**先读这四份**，再开始工作。

## 团队角色

5 个智能体：项目经理(PM) / AI Agent 工程师(核心) / 全栈开发 / 数据与规则研究员(成败关键) / QA。

## 技术栈（已锁定 D-003）

Next.js(App Router) 一体全栈 + TypeScript + Tailwind + Supabase(Postgres+Auth+RLS) + Prisma。
规则/概率引擎 = TS 纯函数（`src/decision/*`，AI工程师 MAO-12），数据 = JSON（数据角色 MAO-9），LLM 编排同仓 TS（待 MAO-14）。详见 [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) 与 [docs/API-CONTRACT.md](./docs/API-CONTRACT.md)。

---

## 数据来源（交付物2 · 透明化）

> 红线：每个数据点都可追溯到**官方来源 + 数据年份/更新时间**。完整明细见 [`data/DATA-PACKAGE.md`](./data/DATA-PACKAGE.md)。

- **范围**：江苏省 · 2026 年 · 物理类（示例考生 637 分 / 位次 5,200 / 选科 物理+化学）。
- **数据集**：[`data/sample-jiangsu-2026-phys.json`](./data/sample-jiangsu-2026-phys.json)（状态 **sample**，关键路径交付）—— 4 张候选卡 / 3 所院校（东南大学 1102、南京理工大学 1104、河海大学 1105），覆盖冲刺 / 稳妥 / 保底。
- **字段契约**：与 [`src/decision/types.ts`](./src/decision/types.ts) 的 `CandidateCard` / `Rule` 一致，决策引擎可直接 `import` 消费（**非 mock**）。

### 数据年份与层级

| 数据项 | 来源 | 年份 | 可信度 |
|---|---|---|---|
| 投档最低分 `min_score` | 江苏省教育考试院投档线 PDF（权威、各源一致） | 2023–2025 | 权威 |
| 最低位次 `min_rank` | 由「一分一段表」派生（PDF 不含位次） | 2023–2025 | 各聚合站 ±300 位出入，标 `status=待官方复核` |
| 招生计划 `plan` | 江苏招生计划汇编 / 志愿填报辅助系统 | 2026 | 当前为校·物理类总量；组级精确计划待抽取（`plan=null`） |
| 选科要求 | 教育部《指引》+ 江苏选考科目要求 | 2024–2026 | 本样本 4 组均「物理+化学」 |
| 学费 | 各校招生章程 + 苏价费〔2014〕136号 | 当年度 | 4 组 5800–6380 |

### 官方来源链接

- 投档线 2025（物理类）：<https://www.jseea.cn/webfile/upload/2025/07-18/09-33-5302461102655621.pdf>
- 投档线 2024 / 2023（物理类）：<https://www.jseea.cn/>（`webfile/index/index_zkxx`）
- 一分一段表 2025（位次派生）：<https://www.jseea.cn/>
- 选科要求：<https://www.jseea.cn/> · <https://gaokao.chsi.com.cn/>
- 招生计划 / 学费章程：<https://www.jseea.cn/> · 各校招生网（东南 zsb.seu.edu.cn、南理工 zsb.njust.edu.cn）

> 概率参考方法 = **近3年位次差法**（`method` + `data_years=2023-2025`），确定性算术、**非录取预测**。

## 资格规则（交付物2 · 透明化）

> 红线：规则判断 = 确定性纯函数（**不交给 LLM 凭感觉判**）。规则表见 [`data/rules.example.json`](./data/rules.example.json)，引擎判定见 [`src/decision/engine.ts`](./src/decision/engine.ts) 的 `evaluateRule()`。

每条规则 = 文本规则 → 可机读判据 `machine{type, params}`。引擎 canonical 4 类，逐条附官方来源 + 适用周期：

| rule_id | 类别 | machine.type | params | 官方来源 | 适用周期 |
|---|---|---|---|---|---|
| `SUBJ-REQ-2024-001` | 选科 | `subject_match` | `required:[物理,化学]` | 教育部《指引》/ 江苏考试院 | 2024–2026 |
| `BATCH-QUAL-2026-001` | 批次 | `batch` | `allowed:[普通类本科批]` | 江苏省教育考试院（批次线） | 2026 |
| `FEE-CAP-2026-001` | 费用 | `tuition_le` | `max:60000` | 各校招生章程 / 苏价费〔2014〕136号 | 随当年度章程 |
| `PLAN-AVAIL-2026-001` | 计划 | `plan_gt` | `min:0` | 江苏招生计划汇编 | 2026 |

**判定原则（对应异常路径）**：只有「能确定不满足硬条件」才阻断资格；数据待抽取（`tuition`/`plan=null`）或未知规则类型一律**不阻断**，改为附 `caveat` + 标 `needs_review`（避免样本缺值误杀）。

## Agent 流程：6 步（交付物2 · 透明化）

> TASK-SPEC §3/§4 的完整端到端流程，对应页面组件与 API（决策核心 = **真引擎，非 mock**）。每个响应都带 `trace`（`conditions_used` / `rules_applied` / `dataset_year` / `generated_at`）。

| 步骤 | 内容 | 页面 / API（代码位置） |
|---|---|---|
| **01 对话建立条件** | 填写 / 追问影响资格的缺失条件与冲突 | [`ConditionForm`](./src/components/ConditionForm.tsx)（结构化表单：省 / 年度 / 科类首选 + 再选 / 分 / 位次 / 学费预算） |
| **02 获取官方信息** | 展示本省本年度真实数据 + 原始来源 | 候选卡 `source.url` + `updated` + `status`（江苏考试院投档线 PDF） |
| **03 资格过滤** | 逐条规则判定，排除不满足硬条件的候选 | `POST /api/eligibility`（`checkEligibility`，阻断 / advisory / needs_review 可展开） |
| **04 方案比较** | 候选 / 差距 / 成本 / 风险 + 多策略取舍并排 | `POST /api/compare`（`compare`，按 院校优先 / 专业优先 / 均衡 排序，概率档 / 位次差 / 理由） |
| **05 修改条件重算** | 改一项分数 / 预算 / 地区 / 目标，重跑过滤 + 规划，对比前后版本 | `POST /api/recompute`（`recompute` → `diff.added/removed/changed`）；前端 debounce 300ms 并行重调 |
| **06 确认导出** | 确认最终方案，导出带来源的行动计划 | `exportReport()`（Workspace）→ Markdown（条件 / 资格 / 方案排序 / 每条来源 + 时间 / 三红线声明）→ `.md` 下载 |

**异常路径**：缺关键条件 → `info_insufficient`；无候选通过 → `no_result`（均给原因 + 下一步）。

## 真实 vs 模拟功能（显式标注）

> 交付物2 红线：模拟内容明确标出，**不作为已实现功能**。区分「真实实现并运行」「样本 / 占位」「模拟 / 后置增强」。

### ✅ 真实实现并运行

- **决策核心引擎**：资格校验 / 概率档 / 方案排序 / 改条件重算 / 版本差异 = TS 纯函数（`src/decision/*`），`vitest` 44 用例全绿；输入相同输出相同。
- **数据**：真实官方来源结构化 JSON（投档线取江苏省教育考试院 PDF）。
- **概率**：位次差法确定性算术（**非写死** —— 换分数 / 位次，候选与档位随之变化，已验证）。
- **官方来源入口**：每张候选卡可打开官方链接并查看更新时间。
- **6 步端到端**：API 调真引擎，非 mock / 非录像。

### ⚠️ 样本 / 占位（数据层面，已逐项标注）

- 最低位次 `min_rank`：一分一段表派生（标 `status=待官方复核`，聚合站 ±300 位出入）。
- 招生计划 `plan`：当前校·物理类总量；组级精确计划待计划汇编抽取（`plan=null`，规则暂不阻断）。
- 东南 SEU-06 组 2023 投档最低分待补。

### 🧪 模拟 / 后置增强（明确标注，未作为已实现）

- **LLM 自然语言对话建条件**：当前为结构化表单（`ConditionForm`）；自然语言对话 + LLM 编排待 AI 工程师接入。
- **Supabase 登录 / 多账户隔离 / RLS**：增强项，**可后置**（MAO-2）；核心流程零环境变量、不依赖它即可部署运行。
- 页头「一账号 · 多考生档案」标签为规划占位（数据模型已建，鉴权待接入）。

---

## 前端启动

```bash
npm install
npm run db:generate   # prisma generate（生成 @prisma/client 类型；构建前跑一次）
npm run dev           # http://localhost:3000
npm run build         # 生产构建（= prisma generate && next build，见 vercel.json）
npm run test          # 引擎 vitest 单测（44 用例）
npm run qa            # 6 步黑盒回归（需先 npm run dev/start，打 http://localhost:3000）
```

> 前端：`app/page.tsx` + `src/components/*`（ConditionForm / Workspace / CandidateCard）；建条件表单 + 工作区双栏 + 结构化候选卡。
> 候选卡数据来自真引擎 `POST /api/compare`（`src/decision` 纯函数算概率档/位次差/理由/排序），**非 mock**。
> 数据库/鉴权（MAO-2）需先建 Supabase 项目并配 `.env`（见 `.env.example`），运行 `npm run db:setup`。

## 部署 (Vercel)

**核心流程零环境变量**：资格/比较/重算只读 `data/*.json` + 调 `src/decision/*` 纯函数，构建与运行均不依赖 Supabase（已验证：无任何 env 时 `npm run build` 通过、6 步 QA 全绿）。因此**先零配置上 Vercel 跑通核心流程**，Supabase 后置。

### 方式 A：Vercel 连 GitHub 自动部署（推荐）

1. Vercel → **Add New… → Project** → 选本 GitHub 仓库 → Import。
2. 框架自动识别为 **Next.js**；构建命令已由 [`vercel.json`](./vercel.json) 固定为 `prisma generate && next build`（不填也行，Vercel 默认 `next build`，但显式更稳：避免 `@prisma/client` 未 generate 导致的类型检查失败）。
3. **Environment Variables：留空即可**（核心流程不需要）。若要启用登录/数据隔离，再按 `.env.example` 填 Supabase 四项（见下）。
4. Deploy → 得到 `https://<project>.vercel.app`。之后每次合并 `main` 自动重新部署。

### 方式 B：Vercel CLI

```bash
npm i -g vercel
vercel login            # 一次性
vercel --prod           # 生产部署当前目录
# 之后更新：vercel --prod
```

### 环境变量（可选，仅启用 Supabase 登录/数据隔离时需要）

| 变量 | 用途 | 必填？ |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` | 浏览器端 Supabase 客户端 | 否（核心流程不需要） |
| `DATABASE_URL` / `DIRECT_DATABASE_URL` | Prisma 迁移/直连（Supabase Postgres） | 否 |
| `SUPABASE_SERVICE_ROLE_KEY` | 服务端绕 RLS（仅 scripts） | 否 |

> 服务端 LLM 密钥（AI 工程师 MAO-14 接入时）同样留在 Vercel 环境变量，前端不接触。

### 部署后 QA（6 步端到端回归）

```bash
BASE_URL=https://<project>.vercel.app npm run qa   # 验证线上 /api/* 真引擎
```

## 范围

**本次只做方向 05 高考志愿**。两项共同必做工作流（游戏营销、AI 漫剧）已确认**后续独立处理**，不在本次交付范围内。
