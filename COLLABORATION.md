# 协作与 Git 规范

> 本文件规定团队成员（人 + 各 agent）在同一个仓库上如何协作与提交代码。
> 与 [TASK-SPEC.md](./TASK-SPEC.md)、[DELIVERY-STANDARD.md](./DELIVERY-STANDARD.md)、[RND-PROCESS.md](./RND-PROCESS.md) 配套。
> 原则：**实用、可控、不追求过度完美**——能保证"改了不互相踩、main 始终可用"即可。

---

## 1. 分支策略

- `main` 受保护、始终可运行，**只通过合并进入，不直接 push**。
- 每个任务一个分支，命名 `<角色>/<简述>`：
  - `pm/prd-v1`
  - `ai-eng/eligibility-rule`
  - `fullstack/candidate-card`
  - `data/jiangsu-2026`
  - `qa/e2e-flow`
- 大改动先在频道/issue 对齐方案再切分支，避免返工。

## 2. 提交

- 提交信息前缀按类型：`feat / fix / docs / data / test / chore` + 一句话说明改了什么。
- 一个提交只做一件事，不要堆。

## 3. 改动前

- 先 `pull` 最新 `main`，从最新 `main` 切分支。

## 4. 评审与合并（关键）

- 分支完成后开 PR（或等效合并请求），写清：**改了什么、为什么、怎么验证**。
- **至少一人复核**：默认 PM 复核；涉及规则/数据/核心逻辑的改动，由 AI 工程师或数据角色复核。
- 复核通过 → 合并到 `main`；合并后删除分支。
- **不允许未经复核就自行合并进 main。**

## 5. 冲突与集成

- 合并冲突由改动方基于最新 `main` 解决（rebase 或 merge）。
- 数据 / 规则 / API 契约的变更，要通知受影响的其他角色。

## 6. 部署

- 只部署 `main`；分支不部署（除非需要临时预览）。

## 7. 任务跟踪

- 用 Multica issue 跟踪任务，分支关联对应 issue。
- PR 合并到 `main` 即视为该任务完成（按平台契约，合并需显式确认，不自动 close）。
