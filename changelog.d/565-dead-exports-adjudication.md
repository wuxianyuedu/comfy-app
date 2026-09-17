## Changed

- **零消费导出棘轮消费方口径收口，基线 34 → 0**（`scripts/check-dead-exports.cjs`）。判据此前只拿数量说话，而引用方范围**不含任何测试** —— 于是「同文件单测逐条锁住的纯函数」被永久判成零消费，34 条登记项绝大多数是这么攒出来的；脚本里写成注释的「测试算是消费方」从未生效（注释与判据相反，规范 §12.17 的同款教训）。现在「谁算消费方」显式成表：生产源码（`src` / `scripts` / `e2e`）算，**模块自己的测试文件**（同目录同名、`tests/<基名>`、以及**任何 import 了该模块**的测试）也算；仅「在别的测试里被提到名字」不算（那会把判据退化成「有没有人写过这个名字」）。新增 `--verify <rel>#<Symbol>` 单条精确复核 —— 清单归零后「为空」不再能证明扫描器在工作，反向锚点改由它承担。

## Removed

- **34 条登记项按 §12.15 逐条复核后清零**：接线 3、删除 31。删除的部分里最值得记的是那批「长得像基础设施」的条目 —— 判据只有一句：**留着的理由必须写得出「谁在什么时候用它」**，写不出即删（旧清单把「通用工具，落地时机未到」当理由，实测那批常量的真正写入方是脚本侧各自拼的路径，与 `log-paths.ts` 无关）。
  - 一行转发：`shouldReportReady(p) === (p !== null)`；语法糖：`hasDesktopMarker` / `isDesktopInstall`（组合调用 `classifyComfyInstall` 判 kind，唯一调用方就是它们自己）。
  - **画布那一族**：`MODEL_REGISTRY` / `defaultModelFor` / `getModelPreset` / `ModelPreset` / `ModelRegistry` / `CANVAS_STORAGE_KEY` —— 画布早已改成「选工作流库工作流」，模型注册表整族无人消费。
  - `friendlySubgraphLabel`（唯一调用方是它自己的同域单测）、`portLabel`（表里没有 translation map，只剩 `String(type).trim()`）、`asUnknownArray`、`getModelPreset` 之外的 `proc-detect` 三个链外查询函数、`writeEnvVar`（`saveSettings` 动作早已废弃并显式拒绝写 `.env`）、`killHostedChild`、`log-file-client` 两个只服务「历史日志」入口的请求（`/api/logs/list`、`/api/logs/history` 无前端消费方）、`resetSizePresetTable`（弹窗按场景恢复，没有「全部恢复」入口）、`resolutionRow`、`sceneFromText`、`flattenOptions`、`PARAM_NODE_{ROW_H,PAD_Y,DOT_SIZE,DOT_OFFSET}`、`normalizeAgentMessages` 与 `agent/types.ts` 整文件、`commitDraftProject`（`upsertProject` 的别名，唯一真实调用方直接用后者）、`runScript`（画布 `script` 节点从未接线）、`inferWorkflowTypeFromGraph`、`modeUsesControlImage`、`newScene`、`log-paths.ts` 五个「由脚本侧各自拼路径」的常量、`workflowArdot` 的调试渲染链路（该组件是「对齐设计稿的纯视觉测试节点」，无 data / 无 handlers，没有调试价值）。

## Fixed

- **三处「本应复用却自己实现」已接线**（这类死代码的危害不在占行数，在于它的存在本身在骗人）：`emptyProject()` ← 视图里手写的一份 `DEFAULT_META`（逐字相同）；`sanitizeModeValue()` ← 视图里手写的 `"text"`（同一个「坏值复位」语义，一处判损坏、一处写死复位值）；`NEXTJS_PANEL_LOG_PREFIX` ← 路由里手写的 `"nextjs-panel-"` 前缀（与命名方各写一份，改一处不会报错、只会静默分叉）。

## Added

- `tests/check-dead-exports.test.ts` 12 → 18 例：同目录同名 / 集中目录同名 / 集中目录**异名**测试各一（三种布局都要认）、「别的测试只是提到名字不算消费」的反例、`--verify` 三态（有消费 / 零消费 / 符号不存在），以及真实仓库的**反向锚点**（对被接线的符号复核必须报「有消费」）。

Ref: #565
Ref: #573
