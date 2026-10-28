<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/product/pipeline-stages.md`。改动请回源文件，再重新生成。 -->

# 创作流水线六阶段规格（Pipeline Stages）

> 本文件是**创作主链路的唯一验收基准**：剧本 → 角色 → 分镜 → 生图 → 生视频 → 合成，
> 每阶段写「目标 / 输入输出契约 / 人的用法 / AI 的用法 / 质量验收口径 / 当前状态 / 已知缺口 /
> 代码落点」。做某一阶段的功能前先读对应节，做完按「质量验收口径」自检。
>
> 阶段顺序的**唯一出处**是代码 `src/components/workshop/stage-config.ts`（六阶段常量），
> 本文件的六节与它一一对应；改顺序先改代码再改本文件（需求与实现不一致的处置见
> [README §4](README.md) 第三条）。
> 需求编号与状态在 [feature-catalog.md](feature-catalog.md)（`FR-WP` 能力 /
> `FR-QA` 质量 / `FR-AG` AI 操作者），本文件不另立编号。

## 0. 通用口径（六阶段共用）

| 口径 | 内容 |
| --- | --- |
| **双操作者** | 同一阶段的同一份状态与产物，**人**（界面）与 **AI**（自主 run / MCP）都能读写，不能有两套真值。人的界面改了镜头，AI 接着跑必须看到改动；反之亦然（MCP 会话已接同一份真值：会话绑定 proj_*、内容权威读在 production，`FR-AG-01` · #2482） |
| **产物可追溯** | 每一阶段的输出都能追到它是哪一次生成来的（`taskId` / seed / 工作流 ID / 模型与参数快照），换机器重跑要能复现 |
| **推荐流不是闸门** | 阶段导航允许跳步与回改（`FR-WP-02`）；缺素材给提示，不阻断 |
| **失败有出口** | 任一阶段失败：能看见原因、能重试、能只重跑失败的那一镜（不牵连已完成的） |
| **持久化** | 阶段产物落本地草稿 + 服务端镜像（`FR-WP-05`），关掉应用不丢 |
| **质量验收口径** | 写成能跑命令 / 能指路径 / 能在界面上指到的形态，不写「效果好」这类不可判的词（README §5.4） |

**当前整体状态**：六阶段界面链路已上线（`FR-WP-01`），AI 侧端到端自主成片为
**灰度**（`FR-WP-07` 服务端编排 / `FR-WP-08` 自主 run）；**「多剧集」这一层尚未结构化**
（见 `FR-SR`）。

---

## ① 剧本（Script）

| 项 | 内容 |
| --- | --- |
| **目标** | 把一句话创意（或已有文本）变成一份**可拆场景**的剧本：有标题、类型、基调、 logline 与分段正文 |
| **输入契约** | `ProjectMeta`（标题 / 类型 / 基调）+ `idea`（一句话创意）；也可直接手写或导入 Markdown |
| **输出契约** | `scriptMarkdown`（正文 Markdown）；服务端编排另解析出 `Scene[]`（场景列表，供分镜阶段消费） |
| **人的用法** | 工坊阶段①：填创意 → 生成 / 手写 / 导入 → 就地编辑成稿 |
| **AI 的用法** | MCP `workshop_generate_script` / `workshop_set_script`；自主 run 的第一步 `generate_script`，以及剧本质量闭环（`FR-QA-07`④ · #2478）：`review_script`（rubric 维度评分）→ 不达标时 `revise_script`（按低分维度定向改写，旧版留档）→ 复评，有界收敛（`REVIEW_MAX_RETRY` + 分数阈值） |
| **质量验收口径** | ① 产物能被下游**自动拆出** `Scene[]`（拆不出 = 剧本不可用）；② 类型 / 基调进入后续所有阶段的提示词构造（`src/lib/workshop/prompt-builder.ts`），改剧本后重跑分镜，镜头描述必须随之改变；③ 产物**内在结构**有效：拆出的 `Scene[]` 非空、每场景有可定位的标题与正文、类型 / 基调字段非空（LLM 生成不具跨次确定性，验收不依赖「重跑两次结果一致」） |
| **当前状态** | 已上线（`FR-WP-01` / `FR-WP-03` / `FR-WP-04` 两条通道：本地 ComfyUI 工作流 / API 直连） |
| **已知缺口** | ~~无剧本评审环节~~ 已闭环（`FR-QA-07`④ · #2478：`run.reviewScript` / `run.reviseScript` + 引擎闭环 + 工坊「AI 评审剧本」入口）；人的「通过 / 否决」裁决（快照 = 剧本内容指纹，人通过豁免 AI 评审、否决拉回循环）见 `FR-QA-08` · #2480；剧本与「集」结构无关（多集剧本无容器，见 `FR-SR-03`）；改写留档只保最近 3 版（`scriptReview.revisions`），无完整版本对比与回退 |
| **代码落点** | `src/components/workshop/ScriptGenerator.tsx`；编排侧场景解析 `src/server/workshop/orchestrator.ts`；自主 run `src/server/agent/run-engine.ts` |

---

## ② 角色（Character）

| 项 | 内容 |
| --- | --- |
| **目标** | 从剧本抽出**稳定可复用**的角色卡：身份一致、外观可复现，是全片一致性的锚点 |
| **输入契约** | `scriptMarkdown` + `StyleRef[]`（风格参考） |
| **输出契约** | `Character[]`：稳定身份字段、外观与服装描述、风格标签、正 / 负提示词、生成参数、定妆照候选 + 选中的 `portraitUrl` |
| **人的用法** | 工坊阶段②：抽取角色 → 逐个编辑 → 生成 / 上传定妆照 → 选定一张作为该角色的视觉锚 |
| **AI 的用法** | MCP `workshop_extract_characters` / `workshop_set_characters`；自主 run 的 `extract_characters`（**当前只生成角色文本，不出定妆照**） |
| **质量验收口径** | ① 每个角色有且仅有一张**生效定妆照**（`portraitUrl`），缺锚定时下游生图给出可见提示；② 同一角色在**不同镜头**里被引用时，`characterIds` 一致且参考图同源（换镜头不该换脸）；③ 角色卡改动后重跑生图，结果图必须变化（证明角色卡真的进了提示词） |
| **当前状态** | 已上线（角色卡 + 定妆照上传 `FR-WP-06`）；**一致性只到「参考图」这一层** |
| **已知缺口** | 无「角色 ↔ LoRA / 模型」绑定（LoRA 只能由所选工作流内部承载）；无跨集角色库（`FR-SR-03`）；AI 自主链路不产定妆照；**视觉一致性评审未实现**（`src/server/agent/review.ts` 只评审文本，等后续多模态能力；由 `FR-QA-07` 承接，#2479） |
| **代码落点** | `src/lib/workshop/types.ts`（`Character`）；`src/components/workshop/WorkshopStageBody.tsx`；参考图上传与注入 `src/lib/workshop/generation-client.ts` |

---

## ③ 分镜（Storyboard）

| 项 | 内容 |
| --- | --- |
| **目标** | 把剧本拆成**可执行的镜头表**：每镜有景别、描述、提示词、运动、时长、转场与出场角色 |
| **输入契约** | `scriptMarkdown` / `Scene[]` + `Character[]` + `StyleRef[]` |
| **输出契约** | `Shot[]`：场景关联、`characterIds`、景别、描述、提示词、运动、时长、转场，以及后续阶段回填的 `status` / `taskId` / `imageUrl` / `clip*` 字段 |
| **人的用法** | 工坊阶段③：一键规划 → 逐镜编辑（含增删、改顺序、改时长与转场）→ 带入下一阶段 |
| **AI 的用法** | MCP `workshop_build_storyboard` / `workshop_set_storyboard`；自主 run 的 `plan_storyboard` |
| **质量验收口径** | ① 每镜都能指到一个场景，且**出场角色都在 `Character[]` 里**（指向不存在的角色 = 红）；② 提示词由场景 + 角色卡 + `skill` 风格模板拼出（`src/lib/workshop/prompt-builder.ts`），改任一输入重跑，提示词必须变化；③ 镜头时长之和与成片目标时长在同一个量级（时长全为空或全为 0 = 分镜不可用）；④ 镜头表可导出、可回读（不丢顺序） |
| **当前状态** | 已上线（`FR-WP-01`）；支持批量编辑 |
| **已知缺口** | 镜头是 **JSON 列**（`production.shots` / `workshopDraft.shots`），不是独立实体 ⇒ 无法按镜头建索引、做跨集复用与版本（`FR-SR-03`）；无分镜**预览图 / 草图**（跳过了「先画再出图」的廉价试错层）；无镜头级审批停点（AI 侧） |
| **代码落点** | `src/components/workshop/useStoryboardPlanner.ts`；`src/lib/workshop/types.ts`（`Shot`） |

---

## ④ 生图（Image）

| 项 | 内容 |
| --- | --- |
| **目标** | 把每个镜头变成一张**可用的关键帧**：风格统一、角色可辨、构图符合景别 |
| **输入契约** | `Shot` + 所属 `Scene` / `Character[]`（定妆照）+ `StyleRef` + 工作流或 API 通道 + 参考图 + `seed` |
| **输出契约** | 回填 `Shot.status` / `Shot.taskId` / `Shot.imageUrl`，产物落盘并在产出视图可见 |
| **人的用法** | 工坊阶段④：选工作流 / 通道 → 单镜或批量生成（项目内批量并发上限 2）→ 不满意可固定或换 seed 重出 |
| **AI 的用法** | MCP `workshop_generate_image`；自主 run 的 `render_images` + 可选 `review_shots` |
| **质量验收口径** | ① 镜头按 `characterIds` 收集**选中的定妆照**（至多两张）上传为 `referenceImages`，生图请求里能查到该字段；② `seed` 可固定：同一 seed + 同一工作流 + 同一参考图重跑，产出图一致（复现性；**本地 ComfyUI 通道**判此条，API 直连通道在上游声明同 seed 确定性时才判）；③ 失败只重跑失败那一镜，已完成的不被动；④ 每张图都能从产出 / 历史追回 `taskId` 与参数快照 |
| **当前状态** | 已上线（本地 ComfyUI 通道 `FR-WP-03`）；API 直连通道 `FR-WP-04` 已上线，**远端生图**运行时未接（`FR-LM-06` 计划中） |
| **已知缺口** | 无「抽卡 N 选 1」的自动优选（依赖视觉评审 + 评分阈值，`FR-QA-04`④）；无角色 ↔ LoRA 绑定；失败重试：任务级**原样重跑**已落地（#2481：`task.retry`，历史页「重试」直调）；**带修改的重跑**已落地（#2483：历史详情图片产物可放大重出 / 画蒙版局部重绘，`parentId` 追溯，模板取自用户工作流库）；不合格重生成走 `FR-QA-07` 的 gacha / reprompt |
| **代码落点** | `src/components/workshop/ShotStudio.tsx`；参考图注入 `src/lib/workshop/generation-client.ts`；编排 `src/server/workshop/orchestrator.ts`；视觉评审 `src/server/agent/review.ts`（`reviewShotImage`）+ 生图 rubric `src/lib/production/review-rubrics.ts`（`shotImage`） |
| **视觉评审（#2479 · P8-2）** | 已落地：LLM 层加多模态消息形态（`src/lib/llm/server.ts` 的 `messagesToWire`，OpenAI content 数组 / Ollama images 二选一，按 provider）+ 视觉模型通道（`getVisionLLMConfig`，可配远端 `kind=image` 模型或回落主模型）；生图后按生图 rubric（与提示词对齐 / 角色一致性 / 构图景别 / 画面瑕疵）**看图打分**，判定写回 `shot.imageReview`（与文本 `shot.review` 分开）；自动 run 的 `review_shots` 升级为「文本 + 图」双裁判——图没过 = 不过，不合格走 gacha / reprompt，达 `REVIEW_MAX_RETRY` 上限转人工（`FR-QA-07`⑤） |
| **人工裁决与评分（#2480 · `FR-QA-08`）** | 已上线：产物评分 / 收藏落 `taskImage.humanRating` / `isFavorite`（历史页 `ImageFeedbackRow` + `task.setImageFeedback`）；人工裁决**快照式**（镜头 = `rev`、剧本 = 内容指纹），人通过且新鲜 → 定稿豁免 AI 评审，人否决且新鲜 → 拉回评审循环（达上限保留；人改内容后裁决自然失效）；校准读数（人评 0~5 → 1~5 映射 vs AI 维度分的 MAE / 一致率 / 按维度偏差，`review-calibration.ts` 只读纯函数）内嵌镜头评审弹窗 |

---

## ⑤ 生视频（Video）

| 项 | 内容 |
| --- | --- |
| **目标** | 把关键帧变成**可剪的镜头片段**：运动符合分镜、时长符合设定、首尾帧可控 |
| **输入契约** | `Shot.imageUrl`（作首帧）+ 提示词 + `duration` / `motion`；工作流封装支持多参考图与首 / 尾帧端口 |
| **输出契约** | 回填 `Shot.clipTaskId` / `Shot.clipStatus` / `Shot.clipUrl` |
| **人的用法** | 工坊阶段⑤：选视频工作流 → 单镜或批量提交 → 轮询状态、看片段 |
| **AI 的用法** | MCP `workshop_submit_video` / `workshop_poll_video`；自主 run 里**没有独立的视频阶段**——`render_film` 一步把「逐镜视频 + ffmpeg 成片」合并触发 |
| **质量验收口径** | ① 首帧确实是 `Shot.imageUrl`（图生视频链路成立，不是文生视频另起一张）；② `clipStatus` 有终态且失败可单独重跑；③ 片段时长与分镜设定一致（差一个数量级 = 参数没传进工作流）；④ 成片前所有镜头的 `clipUrl` 都非空（缺一个都不该进合成） |
| **当前状态** | 已上线（图生视频，工坊内）；**自主 run 缺独立视频阶段与审批停点**，是 `FR-AG-02` 的头号缺口 |
| **已知缺口** | 无视频**一致性**机制（同一角色的运动 / 光影跨镜不连续）；无首尾帧跨镜衔接；无片段级审批（人不能在中途否掉一条片段）；批量视频的失败重试口径未成文 |
| **代码落点** | `src/components/workshop/VideoStudio.tsx`；合并触发 `src/server/agent/run-engine.ts` |

---

## ⑥ 合成（Compose）

| 项 | 内容 |
| --- | --- |
| **目标** | 产出**可交付的成片文件**（MP4）：镜头按序、时长可控、带字幕与 BGM |
| **输入契约** | 完整 `Shot[]`（含 `clipUrl`、时长、转场）+ 成片参数（尺寸 / fps / 字幕 / BGM） |
| **输出契约** | 服务端链路落 `generated/films/<id>.mp4` 并回写项目 `clipUrl` / `rendered` |
| **人的用法** | 工坊阶段⑥：时间线预览 → 改时长 / 转场 → 导出合成清单；**真出 MP4 走「成片」视图**（`film`：建片 / 逐镜 / 起跑 / 取消） |
| **AI 的用法** | MCP `workshop_compose_final`（写 `data/workshop-compositions`，可选 ffmpeg）；自主 run 的 `render_film` 走服务端 `film` 实体链 |
| **质量验收口径** | ① 两条链路的**产物与实体不同**这一点在文档与界面上都写清楚（工坊⑥ = 清单；`film` = 真 MP4），不混用；② 服务端合成做了逐镜归一化 + concat + 字幕 + BGM 混音，产出文件能播、时长等于各镜之和（含转场）；③ 合成失败能定位到「哪一镜没就绪」；④ 成片落盘路径可寻址、可打开（`FR-OP-05`） |
| **当前状态** | 两条链路均**已上线**：服务端 ffmpeg 合成 `FR-OP-04`；工坊⑥清单已上线（`FR-WP-01`） |
| **已知缺口** | 工坊⑥**不产 MP4**（界面已补「去成片合成 MP4」出口：导出清单后引导跳「成片」视图，该视图能从活跃项目读镜头并一键成片；出口缺失这条缺口已闭环，见 #2476）；MCP 的 `compose_final` 与 `film` 实体链是**两套落盘**，机器面与界面面不能互通；无字幕自动生成与校对；无 BGM 素材管理；无成片**质量校验**（黑帧 / 静音 / 分辨率不符无人判） |
| **代码落点** | `src/components/workshop/FinalComposer.tsx`（清单）；`src/server/film/orchestrator.ts` + `src/server/film/compose-film.ts`（真合成）；`src/server/workshop/final-compose.ts`（MCP 侧） |

---

## 7. 阶段间衔接（一句话）

六阶段共享同一份 `scriptMarkdown / scenes / characters / shots` 状态，衔接集中在
`src/components/workshop/hooks/use-workshop-pipeline.ts` 与 `WorkshopStageBody.tsx`；
**角色 / 分镜目前是 JSON 列而非独立实体** —— 这是「多剧集复用」与「版本管理」上不去的
根因，需求侧由 `FR-SR-03`（跨集资产复用）承接。

## 8. 关联

- 需求编号与状态：[feature-catalog.md](feature-catalog.md)（`FR-WP` / `FR-QA` / `FR-AG` / `FR-SR` / `FR-OP`）
- 需求详述：[feature-specs.md](feature-specs.md)
- 产品全局：[overview.md](overview.md)
- 功能流程图（功能方向口径）：`docs/guides/feature-workshop-flow.md`
- 术语（强制口径）：`docs/glossary.md`
