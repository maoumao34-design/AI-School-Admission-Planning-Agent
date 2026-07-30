# AI 升学规划 Agent（高考志愿）

方向 05 · 决策型 Agent。本项目选定场景：**高考志愿规划**。

> 🌐 **Live**：<https://ai-school-admission-planning-agent.vercel.app/> · 📦 **完整源代码 + README 已提交**：[GitHub 仓库](https://github.com/maoumao34-design/AI-School-Admission-Planning-Agent)
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
规则/概率引擎 = TS 纯函数（`src/decision/*`，AI工程师 MAO-12），数据 = JSON（数据角色 MAO-9）。**对话建条件 = 确定性层（`/api/condition-building`，不用 LLM key）**；LLM 自然语言增强为可选锦上添花（maozh2 决定暂不接入 key）。详见 [docs/DATA-MODEL.md](./docs/DATA-MODEL.md) 与 [docs/API-CONTRACT.md](./docs/API-CONTRACT.md)。

---

## 数据来源（交付物2 · 透明化）

> 红线：每个数据点都可追溯到**官方来源 + 数据年份/更新时间**。完整明细见 [`data/DATA-PACKAGE.md`](./data/DATA-PACKAGE.md)。

- **范围**：江苏省 · 2026 年 · **物理类 + 历史类两类**（maozh2 要求覆盖大部分考生；示例考生 637 分 / 位次 5,200 / 选科 物理+化学）。
- **数据集**：物理类 [`data/sample-jiangsu-2026-phys.json`](./data/sample-jiangsu-2026-phys.json) + 历史类卡，共 **3666 张专业组卡**（物理 2511 / 996 校，历史 1155 / 803 校），投档分全段覆盖（物理 463–686 / 历史 482–679）。由 jseea 2025 投档线 PDF 经 pymupdf 批量解析 + converter 脚本转卡（取代手填 / web 逐校爬），来源全标官方 URL。
- **字段契约**：与 [`src/decision/types.ts`](./src/decision/types.ts) 的 `CandidateCard` / `Rule` 一致，决策引擎可直接 `import` 消费（**非 mock**）；`subject_requirement` 用「物理+化学 / 历史+思想政治 / 不限」格式，引擎 per-card 首选+再选硬过滤直消费。

### 数据年份与层级

| 数据项 | 来源 | 年份 | 可信度 |
|---|---|---|---|
| 投档最低分 `min_score` | 江苏省教育考试院（jseea）投档线 PDF，pymupdf 批量解析 | **2025 权威**（2024 回填中） | 权威 |
| 最低位次 `min_rank` | 由「一分一段表」派生 | 2024–2025 | **3666 卡中仅 61 条手填有值，3621 条 null 标「待一分一段表派生」**；引擎在空时按投档分差兜底（MAO-26），位次后续补精 |
| 招生计划 `plan` / 学费 / 专业清单 majors / 城市 | 江苏招生计划汇编 / 各校章程 | 2026 / 当年度 | 待回填（部分 `null`，规则不阻断、标 caveat） |
| 选科要求 | 教育部《指引》+ 江苏选考科目要求 | 2024–2026 | 每专业组完整首选+再选要求（物理+化学 / 历史+思想政治 等），逐组核、标来源 |

> 推荐年份口径：**2026 推荐以 2024/2025 为主依据**（maozh2），2023 仅趋势参考；卡片标清年份/来源/待核，不得把 2026 说成真实录取结论。

### 官方来源链接

- 投档线 2025（物理类 / 历史等科目类）：<https://www.jseea.cn/>（`webfile/index/index_zkxx`，两册 PDF）
- 投档线 2024 / 2023：<https://www.jseea.cn/>
- 一分一段表 2025（位次派生，**图片格式、工具链暂无 OCR、位次回填受阻**）：<https://www.jseea.cn/>
- 选科要求：<https://www.jseea.cn/> · <https://gaokao.chsi.com.cn/>
- 招生计划 / 学费章程：<https://www.jseea.cn/> · 各校招生网

> 概率参考方法 = **位次差法（min_rank 有值）+ 投档分差兜底（min_rank 空，MAO-26）**（`probability_ref.method` + 数据年份），确定性算术、**非录取预测**；reason 标注当前用哪种方法、不混淆。

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
| **01 对话建立条件** | 填写 / 追问影响资格的缺失条件与冲突 | **两种模式**：[`ConditionForm`](./src/components/ConditionForm.tsx)（结构化表单）或 [`ChatPanel`](./src/components/ChatPanel.tsx)（自然语言对话 → `POST /api/condition-building` 确定性层：抽条件 / `findMissingConditions` / 冲突检测 / 追问，**不用 LLM key**；ready 后建立/更新考生档案并驱动下游） |
| **02 获取官方信息** | 展示本省本年度真实数据 + 原始来源 | 候选卡 `source.url` + `updated` + `status`（江苏考试院投档线 PDF） |
| **03 资格过滤** | 逐条规则判定，排除不满足硬条件的候选 | `POST /api/eligibility`（`checkEligibility`，阻断 / advisory / needs_review 可展开） |
| **04 方案比较** | 候选 / 差距 / 成本 / 风险 + 多策略取舍并排 | `POST /api/compare`（`compare`，传全部策略 → 「院校优先 / 专业优先」**两套方案并排**双列、选中高亮；概率档 / 位次差或投档分差 / 多因素理由） |
| **05 修改条件重算** | 改一项分数 / 预算 / 地区 / 目标，重跑过滤 + 规划，对比前后版本 | `POST /api/recompute`（`recompute` → `diff.added/removed/changed`）；前端 debounce 300ms 并行重调 |
| **06 确认导出** | 确认最终方案，导出带来源的行动计划 | `exportReport()`（Workspace）→ Markdown（条件 / 资格 / 方案排序 / 每条来源 + 时间 / 三红线声明）→ `.md` 下载 |

