# LLM 选型候选与推荐（MAO-14）

> D-003 待定项收口。为「升学规划 Agent」的 **对话建条件 + 推荐理由润色** 选定 LLM。
> 约束：同仓 TS（Vercel AI SDK / 厂商 SDK）、中文能力 + 结构化输出 + 国内可得性。
> 结论供 [MAO-12](./API-CONTRACT.md) §5 的 LLM 编排层落地实现使用。

---

## 0. 决策前提：LLM 在本项目只做什么

继承三条红线（[TASK-SPEC](../TASK-SPEC.md) + [PRD-v1](./PRD-v1.md) §6 + [API-CONTRACT](./API-CONTRACT.md) §5）：

| 工作 | 由谁负责 | 是否交给 LLM |
| --- | --- | --- |
| 资格校验（选科匹配 / 分数线 / 标志位 / 必修项） | **确定性 TS 纯函数**（`engine.ts`） | ❌ 绝不 |
| 概率档（冲刺/稳妥/保底，位次差法） | **确定性 TS 纯函数** | ❌ 绝不（标「方法 + 数据年份，非预测」） |
| **① 对话建条件**：自然语言 → `CandidateConditions`，缺项追问 | LLM | ✅ |
| **② 推荐理由润色**：基于引擎的 `rank_diff / tier / source`，产出「为什么推荐」 | LLM（可关，引擎自带默认 reason） | ✅ |

**因此选型的真实负载很轻**：不要求长链推理、不要求代码生成、不要求多模态。要的是
**中文自然语言理解准** + **稳定吐出符合 schema 的结构化 JSON** + **国内可得 / 成本可控**。
这把候选从「最强通用模型」收窄到「中文强 + 结构化稳 + 国内可得」。

### 结构化输出目标（建条件）

LLM 须把一轮或多轮对话收敛成下面的形状（来自 `src/decision/types.ts`，此处复制以便独立评审）：

```ts
interface CandidateConditions {
  province: string;                 // '江苏'
  year: number;                     // 2026
  subject: {
    category: '物理类' | '历史类';
    primary: string;                // 首选 1
    secondary: string[];            // 再选 2
  };
  score: number;                    // 高考总分，如 637
  rank: number;                     // 全省位次，如 5200
  preferences?: {
    region?: string[];              // 地区偏好
    schoolLevel?: string[];         // 985/211/双一流/公办
    majorDirection?: string[];      // 专业方向
    strategy?: string;              // 院校优先 / 专业优先
  };
  budget?: { maxTuition?: number }; // 学费上限（元/年）
}

// 同时输出"还差什么"——缺项/冲突项驱动追问
interface ConditionGap {
  field: string;                    // 'score' | 'rank' | 'subject.secondary' ...
  status: 'missing' | 'conflict';
  message: string;                  // 给用户的人话，如"还差你的全省位次，方便给一下吗？"
}
```

> 关键工程纪律：**LLM 吐出的 JSON 必须经引擎的运行时校验/归一**（zod 或手写 guard），不通过就回退到追问，
> 不允许半成品条件进入资格校验。结构化输出是"减少解析失败"的手段，不是"信任 LLM 不出错"的理由。

---

## 1. 候选对比（满足验收 ①：≥2 候选 × 5 维度）

价格为 2026-07 查证的官方挂牌价，**以各厂商官网实时为准**（促销/阶梯/币种会变）。
统一口径：**每百万 token（1M tokens）**，输入 / 输出。

