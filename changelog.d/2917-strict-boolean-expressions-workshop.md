## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 14：
  `src/components/workshop` 清零（84 处 / 23 份）**（ISSUE #2776 / #2917）：
  工坊一整屏 —— 视图（FinalComposer 13、ShotStudio 13、VideoStudio 10、
  VideoStudio.parts 7、ExtractToolbar 7、StoryboardPlanner.parts 4、
  CharacterPortraitStudio 2、ShotFilmStrip 2、CharacterDesigner 1、
  DraftIntegrityHint 1、ExtractModelSelect 1、LLMContext 1、
  ModelAdaptersView 1、WorkshopStageBody 1）、业务 hook
  （use-workshop-generation 5、use-workshop-pipeline 4、
  use-workshop-pipeline-effects 3、use-workshop-agent 2、
  use-character-flows 1、useStoryboardExtractFlow 1、useStoryboardPlanner 1）
  与测试（WorkshopHeader.health.test 1、ModeContractEditorView.test 2）。
  - 口径与前几批一致：草稿字段一族（`imageUrl / clipUrl / taskId /
    clipTaskId / dialogue / loraName`，皆 `z.string().optional()`）统一
    `!== undefined && !== ""`（否定 `=== undefined || === ""`）；
    `string | null`（`describeUnmatchedIssues` / `describeDraftIssues` /
    `getActiveId` / `notice`）显式 `!== null && !== ""`；可选链落
    `boolean | undefined`（`Record<string, boolean>` 下标）→ `=== true`；
    纯 string 参与 `&&` 造成的 union 不一致真值（`name && includes(...)`）
    → `name !== "" && ...`；nullable number 长度判断 →
    `draft !== null && draft.inputs.length > 0`。
  - 收窄保活写法两处一族：`loraChar?.loraName` 三元真分支还要读
    `loraChar.loraStrength`，改写为
    `loraChar !== undefined && loraChar.loraName !== undefined && !== ""`
    （TS 不从可选链比较收窄）；`progress?.label` 先收局部变量
    `progressLabel` 再双判。
  - 验证：`src/components/workshop` 该规则复测 0 残留（改完后重拉复核）；
    `tsc --noEmit` 全量通过（顺带修正批 13 一处收窄回归，见
    studio-misc 片段）；该目录 27 份测试 155 用例全绿。
  - 剩余总量 416 处 / 173 份（components 147：studio 直下 85、ui 51、
    其他 11；tests 142；app 115；config 9；trpc 2；tools 1），分布见
    `log/tools/sbe-remaining-2026-11-02.md`。
