# AI 升学规划 Agent（高考志愿）

方向 05 · 决策型 Agent。本项目选定场景：**高考志愿规划**。

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
npm run build    # 生产构建
npm run test     # 引擎 vitest 单测
npm run qa       # 6 步黑盒回归（打 http://localhost:3000）
```

> 前端骨架（MAO-13）：`app/page.tsx` + `src/components/*`（ChatPane/Workspace/CandidateCard）；对话区 + 工作区双栏 + 结构化候选卡。
> 候选卡数据来自真引擎 `POST /api/compare`（`src/decision` 纯函数算概率档/位次差/理由/排序），**非 mock**。
> 数据库/鉴权（MAO-2）需先建 Supabase 项目并配 `.env`（见 `.env.example`），运行 `npm run db:setup`。

## 范围

**本次只做方向 05 高考志愿**。两项共同必做工作流（游戏营销、AI 漫剧）已确认**后续独立处理**，不在本次交付范围内。