| 维度 | **① 通义千问 Qwen**（阿里云百炼 DashScope） | **② DeepSeek** | ③ 智谱 GLM（备选） | ④ OpenAI gpt-4o-mini（兜底） |
| --- | --- | --- | --- | --- |
| **中文能力** | 原生中文，业界最强梯队；升学/教育语境理解稳 | 中文强，数理/推理尤强 | 原生中文 | 良好但非原生，专业术语偶有英化 |
| **结构化输出方式** | JSON Mode（`response_format:{type:"json_object"}`，提示词须含 "JSON" 关键字）+ Function Calling；qwen3.x 全系支持 | JSON Mode + Function Calling | Function Calling + JSON Mode | **最成熟**：Structured Outputs（strict JSON Schema，100% 合规保证）+ Function Calling |
| **可得性（国内 / 代理）** | **国内直连**（`dashscope.aliyuncs.com`），阿里云企业级 SLA，生态完整；海外有国际版 | **国内直连**（`api.deepseek.com`） | **国内直连**（`open.bigmodel.cn`），无需代理，延迟低 | **国内不可直连，需代理/中转**；Vercel 海外节点可直接访问 |
| **成本（每 1M tokens，输入/输出）** | qwen3.7-max 旗舰 `¥12 / ¥36`（限时 5 折 `¥6 / ¥18`）；qwen-plus 约 `¥0.8 / ¥2`（量级，以官网为准）；**开通赠 100 万 token（90 天内）** | 国际 `$0.27 / $1.10`；国内 ¥量级最低梯队；**缓存命中再降约 90%** | GLM-4-Plus ~`¥50 / ¥100`；GLM-4-Air ~`¥0.5 / ¥2`；**GLM-4-Flash 免费**；新用户赠 ¥18 | gpt-4o-mini `~$0.15 / $0.60`（结构化最稳里最便宜之一）；gpt-4o `~$2.5 / $10` |
| **接入方式（同仓 TS）** | OpenAI 兼容（`…/compatible-mode/v1`）→ Vercel AI SDK `@ai-sdk/openai-compatible` 或官方 `dashscope` SDK | OpenAI 兼容 → Vercel AI SDK `@ai-sdk/openai-compatible`（官方亦推荐 openai SDK 指定 baseURL） | OpenAI 兼容 → `@ai-sdk/openai-compatible`；或官方 `zhipuai` SDK | Vercel AI SDK 官方 `@ai-sdk/openai`（一等支持） |

> 数据来源：阿里云百炼《模型调用价格》《结构化输出》、DeepSeek 官方定价页、智谱 bigmodel.cn/pricing、
> OpenAI 定价页（2026-07 查证）。**单价会随厂商促销/版本迭代变动，落地前以官网为准**；本表只用于横向量级比较。

### 厂商快评

- **Qwen（DashScope/百炼）**：中文是主场；教育/升学这类中文对话语境它最不容易"翻译腔"。
  JSON Mode + Function Calling 都成熟，`compatible-mode` 让它能像 OpenAI 一样接，免费额度够整个开发期。
- **DeepSeek**：成本地板、推理强、国内直连、OpenAI 兼容。短板是结构化输出在"极严格 schema + 边角输入"上偶尔需要重试，
  但本项目 schema 简单、且有运行时 guard 兜底，影响可忽略。
- **智谱 GLM**：与 DeepSeek 同档位竞争 fallback 位，国内直连延迟低、Flash 档免费可压成本。
  选 DeepSeek 还是 GLM 作 fallback，按团队熟悉的云生态/账号体系二选一即可，不阻塞主线。
- **OpenAI gpt-4o-mini**：结构化输出是天花板（strict schema 有合规保证），但**国内不可直连**，
  只在"部署在 Vercel 海外节点 + 需要最严 schema 兜底"时启用；国内自营不作主力。

---

## 2. 推荐选型 + 理由（满足验收 ②）

> ### 结论：**首选 通义千问 Qwen**（默认 `qwen-plus`，复杂建条件可升 `qwen-max`）；**备选/降级 fallback = DeepSeek**；OpenAI gpt-4o-mini 仅作"结构化严格兜底"（且仅海外节点）。

**为什么首选 Qwen：**

1. **中文是本项目第一硬指标**——「对话建条件」要从考生/家长的自然语言里抽省份、年度、选科、分数、位次、偏好，
   Qwen 原生中文 + 教育语境理解最稳，追问话术也最自然。
