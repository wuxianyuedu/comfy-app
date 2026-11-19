#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的**按文件豁免表**（EXEMPT_FILES）
/**
 * `EXEMPT_FILES` —— 「哪一条判据在哪个文件上被显式放行」的清单（ISSUE #1811）。
 *
 * 与 `ui-primitives-scope.cjs` 的按目录豁免（`EXEMPT_DIRS`）分工不同：那一份
 * 放行的是「整类目录」（`ui/` 基元自身、`hooks/` 逻辑层），这一份是**逐条落点
 * 写理由**的清单，每条都绑在某一个 P 编号上。
 *
 * 单独成文是因为它自己就有 380 行、且改动节奏与扫描面完全不同：扫描面随账目
 * 扩面（`src/lib` / `src/server` 是后加的），豁免表随每一批治理逐条增减。
 * 无副作用：只有正则与字符串。
 */

/**
 * 按文件豁免（正则 + 理由，均按仓库相对 POSIX 路径匹配）——只给**某一条判据**
 * 用，不是整目录放行；每条都必须写清「为什么这一处不属于该判据」。
 */
const EXEMPT_FILES = {
  /* P84（手搓面包屑）：工作流编辑器顶栏那份**不迁** —— 它不是「路径行」，
   * 是**页头标题本身**：首段 18px 粗体（`font-title` + `text-[18px]`，
   * 与顶栏别的标题同档）、子图段 14px + 当前段带紫色选中药丸（`border` +
   * `bg-primary-500/15`）+ 每段包 `Hint` + `title=`。
   * 迁到 `BreadcrumbPath` 只会让这些外观全部让位给基元默认（§16.2.4.2
   * 第 9 条：转换的验收标准是**渲染结果不变**），与 §16.2.4.6 里
   * 「应用级页签不接 `Tabs`」是同一类判断。 */
  P84: [
    {
      re: /^src\/components\/studio\/workflow-editor\/WorkflowEditorTopbar\.tsx$/,
      reason:
        "顶栏面包屑是**页头标题**（18px 粗体首段 + 紫色选中药丸 + Hint 包裹），" +
        "不是「路径行」；接基元会改变外观（§16.2.4.2 第 9 条）。「一段路径 A / B / 当前 C」" +
        "的通用形态本身仍由 `~/components/ui/breadcrumb-path` 收口。",
    },
  ],
  /* P67-a（Badge 绕开）的命名形态误报：判据以 `export function \w*(Badge|Chip|Tag)`
   * 为锚点（shadcn 已装基元内部的 `function AvatarBadge` / `ComboboxChip` 都**不**
   * 带 `export function`，所以那个锚点能精准避开它们）。
   * `SelectChip` 命中的是**名字里有 Chip**，而它不是徽标 —— 是 `Button` 之上的
   * **可点单选控件**：一排里选一个，语义 `role="radio"` + `aria-checked`，
   * 四种形态带各自的尺寸与圆角档（ISSUE #1423 / §16.2.4）。徽标那一族是
   * `ui/badge` 的三轴（variant × size × tone）、**不可点**。
   * 它要迁也不是迁到 Badge，而是靠 `Button`（本文件已 import 并消费）——
   * 换句话说这条判据想防的「自造徽标」在这里没有对象。 */
  P67: [
    {
      re: /^src\/components\/ui\/select-chip\.tsx$/,
      reason:
        "`SelectChip` 是 `Button` 之上的可点单选控件（role=radio + aria-checked，" +
        "四种形状档），不是徽标；名字里的 Chip 指的是「一排里选一个的可点小片」，" +
        "与 `ui/badge` 那套不可点的三轴徽标不同族（ISSUE #1423 / §16.2.4）。",
    },
  ],
  P39: [
    {
      re: /^src\/lib\/next-frame\.ts$/,
      reason: "出口自身的实现（`onNextFrame` / `afterNextPaint` 就要调 rAF）。",
    },
  ],
  P40: [
    {
      re: /^src\/lib\/browser-io\.ts$/,
      reason: "出口依赖的 IO 层 —— `copyText` 的定义就在这里（本判据数的是**调用**）。",
    },
    {
      re: /^src\/components\/ui\/use-copy-feedback\.ts$/,
      reason: "出口自身实现 —— 它当然要调 `copyText`；本判据数的是**绕过出口**的调用。",
    },
    {
      re: /^src\/components\/studio\/logs\/log-export\.ts$/,
      reason:
        "日志这一域的**转发适配**（`copyLogText`）—— 它已经把成败原样返回给 store，" +
        "反馈由 `LogPanel` 给（那才是按钮所在处）。它调 `copyText` 正是「IO 归 IO」" +
        "的分层：域适配层不该持有一份界面反馈。",
    },
    {
      re: /^src\/components\/studio\/logs\/log-store\.ts$/,
      reason:
        "同上：store 的 `copyAll` 是**纯编排**（取当前筛选的行 → 拼串 → 交给域转发），" +
        "它把 `Promise<boolean>` 向上返回，反馈落在 `LogPanel` 的按钮上。" +
        "在这一层弹提示反而是分层倒置（store 不认识界面）。",
    },
  ],
  P43: [
    {
      re: /^src\/components\/ui\/use-copy-feedback\.ts$/,
      reason:
        "出口自身的实现（`copyFailureText` 的定义处 —— 那句话本来就在这里；" +
        "本判据数的是**别处**又手写了一份）。",
    },
  ],
  P44: [
    {
      re: /^src\/lib\/text-clamp\.ts$/,
      reason:
        "出口自身的实现（`clampText` 的定义处 —— 它当然要 `slice`；" +
        "本判据数的是**别处**又切了一刀）。",
    },
  ],
  P45: [
    {
      re: /^src\/lib\/retry-policy\.ts$/,
      reason:
        "出口自身的实现（`backoffDelayMs` 的定义处 —— `2 ** attempt` 就在这里；" +
        "本判据数的是**别处**又算了一份退避）。",
    },
  ],
  P46: [
    {
      re: /^src\/lib\/time-format\.ts$/,
      reason:
        "出口自身的实现（`formatDate` 的定义处 —— `getFullYear()` 就在这里；" +
        "本判据数的是**别处**又拼了一份日期串）。",
    },
  ],
  P47: [
    {
      re: /^src\/lib\/media\/mime-ext\.ts$/,
      reason: "出口自身的实现（那张表当然就在这里；本判据数的是**别处**又记了一份）。",
    },
  ],
  P48: [
    {
      re: /^src\/lib\/is-record\.ts$/,
      reason:
        "出口自身的实现（`isRecord` / `asRecord` 的判据就在这里；" +
        "本判据数的是**别处**又写了一遍）。",
    },
  ],
  P49: [
    {
      re: /^src\/lib\/safe-name\.ts$/,
      reason: "出口自身的实现（那两条 `replace` 就在这里；本判据数的是**别处**又写了一遍）。",
    },
  ],
  P53: [
    {
      re: /^src\/lib\/keyboard\.ts$/,
      reason:
        "出口自身的实现（键名归一就在这里；本判据数的是**别处**又拿 " +
        "`event.key` 与字面量比了一次）。",
    },
    {
      re: /^src\/components\/ui\/simple-key-handler\.ts$/,
      reason: "出口自身的实现（它当然要读 `event.key`；本判据数的是调用处又手写键判别）。",
    },
    {
      re: /^src\/components\/ui\/use-enter-commit\.tsx?$/,
      reason:
        "`enterCommit` 是**输入框**那条账（§16.2.4.29）：它要判 IME（`isComposing` / " +
        "`keyCode === 229`）与 Shift 排除 —— 那是「按这个键算不算提交」的域判据，" +
        "`simpleKeyHandler` 的「这个键叫什么」表达不了。两者共用 `~/lib/keyboard` 的归一。",
    },
    {
      re: /^src\/components\/ui\/use-hotkey\.ts$/,
      reason:
        "`useHotkey` 是**全局监听**那条账（§16.2.4.23）：它判的是修饰键组合" +
        "（`mod` / `metaKey` / `ctrlKey`）与 `document` 上的生命周期，" +
        "不是元素上的那一个 `onKeyDown`。",
    },
  ],
  P54: [
    {
      re: /^src\/lib\/log\/log-ansi\.ts$/,
      reason:
        "出口自身的实现（SGR 的两条正则与横幅色板就在这里；本判据数的是**别处**" +
        "又写了一遍转义符）。",
    },
  ],
  P55: [
    {
      re: /^src\/lib\/case-token\.ts$/,
      reason:
        "出口自身的实现（那条 `replace(/[A-Z]/g, …)` 就在这里；本判据数的是**别处**又写了一遍）。",
    },
  ],
  P50: [
    {
      re: /^src\/lib\/number-format\.ts$/,
      reason: "出口自身的实现（`fixed` 的 `toFixed` 就在这里；本判据数的是**别处**又写了一遍）。",
    },
  ],
  P51: [
    {
      re: /^src\/lib\/ordered-set\.ts$/,
      reason:
        "出口自身的实现（`compareText` 的 `localeCompare` 就在这里；" +
        "本判据数的是**别处**又写了一遍）。",
    },
  ],
  P52: [
    {
      re: /^src\/lib\/media\/data-url\.ts$/,
      reason:
        '出口自身的实现（`data:` 前缀与 `indexOf(",")` 就在这里；' +
        "本判据数的是**别处**又写了一遍）。",
    },
  ],
  P56: [
    {
      re: /^src\/lib\/path-display\.ts$/,
      reason:
        "出口自身的实现（`path.relative` / 反斜杠归一 / 取末段的三条判据就在这里；" +
        "本判据数的是**别处**又写了一遍）。",
    },
    {
      re: /^src\/lib\/media\/mime-ext\.ts$/,
      reason:
        "那是**扩展名解析**（§16.2.4.51 的 P47 出口），不是展示 —— `extOfPath` / " +
        "`stemOfPath` 的「取最后一段」要的正是 `split().pop()` 的语义：" +
        '`"a/b/"` 这种**目录形态**必须给出空段（拿它当文件名会多出一层），' +
        "而 `~/lib/path-display` 的 `lastSegments` 刻意跳过空段（展示层" +
        "不希望显示成 `a//b`）。两者对空段的判据不同，硬合会把一处的语义" +
        "带进另一处。",
    },
    {
      re: /^src\/components\/ui\/media-drag-source\.tsx$/,
      reason:
        "`displayNameFromUrl` 是**这一处自己的**出口（媒体拖拽载荷的显示名）：" +
        "它的判据是「最后一段为空就回退到整串」—— `/a/b/` 取末段给空串、" +
        "于是回退到 URL；而 `~/lib/path-display` 的 `lastSegments` 会跳过空段" +
        "给出 `b`。两者对空段的判据不同（这条已有用例钉住），不属于「路径展示」。",
    },
  ],
  P58: [
    {
      re: /^src\/lib\/with-timeout\.ts$/,
      reason: "出口自身的实现（两个 race 就在这里；本判据数的是**别处**又写了一份）。",
    },
  ],
  P59: [
    {
      re: /^src\/lib\/clamp\.ts$/,
      reason:
        "出口自身的实现（本条账的全部语义决定 —— 非有限数取 `min`、" +
        "先夹后整 —— 都写在 `clamp` / `clampInt` 里；" +
        "本判据数的是**别处**又写了一份）。",
    },
  ],
  P60: [
    {
      re: /^src\/lib\/upper-token\.ts$/,
      reason:
        "出口自身的实现（`upperToken` 的定义处 —— 它当然要 `trim` 再 `toUpperCase`；" +
        "本判据数的是**别处**又写了一份）。",
    },
  ],
  P61: [
    {
      re: /^src\/lib\/app-events\.ts$/,
      reason:
        "出口自身的实现（`emitAppEvent` 的定义处 —— 它当然要 `new CustomEvent`；" +
        "本判据数的是**别处**又裸写了事件名 / 自建了事件）。",
    },
  ],
  P42: [
    {
      re: /^src\/lib\/error-message\.ts$/,
      reason:
        "出口自身的实现（`errorText` 的定义处 —— 它当然要拼那个冒号；" +
        "本判据数的是**别处**又拼了一份动作前缀）。",
    },
    {
      re: /^src\/lib\/llm\/server\.ts$/,
      reason:
        "`describeFetchFailure` 是**域诊断**而不是「动作 + 详情」两段式：它的" +
        "前缀里带 `（${base}）`（用户要看到是哪个 Base URL 出的问题），" +
        "且按 undici 错误码分了四档各不相同的人话 —— 那四句是域判据，" +
        "`errorText` 的两段式表达不了。本文件已改用 `errorMessage` 取详情" +
        "（原先的裸 `e.message` / `String(e)` 已收口），这正是本判据要的那一半。",
    },
  ],
  P41: [
    {
      re: /^src\/server\/lib\/request-body\.ts$/,
      reason: "出口自身的实现（`readJsonRecord` 的定义处，它当然要调 `req.json()`）。",
    },
    {
      re: /^src\/lib\/is-record\.ts$/,
      reason: "同上：`isRecord` 的定义处（本判据数的是**别处**又写了一份）。",
    },
  ],
  P24: [
    {
      re: /^src\/app\/api\//,
      reason:
        "服务端路由里的 `.text()` 是**读 fetch 响应体**（`res.text()`），" +
        "不是「读用户选的文件」；服务端也拿不到 `File`（与 P12 跳过 app/api 同款）。",
    },
  ],
  P12: [
    {
      re: /^src\/app\/api\//,
      reason:
        "服务端路由（SSE 心跳 / 轮询）里的 setInterval 是**服务端定时器**，" +
        "与「视图轮询」不是同一件事，也不在 React 生命周期里。",
    },
  ],
  P13: [
    {
      re: /^src\/app\/api\//,
      reason:
        "服务端路由的查询参数归一化与「视图搜索框」不是同一件事 —— " +
        "它没有 UI 归一化那层契约，且这里是服务端物（与 P12 跳过 app/api 同款）。",
    },
  ],
  P20: [
    {
      /* 只放行 `use-hotkey.ts` 本身——它是这条账要收口的唯一出口、必须自己挂
       * keydown。此前放行整片 `ui/` 让 `json-viewer.tsx` 钻了口子（一直手拼
       * `window.addEventListener("keydown", onKey)` 而不 import useHotkey），
       * 2026-09-25 修 `json-viewer` 时同步把豁免面收窄。若后续在其它基元里
       * 出现"这个基元自身就该挂 keydown"的正当需求，按文件逐个补进来并写明
       * 理由。 */
      re: /^src\/components\/ui\/use-hotkey\.ts$/,
      reason: "`use-hotkey` 自身就是这条账要收口的唯一出口。",
    },
  ],
  P23: [
    {
      re: /^src\/components\/studio\/canvas\/CanvasSettingsPanel\.tsx$/,
      reason:
        "画布设置面板里的 `SliderRow`：标签行是**标签与当前值左右并排**" +
        "（左边「细线透明度」、右边实时读数），而 `FormField` 的标签行是" +
        "「一行标签 + 下方控件」的块级形态。套上去会把那个并排的读数挪走，" +
        "改掉渲染结果（§16.2.4.2 第 9 条）。控件是 `ui/range-slider`，" +
        "已经不在本判据的照管范围内。",
    },
  ],
  P27: [
    {
      re: /^src\/components\/studio\/project-canvas\/CanvasNode\/hooks\/use-workflow-modes\.ts$/,
      reason:
        "失败时**必须回滚本地模式状态**（`setModes(modes ?? …)`，否则节点上留下" +
        "「僵尸模式章」），而回滚要用到 `catch` 现场那个 `modes` 快照 —— " +
        "把它挪进 `runAsyncAction` 的 `action` 里会让回滚读到已经改过的新值。" +
        "本判据管的是「文案怎么归一、报到哪」，这一处的**域判据在 catch 现场**，" +
        "所以文案仍走 `errorMessage`（同一枚口径），只是不经过出口的编排。",
    },
    {
      re: /^src\/components\/studio\/project-canvas\/hooks\/use-history-panel\.ts$/,
      reason:
        "取数失败要按**作废守卫**决定报不报（`guard.commit(…)` —— 卸载或" +
        "切筛选后到达的旧响应不该往界面上写任何东西，包括错误文案），" +
        "而那条判据表达的是**非失败状态**（这一轮作废），" +
        "`runAsyncAction` 的 `action` 与 `catch` 都在它外面，表达不了它。" +
        "守卫本身已走唯一出口 `~/lib/stale-run`（§16.2.4.34），" +
        "这里豁免的只是 P27 那一条 —— 两者管的是不同的事。",
    },
    {
      re: /^src\/app\/\(main\)\/settings\/hooks\/use-settings-page\.ts$/,
      reason:
        "`openComfy` 的动作里有**多分支的域判据**（未运行 → 一条带可执行动作的" +
        "提示；探测结论 `embed` / `blocked` → 各自的 `decision.detail`；" +
        "失败后**无论如何**都要刷新状态行）。三支各说各话、且都带 `await` 的" +
        "副作用，挪进出口会把 `guard` / `finally` / `successText` 三处钩子都" +
        "占满 —— 比留在原地更难读。该文件其余的 12 条动作已全部走出口。",
    },
  ],
  P66: [
    {
      re: /^src\/components\/ui\/use-reentrancy-lock\.ts$/,
      reason: "出口自身的实现（`lockedRef` 就是这把闸门 —— 本判据数的是**别处**又自建了一份）。",
    },
  ],
  P63: [
    {
      re: /^src\/lib\/page-window\.ts$/,
      reason: "出口自身的实现（三族窗口的算式就在这里；本判据数的是**别处**又写了一遍）。",
    },
    {
      re: /^src\/lib\/path-display\.ts$/,
      reason:
        "那是**路径展示**的取末段（§16.2.4.60 的 P56 出口）：`lastSegments` 的" +
        "判据是「按**段**切」而不是「取最后 N 条」—— 它要处理 `a/` 这种尾段为空的" +
        "形态，与「取尾部 N 条元素」不是同一件事（同款边界已在 P56 里写清）。",
    },
  ],
  P10: [
    {
      re: /^src\/components\/studio\/workflow-library\/CustomNodesSettings\/NodePreviewCard\.tsx$/,
      reason:
        "自定义节点预览卡：头部是一条「取自 category」的实色色带（inline style " +
        "画底 + 白字徽标），刻意镜像 ComfyUI 节点卡外观，与 disclosure 的" +
        "「一行文字 + 折叠标记」不是一个形态；换基元会改掉那条色带的渲染契约" +
        "（§16.2.4.2 第 9 条：验收标准是渲染结果不变）。",
    },
  ],
};

module.exports = { EXEMPT_FILES };
