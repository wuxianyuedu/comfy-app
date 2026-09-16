## Fixed

- **工作流库：RAW 与 API 两种格式地位同等，都算可执行（ISSUE #632）**。此前「能不能跑」的判据是 `hasApi`（有没有 API 图），而导入 RAW 时服务端还会**先把它转成 API 图存进 `graph`**（ComfyUI 不可达时退回按类名猜控件顺序的启发式）。于是只有 `rawJson` 的行被当成「不可执行」——卡片挂红标、生成按钮置灰——而它其实完全能跑（`comfyui-cli` 直接吃 RAW，按节点类定义做权威转换并展开子图）。现在：① 入库**不做格式互转**，API 格式落 `graph`、RAW 落 `rawJson`，两列各自最多一份、各自可空（`src/lib/comfyui/importSource.ts`，create 路由改为共用同一条 `parseWorkflowContent`）；② 「能不能跑」= **两列任有一列有内容**，判据的唯一出处是新模块 `src/lib/comfyui/execution-shape.ts` 的 `hasExecutableWorkflow()`；③ 执行时送哪一份由 `resolveExecutionPayload()` 决定（RAW 优先走 comfy-cli），`generate` 与服务端编排共用它；④ 卡片文案改为「无可执行内容」（真两列都空时才出现），源文件页签与下载按**原件**呈现与取用（纯 RAW 行不再「graph 为空」下不下来）；⑤ 下发的 `apiOrigin` 换成 `apiSource`（只报 API 列从哪来，与可执行性无关）。

- **对外参数落点：去掉自动判定，完全依赖作者画的线（ISSUE #632）**。`resolveMapping` 此前在「作者没画线」时回落到 `autoMapEntries`——按端口名启发式给每个口猜一行，命不中再退到「该节点上第一个标量口」。猜错时用户**看不出来**：页面默认显示的落点看着就像作者自己连的，跑起来值却落到别处。现在 `autoMapEntries` 整条删除，`resolveMapping` 只认 `manualByMode`（作者画的线）；没有线就是**未配置**（卡片圆点悬空、页面如实显示），`applyParamMapping` 对「没连上的口」只下发工作流自身的默认值（外部值落不上时如实进 `unmatched`）。落点端口已改名 / 被移除的线按未配置处理，不再让线静默落空。相应地，工作流库流程图文档、`AGENTS.md` 侧的字段说明与全部相关用例一起改口径。

- **模式契约：必备口可配置，不再写死「提示词」（ISSUE #632）**。工坊「能不能驱动这条工作流」的判据此前是代码里一句 `id === "prompt"`。现在它是契约的一部分（`ModeContract.required`，缺省回落内置默认「提示词」，升级零破坏），在「模式契约」编辑器里按模式勾选；`deriveEncapsulationStatus` 的 `ready` 改为「全部必备口都有落点」，并新增 `missingRequired`（只列必备口缺落点），未配置的**非**必备口仍如实提示但不拦。契约里删掉某口时其必备标记一并清掉（留一个指向不存在口的必备项会让「缺了必备口」永远为真）。

- **删掉 `convertRawToApi`（问答确认「没用就去掉」）**。它的唯一生产消费方曾是「导入 RAW 时转出 API 图存库」，那条路取消后它就只剩零消费（`check-dead-exports` 当场拦下），其随身依赖 `resolveFullOrder` 与「带 `/object_info` 的完整输入序」一并无消费方。`raw.ts` 里保留的是**画布呈现**用的 `fallbackRawToApi`（纯离线启发式，供 `buildRawView` 从 `rawJson` 派生保留 subgraph wrapper 的视图），并在函数上方写明「不要再把它接回导入链」。`fetchObjectInfo` 与 `fetchWidgetOrderTable` 仍有消费方（COMBO 选项解析 / 画布控件顺序反查），保留。
