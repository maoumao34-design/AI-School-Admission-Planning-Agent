# 江苏升学数据包（草案 · draft）

> 数据角色：升学规划数据。范围：江苏 · 2026 · 物理类（先出样本）。状态：**draft**，证明数据链路可通 + 供 AI工程师/全栈/QA 对齐字段与 API 契约。正式提交待群管理派 issue 后切分支 `data/jiangsu-2026`。
> 三条红线：只规划不承诺录取；官方事实/规则判断/AI 建议分层；最终以官方页面为准。

---

## 1. 候选卡字段（对齐 TASK-SPEC §5）

每张「院校专业组候选卡」= 决策引擎的最小消费单元，也是前端展示单元。字段：

| 字段 | 类型 | 说明 / 示例 |
|---|---|---|
| `id` | string | 院校专业组唯一 id，如 `SEU-08`（院校代号-专业组号，待用官方代号） |
| `school.name` / `school.code` / `school.region` | string | 院校名 / 院校代号 / 所在地 |
| `school.level_tags` | string[] | 层次标签：`985 / 211 / 双一流 / 公办 / 民办` 等 |
| `school.batch` | string | 批次：`普通类本科批` 等 |
| `major_group.group_no` | string | 专业组号，如 `08` |
| `major_group.subject_requirement` | object | 选科要求（见 §2） |
| `recruitment.plan_<year>` | int \| null | 该年招生计划数（待抽） |
| `recruitment.duration_years` | int | 学制，如 4 |
| `recruitment.tuition` | int \| null | 学费（元/年）；中外合作等高收费单标 |
| `history[]` | array | **近 3 年**（2023/2024/2025）：`year / plan / min_score / min_rank / rank_diff` |
| `rank_diff_vs_candidate` | int | 考生位次 − 该组投档位次（**负=优于投档线**） |
| `probability_ref` | object | 参考概率（见 §3）：`tier / pct_ref_band / method / data_years` |
| `reason` | string | 一句话推荐理由（可展开「为什么」） |
| `source` | object | 来源（见 §4）：`publisher / url / retrieved_via / updated / accessed / status` |
| `caveats` | string[] | 异常提示：样本年份、待抽字段、需按实际录取等 |

## 2. 选科要求（machine-checkable）

江苏新高考「3+1+2」：首选（物理/历史）+ 再选（化学/生物/政治/地理）。2024 起教育部《指引》下，理工类多数要求 **物理 + 化学**。

```
"subject_requirement": {
  "preferred": "物理",                 // 首选必选
  "reselect_required": ["化学"],       // 再选必选（可空）
  "reselect_options": [],              // 再选任选 N 选 M（可空）
  "raw_text": "首选物理，再选化学"      // 规则原文
}
```
引擎判据：考生首选 ∈ preferred 且 reselect_required ⊆ 考生再选。

## 3. 录取概率参考方法（非预测，标注方法 + 数据年份）

**位次差法**（确定性，不是模型预测）：
- `rank_diff = 考生位次 − 该组某年投档位次`（位次数越小越好；负值=考生优于该年投档线）。
- 分桶（**阈值可配置，参考用**）：
  - 保底：`rank_diff ≤ −1500`（考生明显优于近3年投档线）
  - 稳妥：`−1500 < rank_diff ≤ 0`
  - 冲刺：`0 < rank_diff ≤ +1500`（差距在追赶范围内）
  - 差距过大（不推荐）：`rank_diff > +1500`
- `pct_ref_band`：参考百分比区间（冲刺 <40% / 稳妥 40–75% / 保底 >75%），**仅参考**。
- `data_years`：标注用了哪几年数据；近3年齐全后可用「命中比例」细化 pct。
- 免责：**非录取预测**，最终以官方录取为准。

## 4. 来源与可信度策略

- **权威来源**：江苏省教育考试院 jseea.cn（投档线 / 选考科目要求 / 一分一段表 / 批次线，多为 PDF·表格）＋ 阳光高考 gaokao.chsi.com.cn（选科查询 / 院校专业 / 招生章程，教育部指定平台）。
- **本样本现状**：部分数值经**聚合站**（gaokao.cn / gk100 / dakao100）检索得到，已记 `retrieved_via`，`status=待官方复核`——正式集将从 jseea.cn 官方 PDF 直接抽取并替换。
- 每个数据点可追溯：`url + publisher + updated + accessed + status`；页面提供官方复核入口。

## 5. 硬条件规则表（machine-checkable，见 `rules.example.json`）

规则 = 文本规则 → 可机读判据。每条附 `rule_id / category(选科|学历|先修|费用|计划|批次) / raw_text / machine{type,params} / source{url, effective_period}`。引擎类型：`subject_match / score_threshold / flag / presence`。

## 6. 数据时点提醒

- 2026 投档线（录取结果）约 7 月下旬才开始公布；**志愿填报期工具不依赖当年投档线**，只用 2026 计划 + 选科 + 近3年（2023–2025）投档位次做参考。
- 若后续做「录取后复盘」模式，再单独接当年投档线。

## 7. 已完成 / 待办

- ✅ schema（候选卡 + 选科 + 规则 + 概率方法 + 来源）结构定稿。
- ✅ 真实小样本（3 条物理类专业组，2024 投档分/位次/选科，对齐示例考生 637/5200/物理+化学，覆盖冲刺·稳妥·保底）。
- ⏳ 待办：近3年（2023/2025）位次 + 计划数 + 学费 从 jseea.cn 抽取并替换聚合站数值；扩样到覆盖冲刺/稳妥/保底各档；选科要求表全量；规则表逐条官方来源。
