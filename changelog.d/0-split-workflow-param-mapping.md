## Changed

- **`src/lib/workflow/workflow-param-mapping.ts` 拆包**：主文件 1098 行超过
  §12.6 文件长度棘轮的阈值（当前基线 1093、上一批 PR-12 的 `if (!entry)`
  守卫 + 注释把它推到了 1098，是三个 900+ 行文件里唯一被 --strict 判违规的）。
  拆成两块，依赖方向**单向、无回环**：
  · **新增** `workflow-param-classes.ts`（463 行，叶子）—— **分类模型**与
  配套的判定 / 展示函数：`ParamClass` / `PinFamily` / `SIZE_CLASSES` /
  `SIZE_SUB_IDS` / `ParamEntry` / `ParamOutputPort` 6 个类型 + `CLASS_FAMILY`
  / `SIZE_SUB_IDS` 2 个 const + `nodeIdOfIoKey` / `sizeSubLabel` /
  `sizeGroupIds` / `pinFamily` / `familyOfClass` / `isSizeClass` /
  `pinAcceptsEntry` / `candidateClasses` / `isSizeDetermined` /
  `portTypeDisplay` / `sizeSubTypeDisplay` / `classPinType` /
  `paramOutputPorts` / `wiredTargetsForEntry` 共 22 个纯函数；
  · **主文件缩到 685 行** —— 只做**映射本身**：`buildParamEntries` 组装、
  `ParamMapping` 存储解析（`resolveMapping` / `parseParamMapping` /
  `serializeParamMapping` / `isDefaultMapping` / `hasManualWiring` /
  `clearModeWiring`）、`applyParamMapping` 运行时落值、
  `handleIdForIoKey` / `ioKeyForHandle` / `buildSourceOverrides` /
  `runtimeNodeId` / `sizeValueForPin` 与两个卡片布局常量。分类符号
  `export * from "./workflow-param-classes"` re-export 回来；消费者
  import 路径不变（§12.18 复用优先）。

  `SIZE_CLASSES` / `isSizeClass` / `CLASS_FAMILY` 原来是模块内私有，主文件的
  `classifyPins` 与 `sizeValueForPin` 都要用；本次一并 `export`（同文件、
  跨模块可见）。方向：main → classes → 外部（size-presets / upper-token /
  workflow-io-types / workflow-exposed-params），完全单向。
  `check-circular-deps`、`check-function-length`、`check-file-structure --strict`
  三门本 PR 涉及的 2 个文件全绿；`src/lib/workflow/**` 全 9 个测试文件、
  155 用例通过。
  类型安全审查 src/lib 报告的 M-5 条目（三个 900+ 行文件里最后一个、也是
  --strict 唯一判违规的那一个）。