2. **结构化输出成熟且够用**——JSON Mode + Function Calling 直接产出 `CandidateConditions`；
   本项目 schema 简单（不是嵌套几十层的复杂 schema），Qwen 的稳定性足够，运行时 guard 再兜一层。
3. **国内可得性最好**——团队在国内、阿里云企业级 SLA、百炼平台一站式（模型/计费/监控），
   不依赖代理；海外部署也有国际版（`$2.5/$7.5`）。
4. **接入零摩擦**——OpenAI 兼容 `compatible-mode`，Vercel AI SDK 一行 `baseURL` 就接上，
   与备选 provider 共用同一抽象，切换/降级成本为零。
5. **成本可控 + 开发期免费额度**——`qwen-plus` 量级 `¥0.8/¥2`，开发期 100 万 token 赠额基本跑不满。

**为什么 DeepSeek 做 fallback 而非主力：**

- 成本更低、国内直连、OpenAI 兼容——做 **provider failover**（Qwen 超时/限流/出错时自动切 DeepSeek）几乎零成本。
- 不放主力，是因为「中文教育语境自然度」和「结构化输出的 schema 一致性」上 Qwen 略稳；
  作为降级链第二棒，"够用且极便宜"是它最大的价值。

**为什么 OpenAI 只做兜底、不做主力：**

- 结构化输出确实最严（strict JSON Schema 有合规保证），但**国内不可直连**——
  团队在国内、验收要求"至少真实调用一种模型"，主力不能建立在"需要代理"的前提上。
- 仅当最终部署在 Vercel 海外节点、且 Qwen/DeepSeek 在某类边角输入上 JSON 不稳时，临时启用做"结构化兜底"。

---

## 3. 接入设计（同仓 TS，无 Python）

### 3.1 统一 Provider 接口

两个 LLM 用途收敛成一个接口，底层 provider 可换：

```ts
// src/llm/types.ts
import type { CandidateConditions, ConditionGap } from '../decision/types';
import type { RankedCandidate } from '../decision/types';

export interface BuildConditionsResult {
  conditions: Partial<CandidateConditions>; // 可能还没凑齐 → gaps 驱动追问
  gaps: ConditionGap[];                      // 缺项/冲突项
  raw: string;                               // LLM 给用户的人话（含追问）
  provider: string;                          // 'qwen' | 'deepseek' | 'openai'
}

export interface LLMProvider {
  /** ① 对话建条件：多轮对话 → 抽取/补全 CandidateConditions + 缺项追问 */
  buildConditions(input: {
    history: { role: 'user' | 'assistant'; content: string }[];
    current?: Partial<CandidateConditions>; // 已知条件，避免重复问
  }): Promise<BuildConditionsResult>;

  /** ② 推荐理由润色：引擎算完后，把"为什么推荐"说成人话（可关） */
  polishReason(card: RankedCandidate): Promise<string>;
}
```

### 3.2 用 Vercel AI SDK 包 OpenAI 兼容 provider（Qwen / DeepSeek 通用）

```ts
// src/llm/openai-compatible-provider.ts
import { createOpenAI } from '@ai-sdk/openai';
import { generateObject } from 'ai';
import { z } from 'zod';

// ① Qwen（阿里云百炼 OpenAI 兼容模式）
export const qwen = createOpenAI({
  apiKey: process.env.QWEN_API_KEY!,            // 服务端环境变量，前端拿不到
  baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
});

// ② DeepSeek（同样 OpenAI 兼容）
export const deepseek = createOpenAI({
  apiKey: process.env.DEEPSEEK_API_KEY!,
  baseURL: 'https://api.deepseek.com/v1',
});

// 用 generateObject 强制 schema → 比"提示词求它输出 JSON"更稳
const ConditionsSchema = z.object({
  province: z.string().optional(),
  year: z.number().optional(),
  score: z.number().optional(),
  rank: z.number().optional(),
  subject: z.object({
    category: z.enum(['物理类', '历史类']).optional(),
    primary: z.string().optional(),
    secondary: z.array(z.string()).optional(),
  }).optional(),
  gaps: z.array(z.object({
    field: z.string(),
    status: z.enum(['missing', 'conflict']),
    message: z.string(),
  })),
});

export async function buildConditions(history, model = qwen('qwen-plus')) {
  const { object } = await generateObject({
    model,
    schema: ConditionsSchema,
    system: [
      '你是高考升学规划助手，只负责从对话里抽取考生条件。',
      '抽不到的字段不要编造，写进 gaps 让用户补。',
      ' province/year/score/rank/subject 是硬条件，缺了必须追问。',
    ].join('\n'),
    messages: history,
  });
  return object; // → 运行时再过一道 guard，缺失硬条件就继续追问，不进引擎
}
```