**异常路径**：缺关键条件 → `info_insufficient`；无候选通过 → `no_result`（均给原因 + 下一步）。

> **TASK-SPEC §三 4 核心功能**：①对话建条件（确定性层 + 对话每轮更新档案）✅ ②资格校验 ✅ ③两套方案并排 ✅ ④计划与版本（关键日期「待公布」+ 风险提醒 + 版本随动面板，`fullstack/plan-version-panel`）✅。每张候选卡带**多因素推荐理由**（位次 + 选科 + 预算 + 年份 trace）。

## 真实 vs 模拟功能（显式标注）

> 交付物2 红线：模拟内容明确标出，**不作为已实现功能**。区分「真实实现并运行」「样本 / 占位」「模拟 / 后置增强」。

### ✅ 真实实现并运行

- **决策核心引擎**：资格校验 / 概率档 / 方案排序 / 改条件重算 / 版本差异 / 对话建条件 / 多因素推荐理由 = TS 纯函数（`src/decision/*`），`vitest` 78 用例全绿；输入相同输出相同。
- **§三 ① 对话建条件（确定性层，不用 LLM key）**：`/api/condition-building` 抽条件 + 追问 + 冲突检测；对话每轮实时更新考生档案、右侧随重算。
- **§三 ② 资格校验**：per-card `subject_requirement` 首选+再选硬过滤。
- **§三 ③ 两套方案并排**：「院校优先 / 专业优先」双列并排。
- **§三 ④ 计划与版本**：关键日期（待公布）+ 风险提醒 + 版本随动面板。
- **多因素推荐理由**：每张卡 reason 同时含 位次差+冲稳保档 / 选科符合性 / 预算 / 参考年份+非预测声明。
- **伪登录 + 账户档案分桶隔离**（MAO-21）：输用户名即登录；A 账户看不到 B 档案、增删/对话建档只影响当前账户桶。
- **数据（双类 3666 卡）**：物理 991 / 996 校 + 历史 1155 / 803 校，jseea 2025 投档线 PDF 批量解析转卡。
- **概率 + 候选随动**：位次差法 / 投档分差兜底确定性算术（**非写死** —— 换分数 / 位次 / 选科，候选与档位随之变化，已验证）。
- **官方来源入口**：每张候选卡可打开官方链接并查看更新时间。
- **6 步端到端**：API 调真引擎，非 mock / 非录像。

### ⚠️ 样本 / 占位（数据层面，已逐项标注）

- **最低位次 `min_rank`**：3666 卡中仅 61 条手填有值，3621 条 null 标「待一分一段表派生」（一分一段表为图片、工具链暂无 OCR）；引擎走投档分差兜底（MAO-26）不阻塞，位次后续补精。
- **招生计划 / 学费 / 专业清单 majors / 城市**：待《招生计划》回填（部分 `null`，规则不阻断、标 caveat）。
- **2024 投档分**：现以 2025 为主，2024 回填中。

### 🧪 可选增强 / 已知限制（明确标注）

- **LLM 自然语言增强层**：maozh2 决定**不用 LLM key**；对话建条件走确定性层已可用，LLM 仅作可选锦上添花（非必需）。
- **真实 Supabase Auth / RLS**：当前为**伪登录 + 本地账户分桶隔离**（验收口径：账号/档案数据隔离真实生效即可，MAO-21 已实现）；生产级真实 Auth/RLS 为可选增强。
- **已知限制（验收参考）**：①引擎需考生提供**位次**（只给分不给位次 → `info_insufficient`）；②近本科线考生（物理 ~470 / 历史 ~490）只有冲+稳、**无保底**（本科线是地板，不扩专科/民办无法补）——周有局限，不作为缺陷。
- 手机端真机视觉未单独跑（响应式 Tailwind 已实现）。

---

## 前端启动

```bash
npm install
npm run db:generate   # prisma generate（生成 @prisma/client 类型；构建前跑一次）
npm run dev           # http://localhost:3000
npm run build         # 生产构建（= prisma generate && next build，见 vercel.json）
npm run test          # 引擎 vitest 单测（78 用例）
npm run qa            # 6 步黑盒回归（需先 npm run dev/start，打 http://localhost:3000）
```

> 前端：`app/page.tsx` + `src/components/*`（ConditionForm / **ChatPanel**（对话建条件）/ Workspace / CandidateCard / **两套方案并排** / **计划与版本面板** / ProfilePanel）；建条件（表单/对话）+ 工作区双栏 + 结构化候选卡。
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
