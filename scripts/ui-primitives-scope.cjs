#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的**扫描面与豁免层**（扫描根 / 目录与文件豁免 / 档位 / 硬闸清单）
/**
 * `check-ui-primitives.cjs` 的扫描面与豁免层（ISSUE #1811 拆 R5 超限文件）。
 *
 * 这一层回答「哪些目录进判据面、哪些落点被显式放行、哪些判据是硬闸、每条判据
 * 归哪一档」。它与 85 条判据的 `count` 实现（四份 `ui-primitives-rules-*.cjs`）
 * 是两件事：这边改一次要有人签字（新增豁免 / 新增目录 / 升降档），那边是「某条
 * 判据怎么数」。
 *
 * 无副作用：只有常量与 Set/正则，不读文件、不起进程。
 */

const { EXEMPT_FILES } = require("./ui-primitives-exempt-files.cjs");

const VIEW_SCAN_DIRS = ["src/components", "src/app"];

/**
 * **本批三条判据（P39/P40/P41）**额外要扫的两条根。
 *
 * 为什么不能把 `src/lib` / `src/server` 直接加进 `SCAN_DIRS`：那会顺带把
 * P1~P38 **全部**套到 lib 层上，而 lib 层里全是这些出口的**实现本身**
 * （`lib/browser-io.ts` 就是剪贴板出口、`lib/dom-rect.ts` 就是几何出口）——
 * 判据会把「出口实现自己做的事」当成违规（实测 21 处全是这种）。
 * 逐条列在这里，与 `HOOKS_ALSO_SCANNED` / `UI_ALSO_SCANNED` 同一手法：
 * 让「哪条判据扫哪一层」这件事写在明处。
 */
const LIB_SCANNED_RULES = new Set([
  "P39",
  "P40",
  "P41",
  "P42",
  "P44",
  "P45",
  "P46",
  /* 本批三条（规范 16 §16.2.4.51 ~ §16.2.4.53）：MIME 表 / 宽松对象视图 /
   * 文件名安全化 —— 三条的落点**横跨两侧**（MIME 表在 `lib/workshop` 与
   * 两条 REST 路由、宽松视图在 `lib/comfyui` 与 `lib/workshop`、文件名
   * 安全化在 `lib/safe-name` 与 `server/workshop`）。 */
  "P47",
  "P48",
  "P49",
  /* 本批三条（规范 16 §16.2.4.54 ~ §16.2.4.56）：数字精度格式化 /
   * 去重合并 / data URL —— 三条的落点**都在 `src/lib` / `src/server` 里
   * 出现**（数字精度在 `format-bytes` 与 ffmpeg 编排、去重合并在
   * `core` 与 `comfyui`、data URL 在 `lib/workshop` 与 `server/workshop`）。 */
  "P50",
  "P51",
  "P52",
  /* 本批三条（规范 16 §16.2.4.57 ~ §16.2.4.59）：键盘键判据 / SGR 转义序列 /
   * 书写法换算 —— 三条的落点**都在 `src/lib` 与 `src/server`**：
   *   · P53 的键名归一在 `lib/keyboard`；
   *   · P54 的四处里三处在 `lib/**`（日志出口、会话切分、服务端横幅）；
   *   · P55 的唯一落点在 `lib/shell/overlay-z`。 */
  "P53",
  "P54",
  "P55",
  /* 本批三条（规范 16 §16.2.4.60 ~ §16.2.4.62）：路径展示 / props 透传 /
   * 异步超时 —— 三条的落点**都横跨两侧**：
   *   · P56 的相对化 / 归一在 `src/app/api` 的三条路由与 `src/lib`；
   *   · P57 的剔除表全在 `ui/` 基元（`ui/` 是**视图层**，见 UI_ALSO_SCANNED，
   *     这里列上是为了让 `src/lib` 里的同类形态（若有）也被数到；
   *   · P58 的 race 散在 `lib/comfyui`(`status`) 与 `components/studio`。 */
  "P56",
  "P57",
  "P58",
  /* 本批三条（§16.2.4.63 ~ §16.2.4.65）：
   *   · **P59**（数值夹取）—— 「同一个数在两个面板夹到不同的区间」在视图侧
   *     （滑块 / 数值步进器）与服务端（日志切片 / 落库前夹取）同样成立；
   *   · **P60**（大写归一）—— 收口前的 26 处**横跨视图 / lib / server**
   *     （类型判定在 `workflow-io`、模式码在 `lib/workshop`、状态筛选在
   *     `server/api/routers`），且 `trim` 与否的分歧正是同一文件里发生的；
   *   · **P61**（应用事件）—— 「事件名与载荷分开两处」在视图层（订阅）与
   *     `lib`（派发）同样成立，`open-task` 的死监听就在视图层。 */
  "P59",
  "P60",
  "P61",
  /* 本批两条（§16.2.4.67 ~ §16.2.4.68）：
   *   · **P63**（分页 / 窗口切片）—— 收口前的落点**大半在 `src/lib`**
   *     （`log-store` 的倒序分页、`workflow-run-store` 的尾部窗口、
   *     `generation-log.server` 的截取、`use-runtime-log-source` 的分段上限、
   *     `executor-cli` 的 stderr 尾部）—— 只扫视图层等于对这条账的一半
   *     视而不见（与 P27「存量大部分在 hooks」是同一课）；
   *   · **P64**（进度回调节流）—— 订阅回调的落点横跨视图层与 `src/lib`
   *     的客户端转发。 */
  "P63",
  "P64",
  /* 本批两条（§16.2.4.69 / §16.2.4.71）—— 两条的落点都**横跨两侧**：
   *   · **P65**（异步动作的忙碌位）—— 收口前的 20 处里过半在
   *     `app/(main)/settings` 与 `components/studio/hooks`（逻辑层），
   *     出口 `~/components/ui/use-busy-action` 也在视图层；
   *   · **P66**（重入闸门）—— 收口前的自建闸门在 `ui/use-copy-feedback`
   *     与 `ui/use-external-action`（两个 `ui/` 基元），出口在 `lib/`。 */
  "P65",
  "P66",
]);