### 3.3 切换 / 降级（env 驱动 + failover）

```ts
// src/llm/index.ts
export function getProvider(): LLMProvider {
  switch (process.env.LLM_PROVIDER) {
    case 'deepseek': return makeDeepSeek();
    case 'openai':   return makeOpenAI();      // 仅海外节点兜底
    case 'qwen':
    default:         return makeQwen();        // 默认首选
  }
}

// 建条件带 failover：Qwen 失败 → DeepSeek
export async function buildConditionsWithFallback(history) {
  try { return await getQwen().buildConditions(history); }
  catch (e) {
    console.warn('[llm] qwen failed, fallback to deepseek', e);
    return await getDeepSeek().buildConditions(history);
  }
}
```

**部署/密钥（对接全栈）：** 全部走 Vercel 环境变量，前端永不接触 key。
`.env.example` 留 `LLM_PROVIDER`、`QWEN_API_KEY`、`DEEPSEEK_API_KEY`、`OPENAI_API_KEY`（可选）四项。

---

## 4. 三红线落地复核

| 红线 | 本选型如何保证 |
| --- | --- |
| 只规划，不承诺录取 | LLM 只做建条件 + 理由润色；录取/概率由确定性引擎算，概率档强制标注「位次差法 + 数据年份，非预测」 |
| 官方事实 / 规则判断 / AI 建议分层 | 规则判断=纯函数；LLM 输出的理由明确标注「AI 建议层」，与官方来源（引擎带的 `source`）分层展示 |
| 最终以官方页面为准 | LLM 不生成资格规则；所有规则来自数据角色交付的机读规则表，LLM 不得改写 |

---

## 5. 验证计划（落地后自验，不空口推荐）

- [ ] **建条件**：构造 3 段真实风格中文对话（含缺位次、含"我想去江浙沪读计算机"这类偏好），断言 LLM 抽出的
      `CandidateConditions` + `gaps` 与人工标注一致；缺硬条件时不进引擎。
- [ ] **schema 合规**：连续 50 次建条件请求，统计 JSON 校验通过率（目标 Qwen ≥ 98%，DeepSeek ≥ 95%）。
- [ ] **降级链**：手动 kill Qwen key，确认自动切 DeepSeek 且不丢已抽条件。
- [ ] **理由润色**：对同一张 `RankedCandidate`（如 SEU-08 稳妥），断言理由含「位次差 + tier + 官方来源」三要素，且不含"保证录取"类禁用词。
- [ ] **成本烟测**：跑一轮完整 6 步，记录 token 消耗与费用（qwen-plus 量级应在分钱级别）。

---

## 6. 给 PM / 全栈的一句话结论

> **LLM 选 Qwen（通义千问，默认 qwen-plus）做对话建条件 + 推荐理由，DeepSeek 做自动降级，OpenAI 仅海外节点结构化兜底。
> 全部同仓 TS、Vercel AI SDK 的 OpenAI 兼容 provider 接入，密钥在 Vercel 环境变量；资格判定/概率档不碰 LLM。**
> 待 PM 确认后，MAO-12 §5 的 LLM 编排模块即可按本文件 §3 落地。

**价格以官网实时为准**（促销/版本会变）；本文件价位仅用于横向量级比较。
