# 江苏升学数据包（江苏 · 2026 · 物理类）

> 数据角色：升学规划数据。状态：**sample（关键路径交付）**——证明「官方数据→结构化→规则→概率方法→引擎消费」链路端到端可通，并供 AI工程师/全栈/QA 直接消费。
> 三条红线：只规划不承诺录取；官方事实/规则判断/AI 建议分层；最终以官方页面为准。
> **字段契约对齐**：本数据包字段与 `src/decision/types.ts`（分支 `ai-eng/api-contract`）的 `CandidateCard` / `Rule` 一致，规则 `machine.type` 用引擎 `evaluateRule()` 实际支持的 4 种——引擎可直接 `import` JSON 消费。

---

## 1. 候选卡字段（CandidateCard，对齐 TASK-SPEC §5 + 引擎 types.ts）

每张「院校专业组候选卡」= 决策引擎最小消费单元 = 前端志愿卡。

| 字段 | 类型 | 说明 |
|---|---|---|
| `id` | string | 院校专业组唯一 id，如 `SEU-08` |
| `school.name` / `school.code` / `school.region` | string | 院校名 / **院校代号(招生代码)** / 所在地 |
| `school.level_tags` | string[] | 层次标签：`985/211/双一流/公办/民办` |
| `school.batch` | string | 批次：`普通类本科批` |
| `major_group.group_no` | string | 专业组号，如 `08` |
| `major_group.subject_requirement` | string | 选科要求**原文串**，如 `物理+化学`（引擎按串展示；结构化判据见规则表 `subject_match`） |
| `major_group.majors` | string[]? | 组内可报专业（可选） |
| `recruitment.plan` | int \| null | 拟招计划数（见 §6 粒度说明） |
| `recruitment.duration` | int | 学制（年） |
| `recruitment.tuition` | int | 学费（元/年） |
| `history[]` | array | **近 3 年**：`year / plan / min_score / min_rank / rank_diff / source` |
| `rank_diff_vs_candidate` | int | = 考生位次 − 该组**最近年(2025)**投档位次（负=优于投档线） |
| `probability_ref` | object | `{tier, pct_ref_band, method, data_years}`（见 §3） |
| `reason` | string | 一句话推荐理由 |
| `source` | object | `{url, publisher, updated, status}`（卡级，指向最近年官方投档线 PDF） |
| `caveats` | string[] | 异常提示（样本年份、位次派生、计划粒度、选科口径变化等） |

> 引擎额外字段（`plan_granularity` / `tuition_note` / `history[].source` 等）为数据侧补充，引擎按未知键忽略，不影响消费。

## 2. 选科要求（machine-checkable）

江苏新高考「3+1+2」：首选（物理/历史）+ 再选（化/生/政/地，任选2）。2024 起教育部《指引》下，理工类多数组要求 **物理 + 化学**。

- 卡片 `major_group.subject_requirement` = 规范串 `"物理+化学"`（首选 + 再选必选，`+` 连接）。
- 判据在规则表：`machine = {type:"subject_match", params:{required:["物理","化学"]}}`，引擎 `evaluateRule` 据此判定。
- **异质数据集**：不同专业组选科不同时，按各组 `subject_requirement` 生成组级 `subject_match` 规则（本样本 4 组均为物+化，故一条全局规则即适用）。

## 3. 录取概率参考方法（非预测，标注方法 + 数据年份）

**位次差法**（确定性算术，与 `engine.ts` 的 `rankDiff/probabilityRef` 完全一致）：

- `rank_diff = 考生位次 − 该组最近年(2025)投档位次`（位次数越小越好；负=考生优于投档线）。
- 分档（阈值见 `engine.ts TIER_THRESHOLDS`）：
  - 冲刺：`rank_diff >= 0`
  - 稳妥：`-1500 <= rank_diff < 0`
  - 保底：`rank_diff < -1500`
- `pct_ref_band`：参考百分比（冲刺 <40% / 稳妥 40-75% / 保底 >75%），**仅参考**。
- `method = "近3年位次差法"`，`data_years = "2023-2025"`。
- 免责：**非录取预测**，最终以官方录取为准。

## 4. 来源与可信度策略（每个数据点可追溯）