const SCAN_DIRS = [
  "src/components",
  "src/app",
  /* `src/lib` 与 `src/server` 加进来的理由（规范 16 §16.2.4.42 ~ §16.2.4.44）：
   * P39（等一帧）/ P40（复制之后的反馈）/ P41（入参收窄）三条账的落点**本来
   * 就横跨两侧** —— 帧调度在 `src/lib/project-canvas`，复制反馈在两处 hooks，
   * `isRecord` 的 5 份实现在 `src/lib/**`。只扫视图层等于对这三条账的一半视而
   * 不见（与 P27「存量大部分在 hooks」是同一课）。
   *
   * 这三条判据对 `src/lib/**` 与 `src/server/**` 的**全量**文本生效，但每条都
   * 自带形态约束（P39 排除帧循环、P40 只认 `copyText(` 调用、P41 只认
   * `isRecord` 定义与「`req.json()` + 400 信封」同现），不会把无关代码算进来。 */
  "src/lib",
  "src/server",
  /* `src/config` 加进来的理由（规范 16 §16.2.4.65）：应用事件表里
   * `custom-nodes:updated` 的派发侧就住在 `src/config/custom-nodes.ts` ——
   * 只扫前四条根等于让这条事件的一半落在扫描面之外（与 `src/lib` 加进来同款）。
   * 本目录只有这一个文件，且不含其余判据的形态（已实测）。 */
  "src/config",
];

/**
 * 豁免目录（正则，均按仓库相对 POSIX 路径匹配）与理由：
 *
 * - `ui/`：基元自身实现，`<button>` / portal 在这里是**正确的载体**；
 * - `hooks/`：§16.2.1 第②层，逻辑层里出现 IO/样式拼接不是「视图自己实现一份」。
 *
 * ⚠️ 这里**只剩这两条**：原先还豁免 `studio/ui/**` 与 `studio/shared/**`
 * （历史第二套 UI kit）。那批目录已按 §16.2.4 的台账归并完（`studio/ui/**`
 * 并入 `components/ui/**`，`studio/shared/**` 拆成 `components/ui/**` 的通用
 * 件与 `studio/workflow-form/**` 的表单件），所以**豁免已归还** —— 再留一条
 * 按目录的模糊放行，等于让那两处的新增自实现悄悄溜过。
 */
