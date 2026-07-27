# AI 升学规划 Agent（高考志愿）

方向 05 · 决策型 Agent。本项目选定场景：**高考志愿规划**。

> 🌐 **Live**：<待部署后填入 Vercel URL> · 仓库：[GitHub](https://github.com/maoumao34-design/AI-School-Admission-Planning-Agent)
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

## 前端启动

```bash
npm install
npm run dev      # http://localhost:3000
npm run build    # 生产构建（内部 prisma generate && next build，见 vercel.json）
npm run test     # 引擎 vitest 单测（44 用例）
npm run qa       # 6 步黑盒回归（需先 npm run dev/start，打 http://localhost:3000）
```

> 前端骨架（MAO-13）：`app/page.tsx` + `src/components/*`（ChatPane/Workspace/CandidateCard）；对话区 + 工作区双栏 + 结构化候选卡。
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