| 数据 | 官方来源 | URL（已核） |
|---|---|---|
| 投档线 2025（物理类） | 江苏省教育考试院 | https://www.jseea.cn/webfile/upload/2025/07-18/09-33-5302461102655621.pdf |
| 投档线 2024（物理类） | 江苏省教育考试院 | https://www.jseea.cn/webfile/index/index_zkxx/2024-07-18/7219509116052443136.html |
| 投档线 2023（物理类） | 江苏省教育考试院 | https://www.jseea.cn/webfile/index/index_zkxx/2023-07-18/7086888854866628608.html |
| 一分一段表 2025（位次派生） | 江苏省教育考试院 | https://www.jseea.cn/webfile/index/index_zkxx/2025-06-24/7343234265133355008.html |
| 选科要求 | 教育部 / 江苏省教育考试院 / 阳光高考 | https://www.jseea.cn/ ；https://gaokao.chsi.com.cn/ |
| 招生计划（计划数） | 江苏省教育考试院 | https://www.jseea.cn/ （计划汇编 / 志愿填报辅助系统） |
| 学费 / 招生章程 | 各校招生网 + 苏价费〔2014〕136号 | 东南 zsb.seu.edu.cn ；南理工 zsb.njust.edu.cn ；河海 + 省物价局 |

**数值层级（重要）**：
- `min_score`（投档最低分）= 官方投档线 PDF 权威值，各源一致。
- `min_rank`（最低位次）= 官方投档线 PDF **不含位次**，由「一分一段表」派生；各聚合站有约 ±300 位出入 → 一律标 `status=待官方复核`，`source.rank_via="一分一段表派生"`，以 jseea 一分一段表为准。
- 院校代号（招生代码）：东南=1102、南理工=1104、河海=1105（取自官方投档线 PDF）。

## 5. 可机读规则表（见 `rules.example.json`）

每条：`rule_id / category(选科|批次|费用|计划) / raw_text / machine{type, params} / source{url, effective_period}`。引擎 `machine.type` 仅用其实际支持的 4 种：

| rule_id | category | machine.type | params | 说明 |
|---|---|---|---|---|
| SUBJ-REQ-2024-001 | 选科 | `subject_match` | `required:[物理,化学]` | 选科资格（核心过滤） |
| BATCH-QUAL-2026-001 | 批次 | `batch` | `allowed:[普通类本科批]` | 仅本科批 |
| FEE-CAP-2026-001 | 费用 | `tuition_le` | `max:60000` | 预算/高收费(中外合作)过滤 |
| PLAN-AVAIL-2026-001 | 计划 | `plan_gt` | `min:0` | 须有当年计划 |

覆盖全部四类（验收「至少选科与批次」已超额）；每条附官方来源 + 适用周期。

## 6. 数据时点与粒度提醒

- 2026 投档线（录取结果）约 7 月下旬才公布；**志愿填报期工具不依赖当年投档线**，只用 2026 计划 + 选科 + 近 3 年(2023–2025)投档位次做参考。
- `recruitment.plan` / `history[].plan` 当前为**校·物理类招生计划总量**（如东南 2025=503、河海 2025=949），**非本组精确计划**；组级精确计划待《江苏招生计划》汇编抽取（已标 `plan_granularity`）。`plan=null` 的卡，`plan_gt` 规则暂无法全量评估（引擎按未知默认通过，需人工复核）。
- ⚠️ **选科口径变化**：河海 05 组 2023 选科为「不限」，2024 起按教育部《指引》改为「化学」；近 3 年同组对比含口径变化，2023 参考性有限（引擎按最近年 2025 判档，不受影响）。
- 年际波动：南理工 03 组 2023 位次 4396 → 2024/2025 降至 6733~7633；体现「改条件/年份随动」的必要性。

## 7. 样本清单（4 卡 / 3 所院校 / 冲刺·稳妥·保底）

示例考生：637 分 / 位次 5,200 / 物理+化学。

| id | 院校(代号) | 组 | 选科 | 近3年位次(23/24/25) | rank_diff(25) | 档 |
|---|---|---|---|---|---|---|
| SEU-06 | 东南大学(1102) | 06 | 物+化 | 2578/2297/2618 | +2582 | 冲刺 |
| SEU-08 | 东南大学(1102) | 08 | 物+化 | 5894/5644/6362 | −1162 | 稳妥 |
| NJUST-03 | 南京理工大学(1104) | 03 | 物+化 | 4396/7633/6733 | −1533 | 保底 |
| HHU-05 | 河海大学(1105) | 05 | 物+化 | 待补/11188/8837 | −3637 | 保底 |

## 8. 已完成 / 待办

- ✅ schema 对齐引擎 `types.ts`（CandidateCard/Rule）；规则用引擎 4 种 machine.type，可直接消费。
- ✅ 真实小样本：4 卡 / 3 所院校 / 冲刺·稳妥·保底全覆盖；min_score 取官方投档线、min_rank 标一分一段表派生+待复核。
- ✅ 每数据点附官方来源 URL + 更新时间 + 数据年份（卡级 source + history[].source）；概率标注方法+年份。
- ⏳ 待办：从 2023/2024 官方 PDF/一分一段表逐一核换 min_rank（消除聚合站±300 位出入）；组级精确计划数从计划汇编抽取；补 SEU-06 组 2023 投档最低分；扩样到更多院校/历史类。