const EXEMPT_DIRS = [
  { re: /^src\/components\/ui\//, reason: "ui/ 基元自身实现" },
  { re: /\/hooks\//, reason: "§16.2.1 第②层（逻辑层），不算视图实现" },
];

/**
 * 「逻辑层（`<feature>/hooks/**`）也要一起扫」的判据。
 *
 * 默认豁免 `hooks/` 是因为 P1/P2/P3（手写 `<button>` / portal / spinner）
 * 数的是**视图实现** —— 逻辑层里不该出现 DOM，出现了反而是另一个问题。
 *
 * 但这几条**在逻辑层同样成立**，而且收口前的存量恰恰大部分在 `hooks/` 里
 * （P27 收口前 21 处里 19 处在 hooks）：

 *   · **P27**（异步动作的结果接到反馈通道）：设置页、工作流库、模型标签
 *     的逻辑层各自写一遍「置忙 → 调用 → catch → report」——
 *     它们**本来就不在视图里**，不扫 hooks 等于对这条账视而不见；
 *   · **P29**（手拼查询串）：网络客户端全在 `lib/**`，但域内的取数也常在
 *     `hooks/` 里拼串；
 *   · **P26 / P24 / P12 / P13 / P20 / P25** 同样已按「视图 / 逻辑层」的口径
 *     写在判据描述里 —— 它们此前能生效只是因为落点恰好不在 hooks 下。
 *
 * 因此这几条不走 `EXEMPT_DIRS` 的 hooks 豁免，逐条列在这里（口径写死，
 * 不做模糊放行）。 */
/**
 * 「`components/ui/**` 也要一起扫」的判据 —— 默认跳过 `ui/`（基元自身实现），
 * 这一条例外：
 *
 * - **P40**（复制之后给什么反馈）：`ui/json-viewer` 的「复制全部」是这条账的
 *   一个真实落点（它此前只判 `if (await copyText(...))`、没有失败分支），
 *   而 `ui/` 里其余基元也确实**不该**有复制动作。整体跳过会让出口的消费点
 *   无从校验，逐条列在这里。
 */
const UI_ALSO_SCANNED = new Set([
  "P40",
  /* P47/P48 的落点也在 `ui/` 里出现过（`ui/code-block` 自己切后缀取扩展名、
   * `ui/media-thumbnail` 收窄拖拽负载）—— 与 P40 同款：整体跳过会让出口的
   * 消费点无从校验。P49 不需要（`ui/` 里没有文件名安全化）。 */
  "P47",
  "P48",
  /* P50 在被 `ui/` 里用了（`ui/number-field` 的小数位格式化、
   * `ui/range-slider` 的读数）—— 与 P40/P47 同款：整体跳过会让出口的
   * 消费点无从校验。P51 / P52 不需要（`ui/` 里没有去重与 data URL）。 */
  "P50",
  /* P56 的落点在 `ui/` 里也出现过（`ui/media-drag-source` 取末段做显示名、
   * `ui/code-block` 的扩展名）—— 与 P40/P47 同款。
   *
   * **P57 必须一起扫 `ui/`**：这条账的全部落点本来就是基元自己
   *（`ui/media-thumbnail` / `ui/range-slider` / `ui/icon` / `ui/file-picker`）——
   * 跳过 `ui/` 等于对这条账视而不见（与 P1/P2/P3 的豁免理由相反：那三条数的是
   * 「业务侧有没有自己实现一份基元」，`ui/` 里出现是正确的载体；本条数的是
   * 「基元自己怎么写剔除表」，`ui/` 正是唯一该被数的地方）。 */
  "P56",
  "P57",
  /* 本批一条：**P59** —— `ui/` 里有本条账的真实落点（`ui/range-slider` 的
   * 填充比例、`ui/number-field` 的步进取整后夹取、`ui/use-image-zoom` 的
   * 缩放倍数）。与 P40/P47/P57 同款：整体跳过会让出口的消费点无从校验。
   * P60 / P61 不需要（`ui/` 里没有外来串归一与应用事件）。 */
  "P59",
  /* **P71 / P79 必须一起扫 `ui/`**（ISSUE #2031）：这两条数的是「视图层有没有
   * 手写调色板字面量」，而 `ui/` 是**全库唯一的样式出口层** —— 这里写死一个
   * `bg-violet-500/12`，它下面所有调用点就一起绕开了语义 token，比业务面某一屏
   * 写死一处的代价大得多。默认的 `ui/` 豁免对这两条是**错的**：那条豁免的理由
   * 是「`ui/` 是基元自己的实现、`<button>` 之类出现在这里是对的」（P1/P2/P3 数
   * 的是「业务侧有没有自己实现一份基元」），而 P71/P79 数的是**色值怎么写**，
   * 与「这一层该不该有实现」无关。
   *
   * 实测这一格此前是**真空**：`ui/` 整层被短路，于是 `task-type-chip` 的六处
   * 调色板字面量、`error-boundary` 的三处、`editable-label` 的一处、
   * `code-block` 的一处在 85 条硬闸全绿的状态下活了下来。翻进来之前先把这 11 处
   * 清到 0（判据扩展与存量清零**同批**，否则硬闸当场变红）。 */
  "P71",
  "P79",
  /* **P87 也要扫 `ui/`**（ISSUE #2031）：基元自己带背景模糊更贵 —— 它下面
   * 所有调用点一起继承那个 backdrop-filter 图层。这一条落进来时 `ui/` 里
   * 有 5 处（`settings-card` / `confirm-dialog` / `segment-popover` 各一、
   * `dialog-overlay` 的**遮罩**两处不算 —— 遮罩铺满视口、是贴边条形态），
   * 同批清零。 */
  "P87",
]);

/**
 * **只扫 `ui/` 层**的判据集合。与 `UI_ALSO_SCANNED` 对偶：
 *   · `UI_ALSO_SCANNED` = 「主战场在视图层，`ui/` 也顺带扫一下」；
 *   · `UI_ONLY_RULES` = 「这条账问的就是 `ui/` 层自己有没有绕开基元，
 *     视图层不该被算进来」。
 *
 * 为什么需要它（P67 引入）：P67 判据「`export function X(Badge|Chip|Tag)`
 * 且没 import Badge」形态的锚点在 `ui/` 里能精准命中 status-badge /
 * list-badge / source-tag / task-type-chip 四个真轮子；但视图层里
 * `WorkflowPickChip` / `NodeIdChip` / `ShotStatusBadge` 这类**消费 ui/ 基元的
 * 业务包装**用同样的命名不算轮子——不加范围收窄会误伤一片。同款理由对
 * Empty / Field 两条子判据也成立。
 */
const UI_ONLY_RULES = new Set([
  /* §16.2.3 / §12.18：ui/ 层自造组件绕开已装 shadcn 基元（Badge / Progress /
   * Slider / Empty / Field）。判据本身按形态锚点已经收窄（`export function
   * X(Badge|Chip|Tag)` 这类命名 / `role="progressbar"` / `type="range"` 属性
   * / `export function Empty\w*` 命名 / `<label htmlFor>` + `aria-describedby`），
   * 视图层里出现同样形态**本就不该**——那是 P1/P16 的账；让 P67 只在 ui/ 里
   * 跑，避免与视图层判据重复计数、也避免误伤业务包装组件。 */
  "P67",
]);

const HOOKS_ALSO_SCANNED = new Set([
  "P12",
  "P13",
  "P20",
  "P24",
  "P25",
  "P26",
  "P27",
  "P28",
  "P29",
  "P30",
  "P31",
  /* 本批三条（规范 16 §16.2.4.36 ~ §16.2.4.38）：
   *   · **P33**（生成唯一 id）：收口前的 6 处里有 2 处在 hooks
   *     （`use-workshop-agent` 的对话条目与工具运行记录）——
   *     「同一时刻的两条会不会撞 id」在逻辑层同样成立；
   *   · **P34**（报错 → 建议）：词表若写在 hooks 里，一样会与视图侧漂移；
   *   · **P35** 不在此列：它数的是「亲手拼一个画布节点对象」，
   *     逻辑层里的落点（`use-canvas-drop`）本来就在扫描范围内、
   *     也不需要跨 hooks 生效 —— 但**放进来无害且更一致**：
   *     画布节点的创建逻辑天然住在 hooks 里。 */
  "P33",
  "P34",
  "P35",
  "P36",
  "P37",
  "P38",
  "P39",
  "P40",
  "P41",
  "P42",
  "P43",
  "P44",
  "P45",
  "P46",
  "P47",
  "P48",
  "P49",
  /* 本批三条（规范 16 §16.2.4.54 ~ §16.2.4.56）：
   *   · **P50**（数字精度）—— 逻辑层里的落点本来就有
   *     （`use-workflow-import` 的体积提示、设置页 hook 的耗时文案）；
   *   · **P51**（去重合并）—— 「去重键是什么」在逻辑层同样成立；
   *   · **P52** 不在此列：它的落点全在 lib / server（没有 hooks 里的）。 */
  "P50",
  "P51",
  /* 本批三条（规范 16 §16.2.4.63 ~ §16.2.4.65）：
   *   · **P59**（数值夹取）—— 逻辑层里的落点本来就有
   *     （`use-material-library` 的搜索防抖窗口夹取、画布缩放 hook）；
   *   · **P60**（大写归一）—— 类型判定在 hooks 里同样会漂移；
   *   · **P61**（应用事件）—— 收口前的订阅侧**大部分在 hooks**
   *     （`use-history-list` / `use-canvas-connections` / `use-workflow-library`），
   *     与 P27「存量大部分在 hooks」是同一课。 */
  "P59",
  "P60",
  "P61",
  /* 本批三条（规范 16 §16.2.4.66 ~ §16.2.4.68）：
   *   · **P62**（事件值改写样板）—— 逻辑层里同样会写
   *     （`use-...` 的取数表单与草稿改写）；
   *   · **P63**（分页 / 窗口切片）—— 收口前的落点就有在 hooks 里的
   *     （`use-runtime-log-source` 的分段上限）；
   *   · **P64**（进度回调节流）—— 收口前的存量**大部分在 hooks / 视图**。 */
  "P62",
  "P63",
  "P64",
  /* 本批一条（规范 16 §16.2.4.62）：**P58** —— 「给一个异步结果加超时」
   * 在逻辑层同样成立，且收口前的落点里就有一处在 hook 里
   *（`use-workflow-detail-loader` 的 `withTimeout`）。 */
  "P58",
]);

/* ── 分档与硬闸清单 ──────────────────────────────────────────────── */

/* ── 分层：判据按「它守的那件事有多稳」分两档 ──────────────────────────
 *
 * ISSUE #1747 的第二问：这样一个 85 条判据、4800 行的脚本能不能分层 ——
 * 「最基础的基元（几乎不怎么改动的）放一层，频繁改动的放一层」。
 *
 * ## 先把「分层」这个词的三种含义分开
 *
 * 用户说的「分层」落在哪一层，决定了它**能不能省时间**：
 *
 *   · **按执行顺序分层**（先扫便宜的、贵的放后面）—— 省不了。判据是硬闸，
 *     命中即阻断，**每一条都必须跑到**；跳过任何一条就是「判据宣称在跑、实际
 *     没有执行者」（§13.5.12 那一族）。
 *   · **按代码归属分层**（基础基元 / 业务视图）—— 也省不了，见下。
 *   · **按「同一份输入被重复算了多少遍」分层** —— **这才是真正白付的那一层**：
 *     84 条判据各自 `stripComments(text)`，同一份文本被剥 84 遍。
 *     实测（1070 份源文件）：逐条现剥 **8.6s**，按文本缓存 **0.4s**。
 *
 * 所以这次落地的是**两件事**，两件都对着「分层」这个词的一种真实含义：
 *
 *   ① **预计算层**（`stripCommentsCached`，见上方那条）—— 把「剥注释」从
 *      「每条判据各算一次」提成「每份文本算一次」。这是**唯一**能改掉
 *      O(判据 × 文件) 的地方，实测 5.4s → 0.88s（6 倍）；
 *   ② **判据分档**（本段）—— 把 85 条判据按「它守的那件事稳不稳」分成
 *      `CORE`（基元层）与 `SURFACE`（业务面）两档，**档位只影响报告与
 *      诊断的输出组织，不影响判据强度**。
 *
 * ## 判据分档为什么改不了耗时（这一点必须写在明处）
 *
 * 「基础基元几乎不改 ⇒ 那一层可以少跑」这个推论**不成立**：判据守的是
 * *视图层有没有自己实现一份*，而**新写一份自实现可能落在任何一个文件里**
 * —— 基础层稳定恰恰意味着「有人在业务面里重新长出一个轮子」是唯一还在
 * 发生的形态。少跑基础档 = 对「有人再写一个 `<button>`」完全失明。
 *
 * 因此分档**只**做两件事，且两件都不放松判据：
 *   · `--report` 与失败输出**按档分组**（85 条一眼看得出「响的是哪一层」）；
 *   · 分档本身受机器约束 —— 每条 rule id 必须**恰好**落在一档里，
 *     新增判据忘记登记时直接报错（不许有「没档位的判据」这一档存在）。
 *
 * ## 档位怎么分（轴 = 出口的稳定度，不是「代码在哪个目录」）
 *
 * · **CORE（基元层）** —— 答的是「**视图层有没有绕过那个已经建好的基元**」：
 *   出口是 `ui/` 组件或 `lib/` 里已被反复固化的小工具，形态在半年尺度上
 *   几乎不动（`<button>` 永远是 `<button>`、`animate-spin` 永远是那个类名）。
 *   这一档的判据一旦清了就是 0，改动它的动因通常是「换了基元本身」。
 * · **SURFACE（业务面）** —— 答的是「**某个领域里正在长的样板**」：出口常常
 *   刚建不久（P84 面包屑、P85 表格、P86 页头就是近几批接上的零引用基元），
 *   形态还会随业务调整。这一档是**新增判据的入口**：先在这里冻结、清完升硬闸。
 *
 * 两档都是硬闸、都要跑；差别只在「它是地基本身，还是地基之上刚长出来的一层」。
 *
 * ## 一条排版纪律（为什么形状不能写成数组字面量）
 *
 * 档位表**不能**写成「一个 id 占一行、行首两格引号」的形态：
 * `tests/check-ui-primitives.test.ts` 的 `demoteToRatchet()` 靠
 * `\n  "P1",` 这个**行形状**在源码里定位并摘掉 `HARD_GATE_RULES` 的登记项。
 * 档位表若逐行写成同一形状，那个正则会先撞上这里、摘错行（实测：7 条棘轮
 * 机制用例因此全红）。所以这里每档写成一行逗号分隔的字符串 —— 同一份数据、
 * 另一种排版，让「按行形状找」的既有工具够不着。
 */
const RULE_TIER_IDS = {
  /* 基元层：出口是已固化的基元 / 小工具，形态长期不动。
   * 分组只为可读，顺序即 `--report` 里的输出顺序。 */
  CORE: [
    /* 「四种基本元素」：按钮 / 浮层 / 加载态 / 滚动条外观。 */
    "P1",
    "P2",
    "P3",
    "P4",
    "P9",
    /* 浏览器能力的地基：剪贴板 / 下载 / 文件选择 / 显示占位。 */
    "P5",
    "P6",
    "P7",
    "P8",
    /* 「一格开关 / 一段折叠 / 一个浮层列表」这类结构件。 */
    "P10",
    "P11",
    "P15",
    "P16",
    "P17",
    "P18",
    "P19",
    "P23",
    "P36",
    /* 挂钩与生命周期：轮询 / 快捷键 / 滚动 / 展开集合 / 忙碌位 / 重入闸门。 */
    "P12",
    "P14",
    "P20",
    "P21",
    "P26",
    "P30",
    "P37",
    "P65",
    "P66",
    /* `lib/` 里的固化小工具：归一化 / 展示 / 换算 / 夹取 / 去重。 */
    "P13",
    "P22",
    "P24",
    "P25",
    "P27",
    "P28",
    "P29",
    "P31",
    "P33",
    "P38",
    "P39",
    "P40",
    "P42",
    "P43",
    "P44",
    "P45",
    "P46",
    "P47",
    "P48",
    "P49",
    "P50",
    "P51",
    "P52",
    "P53",
    "P54",
    "P55",
    "P56",
    "P57",
    "P58",
    "P59",
    "P60",
    "P61",
    "P62",
    "P63",
    "P64",
    /* `ui/` 层自身的「绕开已装基元」。 */
    "P67",
    /* 表单元素与样式 token：`<input>` / `<label>` / `aria-pressed` /
     * `space-y-*` / `dark:palette` / `size-*` 都是 tailwind 与 shadcn 的
     * 内建约定，不随业务漂；治理清零后升的硬闸。 */
    "P68",
    "P69",
    "P70",
    "P71",
    "P72",
    "P73",
    "P77",
    "P78",
    "P79",
    "P80",
    "P81",
    "P82",
    "P83",
    "P87",
    /* 服务端与跨端的固化出口：入参收窄 / 错误信封 / 报错建议 / 画布节点。 */
    "P41",
    "P32",
    "P34",
    "P35",
  ],
  /* 业务面：出口多为近几批才接上的零引用基元，形态随业务走。 */
  SURFACE: [
    /* P75 空态卡（`border-dashed` + 圆角 + 文案的整块形态）。 */
    "P75",
    /* P76 裸 `<select>` —— 出口 `SelectMenu` 自身仍在扩口（id / aria-* 转发）。 */
    "P76",
    /* P84 / P85 / P86 是 §16.2.4.72 与 §16.2.4.73 同批接上的
     * `breadcrumb-path` / `table` / `page-header`，此前全库零引用。 */
    "P84",
    "P85",
    "P86",
  ],
};

/** 硬闸判据：清零后直接阻断新增，不进棘轮基线（P4~P38 属此类）。 */
const HARD_GATE_RULES = new Set([
  "P4",
  "P5",
  "P6",
  "P7",
  "P8",
  "P9",
  "P10",
  "P11",
  "P12",
  "P13",
  "P14",
  "P15",
  "P16",
  "P17",
  "P18",
  "P19",
  "P20",
  "P21",
  "P22",
  "P23",
  "P24",
  "P25",
  "P26",
  "P27",
  "P28",
  "P29",
  "P30",
  "P31",
  "P32",
  "P33",
  "P34",
  "P35",
  "P36",
  "P37",
  "P38",
  "P39",
  "P40",
  "P41",
  "P42",
  "P43",
  /* 本批三条（§16.2.4.51 ~ §16.2.4.53）：
   *   · **P47**（MIME 表）—— 「扩展名与 MIME 对不上」在浏览器侧同样成立
   *     （上传前按 MIME 猜后缀、渲染前按后缀猜 MIME）；
   *   · **P48**（宽松对象视图）—— 收口前一份就住在 `hooks/` 里
   *     （`use-param-wiring` 的 `isPlainRecord`）；
   *   · **P49**（文件名安全化）——「把用户给的字符串变成文件名」在逻辑层
   *     同样危险（下游按名字判种类）。 */
  "P47",
  "P48",
  "P49",
  /* 本批三条（§16.2.4.54 ~ §16.2.4.56）：
   *   · **P50**（数字精度）—— 「同一个值在两个面板长得不一样」在浏览器侧
   *     同样成立（滑块读数 vs 节点值单元格）；
   *   · **P51**（去重合并）—— 「排不排序 / 按哪个字段去重」在视图层
   *     同样会漂移（画布 chip 的候选列表 vs 下拉框）；
   *   · **P52**（data URL）—— 读取侧的 `character-portrait-client`
   *     就跑在浏览器里。 */
  "P50",
  "P51",
  "P52",
  /* 本批三条（§16.2.4.57 ~ §16.2.4.59）：键盘键判据 / SGR 转义序列 /
   * 书写法换算 —— 三条的落点**都在 src/lib 与 src/server**：
   *   · P53 的键名归一在 `lib/keyboard`；
   *   · P54 的四处里三处在 `lib/**`；
   *   · P55 的唯一落点在 `lib/shell/overlay-z`。 */
  "P53",
  "P54",
  "P55",
  /* 本批三条（§16.2.4.60 ~ §16.2.4.62）：
   *   · **P56**（路径展示）—— 「同一个文件在不同面板显示成三种样子」在浏览器侧
   *     与服务端同样成立，且两侧必须同一口径；
   *   · **P57**（props 透传）—— 落点全在 `ui/` 基元，那正是这条账该被数的地方；
   *   · **P58**（异步超时）—— 「定时器谁来清」在浏览器侧（tRPC 取数）与
   *     服务端（ffmpeg / 中介进程）同样会漏。 */
  "P56",
  "P57",
  "P58",
  /* 本批三条（规范 16 §16.2.4.63 ~ §16.2.4.65）：数值夹取 / 大写归一 /
   * 应用事件 —— 三条的落点**都横跨两侧**：
   *   · P59 的 19 处里大半在 `lib`（`progress` / `number-format` /
   *     `log-session-scope` / `workshop` / `server/film`）；
   *   · P60 的 26 处里过半在 `lib`（`workflow-param-mapping` /
   *     `model-mode-contract` / `media/size-presets` / `comfyui/workflow-detail-io`）；
   *   · P61 的派发侧在 `lib/project-canvas`（画布仓库变更广播）。 */
  "P59",
  "P60",
  "P61",
  /* 本批三条（§16.2.4.66 ~ §16.2.4.68）：事件值改写样板 / 分页与窗口切片 /
   * 进度回调节流 —— 三条都按**形态**取锚点，且每条都配反面用例。 */
  "P62",
  "P63",
  "P64",
  /* P70（shadcn styling.md「No space-x-N / space-y-N」）：2026-09-24 一次治理
   * 把全库 107 处 space-y-N 清零，从此是硬闸——新增即阻断。 */
  "P70",
  /* P72（shadcn composition.md「Dialog/Sheet always need a Title」）：
   * 2026-09-25 一次治理把视图层 9 处真漏清零（8 DialogContent + 1 SheetContent
   * 既无 Title 组件又无 aria-label），从此是硬闸——新增即阻断。
   * `ui/` 走 EXEMPT_DIRS 短路，基元自身实现不受本判据影响。 */
  "P72",
  /* P73（shadcn composition.md「Use Separator instead of <hr> or <div
   * className="border-t">」）：视图层自闭合 `<div>` + `border-{t|b|l|r}`
   * 是手搓的分隔线、应走 `~/components/ui/separator` 的 `<Separator>`。
   * 本会话内一次治理 4 处清零（`SectionHeader.tsx:24` /
   * `GroupedControls.tsx:103` / `IoEndpointsSection.tsx:58,66` · 全是
   * `flex-1 border-t border-dashed` 类虚线填充线 · 迁 Separator +
   * `border-dashed bg-transparent h-0/h-px` 保留原视觉）、直接进硬闸。
   * 锚点与"只数自闭合 div"的具体形态见 RULES 里 P73 项的注释。 */
  "P73",
  /* P80（shadcn styling.md「Use size-* when width and height are equal」）：
   * 引入时视图层实测 91 处，跨 7 批治理 + 一次锚点假阳修 一次性清零
   * （#1015 #1016 #1017 #1018 #1019 #1022 + 本 PR），升为硬闸。
   * `size-N` 是 tailwind 内建、与 `w-N h-N` 视觉完全等价、迁移零风险，
   * 与 P70 同款（space-y/x→gap 也是治理清零后升为硬闸）。 */
  "P80",
  /* P79（shadcn styling.md 原则 4 · 无 dark: 前缀的浅色原色板）：
   * #1009 引入时视图层实测 67 处，八批治理（#1065 #1066 #1073 #1076
   * #1079 #1082 #1085 #1087 · 覆盖 38 文件）清零 → 本 PR 升为硬闸。
   * 路径两条：状态色走 §3.6.2 统一状态映射（bg-success/bg-primary/
   * bg-destructive/bg-info/bg-warning），brand 双色渐变与域装饰色走
   * `// p71-allow:start …` 就地声明（P71/P79 共享一份 allow · 见
   * stripP71AllowBlocks）。 */
  "P79",
  /* P76（shadcn forms.md · 视图层裸 `<select>`）：
   * #1001 引入时视图层实测 11 处（10 文件），五批治理（#1057 #1059 #1062
   * #1064 + 本 PR）全部走 `~/components/ui/select-menu` 的 `<SelectMenu>`
   * 基元清零 → 本 PR 升为硬闸。SelectMenu 已扩 `id` / `aria-*` 转发口、
   * 支持 `<FormField>` render prop 场景；剩余若确有非走 SelectMenu 不可的
   * 特殊形态（比如原生 select 的 size= 属性），走 `EXEMPT_FILE_PATTERNS`
   * 按文件粒度登记 + 说明理由。 */
  "P76",
  /* P77（shadcn forms.md · 视图层手写 `aria-pressed=`）：
   * #1007 引入时视图层实测 7 处（6 文件），六批治理清零：#1034 RgthreeBodies
   * 单按钮 `<Button aria-pressed>` → `<Toggle>`；#1051 FilmStudio/
   * SizePresetTableModal 单选组 → `<ToggleGroup multiple=false>`；#1054
   * LogFilterBar/UsageTestDialog → `<ToggleGroup>`（broken-value 语义通过
   * value=[trim()] 保留 · level-specific 色在 item className 里）；本 PR
   * LlmLocalSection 混合多选 chip（非互斥）→ 每项独立 `<Toggle>`。
   * 视图层新增手写 `aria-pressed=` 直接阻断、走基元。 */
  "P77",
  /* P78（shadcn forms.md · 视图层裸 `<label>`）：
   * #1006 引入时视图层实测 33 处（22 文件），十批治理清零：#1030 ExitSection
   * + ComfyuiSection + UpdateCheckSection（htmlFor 独立行）· #1032 三处日志
   * 面板自动滚动 · #1035/#1038/#1040/#1047 各类字段行 · #1089 WorkshopAside
   * 字段行 · #1092 AttributeMultiSelect `<label role="option">` 改回
   * `<div role="option">` + 外层 listbox（错的 ARIA 语义）· 本 PR 无新降。
   * 视图层新增裸 `<label>` 直接阻断、走 FieldLabel/FormField/div role。 */
  "P78",
  /* P75（shadcn composition.md · 视图层手搓空态卡）：
   * #1011 引入时视图层实测 12 处，两批治理清零：#1103 workshop 六处
   * （CharacterDesigner / FinalComposer / ShotStudio / StoryboardPlanner
   * 两处 / VideoStudio）→ `EmptyState variant="hint"`；本 PR studio /
   * model 六处（`studio/ModelLibrary.tsx` 两处 · `studio/history/HistoryList.tsx`
   * · `studio/ProjectOutputs.tsx`
   * · `studio/WorksGallery.tsx` · `model/ModelLibrary.tsx`）→
   * `EmptyState`（`page` 档为主、`minHeightClass` 与原 `min-h-[N]` 对齐、
   * `WorksGallery` 的类别装饰色块走已 allow 的 `WORKS_CATEGORY_ICON_BG`
   * 常量 · 保留视觉身份）。视图层新增手搓「border-dashed + rounded-(xl|2xl|3xl)
   * + 内文案」的空态卡直接阻断，走 `~/components/ui/empty-state` 的
   * `<EmptyState>` 或 `~/components/ui/empty` 的 `<Empty>` 基元。 */
  "P75",
  /* P81（shadcn composition.md · Button 直接子 icon 必带 data-icon）：
   * #1108 引入时视图层实测 114 处 / 51 文件，#1116 一次治理清零
   * （脚本按 `<Button…>…</Button>` 块扫直接子级的 icon-like 起始标签、
   * 注入 `data-icon="inline-start"`，含 `settings/page.tsx` 里
   * `<Disclosure trailing={…}>` 一处手工兜底）→ 本 PR 升为硬闸。
   * 深层嵌套（icon 被 span / div 包着）不属本账、判据显式不计。 */
  "P81",
  /* P71（§4.11.1 · shadcn styling.md「No manual `dark:` color overrides」）：
   * 2026-09-24 引入时视图层实测 230 处、折叠 log-level 色系统 + P13 首批
   * 治理降到 215 冻结起点；本会话 #1063~#1088 的 P79 治理批次同时把 P71
   * 一起按语义 token / `p71-allow` 例外块清零 → 本 PR 升为硬闸。视图层新增
   * `dark:<palette>-N` 直接阻断，走语义 token 或就地 `p71-allow` 声明
   * （ANSI SGR 8 色 / 品牌渐变端点 / 类别装饰色 · P71/P79 共享一份 allow）。 */
  "P71",
  /* ── 12 条 0 值棘轮一次性升为硬闸 ────────────────────────────────────────
   * 升闸的前提不是「数字是 0」，而是**那 0 数得出来**：这几条此前都带正例
   * 用例（喂一段违规代码、断言它被数到并阻断），所以 0 = 清完了，不是扫描器
   * 瞎了（P82 的教训：判据用粗锚时 78 看着像 0）。差别只在 `--update`：
   * 棘轮还能把新增量登记成「起点」，硬闸连登记都拒 —— 规范标题写着「硬闸」
   * 而判据其实是棘轮的那几条（P44/P45/P46/P65/P66）在这里一并名实相符。
   * 例外出口沿用 P71/P79 的形态：确有业务需要时**就地写 allow 标记 + 理由**，
   * 不给规则加全局豁免目录（加了它就等于没有）。 */
  "P1", // 视图内手写 <button>
  "P2", // 视图内自建 createPortal 浮层
  "P3", // 视图内自写 spinner / pulse 动画
  "P44", // 自写文本截断
  "P45", // 自写指数退避算术
  "P46", // 手拼日期串
  "P65", // 忙碌位复位写在成功路径上
  "P66", // 自建重入闸门
  "P67", // ui/ 层自造组件绕开已装基元
  "P68", // 视图层手写 <input> / <textarea>
  "P69", // 视图层手写 <input type=checkbox|radio>
  "P83", // 屏级标题不走字阶档 / h1 上硬写字号
  /* P82（shadcn composition.md · 「悬停说明走 Tooltip、不走原生 title」）：
   * #1123 引入时按粗锚冻结 78 处，治理那一批（#1135）用 TypeScript AST 复扫
   * 发现真存量是 157 处 / 69 文件 —— 粗锚 `[^>]*` 会被属性段里箭头函数的 `>`
   * 截断，`title=` 排在 `onClick={() => …}` 之后的全漏。#1135 一次清零（出口
   * 抽在 `~/components/ui/hint` 的 `<Hint>`，§12.18 补地基）→ 判据换成
   * 平衡扫描（`scanJsxAttrs` + `parseJsxProps` + 五档）并升为硬闸：**先让判据
   * 看得见全部存量，再冻结为 0**，顺序反了就会把硬闸建在看不见的存量上。 */
  "P82",
  /* 本批两条（§16.2.4.72）：**零引用基元按形态复查**接上的两个出口。
   *   · **P84**（手搓面包屑）—— 收口前 2 处（素材库抽屉 / 资源库页各一份，
   *     class 串逐字相同）本次迁到 `BreadcrumbPath`；`WorkflowEditorTopbar`
   *     那份按「外观会变、不动」豁免（见 EXEMPT_FILES.P84 的理由）。
   *   · **P85**（手写 `<table>`）—— 收口前 1 处（尺寸表弹窗），本次迁到
   *     `ui/table`；这也是 `ui/table` 全库零引用状态的第一个消费点。
   * 两条都当批清零、直接进硬闸（与 P4/P5/P6/P7/P9… 同款：棘轮那条路径只给
   * 「刚引入、存量未清」的新判据起步用）。 */
  "P84",
  "P85",
  /* P86（规范 §16.2.4.73 · 视图层手搓屏级页头）：
   * 引入时全库正好 **1 处**真存量（`src/app/(main)/models/page.tsx` 的
   * `h1.u-title-page` + 一行 `mt-1 text-sm` 副说明 + 右侧动作组 —— 它就是
   * Issue 说的「第 8 个新屏」，**不在** 那份 7 屏具名清单里，此前没有任何
   * 东西会响）。本 PR 同批迁到 `ui/page-header` 的 `<PageHeader>` 后清零、
   * 直接进硬闸（与 P84/P85 同款：存量本就只有一两处，不走棘轮那条路径）。
   *
   * 编号此前是**占了位置的未实现**：规范 16 的表里写着 P86 并标注「不进硬闸」，
   * 而 `scripts/` 对 `\bP86\b` 命中 0、脚本内最大编号 P85。本 PR 把两边对齐
   * ——判据落成实现、表里那一行改成指向它。 */
  "P86",
  /* P87（规范 03 §3.13 · 整块容器自带 `backdrop-blur`）：
   * ISSUE #2031 引入时视图层与 `ui/` 合计 **41 处 / 30 文件**，一次治理清零：
   *   · 整块不透明化并撤模糊 —— 卡片 / 弹窗 / 浮层 / 抽屉 / 提示条（它们的
   *     下面是一层带色遮罩或静止页面，模糊 0 像素效果）；
   *   · **贴边条留模糊、去半透** —— 顶栏 / 页脚 / 状态栏这几处模糊是真的
   *     （内容从底下流过），但 `bg-*` 的 85-95 档半透是没有理由的：既然模糊
   *     只在一个方向上有意义，就不该把可读性赌在另一个方向的对冲上。
   * 判据按行取锚（`backdrop-blur` 与贴边定位同现即放行），所以「贴边条」
   * 不是白名单、不会随新增屏漂移。存量清零后直接进硬闸。 */
  "P87",
]);

module.exports = {
  VIEW_SCAN_DIRS,
  SCAN_DIRS,
  LIB_SCANNED_RULES,
  UI_ALSO_SCANNED,
  HOOKS_ALSO_SCANNED,
  UI_ONLY_RULES,
  EXEMPT_DIRS,
  EXEMPT_FILES,
  RULE_TIER_IDS,
  HARD_GATE_RULES,
};
