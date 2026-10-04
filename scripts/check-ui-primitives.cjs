#!/usr/bin/env node
// @ts-nocheck -- UI 基元复用棘轮（供 .githooks/pre-commit 调用）
/**
 * UI 基元复用护栏 —— 规范见 docs/standards/16-shadcn-ui与表单校验.md §16.2.3。
 *
 * 背景（ISSUE #672「前端 ui 组件是否完善、是否符合商业级水平」）：
 * 全量扫描实测出三件事 —— ① `src/components/ui/` 有 29 个基元，业务侧只用到了
 * 寥寥几个；② 视图里手写 `<button>` 427 处、自建 `createPortal` 浮层 12 处，
 * 同一套「按钮 / 浮层」在四五个目录里各实现一份；③ 各 feature 目录都摆着
 * 「通用件」，`ui/` 反而空着。
 *
 * 这件事的难点不在「改不改」，而在**判据**：UI 一致性没有任何机器判据
 * （`scripts/` 下只有 `check-ui-logic-separation.cjs`，管的是 IO 分层，不管
 * 组件复用）。本仓库的历史结论是「只提醒 = 没有判据」（§12.13 / §12.16 同款），
 * 所以这里给的是**计数棘轮**：先把存量冻结在基线，再逐批降，只许降不许升。
 *
 * 判据（三条，都是「视图层是不是自己实现了一份基元」）：
 *   P1 视图层手写 `<button`（应使用 `~/components/ui/button` 的 `<Button>`）
 *   P2 视图层自建 `createPortal(` 浮层（应使用 `ui/dialog` / `ui/popover` /
 *      `ui/sheet` / `ui/dropdown-menu`）
 *   P3 视图文件里重复定义内联 `animate-spin` / `animate-pulse`（应使用
 *      `ui/page-loading` 的 `PageLoading`（块级）/ `Spinner`（行内 · 按钮内）、
 *      `ui/skeleton` / `ui/progress` 这类加载态基元，状态圆点的脉冲走
 *      `ui/status-dot`）
 *   —— P1~P3 起初走的是**棘轮**（按文件记账、只许降不许升，与
 *      `check-ui-logic-separation.cjs` / `check-theme-colors.cjs` 同一口径，基线
 *      `scripts/.ui-primitives-baseline.json`）。存量清零后它们与其余判据一样进了
 *      `HARD_GATE_RULES`：**现在 84 条全部须为 0**。棘轮这条路径留着，是给
 *      **新引入的判据**起步用的（先冻结存量 → 清零 → 升硬闸，顺序不能反，
 *      见 P82 那条的教训）。
 *
 *   P4 视图里再写一份 `::-webkit-scrollbar` 外观（**硬闸，不是棘轮**）——
 *      `src/app/globals.css` 是自绘滚动条的唯一出口（`.custom-scrollbar` /
 *      `.soft-scrollbar` / 全局兜底，三档取值各有出处）。视图里写任意值变体
 *      （`[&::-webkit-scrollbar-thumb]:bg-…!`）等于把同一件事再实现一份，
 *      取值还会各自漂移 —— 收口前实测到两份（`.custom-scrollbar` 的
 *      `--color-border-strong` / `--color-ink-icon` 与视图里那份
 *      `bg-border-strong` / `bg-ink-muted`）。P4 已在同批清零，因此直接是硬闸。
 *      `ui/scroll-area` 那套 base-ui 自绘滚动条属`ui/` 工具生成物，
 *      走 EXEMPT_DIRS 的 `ui/` 豁免（口径见规范 16 §16.2.4.6 第三档）。
 *
 *   P5 视图里再写一份「剪贴板写入」（**硬闸**）—— `~/lib/browser-io` 的
 *      `copyText` 是唯一出口（含 Clipboard API → `execCommand` 的降级与
 *      `navigator` 存在性判定）。此前有 4 份实现，各自的兜底写法还不一样
 *      （`opacity:0` / `left:-9999px` / 不做降级 / 静默不静默）。
 *   P6 视图里再写一份「Blob + 临时 `<a download>` 下载」（**硬闸**）——
 *      `~/lib/browser-io` 的 `downloadText` / `downloadJson` 是唯一出口。
 *      此前有 7 份实现，`URL.revokeObjectURL` 与 `click()` 的先后顺序都不统一
 *      （先 revoke 会让大文件拿到失效 URL）。
 *
 *   P5/P6 与 P4 同性质：口径是「必须为 0」，不进棘轮基线。
 *
 *   P7 视图里再写一份「隐藏 `<input type=file>` + 点谁去触发它」（**硬闸**）
 *      —— `~/components/ui/file-picker` 的 `useFilePicker` / `FilePickerButton`
 *      是唯一出口。此前 9 个落点各写一份，写法互不相同：多数用
 *      `useRef` + `ref.current?.click()`、两处用 `<label htmlFor>` 隐式关联、
 *      一处干脆把 input 露在界面上。三个共性问题只有放一处才收得住：
 *      ① `click()` 在 ref 未挂上时**静默空操作**（界面「点了没反应」）；
 *      ② 多数落点**没有复位 `event.target.value`** —— 用户连选同一个文件不触发
 *      `change`，看起来像上传坏了；③ 两个隐藏 input + 两个 ref + 两个 click 的
 *      样板在同一文件里复duplicated。
 *
 *   P9 视图里再自绘一份「模态浮层外壳」（**硬闸**）—— `ui/dialog` 的
 *      `Dialog` / `DialogContent`（居中卡片）或 `ui/sheet` 的 `SheetContent`
 *      （抽屉）是唯一出口。此前 **16 个落点**各写一份 `overlayClass("modal", …)`
 *      的容器 div，写法还分三派：① 外层带 `onClick` + 内层 `stopPropagation`
 *      （多数）；② 把遮罩写成一个**兄弟 div** 单独接 `onClick`；③ 干脆不接关闭
 *      （只能点自带的 ✕）。a11y 语义随之分叉：16 份里**只有 3 份**接了 Esc、
 *      只有 3 份声明了 `role="dialog"` / `aria-modal`，焦点锁与归还**一份都没有**。
 *
 *      ⚠️ P2 数的是「有没有用 `createPortal`」，这批**一处 portal 都没有** ——
 *      所以它在 P2 全库清零之后依然全部漏过。**判据要按形态设计，不是按 API**：
 *      这里问的是「这个文件自己拼了一份模态外壳吗」，形态锚点取
 *      「视图里出现 `overlayClass(`」（本项目顶层浮层定位的唯一出口）。
 *
 *   P12 视图 / 逻辑层里自己写 `setInterval` 轮询（**硬闸**）——
 *      `~/components/ui/use-interval` 的 `useInterval` 是唯一出口。
 *      此前 **9 处**各自 `setInterval(onDone, N)` + 清理里 `clearInterval`，
 *      写法分三族、缺陷各异：**不立刻跑一次**（挂载后先空一个间隔）、
 *      **后台标签页空转**（浏览器把后台定时器降到 ≥1min，请求照发）、
 *      **跑在已卸载组件上**（异步回调后 `setState`）。其中「前后台开关」
 *      那段还被逐字抄了两份（`use-comfy-stats` / `use-update-check`）。
 *
 *      ⚠️ 豁免：`ui/use-interval.ts` 自身（实现），以及 `/hooks/**` 之外的
 *      服务端路由（`app/api/**` 的 SSE 心跳是服务端定时器，不是「视图轮询」）。
 *
 *   P11 视图里再自绘一份「可滚动的浮层选项列表」（**硬闸**）——
 *      `~/components/ui/option-list-popover` 的 `OptionListPopover` 是唯一
 *      出口。此前画布节点上的四个 chip（`WorkflowPickChip` / `WorkflowModePickChip` /
 *      `WorkflowSourceFilterChip` / `WorkflowModelFilterChip`）各写一份**逐行
 *      同形**的浮层：触发器配一个 `▾`（`open` 时 `rotate-180`）、内容
 *      `max-h-* overflow-y-auto`、每行 `role="option"` + `aria-selected` +
 *      「选中高亮 + 勾」，而「当前项」配色四份各写各的（`violet-500/20` /
 *      `fuchsia-500/20` / `primary-soft` / `bg-accent`）。
 *
 *      ⚠️ 判据取「同一文件里既自建 `PopoverTrigger`、又自己画 `▾` 展开标记」
 *      —— 那就是「手搓 chip 浮层」。单看 `▾` 会把 `DropdownMenu` /
 *      `Dialog` 的触发器（`ProjectSwitcher` / `MetaEditor`）误判；单看
 *      `PopoverTrigger` 会把表单里的 `SelectMenu` 调用处误判。
 *
 *   P10 视图里再自绘一份「折叠 / 展开」开关（**硬闸**）—— `ui/disclosure` 的
 *      `Disclosure` 是唯一出口。此前有三套写法做同一件事：
 *      ① 原生 `<details>` / `<summary>` 六处（`ErrorPanel` ×2、
 *      `HistoryDetailModal`、`CharacterDesigner`、`CharacterPortraitStudio`、
 *      `ExtractToolbar` ×2）；② 自绘「布尔 state + 条件渲染 + `▸/▾` 或
 *      `Chevron` 切换 + 手写 `role="button"` / `onKeyDown`」四处；
 *      ③ 树形结构的 `expanded*` 映射两份。差别不是风格，而是**无障碍语义各写
 *      各的**：`<details>` 天生带 `role` / `aria-expanded` / 键盘切换 / 页内查找
 *      自动展开，自绘那份基本只有 `onClick`（`NodesTab` 还为此专门补了
 *      `role="button"` + Enter/Space —— 因为「不能嵌 button」而绕路）。
 *
 *      ⚠️ 判据按**形态**取，不按 API：数「视图里出现 `<details`」与「自绘的
 *      展开标记 `▸` / `▾` 字面量」。前者是原生写法，后者只能出现在把一段内容
 *      折起来的地方 —— 与 P9 同款教训（`createPortal` 数不到 `overlayClass`）。
 *
 *   P15 视图里再写一份「面板加宽档 + 切换钮」（**硬闸**）——
 *      `~/components/ui/wide-panel` 的 `useWidePanel` / `WidePanelToggle` 是
 *      唯一出口。三个日志面板（`LogPanel` / `GlobalStepLogPanel` /
 *      `WorkflowRunLogModal`）此前各写一份逐字同形的 `useState(false)` +
 *      两处 `wide ? W.wide : W.base` + 「收缩 / 加宽」文案与图标，且三份
 *      **都没有持久化** —— 用户加宽后关掉再打开又回到窄档。
 *
 *      ⚠️ 判据锚点取 `wide ?` 这个三元的形态（`.wide :` · `.base`），
 *      比「数 `useState(false)`」准：后者会把正常的弹窗开关全算上。
 *
 *   P14 视图里再写一份「展开集合」的读写样板（**硬闸**）——
 *      `~/components/ui/expansion-set` 的 `useExpansionSet` 是唯一出口。
 *      `NodesTab` 一棵树此前用了三份 `Record<string, boolean>`，每份配一组
 *      逐字同形的 `setX((prev) => ({ ...prev, [k]: !prev[k] }))`，外加一段
 *      **抄了两遍**的「补默认展开」（它的语义是「已有表态的键不覆盖」）。
 *
 *      ⚠️ 判据锚点取「展开集合的翻转写法」：`...prev` 与 `[key]: !prev[key]`
 *      同一处出现。单看 `Record<string, boolean>` 会把 `perPkgParsing`
 *      （在跑标记）与 `pendingLoading`（落位中标记）这类**不是折叠语义**的
 *      映射误判 —— 它们不该走 `ExpansionSet`。
 *
 *   P13 视图 / 逻辑层里再写一份「可搜索列表过滤」的归一化（**硬闸**）——
 *      `~/lib/list-filter` 的 `normalizeNeedle` / `matchesNeedle` 是唯一出口。
 *      全库 8 处各写一遍 `trim().toLowerCase()`，而 `AttributeMultiSelect`
 *      那处只写了 `trim()` —— 含拉丁字母的候选（`JK制服` / `T恤`）因此
 *      大小写敏感，用户输 `jk` 一条也搜不到。两条都编译、都运行、类型都对，
 *      差别只在这一个语义决定上。
 *
 *      ⚠️ 豁免 `src/app/api/**`：服务端路由的查询参数归一化与「视图搜索框」
 *      不是同一件事（它没有 UI 归一化的那层契约），且那是服务端物 ——
 *      与 P12 跳过 `app/api/**` 同款口径。
 *
 *   P8 视图里再写一份「值不存在时显示 `—`」的判据（**硬闸**）——
 *      `~/lib/display-value` 的 `displayValue` / `EMPTY_PLACEHOLDER` 是唯一
 *      出口。此前 31 处各写一遍，而「什么算不存在」判得都不一样：
 *      `??`（只管 null/undefined）、`||`（把 `0` 与 `""` 也当不存在 ——
 *      「步数 0」显示成「—」）、`> 0 ? x : "—"`、`!= null ? String(x) : "—"`。
 *      四者只差一两个字符，都编译、都运行、类型都对，差别只在**一个语义
 *      决定**上，散在 31 处就永远不会被统一说出来。收口后口径写在
 *      `src/lib/display-value.ts` 的文件头（`0` / `false` 是真实值不是缺值；
 *      想把 `0` 当缺值的域必须显式写自己的判据）。
 *
 *      ⚠️ 判据只管**视图**（`src/components/**`、`src/app/**`）：出口模块
 *      与 `src/lib/**` 里的域语义（如 `model-library-config.ts` 的
 *      `fmtSize` 把 0 当「未探到体积」）不在此列。
 *
 *      ⚠️ 判据只管**隐藏** input 的触发（`className="hidden"` 那类）：
 *      `FilmStudio` 的 BGM 选择器是**用户可见的表单字段**（靠 `file:` 伪元素
 *      美化、就地显示已选文件名），是另一种形态，不在此列。
 *
 *   P16 视图里自绘「进度条」的填充（**硬闸**）—— 「给一段异步动作配进度」
 *      这件事有两个出口：**数值**走 `~/lib/progress` 的 `clampPct` / `toPct` /
 *      `pctToWidth`，**形态**走 `~/components/ui/progress-bar` 的 `ProgressBar`。
 *      此前全库 **10 处**各写一遍「track div + 内层 `width: X%` + 百分比文字」，
 *      写法分四派：`Math.max(4, p)` 的可见下限、自己 `Math.min(100, done/total*100)`
 *      的比例、不夹取的 `${x}%`、以及算好的 `pct`。三条都编译、都运行，差别
 *      只在「0% 要不要留一格 / 超量要不要夹取 / 总数未知算 0 还是算不确定」。
 *
 *      ⚠️ 判据锚点取 `style={{ width: `${…}%` }}` —— 那是「自己按百分比摆宽度」
 *      这个动作本身。单看 `rounded-full` 会把所有圆角元素算进来；单看
 *      `bg-primary` 会把按钮算进来。宽度百分比是进度条的签名。
 *
 *   P17 视图里自写「键值行」（**硬闸**）—— `~/components/ui/key-value-rows`
 *      的 `KeyValueRows` 是唯一出口。此前全库 **5 处**各写一遍「标签 + 值 +
 *      空值占位」的行，四种布局语言：`ProjectOutputs` 的隔行参数表、
 *      `HistoryDetailModal` 的生成参数卡与 `<table>` 参数表、`TrainingStudio`
 *      的 Metrics 网格、`BrowserStatusBar` 的显存/内存内联项。
 *
 *      ⚠️ 判据取「一个 muted/faint 色的标签叶子元素，紧随其后出现**值的
 *      渲染器**（`displayValue(` / `JSON.stringify(` / `typeof x === "string"`）」。
 *      「空值显示什么」早由 `~/lib/display-value` 收口（见 P8）—— 所以这里
 *      数的是**布局那一层**：标签与值成对出现、值可能是任意对象。
 *      单看 `justify-between` 会把 400+ 处普通布局算进来（实测 41 处误报）；
 *      单看 `font-mono` 会把日志行算进来。两个条件必须同时成立。
 *
 *   P18 视图里裸写 `<img` / `<video`（**硬闸**）——
 *      `~/components/ui/media-thumbnail` 的 `MediaThumbnail` 是唯一出口。
 *      此前全库 **18 个文件**各自裸写 `<img>`，而**加载失败这一侧有四种写法**：
 *      `HomePage` 项目缩略图用 `event.target.style.display = "none"`（绕过 React
 *      直接改 DOM，失败的那一格留下**空洞**）、`TrainingStudio` 数据集缩略图用
 *      `style.visibility = "hidden"`（同款）、`WorkflowImagePreview` 自持
 *      `useState(failed)` + 「图片不可用」方块（写法对，但每个落点重写一遍）、
 *      `SettingsPrimitives` 同上换成长文案。**另外 14 处压根没有兜底** ——
 *      `<img>` 失败就交给浏览器画破图图标。
 *
 *      ⚠️ 判据取「视图里出现 `<img` 或 `<video` 标签」这个形态。收口后
 *      这条是硬闸（0 处）—— 单看 `onError=` 会漏掉那 14 处没有兜底的，
 *      而它们正是「同一件事在不同落点行为不同」的另一半。
 *
 *   P19 视图里自写「把一张媒体图变成可拖拽源」（**硬闸**）——
 *      `~/components/ui/media-drag-source` 的 `useMediaDragSource` 是唯一出口。
 *      `HistoryPanel` 与 `MaterialLibraryPanel` 各有网格 / 列表两个视图，**四处
 *      逐字相同**地手写 `dataTransfer.setData("application/x-comfyapp-media", …)`
 *      + `effectAllowed = "copy"` + drag 光标类；而消费端 `use-canvas-drop` 的
 *      `MediaDropPayload` 形状要靠**手抄**跟这四处保持一致（它只做 `JSON.parse`
 *      + 类型断言，形状对不上就是一次**静默丢投**）。
 *
 *      ⚠️ 判据取 `dataTransfer.setData("application/x-comfyapp-media"` 这个
 *      自定义 MIME 的字面量：它是「跨组件拖拽」的签名。单看 `draggable` 会把
 *      React Flow 节点、表单行拖拽这些**组件内**拖拽算进来（它们不跨组件、
 *      不该走这个出口）。
 *
 *   P20 视图里自写「全局快捷键监听」（**硬闸**）——
 *      `~/components/ui/use-hotkey` 的 `useHotkey` 是唯一出口。全库 6 处各自
 *      `addEventListener("keydown", …)` + 手写清理，而**修饰键的判据各不相同**：
 *      `LogProvider`（Ctrl+Shift+L）与 `UpdateCheckProvider`（Ctrl+Shift+U）
 *      只判 `ctrlKey && shiftKey` —— **macOS 的 ⌘ 按了没反应**；`json-viewer`
 *      （⌘/Ctrl+F）判了 `metaKey || ctrlKey` 却**不过滤输入焦点**（在别的输入框
 *      里也会把 ⌘F 抢走）；`ScriptMarkdownEditor`（⌘/Ctrl+S、Z）两种修饰键都判。
 *
 *      ⚠️ 判据取 `addEventListener("keydown"` / `addEventListener('keydown'`
 *      这个形态。单看 `metaKey` / `ctrlKey` 会漏掉那两处**完全没写 metaKey** 的
 *      —— 而它们才是这条账里更差的那一种（与 P13「更差的那种也要数」同源）。
 *
 *   P21 视图里自写「滚动跟随到底」（**硬闸**）——
 *      `~/components/ui/use-scroll-follow` 的 `useScrollFollow` 是唯一出口。
 *      全库 **4 处**各写一份「内容一变就把 `scrollTop` 设成 `scrollHeight`」，
 *      而**判据各不相同**：`RuntimeLogBox` 有「贴底 32px 内仍算跟随」并给出
 *      「恢复自动滚动」按钮；`GlobalStepLogPanel` / `WorkflowRunLogModal` 只有
 *      一个 `autoscroll` 布尔、**用户上滚会被按回底部**；`AgentOverlay` 连开关
 *      都没有（永远强行贴底 —— 读不到上一句 AI 回复）。
 *
 *      ⚠️ 判据取 `scrollTop = …scrollHeight` 这个**赋值形态**（两侧都要，
 *      所以「只读 `scrollHeight` 做量测」的虚拟化面板不会误伤）。单看
 *      `scrollHeight` 会把 `log-virtual` 的贴底算术、textarea 自动增高算进来。
 *
 *   P22 视图里自写「打开外部目标」（**硬闸**）——
 *      `~/lib/external-open` 的目标类型与结果归一 + `~/components/ui/use-external-action`
 *      的执行态样板是唯一出口。全库 **9 处**各写一份「set busy → mutate →
 *      `ok ? ok : err` → catch `errorMessage` → finally 清 busy」，而
 *      **结果字段不统一**（`openExternal` / `comfyOpen` / `dbStudioOpen` 读 `ok`，
 *      更新器读 `triggered`）、**空目标只有一处拦过**（其余把空串发给服务端，
 *      拿到 zod 的英文报错当用户提示）。
 *
 *      ⚠️ 判据取 `window.location.href =` 这个**外部导航**形态（自定义协议
 *      打开目录的唯一写法）。单看 `target="_blank"` / `window.open` 与
 *      「调 tRPC 打开浏览器」不是同一件事（后者走 `useExternalAction` 的调用处，
 *      形态上判不出来 —— 那由出口契约从另一侧钉）。
 *
 *   P23 视图里自写「标签 + 控件」的表单行（**硬闸**）——
 *      `~/components/ui/form-field` 的 `FormField` 是唯一出口。
 *      全库 **15 处**各写一份「`<label>` + 控件」，而三件事在**不同落点被漏掉**：
 *      `htmlFor` / `id` 关联（15 处**没有一处**关联过 —— 点标签不聚焦输入框、
 *      读屏器把标签读成孤立文本）、`aria-invalid` + `aria-describedby`
 *      （只有 1/15 处写了 `aria-invalid`、**没有一处**关联错误文案）、
 *      错误行（训练工作室只报一句整表文案，不指出是哪一行错）。
 *
 *      ⚠️ 判据取「视图里的裸 `<label`」这个形态。单看 `aria-invalid` 会漏掉
 *      那 14 处**压根没有** ARIA 标记的 —— 而它们才是这条账里更差的那一半
 *      （与 P13「更差的那种也要数」同源）。`ui/` 自身豁免（`label.tsx` 就是实现）。
 *
 *   P24 视图里自写「读文件」（**硬闸**）——
 *      `~/lib/file-io` 的 `readFileAsText` / `readFileAsDataUrl` 是出口。
 *      全库 6 处各写一遍「把用户选的 File 读成文本 / data URL」，而它们对
 *      两件事各判各的：**怎么读**（4 处 `file.text()`、2 处手搓 `FileReader`）
 *      与**读到空算不算失败**（两处 FileReader 把 `typeof result === "string"
 *      ? result : ""` 与「读失败」压成同一个 `""`，调用处只能靠 `if (!dataUrl)
 *      throw` 反推，另一处连那一步都没有）。
 *
 *      ⚠️ 判据取 `new FileReader(` 与 `<input … type="file"` **之外的**
 *      `readAs*` 调用形态（`readAsText` / `readAsDataURL` / `readAsArrayBuffer`）
 *      + `await file.text()`。单看 `FileReader` 会漏掉 `file.text()` 那一族
 *      （它们才是多数），而 `readAs*` 是 FileReader 的唯一签名。
 *      文件选择框本身不在此列（那是 P7 的账，出口是 `ui/file-picker`）。
 *
 *   P25 视图 / lib 里自写 localStorage 存取（**硬闸**）——
 *      出口是 `~/lib/browser-storage` 的六个函数，名字与理由见 §16.2.4.28
 *      （读 / 写 / 删 + JSON 变体 + 「能不能用」探测）。全库 9 个
 *      文件、十余处各写一遍「读 / 写 localStorage」，而它们对
 *      **怎么判「没有浏览器」**各判各的 —— 三种写法同时存在，
 *      在 SSR、jsdom、隐私模式下**行为不同**：只判 window 的那几处
 *      在隐私模式下会抛异常（外层 try 兜住的是另一件事）。
 *
 *      ⚠️ 判据取 `localStorage` 上那几个读写方法调用的**形态**。
 *      不看 `typeof localStorage`：那只是它的一个前置判据，
 *      而这条账里更差的一半正是「压根没判」。
 *
 *   P26 视图里自写「Enter 提交 / Esc 取消」的键位判据（**硬闸**）——
 *      `~/components/ui/use-enter-commit` 的 `enterCommit` 是出口。
 *      全库 11 处各在 `onKeyDown` 里判键，而它们对两件事各判各的：
 *      **Enter 要不要 `preventDefault`**（6 处写了、5 处没写 —— 没写的那几处
 *      在 `<form>` 里会连带提交整页，「回车新增标签」变成「回车提交整页」）、
 *      **Esc 取消要不要复位草稿**（复位是 3 处，其余留在原值）。
 *      另有 6 处 `role="button"` 元素在 `onKeyDown` 里复刻浏览器对原生按钮的
 *      默认行为 —— 那类要的是 `<Button>`（P1 的账），本判据够不着它们。
 *
 *      ⚠️ 判据取 `onKeyDown` 里判 `"Enter"` 这个**形态**，且**只看输入类控件**
 *      （`<input` / `<textarea` / `<Input` / `<Textarea` 在附近）。
 *      不数「挂到 window 上的全局快捷键」（那是 P20 的账）。
 *
 * ⚠️ 为什么会把「内联 animate-spin」也算进来：它不是「样式问题」，而是
 * 「这个加载态本该复用基元」。单独看每一处都「没毛病」，全库一起才看得出
 * 有 19 份自写 spinner —— 与 §12.12「跨文件重复块」是同一族问题。
 *
 * 豁免（显式，不做模糊放行）：
 *   · `src/components/ui/**`      基元自己的实现（Button 里本来就是 `<button>`）；
 *   · `<feature>/hooks/**`        §16.2.1 第②层（逻辑层），不是视图；
 *   · `*.test.*` / `__tests__/**` 测试里的 DOM 与 mock 不算视图实现。
 *
 * 用法：
 *   node scripts/check-ui-primitives.cjs            # 检查（84 条硬闸全部须为 0）
 *   node scripts/check-ui-primitives.cjs --strict   # 基线下调也失败（强制收紧）
 *   node scripts/check-ui-primitives.cjs --report   # 只出清单，不判失败（排批次用）
 *   node scripts/check-ui-primitives.cjs --update   # 只给**新引入的棘轮判据**登记起点
 *                                                  # （硬闸未清零时直接拒绝，不写基线）
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const BASELINE = path.join(__dirname, ".ui-primitives-baseline.json");

/* ── 扫描范围 ────────────────────────────────────────────── */

/** 棘轮作用域：视图层（组件 + 路由页面）——与 UI/逻辑分离棘轮的 RATCHET_DIRS 同口径。 */
/** 视图层两条扫描根（P1~P38 的既有范围）。 */
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
   * 安全化在 `lib/comfyui/trainer` 与 `server/workshop`）。 */
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

 *   · **P27**（异步动作的结果接到反馈通道）：设置页、工作流库、模型标签、
 *     训练工作室的逻辑层各自写一遍「置忙 → 调用 → catch → report」——
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
  P39: [
    {
      re: /^src\/lib\/next-frame\.ts$/,
      reason: "出口自身的实现（`onNextFrame` / `afterNextPaint` 就要调 rAF）。",
    },
  ],
  P40: [
    {
      re: /^src\/lib\/browser-io\.ts$/,
      reason:
        "出口依赖的 IO 层 —— `copyText` 的定义就在这里（本判据数的是**调用**）。",
    },
    {
      re: /^src\/components\/ui\/use-copy-feedback\.ts$/,
      reason:
        "出口自身实现 —— 它当然要调 `copyText`；本判据数的是**绕过出口**的调用。",
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
      reason:
        "出口自身的实现（那张表当然就在这里；本判据数的是**别处**又记了一份）。",
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
      reason:
        "出口自身的实现（那两条 `replace` 就在这里；本判据数的是**别处**又写了一遍）。",
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
      reason:
        "出口自身的实现（它当然要读 `event.key`；本判据数的是调用处又手写键判别）。",
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
      reason:
        "出口自身的实现（`fixed` 的 `toFixed` 就在这里；本判据数的是**别处**又写了一遍）。",
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
      reason:
        "出口自身的实现（两个 race 就在这里；本判据数的是**别处**又写了一份）。",
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
      reason:
        "出口自身的实现（`readJsonRecord` 的定义处，它当然要调 `req.json()`）。",
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
      reason:
        "出口自身的实现（`lockedRef` 就是这把闸门 —— 本判据数的是**别处**又自建了一份）。",
    },
  ],
  P63: [
    {
      re: /^src\/lib\/page-window\.ts$/,
      reason:
        "出口自身的实现（三族窗口的算式就在这里；本判据数的是**别处**又写了一遍）。",
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

/** 某文件是否被指定判据豁免。 */
function isExemptFile(id, rel) {
  return (EXEMPT_FILES[id] ?? []).some((e) => e.re.test(rel));
}

/* ── 三条判据 ────────────────────────────────────────────── */

/**
 * 去掉 `//` 行注释与 `/* … *\/` 块注释（保留换行，便于定位）。
 *
 * **为什么判据必须先过这一层**：注释里描述「本组件渲染一个 `<button>`」、
 * 「原来是 `<button>` 手写实现」是**说明**，不是视图实现。不剥注释时，把一处
 * 手写按钮改成 `<Button>` 并把理由写进注释，会让该文件的计数**停在原地**
 * —— 棘轮于是永远降不下去，而代码其实已经合规。
 * （同款教训见 `scripts/check-theme-colors.cjs` 的 `stripComments`：
 * 注释里的 `#346` ISSUE 引用被误判成 3 位色值。）
 *
 * 字符串/模板字面量**不**剥离：`"<button"` 出现在字面量里同样是「自己实现
 * 一份」的信号，保守计上更安全（NUL 哨兵那类反例见规范 §12.11）。
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let inBlock = false;
  let inLine = false;
  while (i < n) {
    const ch = text[i];
    const nx = text[i + 1];
    if (inLine) {
      if (ch === "\n") {
        inLine = false;
        out += ch;
      } else out += " ";
      i++;
      continue;
    }
    if (inBlock) {
      if (ch === "*" && nx === "/") {
        inBlock = false;
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }
    if (ch === "/" && nx === "/") {
      inLine = true;
      out += "  ";
      i += 2;
      continue;
    }
    if (ch === "/" && nx === "*") {
      inBlock = true;
      out += "  ";
      i += 2;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 剥掉 p71-allow:start … p71-allow:end 之间的整段（含两行标记）。
 * 供 P71 / P79 使用——§3.6.1 里 palette 字面量本身就是语义（如 ANSI SGR
 * 终端 8 色 / brand 渐变 / 媒体类型色板 / workshop 域专有装饰色），不该
 * 被 token 化。**必须在 `stripComments` 之前调用**，否则标记注释会被先
 * 抹掉、块内的 palette 字面量又会被计回来。
 *
 * 支持两种就地声明形态，覆盖 JS 与 JSX 两个上下文：
 *   · **`// p71-allow:start …`** —— 落在 JS 表达式位（`{cond && (` 之后、
 *     return 里的 JS 段等）；一行一条标记。
 *   · **JSX 注释包 `p71-allow:start …`** —— 落在 JSX 兄弟节点位（顶层 JSX
 *     元素之间），`//` 前缀会被 parse 成 JSX text 破解析、必须走 JSX 注释
 *     形式（形如：左大括-斜星-空格 p71-allow:start · 空格 斜星大括-右）。
 * 两形态在剥除阶段等价：只要匹配 `start` / `end` 关键字，前面是 `//` 或
 * `/*` 起始符都算命中。`p71-allow` 名字保留（P71 先立、P79 与之后可能
 * 的同族 palette 判据共用一份 allow，别另立 p79-allow 造成"一次标允许 ·
 * 二次标漏掉"的分裂）。
 */
function stripP71AllowBlocks(text) {
  const lines = text.split("\n");
  const out = [];
  let inBlock = false;
  for (const line of lines) {
    if (inBlock) {
      if (/(?:\/\/|\/\*)\s*p71-allow:end\b/.test(line)) inBlock = false;
      continue;
    }
    if (/(?:\/\/|\/\*)\s*p71-allow:start\b/.test(line)) {
      inBlock = true;
      continue;
    }
    out.push(line);
  }
  return out.join("\n");
}

/**
 * 数「夹取」的处数：`Math.max(` 里包着 `Math.min(`、或反过来。
 *
 * 实现是**配对扫描**而不是一个正则：正则要匹配「嵌套但深度不定」的括号，
 * 写成 `Math\.(max|min)\([^()]*Math\.(?!\1)…` 会在多层括号（
 * `Math.min(max, Math.max(min, Math.round(v)))`）上退化成漏报。
 *
 * 判据是「**两种不同**的 Math 函数嵌套」：`Math.max(1, 1 / Math.max(zoom, x))`
 * 是取值（同一个函数），不是夹取 —— 只数 max 里包 min、min 里包 max。
 *
 * 取「**最近的**一层」：从每个 `Math.max(` / `Math.min(` 的左括号开始，
 * 只看它**直接内层**（跳过嵌套括号）里有没有出现另一种 Math 调用；
 * 深层的由它自己的那一处负责数 —— 这样 `Math.round(Math.min(max,
 * Math.max(min, n)))` 只计 1 次（夹取），不重复计。
 */
function countNestedMinMax(text) {
  let n = 0;
  const re = /\bMath\.(max|min)\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const outer = m[1];
    const inner = outer === "max" ? "min" : "max";
    /* 从外层的左括号开始，扫到**它自己**的右括号为止；
     * 中途遇到 `Math.<inner>(` 即命中（该处夹取由外层负责数）。 */
    let depth = 1;
    let i = re.lastIndex;
    const innerRe = new RegExp(`\\bMath\\.${inner}\\s*\\(`, "g");
    while (i < text.length && depth > 0) {
      const ch = text[i];
      if (ch === "(") depth++;
      else if (ch === ")") depth--;
      else if (ch === "M" && depth === 1) {
        /* 只在**直接内层**（depth 仍为 1）判 —— 深一层的由那一处自己数。 */
        innerRe.lastIndex = i;
        const hit = innerRe.exec(text);
        if (hit && hit.index === i) {
          n++;
          break;
        }
      }
      i++;
    }
  }
  return n;
}

/**
 * 数「把 `path.relative` 的结果当**展示文本**用」的处数。
 *
 * `path.relative` 有两种用途：展示（本条账）与**包含判据**
 *（`const rel = path.relative(root, p); if (rel.startsWith("..") || …)` ——
 * 判断「这个路径在不在 root 里」的标准写法）。只数前者：锚点取每次
 * `path.relative(` 之后的 200 字符窗口里**没有** `startsWith("..")` / `isAbsolute`。
 */
function countNonContainment(text) {
  const re = /\bpath\.relative\s*\(/g;
  let n = 0;
  let m;
  while ((m = re.exec(text)) !== null) {
    const window = text.slice(m.index, m.index + 200);
    if (/startsWith\s*\(\s*"\.\."/.test(window)) continue;
    if (/isAbsolute/.test(window)) continue;
    n++;
  }
  return n;
}

const RULES = {
  P1: {
    label: "视图内手写 <button>（应使用 ~/components/ui/button 的 <Button>）",
    count: (t) => (stripComments(t).match(/<button\b/g) || []).length,
  },
  P2: {
    label: "视图内自建 createPortal 浮层（应使用 ui/dialog / popover / sheet）",
    count: (t) => (stripComments(t).match(/\bcreatePortal\s*\(/g) || []).length,
  },
  P3: {
    label:
      "视图内自写加 spinner/pulse 动画（应使用 ui/page-loading 的 PageLoading / Spinner、ui/skeleton / ui/progress）",
    count: (t) =>
      (stripComments(t).match(/\banimate-(?:spin|pulse)\b/g) || []).length,
  },
  P9: {
    label:
      "视图内自绘模态浮层（应使用 ui/dialog 的 Dialog/DialogContent 或 ui/sheet 的 SheetContent）",
    /* 判据是「这个文件自己拼了一份模态外壳」，**不是**「有没有用 createPortal」
       —— 这正是 P2 的盲区：16 个落点里一处 portal 都没写，它们把遮罩写成
       一个普通 `<div className={overlayClass("modal", …)}>`。P2 数的是「有没有
       用某个 API」，于是这批在 P2 全库清零之后依然一个都没被追上。

       形态判据取 `overlayClass(` 这个调用：它是本项目「顶层浮层定位」的唯一出口
       （`fixed top-title-bar …`，同时被 `check-title-bar-clearance.cjs` 认），
       视图里出现它 = 这个文件在自绘浮层容器。`FullScreenLayer` 也是浮层，但它
       由基元组件承担（`ui/` 目录整体豁免），调用处不出现这次调用。 */
    count: (t) => (stripComments(t).match(/\boverlayClass\s*\(/g) || []).length,
  },
  P4: {
    label:
      "视图内自写 ::-webkit-scrollbar 外观（应复用 globals.css 的 .custom-scrollbar / .soft-scrollbar）",
    count: (t) => (stripComments(t).match(/::-webkit-scrollbar/g) || []).length,
  },
  P5: {
    label: "视图内自写剪贴板写入（应使用 ~/lib/browser-io 的 copyText）",
    count: (t) => {
      const t2 = stripComments(t);
      return (
        (t2.match(/navigator\.clipboard/g) || []).length +
        (t2.match(/document\.execCommand\(/g) || []).length
      );
    },
  },
  P6: {
    label:
      "视图内自写 Blob 下载（应使用 ~/lib/browser-io 的 downloadText / downloadJson）",
    count: (t) =>
      (stripComments(t).match(/URL\.createObjectURL\s*\(/g) || []).length,
  },
  P8: {
    label:
      "视图内自写「值不存在显示 —」的判据（应使用 ~/lib/display-value 的 displayValue）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 数两种写法：① 字面量里直接写占位符；② 比较算子后面紧跟占位符。
       * 两条都要求占位符**字面出现**在代码里 —— 用了 `displayValue` 的地方
       * 自然不含它。 */
      return (
        (t2.match(/"—"|'—'/g) || []).length +
        (t2.match(/\?\?\s*"[^"]*—/g) || []).length
      );
    },
  },
  P12: {
    label:
      "视图 / 逻辑层里自写 setInterval 轮询（应使用 ~/components/ui/use-interval 的 useInterval）",
    count: (t) => {
      const t2 = stripComments(t);
      return (t2.match(/\bsetInterval\s*\(/g) || []).length;
    },
  },
  P11: {
    label:
      "视图内自绘可滚动浮层选项列表（应使用 ~/components/ui/option-list-popover 的 OptionListPopover）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 「手搓 chip 浮层」= 本文件里既自建 `PopoverTrigger`、又自己画 `▾`
       * 展开标记。两个条件同时成立才计 —— 见文件头 P11 说明。 */
      if (!/\bPopoverTrigger\b/.test(t2)) return 0;
      return (t2.match(/▾/g) || []).length;
    },
  },
  P10: {
    label:
      "视图内自绘折叠/展开开关（应使用 ~/components/ui/disclosure 的 Disclosure）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 两种形态：① 原生 `<details>`；② 自绘折叠开关 —— `role="button"` 配
       * `▸` / `▾` 展开标记。第二种要求**同一文件里两者同时出现**，否则会把
       * 「浮层触发器上的装饰箭头」（chip / 下拉 / 弹窗触发器都画一个 `▾`）
       * 误判成折叠 —— 那些属于浮层形态（P9 / 基元），不是 disclosure。
       * 箭头图标（lucide `Chevron*`）不计：它在导航 / 分页 / 浮层触发里都有，
       * 单看图标判不出意图；`▸` / `▾` 这两个字符在本库只用于「折起来」与
       * 「打开面板」，配上 `role="button"` 才唯一指向折叠。 */
      const details = (t2.match(/<details\b/g) || []).length;
      const markers = (t2.match(/[▸▾]/g) || []).length;
      const roleButton = /role\s*=\s*["']button["']/.test(t2);
      return details + (roleButton ? markers : 0);
    },
  },
  P13: {
    label:
      "视图 / 逻辑层里自写搜索关键字归一化（应使用 ~/lib/list-filter 的 normalizeNeedle / matchesNeedle）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`<expr>.trim().toLowerCase()`。这才是「搜索框归一化」的形状 ——
       * 单看 `.toLowerCase()` 会把内容哈希、配置解析那些也数进来（它们不是
       * 搜索）。同一串里两个方法都出现才计。
       *
       * ⚠️ **另一种形态必须同时数**：只 `trim()` 不折小写 —— 那正是
       * `AttributeMultiSelect` 的原始缺陷（候选值含拉丁字母时大小写敏感），
       * 而它**不含 `.trim().toLowerCase()`**，上一条正则一条也看不见。
       * 判据漏掉「更差的那种写法」比判据太宽更危险：被拦下的只是合规者。
       *
       * 只数**变量名像搜索词**的那一类（`kw` / `needle` / `needle` / `term` /
       * `query` / `search` / `keyword` / `q`）—— 否则 `line.trim()` 这类
       * 无关的去空白会被全量计入（那是格式清洗，不是搜索）。 */
      const both = (t2.match(/\S+\.trim\(\)\.toLowerCase\(\)/g) || []).length;
      const trimmed = (
        t2.match(
          /\b(?:kw|needle|term|query|search|keyword|q)\w*\s*=\s*[^;\n]*\.trim\(\)(?!\.toLowerCase\(\))/gi,
        ) || []
      ).length;
      return both + trimmed;
    },
  },
  P14: {
    label:
      "视图内自写展开集合的翻转样板（应使用 ~/components/ui/expansion-set 的 useExpansionSet）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`{ ...src, [key]: !src[key] }` —— **同一个标识符**既被展开、
       * 又是翻转的取值源。这就是「自己在维护一份展开集合」的签名。
       *
       * 参数名故意不写死（`prev` / `state` / `parents` / `nodeList` / `expanded`
       * 各种都有）—— 收口前那三处的形参名就是三种。双条件（展开 + 翻转同源）
       * 是必须的：只数 `[k]: !x[k]` 会把「在跑标记」这类**不是折叠语义**的
       * 映射误判成展开集合（见文件头 P14）。 */
      const flips =
        t2.match(
          /[A-Za-z_$][\w$]*\s*,?\s*\[\s*[^\]]+\s*\]\s*:\s*!\s*[A-Za-z_$][\w$]*\s*\[/g,
        ) || [];
      let n = 0;
      for (const flip of flips) {
        const src = /!\s*([A-Za-z_$][\w$]*)\s*\[/.exec(flip)?.[1];
        if (src && new RegExp("\\.\\.\\.\\s*" + src + "\\b").test(t2)) n++;
      }
      return n;
    },
  },
  P15: {
    label:
      "视图内自写面板加宽档与切换钮（应使用 ~/components/ui/wide-panel 的 useWidePanel / WidePanelToggle）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`<flag> ? <X>.wide : <X>.base` —— 加宽档的三元写法。
       * 单看 `useState(false)` 会把所有弹窗开关算上（见文件头 P15）。 */
      return (
        t2.match(/\?\s*[A-Za-z_$][\w$]*\.wide\s*:\s*[A-Za-z_$][\w$]*\.base/g) ||
        []
      ).length;
    },
  },
  P16: {
    label:
      "视图内自绘进度条填充（应使用 ~/components/ui/progress-bar 的 ProgressBar；数值走 ~/lib/progress）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`style={{ width: `${…}%` }}` —— 自己按百分比摆宽度。
       * 这是进度条填充的签名，且不会被圆角 / 背景色这类通用类误伤。 */
      return (t2.match(/style=\{\{\s*width:\s*`\$\{[^}]+\}%`/g) || []).length;
    },
  },
  P17: {
    label:
      "视图内自写键值行（应使用 ~/components/ui/key-value-rows 的 KeyValueRows）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已经用了出口的文件**不可能**是「自己写一份」—— 它的标签 / 值节点
       * 是作为 `items` 传给 `KeyValueRows` 的，形态判据会把它们连起来误报
       * （`WorkshopEncapsulationPanel` 的键节点里有个 muted 色的口 id span）。
       * 与 P13「同时数更差的那种写法」是同一枚硬币的两面：判据要覆盖所有
       * 不合规的写法，也要**一个都不误伤**合规的。 */
      if (/from\s+["']~\/components\/ui\/key-value-rows["']/.test(t2)) return 0;
      /* 形态：一个 muted / faint 色的**标签叶子元素**，紧随其后出现值的
       * 渲染器（`displayValue(` / `JSON.stringify(` / `typeof x === "string"`）。
       *
       * 两个条件同时成立才是「把一个对象的字段渲染成键值行」：
       * ① 只有标签 → 到处都有的小标题；② 只有值渲染器 → JSON 气泡 / 预览。
       * 窗口取 160 字符（相邻的一对标签 + 值），足够跨过标签的闭合标签与
       * 几个属性，又不会把整块 JSX 连起来 —— 实测 400 字符会把环形进度
       * 的「进度」标签与下方的 SVG 连上（误报）。
       *
       * ⚠️ 标签必须是**叶子**（自身闭合、内容不超过 30 字或一个短表达式）：
       * 否则容器型 `div`（内含整块子树）会把远处任何一处 `displayValue`
       * 都连成一次命中。 */
      const pattern =
        /<(?:span|p|div)[^>]*className="[^"]*text-(?:ink-muted|ink-faint|ink-fainter|muted-foreground|faint)[^"]*"[^>]*>\s*(?:\{[^}]{0,60}\}|[^<]{0,30})\s*<\/(?:span|p|div)>[\s\S]{0,160}?(?:displayValue\(|JSON\.stringify\(|typeof\s+[\w.$]+\s*===\s*"string")/g;
      return (t2.match(pattern) || []).length;
    },
  },
  P18: {
    label:
      "视图内裸写 <img> / <video>（应使用 ~/components/ui/media-thumbnail 的 MediaThumbnail）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：视图里自己出现 `<img` / `<video` 标签。收口后 `MediaThumbnail`
       * 是「渲染一张可能失败的媒体图」的唯一出口，调用处不再出现这两个标签。
       *
       * ⚠️ 单看 `onError=` 会漏掉那 14 处**压根没有兜底**的 `<img>` —— 而
       * 「没有出现 onError」正是这条账里更差的那一半（与 P13 同源）。
       * `<video` 一并数：`MediaThumbnail` 管的就是「图片 / 视频二选一」。 */
      return (
        (t2.match(/<img\b/g) || []).length +
        (t2.match(/<video\b/g) || []).length
      );
    },
  },
  P19: {
    label:
      "视图内自写媒体拖拽源（应使用 ~/components/ui/media-drag-source 的 useMediaDragSource）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：手写本项目跨组件拖拽的自定义 MIME。
       * 单看 `draggable` 会把组件内拖拽（React Flow 节点、表单行）算进来。 */
      return (
        t2.match(/setData\(\s*["']application\/x-comfyapp-media["']/g) || []
      ).length;
    },
  },
  P20: {
    label:
      "视图 / 逻辑层里自写全局快捷键监听（应使用 ~/components/ui/use-hotkey 的 useHotkey）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：自己往 window / document 上挂 keydown。
       * ⚠️ 单看 `metaKey` / `ctrlKey` 会漏掉「只判 ctrlKey」那两处 ——
       * 而它们才是这条账里更差的那一种（macOS 上按 ⌘ 没反应）。 */
      return (t2.match(/addEventListener\(\s*["']keydown["']/g) || []).length;
    },
  },
  P21: {
    label:
      "视图内自写滚动跟随到底（应使用 ~/components/ui/use-scroll-follow 的 useScrollFollow）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`el.scrollTop = el.scrollHeight` 这个**赋值**（两侧都在）。
       * 只数「写 scrollTop」会漏掉「用别的变量名接 contentHeight 再赋」的写法；
       * 而只数 `scrollHeight` 会把 `log-virtual` 的贴底算术（只读不写）与
       * textarea 自动增高（写 `style.height`）算进来。两边同时出现才计。 */
      return (t2.match(/scrollTop\s*=[^;\n]*scrollHeight/g) || []).length;
    },
  },
  P22: {
    label:
      "视图内自写外部目标导航（应使用 ~/lib/external-open + ~/components/ui/use-external-action）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`window.location.href = <…>` —— 把控制权交给外部程序
       * （本项目唯一实例是 `comfyapp://` 打开目录）。
       * ⚠️ **不数**对内的路由跳转：那在 App Router 里走 `router.push`
       * （`next/navigation`），不是同一个形态；也不数与文件选择相关的
       * `input.click()`（那是 P7 的账）。 */
      return (t2.match(/window\.location\.href\s*=/g) || []).length;
    },
  },
  P23: {
    label:
      "视图内自写「标签 + 控件」的表单行（应使用 ~/components/ui/form-field 的 FormField）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：**块级标签行** —— `<label className="block …">`（标签是独立
       * 一行、下方是控件）或 `<label htmlFor=… >`（显式关联，也是同一件事）。
       *
       * ⚠️ **不数**「整块可点的开关行」（`<label className="flex cursor-pointer
       * items-center justify-between">` 包住一个 `<Switch>`）：那是另一种形态
       * —— 标签与控件是**并排**的，点哪都切换；`FormField` 的块级标签行套上去
       * 会改掉那条排布（§16.2.4.2 第 9 条：验收标准是渲染结果不变）。
       * 单看 `aria-invalid` 则会漏掉那 14 处**完全没有** ARIA 标记的 ——
       * 它们才是这条账里更差的那一半（与 P13 同源）。 */
      /* 两个条件同时成立才是「标签 + 控件」的块级表单行：
       * ① 块级标签（`className` 里带 `block`）；
       * ② 其后 400 字符内出现一个**输入类控件**标签
       *    （`<input` / `<textarea` / `<select` / `<Input` / `<Textarea` /
       *    `<SelectMenu` / `<NumberField` / `<RangeSlider`）。
       * 只判 ① 会把「带只读徽标的区块标题」（`NodesTab` 的自定义节点目录）
       * 与「整块可点的开关行」一并算上。 */
      const re =
        /<label[^>]*className="[^"]*\bblock\b[^"]*"[^>]*>[\s\S]{0,400}?<(?:input|textarea|select|Input|Textarea|SelectMenu|NumberField|RangeSlider)\b/g;
      return (t2.match(re) || []).length;
    },
  },
  P24: {
    label:
      "视图里自写读文件（应使用 ~/lib/file-io 的 readFileAsText / readFileAsDataUrl）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：FileReader 的 `readAs*` 调用，或 `await <x>.text()`。
       * 单看 `FileReader` 会漏掉 `file.text()` 那一族（它们才是多数）；
       * `readAs*` 是 FileReader 的唯一签名，漏不掉「手搓 reader」那种。 */
      return (
        (
          t2.match(/readAs(?:Text|DataURL|ArrayBuffer|BinaryString)\s*\(/g) ||
          []
        ).length +
        /* **不带 `await` 的 `.text()` 也要数**：那是这条账里更差的一半 ——
         * `void file.text().then(...)` 没有 rejection 分支，读失败被整个吞掉
         *（`VideoQueueModal` / `WorkshopStageBody` 原先就是这两处）。
         * 与 P13「更差的那种写法也要数」同源：判据漏掉更差的那一种，
         * 被拦下的就永远只是合规者。 */
        /* 只数**像文件**的接收者（`file` / `fileToRead` / `files[0]` /
         * `input.files[0]`）—— `.text()` 也是 `fetch` 读响应体的方法
         *（`res.text()`），那是网络读取，不是「读用户选的文件」。
         * 用名字前缀而不是白名单：调用处给 File 变量的命名几乎都带 `file`。 */
        (
          t2.match(
            /\b(?:[A-Za-z_$]*[Ff]iles?(?:\[\d+\])?(?:\.\w+)?)\.text\s*\(\s*\)/g,
          ) || []
        ).length
      );
    },
  },
  P25: {
    label:
      "自写 localStorage 存取（应使用 ~/lib/browser-storage 的 readStorageItem / readStorageJson / writeStorageItem / writeStorageJson）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`localStorage.getItem(` 这类**调用**。
       * 不数 `typeof localStorage` —— 那只是它的一个前置判据，
       * 而这条账里更差的一半正是「压根没判」（与 P13 / P18 同源）。 */
      return (
        t2.match(
          /(?:window\.)?localStorage\.(?:getItem|setItem|removeItem|clear)\s*\(/g,
        ) || []
      ).length;
    },
  },
  /* ── P27「异步动作的结果怎么接到反馈通道上」（硬闸，§16.2.4.30）──────
   * 形态：`try { await … } catch { <反馈通道>(errorMessage(...)) }` ——
   * 「置忙 → 调用 → 结算 → finally 清忙」这段样板的签名。
   *
   * 判据取**两个条件同时成立**：
   *  ① `try` 块里真的 `await` 了（不是同步的 JSON.parse 那种）；
   *  ② `catch` 块里既出现了**反馈通道**的调用，又出现了**错误取值**。
   * 只判 ① 会把「读缓存失败静默回落」那一族（它们根本没有反馈通道，
   * 是合法的降级）算进来；只判 ② 会把 `errorMessage` 在非 catch 处的
   * 使用（服务端路由拼错误信封）算进来。
   *
   * ⚠️ **不数**服务端（`src/app/api/**` 与 `src/server/**`）：那边的
   * 「反馈通道」是响应信封与 logger，不是用户可见出口 —— 与 P12/P13/P24
   * 跳过 app/api 是同一条口径。 */
  P27: {
    label:
      "自写「try/catch + 反馈通道(errorMessage)」样板（应使用 ~/lib/async-action 的 runAsyncAction）",
    count: (t) => {
      const t2 = stripComments(t);
      const blocks =
        t2.match(
          /try\s*\{[\s\S]{0,3000}?\}\s*catch\s*(?:\([^)]*\))?\s*\{[\s\S]{0,600}?\n\s*\}/g,
        ) || [];
      return blocks.filter((b) => {
        if (!/\bawait\b/.test(b)) return false;
        const catchBody = b.slice(b.indexOf("catch"));
        if (
          !/\b(?:toast\.error|setError|setErr|setMsg|showFlash|onFailed|setImportErr|setActionError)\s*\(/.test(
            catchBody,
          )
        )
          return false;
        return /\berrorMessage\s*\(/.test(catchBody);
      }).length;
    },
  },

  /* ── P28「一张媒体图的自然尺寸是多少」（硬闸，§16.2.4.31）───────────
   * 形态：直接出现 `naturalWidth` / `naturalHeight` / `videoWidth` /
   * `videoHeight` 这四个读数。
   *
   * ⚠️ 判据取**属性名**而不是「调用了什么函数」：这条账里更差的一半正是
   * 那几个**压根没判 0** 的落点（它们没有任何函数调用可锚）——
   * 与 P13 / P18 的「更差的那种也要数」同源。出口自己豁免（`ui/` 目录 +
   * `~/lib/media/natural-size.ts` 不在扫描范围内）。 */
  P28: {
    label:
      "视图里自己读媒体的自然尺寸（应使用 ~/lib/media/natural-size 的 readNaturalSize / naturalAspectRatio）",
    count: (t) => {
      const t2 = stripComments(t);
      return (
        (t2.match(/\bnatural(?:Width|Height)\b/g) || []).length +
        (t2.match(/\bvideo(?:Width|Height)\b/g) || []).length
      );
    },
  },

  /* ── P29「一组值怎么写成查询串」（硬闸，§16.2.4.32）─────────────────
   * 形态：模板字面量／普通字符串里出现 `?key=${…}` 或 `&key=${…}` ——
   * 手拼查询串的签名。用了 `buildQueryString` / `withQuery` 的落点里
   * 一个这样的片段都不会有（端点路径不带 `?`）。
   *
   * ⚠️ **不数**：
   *   · 纯数字 / 枚举的内联（`?port=${port}` 的 URL 构造，如 drizzle-studio
   *     的 host 链接与 WS 的 `?clientId=`）—— 它们是**另一个协议的地址**，
   *     不是「发给本应用端点的查询串」（与 P22 的「不数对内路由跳转」同款）；
   *   · 日志消息里的 `key=value`（`promptId=${…}` 不是查询串）。
   * 判据取**「键名 + `=` + 内联值」**这一个签名：
   * `?<键名>=` 或 `&<键名>=` 之后**紧跟 `${` 或一个字符串字面量**，
   * 且 `?` 前面不是词字符（避开 `x?y` 三元与 `a&&b`）。
   *
   * 三条边界都是实测踩出来的：
   *   1. **要求真有值被内联**（`${` 或引号）—— 只数 `?<键名>=` 会把
   *      **写死的 href 字面量**（`href="/workspace?tab=canvas"`）与
   *      **正则字面量**（`/\|?msg=([^|]*)/`）一起算上，那两处都不是
   *      「把一组值写成查询串」；
   *   2. **键名必须以字母开头**（`[A-Za-z][\w.-]*`）：查询串的键几乎不会是
   *      数字 / 下划线开头，这条避开 `${a}?${b}=${c}` 这类 id 拼接；
   *   3. **`?` 的前置字符必须在允许集里**（词字符 / `/` / `.` / `-` /
   *      引号 / 反引号 / `(` / 行首）：路径末字符是词字符
   *      （`/api/images?filename=` 的 `?` 前面正是 `s`）、模板串开头的
   *      `?id=${x}` 前面是反引号 —— 两者都必须算，否则「第一个参数」那条
   *      写法能整片溜过。`&` 那一支同理（它只可能在键值之间）。
   *      `cond ? x = y` 这类表达式由第 1 条挡住（`=` 后面既不是 `${`
   *      也不是引号），不必靠前置字符。
   *
   * 与 P22「不数对内路由跳转」、P28「只数属性名不数函数」是同一条口径：
   * 判据锚在唯一的签名上，误伤一个合规者就等于逼人改坏代码。 */
  P29: {
    label:
      "手拼查询串（应使用 ~/lib/query-string 的 buildQueryString / withQuery）",
    count: (t) => {
      const t2 = stripComments(t);
      const re = /(?:^|[\w./\-'"`(])[?&][A-Za-z][\w.-]*=(?:\$\{|["'`])/g;
      return (t2.match(re) || []).length;
    },
  },

  P26: {
    label:
      "视图里自写「Enter 提交」键位判据（应使用 ~/components/ui/use-enter-commit 的 enterCommit）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：`onKeyDown` 里判 `"Enter"`。这是「输入框回车提交」的签名。
       * ⚠️ **不看挂到 window / document 的全局快捷键**（那是 P20 的账，
       * 出口是 `use-hotkey`）；也够不着 `role="button"` 元素复刻浏览器默认
       * 行为那 6 处 —— 那类要的是 `<Button>`（P1 的账）。 */
      /* 只数**输入类控件**上的回车提交：`onKeyDown` 块里同时出现
       * `"Enter"` 判据，且它所在的那个元素是 `<input` / `<textarea`。
       * `role="tab"` / `role="button"` 上复刻浏览器默认行为的那几处
       * （`e.key === "Enter" || e.key === " "`）是**另一种账** ——
       * 它们要的是 `<Button>`（P1），不是「输入框回车提交」。 */
      const blocks = t2.match(/onKeyDown=\{[\s\S]{0,600}?\}\s*\}/g) || [];
      return blocks.filter((b) => {
        if (!/\.key\s*===\s*"Enter"/.test(b)) return false;
        /* 同一段里不得出现 Space 键位判据 —— 那是「复刻按钮默认行为」
         *（`role="tab"` / `role="button"` 上补 Enter/Space），要的是
         * `<Button>`（P1 的账），不是「输入框回车提交」。 */
        if (/\.key\s*===\s*" "/.test(b)) return false;
        return true;
      }).length;
    },
  },
  P7: {
    label:
      "视图内自写「隐藏 <input type=file> + 手工触发」（应使用 ~/components/ui/file-picker 的 useFilePicker）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 只数**隐藏**的 input：可见 input 是另一种形态（见文件头 P7 说明）。
       * 判据要同时看到 `type="file"` 与「它被藏起来了」—— 两种常见写法是
       * 同类元素上的 `className="hidden"`，以及同文件里再写一遍
       * `className="hidden"` 的另一处；用「同一元素标签内出现两者」判定。 */
      const tags = t2.match(/<input\b[^>]*>/g) || [];
      return tags.filter(
        (tag) => /type\s*=\s*["']file["']/.test(tag) && /\bhidden\b/.test(tag),
      ).length;
    },
  },

  /* ── P30「一次动作的错误挂在谁身上」（硬闸，§16.2.4.33）───────────────
   * 形态：`useState<string | null>(null)` 配一个 `set<X>Error`，而同一块
   * 视图里有**多个条目**在调它 —— 也就是「最近一次操作的草稿」。
   *
   * 判据取**两个条件同时成立**：
   *  ① 出现 `useState<string | null>(null)`（或 `useState("" )` 那类错误位）；
   *  ② 同一文件里 `set*Error(` 被**两处以上不同的调用点**调用，且那些调用点
   *     位于逐条渲染的上下文里（`map(` / 多个同名动作）。
   * 只判 ① 会把「整个面板只有一个错误位、本来就只有一件事会失败」的落点算上
   *（那是合法的：设置页的整页提示条、设置页分区的保存）；
   * 只判 ② 会把「多个动作共用一个整页提示条」算上（那是 §16.2.4.30 的
   * `report` 通道，本来就该共用）。
   *
   * ⚠️ **不数** `~/lib/async-action` 的 `report` 通道（那是「这次说什么」），
   * 也**不数**服务端路由（那边的错误归响应信封，是 P32 的账）。
   *
   * 出口：`~/components/ui/use-item-errors` 的 `useItemErrors`。
   */
  P30: {
    label:
      "按条目渲染的列表共用一块「最近一次操作」的错误位（应使用 ~/components/ui/use-item-errors 的 useItemErrors）",
    count: (t) => {
      const t2 = stripComments(t);
      /* ① **错误位**：变量名带 `error` 语义的字符串 state，两种写法都要认
       *    —— 字面量初始值（`useState("")`）与可空初始值（`useState<string
       *    | null>(null)`）；两种在收口前的存量里都有。
       *
       * ⚠️ 名字里的 `error` 是必须的：`useState<string | null>(null)` 这
       * 一条**本身就是 P14/P15 那些忙碌位选择器的形态**
       *（`polishBusyId` / `aiBusyId` / `editingId`：它们天生就是
       * 「当前是哪一条在忙」，写成单值是**正确**的，因为同一时刻只有一条
       * 在忙）。把它们当错误位算进来，会让判据逼着人改坏代码
       *（与 P22 / P31 同款：判据锚在唯一的签名上）。 */
      const slots =
        t2.match(
          /\bconst\s*\[\s*([A-Za-z_$][\w$]*[Ee]rror)\s*,\s*([A-Za-z_$][\w$]*)\s*\]\s*=\s*(?:React\.)?useState(?:<[^>]*>)?\s*\(/g,
        ) || [];
      if (slots.length === 0) return 0;
      let hits = 0;
      for (const slot of slots) {
        const m = slot.match(
          /\[\s*([A-Za-z_$][\w$]*[Ee]rror)\s*,\s*([A-Za-z_$][\w$]*)\s*\]/,
        );
        const setter = m[2];
        /* ② **逐条写入点**：调用这个 setter 的函数**有除错误对象之外的实参**
         *    （`polishOne(shot)` / `handleAICard(character)`）—— 说明这块错误位
         *    是被「每一条各自」写的，而同一时刻可能两条都挂着错。
         *
         * ⚠️ 判据的难点全在「不误伤批量错误位」：`genError`（一句话生成整批
         *    角色）/ `aiError`（全片拆镜）/ `loadError`（一个弹窗读源码）/
         *    `actionError`（一个面板的上传与删除）**都是合法的单槽** ——
         *    同一时刻只有一件事会失败，它们各自也只有一个写入点。
         *
         *    所以判据**不能**取 `.map(`：同一个符号在同一文件里既可能是
         *    「逐条渲染」（`characters.map(c => <Row …>)`）也可能是
         *    **状态更新助手**（`setXs(prev => prev.map(c => c.id === id ?
         *    {…c, …patch} : c))`）—— 后者离 setter 的调用点很近，实测会把
         *    `CharacterDesigner` 的 `setGenError` 误判成逐条写入。
         *    判据只能取「写入点所在的那个函数的形参」(与 P31「名字不写死」
         *    同款：锚在唯一的签名上)。 */
        /* b) 从 setter 的每个调用点往前找最近的函数头，看它有没有条目实参。 */
        let perItem = 0;
        const callRe = new RegExp(`\\b${setter}\\s*\\(`, "g");
        let cm;
        while ((cm = callRe.exec(t2)) !== null) {
          const before = t2.slice(0, cm.index);
          const fn = before.match(
            /(?:async\s+)?function\s+\w+\s*\(([^)]*)\)[^{]*\{[^{}]*$/,
          );
          if (!fn) continue;
          const params = fn[1].trim();
          if (!params) continue;
          /* 唯一实参是错误对象 / 事件对象 → 那是「一个失败回调」，不是条目。 */
          if (/^(?:event|e|ev|err|error|reason)[\s:]/i.test(params)) continue;
          if (/^(?:event|e|ev|err|error|reason)$/i.test(params)) continue;
          perItem += 1;
        }
        if (perItem > 0) hits += 1;
      }
      return hits;
    },
  },

  /* ── P31「这一轮还算不算数」（硬闸，§16.2.4.34）──────────────────────
   * 形态：本地标志 + 守卫样板（声明 → 读 → 置位三段齐全），即「取数 effect
   * 里这一轮已作废」的签名。
   *
   * ⚠️ 判据取**变量声明 + 置位**这两个锚点（不取具体变量名）：
   *   1. `let <名> = false;` 之后同一文件里出现 `if (<同名校>)` 或
   *      `if (!<同名校>)`，且该名字带 `cancel` / `abort` / `stale` / `alive`
   *      这类语义（八处落点收口前用的都是 `cancelled`，但名字不该写死）；
   *   2. `let <同名校> = true;` 在同文件里出现（置位）。
   * 只判 ① 会把「一个只读不改的局部布尔」算上；两条一起才不会误伤。
   *
   * 与 P27 的分工：P27 数的是「失败怎么报到界面上」；这条数的是
   * **「非失败状态」**（这一轮作废），所以 `use-history-panel` 此前在 P27
   * 的豁免里 —— 那正是这条账一直没被追到的原因。
   *
   * 出口：`~/lib/stale-run` 的 `beginStaleRun`。
   */
  P31: {
    label:
      "自写「这一轮已作废」的守卫样板（应使用 ~/lib/stale-run 的 beginStaleRun）",
    count: (t) => {
      const t2 = stripComments(t);
      /* `let cancelled = false;` 这类声明：名字带作废语义。 */
      const decls =
        t2.match(/\blet\s+([A-Za-z_$][\w$]*)\s*=\s*false\s*;/g) || [];
      let hits = 0;
      for (const decl of decls) {
        const name = decl.match(/\blet\s+([A-Za-z_$][\w$]*)\s*=/)[1];
        if (!/cancel|abort|stale|alive|disposed/i.test(name)) continue;
        /* 读法：`if (x)` / `if (!x)` —— 只要有读，且有置位。 */
        const readRe = new RegExp(`if\\s*\\(\\s*!?\\s*(?:this\\.)?${name}\\b`);
        const setRe = new RegExp(`\\b${name}\\s*=\\s*true\\s*;`);
        if (readRe.test(t2) && setRe.test(t2)) hits += 1;
      }
      return hits;
    },
  },

  /* ── P32「服务端失败信封怎么拼 / 怎么读」（硬闸，§16.2.4.35）──────────
   * 形态：`{ error: errorMessage(e, "…失败") }` 这类**手拼的错误信封** ——
   * 在 `src/app/api/**` 里出现，且同一份形状会被 **6 个客户端**各读一遍。
   *
   * 判据取「字面量里亲自拼 `error` 键 + 错误取值」这一个签名：
   *   `{ error: errorMessage(...) }` / `{ error: <标识符> }`。
   * ⚠️ **不数** `errorResponse(e)`（那是 §10.9 的纯错误出口，是对的写法）、
   * 业务字段（`detail` / `hint` —— 它们不是错误文案）。
   *
   * 读侧同理：`typeof <x>.error === "string"` 这种「自己判形状」也算 ——
   * 收口前 bgm / upload / materials 三份读取函数**逐字相同**。
   *
   * 出口：`~/lib/api-error` 的 `apiErrorBody` / `apiErrorBody` 与
   * `readApiError`（写侧）/ `~/server/lib/error-response`（纯错误侧）。
   */
  P32: {
    label:
      "手拼服务端错误信封 / 自己判它的形状（应使用 ~/lib/api-error 的 apiErrorBody / readApiError）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 写侧：`NextResponse.json({ error: errorMessage(...) })` 这类手拼
       * 的**响应信封** —— 判据要求两件事同时成立：出现了「构造响应体」的
       * 动作（`NextResponse.json(` / `data: ${JSON.stringify(`），
       * **以及**该片段里亲手拼了 `error` 键。
       *
       * ⚠️ 只数 `{ error: errorMessage(...) }` 会把**本地对象字面量**算上
       * （`cacheExtractPatch({ error: errorMessage(e, "导入失败") })` ——
       * 那是往缓存里写一条状态记录，不是 HTTP 响应）。它同形但不同源，
       * 与 P22 / P31 是同一条口径：判据锚在唯一的签名上。 */
      const responseBodies =
        t2.match(
          /NextResponse\.json\([\s\S]{0,400}?\)|JSON\.stringify\([^)]{0,200}\)/g,
        ) || [];
      const write = responseBodies.filter((b) =>
        /\berror:\s*(?:errorMessage|apiErrorDetail)\s*\(/.test(b),
      ).length;
      /* 读取侧：自己判「响应体里的 error 是不是字符串」—— 收口前 bgm /
       * upload / materials 三份读取函数**逐字相同**，`isRecord(body) &&
       * typeof body.error === "string"` 就是那个签名。
       *
       * ⚠️ 判据要求**两件事同时成立**：`isRecord(<名>)` 式的收窄（或
       * `<名>` 带 body / json 语义），**以及**紧接着判它的 `error`。
       * 只数 `typeof x.error === "string"` 会把 SSE 帧（`msg.error`）、
       * 已落库的解析记录（`firstErr.error`）一起算上 —— 那两处的
       * 「error 字段」是**各自协议的业务字段**，不是 HTTP 错误信封
       * （与 P22「不数对内路由跳转」、P31「名字不写死」同款：判据锚在
       * 唯一的签名上，误伤一个合规者就等于逼人改坏代码）。 */
      const read =
        t2.match(
          /(?:isRecord\s*\(\s*(\w+)\s*\)[\s\S]{0,80}?|\b(\w*(?:body|json|data)\w*)\s+as\s*\{[\s\S]{0,80}?)[\s\S]{0,80}?\b\1\2\.error\b/g,
        ) || [];
      return write + read.length;
    },
  },
  /* ── P33「给一条新记录生成 id」（硬闸，§16.2.4.36）─────────────────────
   * 形态：`Date.now().toString(36)` / `Date.now()` 出现在一个**字符串拼接**里
   * —— 也就是「时间戳 + 序号 / 随机段」这种手写的唯一 id。
   *
   * ⚠️ 两条边界都是实测踩出来的：
   *   1. **要求出现在模板串或字符串拼接里** —— 只数 `Date.now()` 会把
   *      「取当前时刻」这一大类算上（日志解析的 `parsedAt` 兜底、去重判据、
   *      `time:` 字段），它们与 id 无关；
   *   2. **`time:` / `at:` / `expires` 这类键不算** —— 它们把时刻当**值**用，
   *      不是把它当 id 的一段。判据只认「时刻与别的片段一起被拼成一个串」。
   *
   * 出口：`~/lib/unique-id` 的 `nextId` / `randomToken`。
   * 收口前实测 6 处，分三派（计数器取模 / 随机后缀 / 裸毫秒数），
   * 「同一毫秒产生的两条会不会撞 id」因此取决于是哪一处生成的。
   */
  P33: {
    label: "自写「时间戳 + 序号」的唯一 id（应使用 ~/lib/unique-id 的 nextId）",
    count: (t) => {
      const t2 = stripComments(t);
      let hits = 0;
      /* ① 模板串里的 `Date.now()`，且它**参与了 id 的拼装** —— 判据要求同
       *    一串里另有 id 语义线索：`id` / `Id` / `_id` / `n_` / `msg_` 这类
       *    前缀、`Math.random()` 随机段、或 `.toString(36)`。
       *
       *    ⚠️ 只数模板串里的 `Date.now()` 会把「把时刻当值用」的落点一起算上
       *    （SSE 心跳注释行 `: hb ${Date.now()}`、文件名 `` `${Date.now()}_…` ``
       *    —— 都不是「记录 id」，它们不参与任何去重 / 排序 / 引用判据）。
       *    收口前那 6 处**每一处**都另有这三类线索之一，所以判据收窄后
       *    仍全部命中（改完为 0）。 */
      const ID_HINT_RE =
        /(?:\b[A-Za-z_$]*[Ii]d\b|Math\.random\(\)|\.toString\(36\)|_\$?\{)/;
      const templates = t2.match(/`[^`]*`/g) || [];
      for (const tpl of templates) {
        if (!/\bDate\.now\(\)/.test(tpl)) continue;
        if (ID_HINT_RE.test(tpl)) hits += 1;
      }
      /* ② 字符串拼接里的同类写法：`"x_" + Date.now()` / `Date.now() + "_"`。
       *    ⚠️ 判据要求 `Date.now()` 的**另一侧是一个字符串字面量** ——
       *    否则 `Date.now() + 10 * 60 * 1000`（算截止时刻）这类算术会被算上，
       *    而那与 id 无关（实测踩到：`VideoStudio` 的轮询超时 deadline）。 */
      hits += (
        t2.match(
          /(?:"[^"\n]*"\s*\+\s*(?:Date\.now\(\)|new Date\(\)\.getTime\(\)))|(?:(?:Date\.now\(\)|new Date\(\)\.getTime\(\))\s*\+\s*"[^"\n]*")/g,
        ) || []
      ).length;
      return hits;
    },
  },

  /* ── P34「ComfyUI 报错 → 可行动建议」（硬闸，§16.2.4.37）────────────────
   * 形态：**建议文案与判据词表在同一处** —— 即同一文件里既有
   * `建议：` 这类行文开头，又有「报错形态」的正则（`out of memory` /
   * `checkpoint` / `econnrefused` / `not installed` 这类 ComfyUI 报错的特征词）。
   *
   * ⚠️ **两个条件必须同时成立**：只数「建议」会把界面上任何一句提示算上；
   * 只数特征词会把**读过原文并原样展示**的落点算上（那是对的写法 ——
   * 判据要拦的是「自己又写了一份词表」）。
   *
   * 出口：`~/lib/comfyui/error-advice` 的 `adviseOnError` / `adviseWithFallback`。
   * 收口前两处（任务历史卡、画布节点错误面板）各写一份词表，同一句报错在两处
   * 给出的建议不同，且告警词表互相漏项。
   */
  P34: {
    label:
      "自写「ComfyUI 报错 → 建议」的规则表（应使用 ~/lib/comfyui/error-advice 的 adviseOnError）",
    count: (t) => {
      const t2 = stripComments(t);
      const hasAdviceText = /建议[:：]/.test(t2);
      if (!hasAdviceText) return 0;
      const faultRe =
        /out of memory|OOM|cuda out|tried to allocate|checkpoint|ckpt|\.safetensors|econnrefused|econnreset|fetch failed|server_busy|prompthelperror|not installed/i;
      const literalRe = /\/(?:[^/\\\n]|\\.)*\/[gimsuy]*/g;
      const literals = t2.match(literalRe) || [];
      return literals.some((re) => faultRe.test(re)) ? 1 : 0;
    },
  },

  /* ── P35「把新节点放进画布」（硬闸，§16.2.4.38）─────────────────────────
   * 形态：视图 / 逻辑层里**亲手拼一个画布节点对象** —— 同一片段里既有
   * `type: "canvasNode"`，又有 `position:`。
   *
   * ⚠️ 只数 `id: makeNodeId()` 会把「只改 data 的节点更新助手」与
   * `makeNodeId` 的单测一起算上；只数 `position:` 会把连线的 `position`
   * （下拉锚点、菜单坐标）算上。两个锚点一起才咬住「新建一个节点」。
   *
   * 出口：`~/lib/project-canvas/canvas-helpers` 的 `placeCanvasNode`
   *（取落点 → 换算 → 组节点 → 追加四步一次给全）。收口前三个入口各写一遍，
   * `screenToFlowPosition` 的入参含义在 `use-canvas-drop` 的注释里还写过一遍
   * 反的（注释说 client 坐标、代码传的是 flow 坐标）。
   */
  P35: {
    label:
      "视图 / 逻辑层里亲手拼画布节点（应使用 ~/lib/project-canvas/canvas-helpers 的 placeCanvasNode）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 判据取「同一片段里同时出现 `type: "canvasNode"` 与 `position:`」——
       * 窗口取 300 字符（与 P17 的 160 字符同款：太大会把相邻的两个对象
       * 连起来误报，太小会漏掉 `data` 比较长的节点）。
       * ⚠️ 不用「花括号配对」取块：节点对象里**必然**嵌套 `position: { x, y }`，
       * `\{[^{}]*\}` 这种非嵌套匹配会整片漏掉（实测：反面用例自己先挂了）。 */
      const marker = /\btype:\s*"canvasNode"/g;
      let hits = 0;
      let m;
      while ((m = marker.exec(t2)) !== null) {
        const window = t2.slice(Math.max(0, m.index - 300), m.index + 300);
        if (/\bposition\s*:/.test(window)) hits += 1;
      }
      return hits;
    },
  },

  /* ── P36「把一棵树的展开状态画成缩进列表」（硬闸，§16.2.4.39）───────────
   * 形态：**同一片段里既有展开判据、又有一组手写的缩进档** —— 一棵树每往下
   * 走一层都要再手写一遍「缩进 + 子行集合容器」。
   *
   * ⚠️ 两个条件必须同时成立：
   *   · 只数缩进档（`ml-*` / `pl-*`）会把界面上的**卡片左内边距**、列表项的
   *     常规缩进算上（全库几百处）；
   *   · 只数展开判据（`isExpanded(` / `expanded &&`）会把**任何条件渲染**算上
   *     （那是无处不在的合法写法）。
   *
   * 缩进档的判据取「**同一个 class 串里既有 `ml-*`/`pl-*`，又有引导线
   * `border-l-*`**」—— 那正是「子行集合」的形态（`NodesTab` 的
   * `ml-3 … border-l-2 border-dashed … pl-3`）。窗口取 400 字符：够跨过
   * `cn(...)` 里那几行，又不至于把相邻的两个容器连起来。
   *
   * 出口：`~/components/ui/tree-rows` 的 `TreeChildren` / `TreeRow` /
   * `indentClass`（缩进档与引导线是一组语义，`expansion-set` 只管状态、
   * `Disclosure` 只管一行怎么折）。
   */
  P36: {
    label:
      "视图里手写「树的缩进档 + 子行集合容器」（应使用 ~/components/ui/tree-rows 的 TreeChildren / TreeRow）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 引导线 + 缩进同处一个 class 串 —— 即「子行集合」的形态。 */
      const railRe =
        /["'`][^"'`\n]*\b(?:ml|pl)-(?:2|3|4|5|6|8)\b[^"'`\n]*\bborder-l-\d\b[^"'`\n]*["'`]/g;
      const rails = t2.match(railRe) || [];
      if (rails.length === 0) return 0;
      /* 展开判据：`isExpanded(` 这类读取，或 `<flag> && (` 条件渲染。 */
      const expandRe =
        /isExpanded\s*\(|\b(?:isOpen|open|expanded|expand\w*)\s*&&/;
      return expandRe.test(t2) ? rails.length : 0;
    },
  },

  /* ── P37「一屏多条目、一次只忙一条」（硬闸，§16.2.4.40）─────────────────
   * 形态：**单值忙碌位的声明**，或**把它与条目 id 比较**。
   *
   * ⚠️ 不能只数 `useState<string | null>` —— 那是全库「当前选中项」的通用写法
   *（菜单 id / 激活项 / 悬停项），会把几百处合法代码算进来；忙碌语义由**变量名**
   * 给出（`…BusyId` / `…retry…Id`）—— 与 P30 同款：变量名是这条账里唯一能区分
   *「忙碌位」与「选中位」的记号。
   *
   * ⚠️ 也不能要求「同一文件里同时出现两样」—— 控制器的声明
   *（`use-history-list`）与视图的比较（`HistoryList`）常常分处两个文件。
   *
   * 出口：`~/components/ui/use-item-action` 的 `useItemAction`
   *（忙标记 + `isBusy` 判据 + 同步 `ref` 判重入 + 随条目消失收敛）。
   */
  P37: {
    label:
      "视图 / 逻辑层里自写「某一条在忙」的执行态（应使用 ~/components/ui/use-item-action 的 useItemAction）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件直接跳过 —— 它的忙位由 `useItemAction` 给。 */
      if (/useItemAction/.test(t2)) return 0;
      const slotRe =
        /(?:const|let)\s*\[\s*(\w+)\s*,[^\]]*\]\s*=\s*(?:React\.)?useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\)/g;
      let hits = 0;
      let m;
      while ((m = slotRe.exec(t2)) !== null) {
        if (isBusySlotName(m[1])) hits += 1;
      }
      /* 视图侧的比较形态：`<busy 名字> === <x>.id`。 */
      const cmpRe = /\b(\w*[Bb]usy\w*|\w*[Rr]etry\w*Id\w*)\s*===?\s*\w+\.id\b/g;
      while ((m = cmpRe.exec(t2)) !== null) {
        if (isBusySlotName(m[1])) hits += 1;
      }
      return hits;
    },
  },

  /* ── P38「读一个元素的几何」（硬闸，§16.2.4.41）────────────────────────
   * 形态取**算式**，不取「有没有调 `getBoundingClientRect`」。
   *
   * ⚠️ 只读尺寸不写（对齐检查）是合法的；这条账里更差的一半恰恰是
   * **先减了、再滚**（或先除了、再定位）那几处，而它们的
   * `getBoundingClientRect` 看着都正常 —— 与 P13「更差的那种也要数」同源。
   *
   * ⚠️ ④（自接 `ResizeObserver`）**必须两个条件同时成立**：单数
   * `new ResizeObserver(` 会把合法用途算上（`use-library-wire-flow` 用它观测
   * 节点内容变化并调 `updateNodeInternals`，那是 React Flow 的约定用法）。
   *
   * 出口：`~/lib/dom-rect` 的 `readElementBox` / `offsetWithin`、
   * 「同一坐标系里的包含判断」`isWithinViewport`、「行高估算」`readLineHeight`、
   * 「居中落点」`centerLineScrollTop`、「锚点矩形冻结与装配」
   * `rectToAnchorRect` / `anchorRectToVirtualElement`；接线走
   * `~/components/ui/use-element-box`。
   */
  P38: {
    label:
      "视图 / 逻辑层里手写元素几何的算术（应使用 ~/lib/dom-rect 的 offsetWithin / readLineHeight 等，量测接线走 use-element-box）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过。 */
      if (/use-element-box/.test(t2)) return 0;
      let hits = 0;
      /* ① 两个 rect 相减 / 相加（面板内偏移、相对定位）。 */
      const rectDiff =
        /getBoundingClientRect\s*\(\s*\)[\s\S]{0,120}?[-+]\s*[\s\S]{0,120}?getBoundingClientRect\s*\(\s*\)/g;
      hits += (t2.match(rectDiff) || []).length;
      /* ② 行高估算：`scrollHeight` 与另一个量做除法。 */
      const lineHeight = /scrollHeight\s*[/]|[)]\s*[/]\s*\w*[Ll]ines?\.length/g;
      hits += (t2.match(lineHeight) || []).length;
      /* ③ 用 `clientHeight` / `clientWidth` 算落点（除以 2、加偏移）。 */
      const viewportMath =
        /client(?:Height|Width)\s*[/]\s*2\b|client(?:Height|Width)\s*[+-]\s*\w/g;
      hits += (t2.match(viewportMath) || []).length;
      /* ④ 自己接线量测：`new ResizeObserver(` **且**手写等值判断落状态。 */
      if (
        /new\s+ResizeObserver\s*\(/.test(t2) &&
        /prev\.(?:width|height|client\w+|scroll\w+)\s*===\s*(?:next|rect|box|el|element)\b/.test(
          t2,
        )
      ) {
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P39「等一帧再做事」（硬闸，§16.2.4.42）────────────────────────────
   * 形态取「**裸的一帧调度**」，而不取「有没有调 `requestAnimationFrame`」：
   * `use-fps` 与 `WorkflowEditorInner` 的贴合循环是**帧循环**（`step` 自递归
   * 采样 / 收敛判断），不是「等这一轮落定再做下一件事」，形态不同、不该算。
   *
   * ⚠️ 判据要同时看两样 —— 「调了 rAF」且「回调体里没有再次 rAF 自己」：
   * 只数前者会把上面那两处循环算进来（它们是合法的采样器）。
   *
   * ⚠️ 取消是可选的**写法**，但「不取消」是这条账里真实的一半缺陷：三处
   * `use-custom-nodes-settings` 与 `json-viewer` 的高亮注入都写在 effect 里而
   * 没有清理，effect 因依赖抖动重跑时旧帧仍会落地（往已经翻走的面板上滚一次）。
   * 出口的返回取消函数就是为这件事存在的，判据不单独数它 —— 换用出口即自动有。
   *
   * 出口：`~/lib/next-frame` 的 `onNextFrame`（一帧，读刚渲染出来的 DOM）与
   * `afterNextPaint`（两帧，等三方布局库重排完成）。
   */
  P39: {
    label:
      "视图 / 逻辑层里裸写「等一帧再做事」的调度（应使用 ~/lib/next-frame 的 onNextFrame / afterNextPaint）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过。 */
      if (/from\s+"~\/lib\/next-frame"/.test(t2)) return 0;
      let hits = 0;
      const re =
        /(?:window\.)?requestAnimationFrame\s*\(\s*\(?\s*(\w+)?\s*\)?\s*=>/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        const param = m[1];
        /* 帧循环：回调体内再次 rAF（`step` / `tick` 这类自递归采样器）。
         * 取回调体前 900 字符，够跨过循环里的收敛判断与视口下发。 */
        const body = t2.slice(m.index, m.index + 900);
        if (
          param &&
          new RegExp(`requestAnimationFrame\\s*\\(\\s*${param}\\b`).test(body)
        ) {
          continue;
        }
        /* 双 rAF（`rAF(() => rAF(cb))`）同样计入 —— 它是同一件事的另一档。 */
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P40「复制到剪贴板之后给什么反馈」（硬闸，§16.2.4.43）──────────────
   * 形态取「**调了剪贴板写入出口**」，而不取「有没有 `navigator.clipboard`」——
   * 后者已在 P5 收口（全库只剩 `~/lib/browser-io` 一处实现）。P5 之后剩下的
   * 问题变成：**成败之后界面说什么**，而它在 14 个落点里有六种答案：
   *
   *   · 完全静默（`void copyText(…)`）—— ShellTabs / DebugChainFooter /
   *     ResultCard / ErrorPanel ×2 / `log-export`，其中三处连注释里的理由都不一样
   *    （「按钮上有 flash」/「用户可手动选中」/ 干脆没写）；
   *   · `useFlashState` 亮一下 —— ProjectOutputs / WorkflowNodeJsonPopover /
   *     settings 的 `UsageTestDialog`；
   *   · `toast.success` + `toast.error` —— `use-history-detail-actions` 的复制路径；
   *   · 进 `runAsyncAction` 的成功文案 —— `use-history-list` 的「重试」实为复制；
   *   · 三态 `setOutcome("done" | "failed")` —— `logs/LogRow`；
   *   · 只判 `if (await copyText(…))` 不写失败分支 —— settings 页的加载错误复制。
   *
   * 也就是说 —— **「复制失败了界面说不说、成功了亮不亮」取决于它是哪一处写的**。
   * 用户可见结果是**不同的**：同一句「剪贴板不可用」在一种写法下能落到眼前、
   * 在另一种下连按钮都不变（用户以为复制成功了）。
   *
   * 出口：`~/components/ui/use-copy-feedback` 的 `useCopyFeedback` —— 把
   * 「写剪贴板 → 按成败执行调用处给的反馈」收一次；反馈形态（flash / toast /
   * 行内）仍由调用处决定（那是表现层选择，与 `~/lib/async-action` 同款口径）。
   */
  P40: {
    label:
      "视图 / 逻辑层里裸调 copyText 而不接反馈出口（应使用 ~/components/ui/use-copy-feedback 的 useCopyFeedback）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过；出口自身的实现文件也跳过。 */
      if (/use-copy-feedback/.test(t2)) return 0;
      if (t2.includes("~/lib/browser-io")) {
        /* 允许「只是 import 了 copyText 但没调」的情形 —— 计数靠下面的调用。 */
      }
      let hits = 0;
      /* `copyText(` / `copyLogText(` 的**调用**（不是 import 行）。 */
      const re = /\bcopy(?:Text|LogText)\s*\(/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        const line = t2.slice(
          Math.max(0, t2.lastIndexOf("\n", m.index)),
          m.index,
        );
        if (line.includes("import") || line.includes("export function"))
          continue;
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P41「REST 路由的入参收窄」（硬闸，§16.2.4.44）────────────────────
   * 形态取**两样之一**：① 手写 `isRecord` 收窄守卫；② POST 路由里
   * 「取 JSON 体 → 判是不是对象 → 回 400」那一段入参收窄。
   *
   * ⚠️ 「必填字段校验」不在这条账里：每个端点的字段语义各不相同
   *（`messages` 不能为空 / `image` 必须存在 / `stage` 要能解析），那是域判据。
   * 这条账管的是**在那之前**的公共三步 —— 读得到 JSON 吗、它是不是对象、
   * 不是的话回什么信封。
   *
   * ⚠️ 收口前的实测分歧正是它的价值：5 个文件逐字相同的 12 行；`custom-nodes`
   * 与 `llm/test` 用 `req.json().catch(() => ({}))` —— **畸形 JSON 被静默当成
   * 空对象**，于是同一个坏请求在一种写法下回 `400 请求格式错误`、在另一种下
   * 走到「字段缺失」分支回一句完全无关的话；`workshop/logs` 又把 `isRecord`
   * 就地展开成 `typeof body === "object" && body !== null`；**`llm/test` 与
   * `llm/models` 的 `await currentServerUser();` 丢弃了返回值** —— 鉴权写了
   * 但没判（这两处另有独立修复，见 §16.2.4.44 ③）。
   *
   * 出口：`~/server/lib/request-body` 的 `readJsonRecord`（读 + 判 + 回 400
   * 一次给全）/ `isRecord`（`unknown` 收窄的唯一实现处）。
   */
  P41: {
    label:
      "REST 路由里自写入参收窄 / 自己定义 isRecord（应使用 ~/server/lib/request-body 的 readJsonRecord / isRecord）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 出口自身的实现文件跳过。 */
      if (/server\/lib\/request-body/.test(t2)) return 0;
      let hits = 0;
      /* ① 自己定义 `isRecord`（9 处里 8 处是逐字相同的实现）。 */
      hits += (t2.match(/function\s+isRecord\s*\(/g) || []).length;
      /* ② 入参收窄三步：`req.json()` + 400 信封。 */
      if (
        /(?:req|request)\.json\s*\(/.test(t2) &&
        /NextResponse\.json\(\s*\{[^}]*error/.test(t2)
      ) {
        hits += 1;
      }
      return hits;
    },
  },

  /* ── P42「错误文案里的『动作前缀』」（硬闸，§16.2.4.45）─────────────────
   * `~/lib/error-message` 的 `errorMessage` 早已是「详情」那一半的唯一出口，
   * 但「**是哪个动作失败了**」那一半在收口前有四种写法并存：
   *
   *   · 模板串硬拼 —— `` `工作流列表加载失败：${errorMessage(e, "未知错误")}` ``
   *     （`use-workflow-library` ×2、`server/film/orchestrator` ×2、
   *     `use-cancel-task`）；
   *   · `+` 拼 —— `"无法读取文件：" + errorMessage(e, "未知错误")`
   *     （`use-workflow-import`）；
   *   · **绕开 `errorMessage`** —— `"读取配置失败：" + String(e)`
   *     （`use-custom-nodes-settings` ×4）、
   *     `` `${err instanceof Error ? err.message : "未知错误"}` ``
   *     （`usage-field-editor`）、`"启动解析进程失败：" + e.message`
   *     （`api/custom-nodes` ×2）；
   *   · 动作名被当成 `errorMessage` 的 **fallback 参数** ——
   *     `errorMessage(e, "保存失败")`。这一档**不算违规**（结果自然就是
   *     「保存失败」），但它表达不了「动作 + 详情」两段式，所以本条判据
   *     只管前三档。
   *
   * 第三档才是真正的缺陷：`String(e)` 对 `new Error("")` 产出 `"Error"`、
   * 对 tRPC 的对象抛值产出 `"[object Object]"`，而且**绕过网络层翻译** ——
   * 同一个文件里其它落点走 `errorMessage`，于是用户会在同一块面板上看到
   * 两种质量并存的文案。
   *
   * 判据取**「动作前缀 + 冒号 + 紧跟一个错误取值动作」这个签名**：
   *
   *   ① 一个以动作名结尾的字符串字面量 / 模板串尾，紧跟全角或半角冒号；
   *   ② 冒号之后 40 字符内出现 `errorMessage(` / `String(e…)` / `.message` /
   *      `instanceof Error` 之一。
   *
   * 两个条件同时成立才计 —— 只数冒号会把任何「标题：正文」的界面文案算上
   *（那是合法的），只数 `String(` 会把日志里的其它转换算上。
   *
   * 出口：`~/lib/error-message` 的 `errorText(e, action, fallback?)`。
   */
  P42: {
    label:
      "视图 / 逻辑 / 服务端里自拼错误文案的「动作前缀」（应使用 ~/lib/error-message 的 errorText）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（与 P39/P40 同款：换用出口即自动合规）。 */
      if (/\berrorText\s*\(/.test(t2)) return 0;
      let hits = 0;
      /* ① 「…：」紧跟 ② 错误取值动作。冒号可为全角或半角（+ 空格）。 */
      const re = /[：:]\s*\+?\s*\$?\{?/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        /* 前缀那一侧必须有**出错语义**的字面量 —— 否则只是普通的
         * 「标题：正文」界面文案（判据太宽会逼人改坏文案）。
         *
         * 词表取实测出来的四类：`失败` / `异常` / `错误` / `无法`（含「不能」
         * 与「读取不出来」这类）。`无法读取文件：` 是这条账里的真实落点，
         * 只认「失败」会把那一处整个漏掉 —— 而漏掉的那一半恰恰是最常见的一档。 */
        const before = t2.slice(Math.max(0, m.index - 40), m.index);
        if (!/(失败|异常|错误|出错|无法|不能|未找到|不存在)/.test(before))
          continue;
        const after = t2.slice(m.index, m.index + 60);
        if (
          /errorMessage\s*\(/.test(after) ||
          /String\s*\(\s*(?:e|err|error)\b/.test(after) ||
          /\bcatch(?:Message|Message)\s*\(/.test(after) ||
          /instanceof\s+Error/.test(after) ||
          /\b(?:e|err|error)\.message\b/.test(after)
        ) {
          hits += 1;
        }
      }
      return hits;
    },
  },

  /* ── P43「复制失败时那句提示」（硬闸，§16.2.4.46）───────────────────────
   * 这是 P40 的**下一层**。P40 把「成败之后界面说不说」收口之后，剩下的是
   * **说了什么** —— 实测 10 个落点给失败提示时每一处都手写同一句话，而有
   * **5 种变体**（`请手动选中后复制` ×5 / `请手动选中复制` ×1（漏了「后」）/
   * `请在下方展开后手动选中复制` ×2 / `请手动选中日志后复制` ×1 /
   * `请到创作台手动重跑` ×1）。
   *
   * 判据取**固定句的语义内核**「剪贴板不可用」（浏览器拒绝写剪贴板的唯一原因，
   * 与落点无关），而不取「复制失败」四个字 —— 后者是**标题**，与
   * `errorText` 的动作前缀同族，各面板本来就该说得不一样。
   *
   * 出口：`~/components/ui/use-copy-feedback` 的 `copyFailureText(target?)` ——
   * 固定句走出口、**界面位置**（只有调用处知道的事）经参数注入。
   */
  P43: {
    label:
      "视图 / 逻辑层里手写「复制失败」的固定提示句（应使用 ~/components/ui/use-copy-feedback 的 copyFailureText）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/\bcopyFailureText\s*\(/.test(t2)) return 0;
      return (t2.match(/剪贴板不可用/g) || []).length;
    },
  },

  /* ── P44「把一段文本按最大长度截断」（硬闸，§16.2.4.48）──────────────────
   * 全库十余处各写一遍「超长就切一刀」，而**长度上限、截断方向、省略标记**
   * 三件事各写各的：上限 600 / 2000 / 4000 / 8000 散落，标记有 `…` /
   * `\n…(truncated)` / `…(truncated, 原始 N 字符)` / **什么都不加**。
   *
   * ⚠️ **上半限的判据要取对，否则误报会把判据逼成噪音**：本仓库里
   * `slice(0, 8)` / `slice(0, 12)` 大量出现在「id / sha 短码」上
   * （`taskId.slice(0, 12)`、`hash.digest("hex").slice(0, 8)`），那些**不是**
   * 本条账 —— 短码本来就是完整标识，旁边的 `…` 是显示约定而不是「这段被切了」。
   * 两条账的分界是**量级**：prose 的预算是「一句话 / 一行」（≥ 24），
   * 短码是「几个字符」（≤ 16）。判据因此取 **N ≥ 24**。
   *
   * 判据：`slice(0, N)` / `substring(0, N)`（N ≥ 24）**且**同一条语句里
   * 出现省略标记（`…` / `truncated`）—— 两个条件同时成立。
   * 出口：`~/lib/text-clamp` 的 `clampText`（上限走具名常量，见该模块）。
   */
  P44: {
    label:
      "视图 / 逻辑 / 服务端里自写文本截断（应使用 ~/lib/text-clamp 的 clampText）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/\bclampText\s*\(/.test(t2)) return 0;
      return (
        t2.match(
          /\.(?:slice|substring)\(0, *(?:2[4-9]|[3-9][0-9]|[0-9]{3,})\)[^;\n]{0,40}(?:…|truncated)/g,
        ) || []
      ).length;
    },
  },

  /* ── P45「一个异步动作重试几次、退避多久」（硬闸，§16.2.4.49）────────────
   * 三处各写一份重试策略（WS 重连 / history 轮询 / Ollama 就绪），形状只有
   * 两种（指数退避 + 上限 / 固定间隔 + 有界次数），但**没有任何一处说明
   * 为什么这一处用指数、那一处用固定**。
   *
   * 判据取**指数退避的算术**这个签名 —— `… * 2 ** …`（含 `Math.pow(2, …)`）
   * 与本项目的「退避」语义**一一对应**：固定间隔里不出现 `2 **`，而
   * `2 **` 在本仓库唯一的用途就是退避（没有第二类用法）。
   * 这条判据**不**数固定间隔的循环（那太宽 —— `for (let i = 0; i < 5; i++)`
   * 到处都是），固定间隔一侧由具名常量（`retry-policy` 的 `*.baseMs` /
   * `*.maxAttempts`）在 Code Review 与 import 侧约束。
   *
   * 出口：`~/lib/retry-policy` 的 `backoffDelayMs` + 具名策略。
   */
  P45: {
    label:
      "视图 / 逻辑 / 服务端里自写指数退避算术（应使用 ~/lib/retry-policy 的 backoffDelayMs）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/\bbackoffDelayMs\s*\(/.test(t2)) return 0;
      return (t2.match(/\* *2 *\*\*|Math\.pow\( *2 *,/g) || []).length;
    },
  },

  /* ── P46「把一个日期写成可读格式」的**只写日期**那一档（硬闸，§16.2.4.50）─
   * `time-format` 早先收了「相对时间」与「时刻」，但「只写日期」那一档
   * （`YYYY-MM-DD` 在历史日期桶 / 消息中心 / 按天文件名三处各拼一遍；
   * `MM-DD` 行首前缀又一份）与**本地时间戳**（`YYYY-MM-DD HH:mm:ss` 在 6 处
   * runtime / 日志模块逐字相同）没有出口。
   *
   * 判据取**手拼日期的形态**：「`getFullYear()` 后面紧跟 `}-`」（即
   * `` `${d.getFullYear()}-…` `` 这个串）。它精确到「正在把年拼进一个日期串」，
   * 不会命中 `getMonth()` 的其它用法（如 `isSameDay` 的比较）。
   * 出口：`~/lib/time-format` 的 `formatDate` / `formatShortDate` /
   * `formatLocalStamp` / `formatCompactStamp`。
   */
  P46: {
    label:
      "视图 / 逻辑 / 服务端里手拼日期串（应使用 ~/lib/time-format 的 formatDate 家族）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/\bformat(?:Date|ShortDate|LocalStamp|CompactStamp)\s*\(/.test(t2))
        return 0;
      return (t2.match(/getFullYear\(\)\}-/g) || []).length;
    },
  },
  /* ── P47「扩展名 ⇄ MIME 类型」的映射表（硬闸，§16.2.4.51）──────────────
   * 同一件事在全库有 **6 份互不相同的映射表**，而它们互相矛盾：
   * `image/avif` 只在其中两份里有、`image/webp` 在一份里缺，`api/generated`
   * 那份还多背了 `text/plain` / `application/json`（它服务磁盘上的任意产物）。
   * 同一个上传文件在「走 resolveMediaBytes 兜底」与「走 prepare 路由落盘」
   * 两条路径上会得到不同的扩展名与 Content-Type。
   *
   * 判据锚**映射表的形态**：一条形如 `"image/xxx": "ext"` 或 `".ext": "image/xxx"`
   * 的字面量对。它精确到「正在把扩展名与 MIME 记成一张表」，不会命中
   * 单个 `?? "image/png"` 兜底（那是调用处的域选择，另算）。
   * 出口：`~/lib/media/mime-ext` 的 `mimeForExt` / `extForMime` /
   * `extOfPath` / `stemOfPath` / `contentTypeForPath`。
   */
  P47: {
    label:
      "视图 / 逻辑 / 服务端里自写「扩展名 ⇄ MIME」映射表（应使用 ~/lib/media/mime-ext）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (
        /\b(?:mimeForExt|extForMime|extOfPath|stemOfPath|contentTypeForPath)\s*\(/.test(
          t2,
        )
      )
        return 0;
      const mimeToExt =
        t2.match(/"\w[\w.+-]*\/[-\w.]+"\s*:\s*"[a-z0-9]{2,5}"/g) || [];
      const extToMime =
        t2.match(
          /"\.?[a-z0-9]{2,5}"\s*:\s*"(?:image|video|audio)\/[-\w.+]+/g,
        ) || [];
      return mimeToExt.length + extToMime.length;
    },
  },

  /* ── P48「`unknown` 当宽松对象视图读」（硬闸，§16.2.4.52）────────────────
   * 收口前全库有 **四份**这个实现，而它们**各叫各的名字**：
   *   workflow-utils 的叫 `asRecord`、`lib/comfyui/raw` 的也叫 `asRecord`、
   *   `api-channel-core` 的**叫 `isPlainRecord` 却不排除数组**、
   *   `use-param-wiring` 的叫 `isPlainRecord`（真排除数组）。
   * 第三处最危险：与 `~/lib/is-record` 的严格版**同名不同义**。
   *
   * 判据锚**转成视图**的那一处形态：`typeof X === "object" && X !== null`
   * 之后紧跟 `as Record<string, unknown>`（同一变量名，反向引用钉住）。
   * 出口：`~/lib/is-record` 的 `isRecord` / `isPlainRecord` / `asRecord`。
   *
   * ⚠️ **判据刻意不数另外两种形态**（写宽了会逼人改坏代码）：
   *   · `typeof e === "object" && e !== null && "message" in e` —— 这是
   *     「就地读一个字段」，用出口要写成 `asRecord(e)?.message` 再判类型，
   *     反而多一层（`error-message.ts` / `repository-user.ts` 属此类）；
   *   · 取反早退守卫（`if (typeof body !== "object" || body === null) return null`）——
   *     取反早退的**守卫**，收窄后立刻用掉，没有「视图」这回事
   *     （`api-error.ts` / `comfy-readiness-client.ts` 属此类）。
   *   第一版判据把这两种一起算进来，实测报出 **24 处**，其中一半是上面两种 ——
   *   与 P44「N ≥ 24」、P45「不数固定间隔」同一条教训：**判据太宽会逼人改坏**。
   * 豁免 `is-record.ts` 自身（定义处）。
   */
  P48: {
    label:
      "视图 / 逻辑 / 服务端里自写「unknown 当宽松对象视图」（应使用 ~/lib/is-record 的 isRecord / asRecord）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/from "~\/lib\/is-record"/.test(t2)) return 0;
      /* 锚**转成视图**的形态：`typeof X === "object" && X !== null` 之后
       * 紧跟 `as Record<string, unknown>`。**不**数「收窄后取一个字段」
       * （`typeof e === "object" && e !== null && "message" in e`）与
       * 「取反早退」（`if (typeof body !== "object" || body === null) return null`）
       * —— 那些是**就地读字段**，不是「把 unknown 变成一个可下钻的视图」，
       * 硬套出口只会逼人写 `asRecord(x)?.field` 再拼一层。
       * 同一变量名（`\1` 反向引用）是判据的一部分：`A !== null` 却 `as` 的是
       * 另一个变量时，这不是同一个视图。 */
      return (
        t2.match(
          /typeof (\w+) === "object" && \1 !== null[\s\S]{0,40}?as Record<string, unknown>/g,
        ) || []
      ).length;
    },
  },

  /* ── P49「把一段文本变成安全的文件名片段」（硬闸，§16.2.4.53）──────────
   * 同一件「非法字符换成 `_`」在全库有 **四份各不相同的正则**，差异没有
   * 一处写下来：保留点与不保留点、保留 CJK 与吃掉 CJK 互相矛盾
   * （同一个中文名在 bgm 上传路径被保留、在工坊产出目录被替换成下划线）。
   *
   * 判据锚**那条替换形态**：`replace(/[^…]/g, "_")` —— 精确到「把一批字符
   * 换成下划线」。不数别的 `replace`（`.` → `-`、空格归一都不在此列）。
   * 出口：`~/lib/safe-name` 的 `safeFileNameSegment` / `safeDisplayName`。
   */
  P49: {
    label:
      "视图 / 逻辑 / 服务端里自写文件名安全化（应使用 ~/lib/safe-name 的 safeFileNameSegment / safeDisplayName）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/\b(?:safeFileNameSegment|safeDisplayName)\s*\(/.test(t2)) return 0;
      return (t2.match(/replace\(\/\[\^[^\]]*\]\+?\/g, *"_"\)/g) || []).length;
    },
  },

  /* ── P50「把一个数字按某档精度写成字符串」（硬闸，§16.2.4.54）──────────
   * 全库 26 处 `toFixed(`，四派写法都编译、都运行、类型都对，差别只在
   * **几个语义决定**上：小数位从哪来、末尾的零要不要留、整数要不要也进
   * 格式化、大数值要不要绕开。还有一处更隐蔽的
   * `(Math.round(v * 100) / 100).toFixed(2)` —— **两层舍入**。
   *
   * 判据锚 `toFixed(` **这个 API 本身**：它是本条账唯一的签名
   *（`Math.round(v * 100) / 100` 那类写法里也必然有一个 `toFixed`）。
   * 不数 `Math.round(` 或 `padStart(` —— 那些是别的账（像素取整 / 补零），
   * 数进来会逼人改坏代码。
   *
   * 出口：`~/lib/number-format` 的 `fixed` / `trimmed` / `trimFixed` /
   * `alphaText`。
   */
  P50: {
    label:
      "视图 / 逻辑 / 服务端里自写数字精度格式化（应使用 ~/lib/number-format）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/number-format"/.test(t2)) return 0;
      return (t2.match(/\.toFixed\(/g) || []).length;
    },
  },

  /* ── P51「把一组值去重 / 合并成有序集合」（硬闸，§16.2.4.55）────────────
   * `[...new Set(xs)]` 与 `Array.from(new Set(xs))` 混用，而比选型更要紧的
   * 是**排序口径也不一**（`localeCompare` 与手写 `for` 循环挑字段做键）。
   *
   * 判据锚两处**形态**，两个条件同时成立：
   *   ① `.sort((…) => …localeCompare(…)` —— 手写「按当前区域设置排序」。
   *      不数不带比较器的 `.sort()`（按字符串码位排是**另一个判据**，
   *      合法且另有所指），也不数数值比较器；
   *   ② 手写按字段去重（`const X = new Set(); … for (…) { if (X.has(k)) continue; X.add(k); … }`）
   *      —— **手写按字段去重**。这一条必须与 ① 同时成立，否则会把
   *      「Set 当索引用」（`seen` 做已读标记、邻接表 `incoming[id] = new Set()`）
   *      一起算进来 —— 那些**不是**去重集合，数进来会逼人改坏代码。
   *
   * 出口：`~/lib/ordered-set` 的 `unique` / `uniqueSorted` / `uniqueBy` /
   * `union` / `compareText`。
   */
  P51: {
    label:
      "视图 / 逻辑 / 服务端里自写去重合并 / 区域设置排序（应使用 ~/lib/ordered-set）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/ordered-set"/.test(t2)) return 0;
      return (
        t2.match(
          /\.sort\(\s*\(\s*\w+\s*,\s*\w+\s*\)\s*=>[^;\n]{0,80}localeCompare\(/g,
        ) || []
      ).length;
    },
  },

  /* ── P52「拼一个 data: URL / 读回它的载荷」（硬闸，§16.2.4.56）──────────
   * `data:${mime};base64,${…}` 手拼 3 处，读回的一侧 6 处各写一遍
   * 「找第一个逗号、后面就是 base64」。而写法**互相矛盾**：
   * `slice(indexOf(",") + 1)` 在缺逗号时会把**整个 data URL** 当 base64
   * 交给解码器（它跳过非法字符）→ 静默解出垃圾字节。
   *
   * 判据取**三条只在本条账出现的形态**：
   *   ① 字面量 `data:${…};base64,${…}`（模板串拼接）；
   *   ② `indexOf(",")` —— 精确到「从这里切 base64 载荷」这个动作；
   *   ③ `split(",")` **且同文件出现 `startsWith("data:")`** ——
   *      **更差的那一种写法**（至少判了有没有逗号，但把整个串 split 一遍）。
   *      ⚠️ 这一条必须一起数：与 P13「只数合规的那种、漏掉更差的那种」
   *      同款 —— 判据漏掉更差的写法，被拦下的就永远只是合规者
   *      （`video-task-util` 的 HEAD 版本正是 `split(",")` 那一档）。
   *      但 `split(",")` 在本仓库另有 CSV 解析的用法（`.split(",")`
   *      切 ANSI 分段 / 切节点白名单），故**两个条件同时成立**才计：
   *      `data:` 前缀与它同现，说明这个文件确实在处理 data URL。
   * **刻意不数 `startsWith("data:")`** —— SSE 帧前缀也是这个写法
   *（`lib/llm/browser` / `lib/llm/server` 的 `data: {...}`），
   * 数进来会把**流式解析**误判成本条账（那是另一件事）。
   * 代价是 `character-portrait-client` 的 HEAD 版本（只用了
   * `startsWith("data:")` 作判据）不会被本判据数到 —— 它的**实质**是
   * 「这是不是内联 media」，已由 `isInlineMedia` 收口，出口侧契约
   *（`tests/ui-primitives-coverage.test.ts`）从另一侧钉住。
   *
   * 出口：`~/lib/media/data-url` 的 `isDataUrl` / `isInlineMedia` /
   * `toDataUrl` / `wrapBase64` / `toBase64` / `parseDataUrl` 与
   * `base64PayloadOf` 七个（见规范 §16.2.4.56）。
   */
  P52: {
    label:
      "视图 / 逻辑 / 服务端里自拼或自切 data URL（应使用 ~/lib/media/data-url）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/media\/data-url"/.test(t2)) return 0;
      const writes = t2.match(/data:\$\{[^}]{0,40}\};base64,\$\{/g) || [];
      const cuts = t2.match(/indexOf\(",\"\)/g) || [];
      /* ③ 两个条件同时成立才计：`split(",")` 与 `data:` 前缀同现
       *（`split(",")` 在本仓库另有 CSV 解析的用法）。 */
      const splitCuts =
        t2.includes('startsWith("data:")') || t2.includes("data:${")
          ? t2.match(/split\(",\"\)/g) || []
          : [];
      return writes.length + cuts.length + splitCuts.length;
    },
  },

  /* ── P53「在元素上自己实现一个键盘动作」（硬闸，§16.2.4.57）────────────
   * 全库 **3 处**各写一遍键判别（`ShellTabs` / `TitleBarTabs` 的页签、
   * `ScriptMarkdownEditor` 的 Tab 缩进），而它们对三件事各判各的：
   *   · **键名叫什么** —— `" "` 还是 `"Space"`、要不要大小写归一
   *     （无修饰单键的 `event.key` 是**带 Shift 的大写字符**）；
   *   · **要不要 `preventDefault`** —— 混在同一个 `if` 里，看不出谁决定的；
   *   · **`event.repeat` 收不收** —— 按住空格会连发。
   *
   * 判据取**一个 `onKeyDown` 里直接拿 `event.key` 与字面量比**这个形态。
   * 键名比对只许经 `~/lib/keyboard` 的 `normalizeKeyName` / `isKeyIn`
   * 或 `~/components/ui/simple-key-handler`（两者共用同一份归一规则）。
   *
   * **不数** `if (event.key === …)` 出现在别处的形态？——数量是全部：
   * 收口后本仓库所有「元素上的键动作」都走这两个出口，`use-hotkey`
   * （全局监听）与 `use-enter-commit`（输入框）另有各自更细的判据，
   * 它们的实现文件在 `EXEMPT_FILES.P53` 里显式登记。
   */
  P53: {
    label:
      "视图里手写 onKeyDown 的键判据（应使用 ~/components/ui/simple-key-handler 或 ~/lib/keyboard 的归一）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (
        /from "~\/lib\/keyboard"/.test(t2) ||
        /from "~\/components\/ui\/simple-key-handler"/.test(t2)
      ) {
        return 0;
      }
      /* 形态：**键盘事件**的 `.key` 与一个字面量比。
       *
       * ⚠️ 锚点必须落在**事件对象**上，不能只锚 `.key` —— 本仓库的
       * `UsageField.key`（结果字段名）也叫 `.key`，只锚 `.key` 会一次报出
       * 6 处「`f.key === "mode"`」这种**数据字段比较**（实测）。
       * 故要求左侧是**键盘事件名**（`event` / `e` 及 `…Event` 结尾者）。
       * 这也把「`onKeyDown` 只转发不判键」正确放过（那条不是本判据的账）。
       *
       *  **已知边界（刻意不判）**：把键名**解构**出来再比
       *（`({ key }: KeyboardEvent) => key === "Tab"`）不在本判据内 ——
       *  那个 `key` 已经脱离了「事件对象」这个名字，机器判不出它是事件字段
       *  还是数据字段。与 P37「忙碌位」、P30「错误位」同款：
       *  按名字判的部分只判能判的那一半，剩下的一半由 Review 兜。 */
      return (
        t2.match(
          /\b(?:e|ev|evt|event|[A-Za-z]+Event)\.key\s*[!=]==?\s*["'`]/g,
        ) || []
      ).length;
    },
  },

  /* ── P54「剥掉 / 判断 SGR」（硬闸，§16.2.4.58）────────────────────────
   * 同一条形态 `\x1b\[[0-9;:]*m` 在 **4 处**各写一遍，而它们**判据不同**：
   *   · `lib/log/log-ansi` 的 `SGR_RE` —— 转义符必须在；
   *   · `logs/log-record` 的 `stripSgr` —— 连**残缺颜色码**（只剩 `[90m`）
   *     一起剥，少剥这层会在面板上显示成 `[[OK]【[90m[OK[0m] …`；
   *   · `logs/log-row-style` 的 `hasAnsi` —— 只判不改；
   *   · `lib/session-banner.server` 与 `log-sessions` —— **写侧与读侧**各持
   *     一份同样的颜色码字面量（写侧改色、读侧就认不出自己写的横幅）。
   *
   * 判据锚**转义符字面量本身**（`\x1b[` 或 `\u001b[`）—— 它只该出现在
   * 出口里。`\x1b` 单独出现（如光标移动）不在此列：那是另一条账。
   */
  P54: {
    label:
      "视图 / 逻辑 / 服务端里自写 SGR 转义序列（应使用 ~/lib/log/log-ansi 的 hasSgr / stripSgr / stripAnsi / BANNER_ANSI）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 形态：转义符字面量（`\\x1b` 或 `\\u001b`）后面在**同一个序列内**
       *  出现 `m` 收尾 —— 即「一条 SGR」。中间形态在本仓库有两种写法
       *  （正则里的 `\\[`、字符串里的 `[`），故不把「中间长什么样」写进判据；
       *  单独的 `\\x1b`（光标移动 / 清屏）不在此列。 */
      return (t2.match(/(?:\\x1b|\\u001[bB]).{0,16}?m/g) || []).length;
    },
  },

  /* ── P55「标识符的书写法换算」（硬闸，§16.2.4.59）──────────────────────
   * 全库只有 1 处（`lib/shell/overlay-z` 的 `zClass`），但它把判据写在
   * 表达式里：`replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)` —— 而换算
   * 结果必须与 `globals.css` 的 `@theme` 变量逐字一致，**写错时静默**
   *（Tailwind 找不到类名不报错，只是那一层没有 `z-index`）。
   *
   * 判据锚**那条替换形态**：`/[A-Z]/g` 且同串出现 `${` 插值（即「大写字母
   * 前插连字符」）。不数别的 `[A-Z]` 用法（`toUpperCase()`、校验正则）。
   *
   * 出口：`~/lib/case-token` 的 `toKebabCase` / `toCamelCase`。
   */
  P55: {
    label:
      "自写驼峰 ⇄ kebab 换算（应使用 ~/lib/case-token 的 toKebabCase / toCamelCase）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/case-token"/.test(t2)) return 0;
      return (t2.match(/replace\(\/\[A-Z\]\/g[^;\n]{0,60}\$\{/g) || []).length;
    },
  },

  /* ── P56「把一段路径拼成可展示的相对路径 / 超长时省略中段」（硬闸，§16.2.4.60）
   * 同一件「把一条文件系统路径变成界面上的一行」散着三种各写各的写法，而它们对
   * 三件事各判各的：**相对谁**（`path.relative(REPO_ROOT,…)` / `(LOG_ROOT,…)` /
   * 原样绝对路径）、**分隔符**（`.replace(/\\/g,"/")` ×8 /
   * `.split(path.sep).join("/")` ×2 / 不归一）、**超长怎么办**（视图清一色
   * `truncate` 只留头部 —— 而路径的语义在尾部，用户看到的恰好是被切掉的那一段）。
   *
   * 判据锚**「手工把路径变成展示文本」的三种形态**：
   *   ① `path.relative(` —— 相对化，出口是 `toDisplayPath`；
   *   ② `split(/[\\/]/).pop()` / `.split("/").pop()` —— 取末段，出口是
   *     `lastSegments` / `toDisplayPath`（`path.basename` 不算：它是 Node API，
   *     在「解析已有路径」里是正确的，本条管的是展示）；
   *   ③ `.replace(/\\/g, "/")` —— 分隔符归一，出口是 `normalizeSlashes`。
   *
   * **刻意不数** `path.join` / `path.resolve` / `path.dirname`（那些在拼路径、
   * 不是展示），也不数 `path.basename`（同上）。
   *
   * 出口：`~/lib/path-display` 的 `toDisplayPath` / `stripPathPrefix` /
   * `lastSegments` / `ellipsisMiddle` / `normalizeSlashes`。
   */
  P56: {
    label:
      "视图 / 逻辑 / 服务端里手工把路径变成展示文本（应使用 ~/lib/path-display 的 toDisplayPath / lastSegments / normalizeSlashes）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/from "~\/lib\/path-display"/.test(t2)) return 0;
      /* `path.relative` 有**两种用途**：展示（本条账）与**包含判据**
       *（`const rel = path.relative(root, p); if (rel.startsWith("..") || …)`
       *  是判断「这个路径在不在 root 里」的标准写法 —— 那不是展示）。
       * 只数**紧接着不是包含判据**的那些：锚点取 `path.relative(` 之后 150 字符内
       * 没有 `startsWith("..")` / `isAbsolute`。 */
      const relative = countNonContainment(t2);
      /* 取末段：两种写法（正则分隔符 / 字面 "/"）—— 与 P50「更差的写法也要数」
       * 同款：只数规范的那一种，被拦下的就永远只是合规者。 */
      /* `/[\\/]/` 与 `"/"` 两种分隔符写法都数（与 P50/P52「更差的写法也要数」
       * 同款）。锚点：`.split(/[...]/).pop()` 或 `.split("/").pop()`。 */
      const tail =
        (t2.match(/\.split\(\/\[[^\]\n]*\]\/\)\.pop\(\)/g) || []).length +
        (t2.match(/\.split\("\/"\)\.pop\(\)/g) || []).length;
      const slashes = (t2.match(/\.replace\(\/\\\\\/g,\s*"\/"\)/g) || [])
        .length;
      const sepJoin = (t2.match(/\.split\(path\.sep\)\.join\("\/"\)/g) || [])
        .length;
      return relative + tail + slashes + sepJoin;
    },
  },

  /* ── P57「透传 props 给底层元素前先剔掉自己的私有字段」（硬闸，§16.2.4.61）
   * 十几个基元都有同一段「摘掉自己的私有字段、剩下 `...rest` 透传」，
   * 而**剔除表各写各的**：类型侧 `extends Omit<Base, "a" | "b">` 与运行时侧
   * 的解构是**两份**，必须逐字一致而没有任何机器判据。表里有、解构里漏 →
   * 该字段**静默透传给 DOM**（React 19 只给一条 console 警告），`value` /
   * `onChange` 这类漏掉的表现是「双份受控」：界面有值但状态没变。
   *
   * 判据锚**「类型侧写了一张私有字段表」这个形态**：`Omit<` 后面紧跟一个
   * **字符串字面量联合**（`Omit<X, "a" | "b">`）。出口是 `~/lib/dom-props`
   * 的 `OmitOwnProps`（表只写一遍 → 类型与运行时同源）。
   *
   * **刻意不数** `Omit<SomeModel, "id">` 这类**数据模型**的排除（它们不是
   * 「透传给 DOM 的属性」，`Omit` 在这里只是表达「这条记录还没有 id」）。
   * 形态上的分界线是 **Omit 的基类型**：只有 `React.ComponentProps<…>` /
   * `HTMLAttributes<…>` / base-ui 的 `…Primitive.…Props` / `LucideProps` /
   * `typeof <组件>` 这类「底层元素的属性集」才是本条账；`Omit<LogEntry, "seq">`
   * 那类数据记录一律不算。
   */
  P57: {
    label:
      "自写「剔掉私有 prop 再透传」的剔除表（应使用 ~/lib/dom-props 的 OmitOwnProps / splitDomProps）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/from "~\/lib\/dom-props"/.test(t2)) return 0;
      /* 形态：`Omit<` 的基类型是**底层元素 / 组件的属性集**，且第二个参数是
       * 字符串字面量键（`"a" | "b"` 或跨行的 `| "c"`）。 */
      const base =
        "(?:React\\.)?(?:ComponentProps|HTMLAttributes|InputHTMLAttributes|ImgHTMLAttributes|VideoHTMLAttributes|ButtonHTMLAttributes|AnchorHTMLAttributes|LabelHTMLAttributes|TextareaHTMLAttributes)|LucideProps|[A-Za-z]*Primitive\\.[A-Za-z.]+Props|typeof\\s+\\w+";
      const oneLine = new RegExp(
        "\\bOmit\\s*<\\s*(?:" + base + ')[^;]{0,200}?,\\s*"[^"]+"',
        "g",
      );
      const multiLine = new RegExp(
        "\\bOmit\\s*<[^;]{0,200}?(?:" +
          base +
          ')[^;]{0,300}?\\n\\s*\\|[^;]{0,200}?"[^"]+"',
        "g",
      );
      return (
        (t2.match(oneLine) || []).length + (t2.match(multiLine) || []).length
      );
    },
  },

  /* ── P58「给一个异步结果加超时」（硬闸，§16.2.4.62）
   * `Promise.race` + `setTimeout` 的样板散在六处，对三件事各判各的：
   * **定时器谁来清**（`.finally` / 两个分支各清一次 / 三个分支各清一次 /
   * 只有一个分支清）、**超时之后干什么**（`reject` / `resolve` 一个哨兵值 /
   * 杀子进程再 fail）、**时长与文案**。
   *
   * 判据锚**「一个定时器在赛跑里把 Promise 结算掉」这个形态**，两种写法都数：
   *   ① **`Promise.race(` 与 `setTimeout(` 同现** —— 最常见的一档。单看
   *     `Promise.race` 会把「两路来源谁先到用谁」那种**正确的**用法误判
   *     （`comfyui/status` 的「权威查询 vs 抢跑探测」：没有定时器、没有要清的
   *     东西，那不是这条账），故两条必须同现；
   *   ② **`setTimeout(() => … resolve(` / `reject(`** —— 手写「定时器到点就把这个
   *     Promise 结算掉」的那一档（`waitForImage` 的 `reject` / `runFFmpeg` 的
   *     `resolve` 哨兵），它们**不用** `Promise.race` 而靠「谁先结算谁算数」，
   *     一样要清定时器、一样各写各的。
   *
   * **刻意不数**：
   *   · `new Promise((r) => setTimeout(r, ms))`（「等一会儿」的 sleep，没有赛跑、
   *     没有对手 —— 但它与两个出口同属「定时器」一族，收在同一文件的 `sleep` 里）；
   *   · `setTimeout(() => void fail(…))` 这种**看门狗 / 防抖**（定时器到点**做事**，
   *     不结算任何 Promise，也不在这条账里 —— 实例是 `executor-ws.armWatchdog`
   *     与 `runner-state` 的三处 debounce）。
   *
   * 出口是 `~/lib/with-timeout` 的 `withTimeout`（超时抛错）/
   * `withTimeoutResult`（超时给兜底值）—— 两者共用一条「胜出即清定时器」的收尾。
   */
  P58: {
    label:
      "自写「给异步结果加超时」的定时器样板（应使用 ~/lib/with-timeout 的 withTimeout / withTimeoutResult）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/from "~\/lib\/with-timeout"/.test(t2)) return 0;
      /* 「必须清掉」是本条账的一半：有 `setTimeout` 却没有 `clearTimeout` 的文件
       * 是**另一种**形态（该等一个窗口就等完，没有别的路径能先赢 ——
       * `external-open.detectFolderHelper` 就是这一种），不属于本条。 */
      if (!/\bclearTimeout\s*\(/.test(t2)) return 0;
      const races = /\bsetTimeout\s*\(/.test(t2)
        ? (t2.match(/\bPromise\.race\s*\(/g) || []).length
        : 0;
      /* ② 定时器回调里结算 Promise（`resolve(` / `reject(` 就在 setTimeout 的
       * 回调体内）。锚点取「setTimeout」与「resolve/reject」在**同一条语句的
       * 200 字符内**同现 —— 手写那几档的写法都是
       * `setTimeout(() => reject(new Error(…)), ms)` 或
       * `const t = setTimeout(() => { … resolve({…}); }, ms)`。 */
      /* `[\s\S]` 而非 `[^;]`：回调体里常有 `;`（`cp.kill("SIGKILL");` 后面
       * 才是 `resolve(…)`），用 `[^;]` 会把那一档**静默漏掉**（漏掉的又恰好是
       * 更完整的那个写法 —— 与 P13/P52「更差的写法也要数」同一课）。 */
      const settles = (
        t2.match(
          /\bsettimeout\s*\([\s\S]{0,200}?\b(?:resolve|reject)\s*\(/gi,
        ) || []
      ).length;
      /* ③ 定时器回调里调一个**本地的结算助手**（`finish(` / `settle(` / `done(`）——
       * `waitForDetachMediator` 就是这样写的：它把「这一轮结束」收成 `finish()`
       *（内部判重入 + resolve），定时器到点调它。只看 `resolve(` 会漏掉这一档。
       * 这几个名字在本仓库的语义是「本轮到此为止」。 */
      const settledByHelper = (
        t2.match(
          /\bsetTimeout\s*\([\s\S]{0,200}?\b(?:finish|settle|done)\s*\(/gi,
        ) || []
      ).length;
      return races + settles + settledByHelper;
    },
  },

  /* ── P59「把一个数夹进一个区间」（硬闸，§16.2.4.63）────────────────────
   * 全库 19 处手写 `Math.min` / `Math.max` 的夹取，四派写法都编译、都运行、
   * 类型都对，差别只在**参数顺序**（`Math.min(max, Math.max(min, x))` 与
   * `Math.max(min, Math.min(max, x))` 都有人写）、**取整在内层还是外层**、
   * 以及**非有限数怎么办**（`Math.max(0, NaN)` 是 `NaN`，会一路静默传播）。
   *
   * 判据锚**两种 Math 的嵌套**这个形态签名：`Math.max(` 里包着 `Math.min(`、
   * 或反过来 —— 这正是「夹取」的形状，而**纯 max(max) / min(min) 不是**
   *（`NodeFrost` 的 `Math.max(1, 1 / Math.max(zoom, 0.01))` 是取值不是夹取），
   * 故要求**两种不同**的 Math 函数嵌套。
   *
   * 刻意**不数**「半个夹取」（`Math.max(0, x)` 只有一个边界）：那表达的是
   * 「不许为负 / 不许超过 n」，不是「放进区间」，换成 `clamp(x, 0, Infinity)`
   * 只会更绕。落点见 `LogPanel` / `log-virtual` 的防负索引。
   *
   * 出口：`~/lib/clamp` 的 `clamp` / `clampInt`。
   */
  P59: {
    label:
      "视图 / 逻辑 / 服务端里手写数值夹取（应使用 ~/lib/clamp 的 clamp / clampInt）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/clamp"/.test(t2)) return 0;
      return countNestedMinMax(t2);
    },
  },

  /* ── P60「把一个可能带空白 / 缺省的外来串归一成大写记号」（硬闸，§16.2.4.64）
   * 全库 26 处各写一遍 `(x ?? "").trim().toUpperCase()` 这一族，而它们
   * **不是同一件事**：差别只在「要不要吃空白」上 —— 而这一条决定**匹配成败**
   *（ComfyUI 的类型字段带尾随空白、模式码来自用户输入）。
   * 收口前的实况是同一个文件里两种写法并存（`model-mode-contract.ts` 的
   * `builtInModeContract` trim、`modeContractEntries` 不 trim）。
   *
   * 判据取**两种形态**，它们共同的特征是「从缺省 / 空白里取值」：
   *   ① `(x ?? "").toUpperCase()` —— 明确处理了缺省；
   *   ② `.trim().toUpperCase()` —— 明确处理了空白。
   * **刻意不数 `x.toUpperCase()`**（`x` 是类型上非空的 `string`）：那是
   * 「把已知值画成大写展示」，不是「归一外来串」，数进来会逼人改坏代码
   *（`log-store` 的行内级别、`StyleSwitcher` 的档名展示都是这一档）。
   *
   * 出口：`~/lib/upper-token` 的 `upperToken` / `upperTokenOr`。
   */
  P60: {
    label:
      "视图 / 逻辑 / 服务端里自写大写归一（应使用 ~/lib/upper-token 的 upperToken）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/upper-token"/.test(t2)) return 0;
      /* ② 先数（含 `.trim()` 的形态一并数进来）。
       * ① 再数**不带 `.trim()`** 的 `?? ""` 形态 —— 否则
       * `(x ?? "").trim().toUpperCase()` 会被两种形态各数一次（重复计）。 */
      const trimmed = (t2.match(/\.\s*trim\(\)\s*\.\s*toUpperCase\s*\(/g) || [])
        .length;
      const plain = (
        t2.match(/\?\?\s*(?:"[^"]*"|'[^']*')\s*\)\s*\.toUpperCase\s*\(/g) || []
      ).length;
      return trimmed + plain;
    },
  },

  /* ── P61「跨组件广播一条应用事件」（硬闸，§16.2.4.65）──────────────────
   * 全库 5 条自定义事件散在 9 个文件里，事件名与载荷的类型**分开两处**：
   * `comfyapp:canvas-store-changed` 的名字定义在 `lib/project-canvas` 却
   * **不导出**（视图侧 3 处硬编码字符串）、`canvas:produce` 的载荷类型只在
   * 读侧有个 `as {...}` 断言、`open-task` 与
   * `comfyapp:local-workflows-path-changed` 的**派发方已经消失**（死监听，
   * 没有任何构建 / 测试会报它）。
   *
   * 判据取**两种形态**：
   *   ① `new CustomEvent(` —— 自建应用事件；
   *   ② `window.addEventListener("…:…"` —— 订阅一个**带命名空间冒号**的事件名
   *     （应用事件的命名空间形态，与 `keydown` / `change` / `resize` 这类
   *     DOM 原生事件名区分开）。
   * 两个条件都**只认带冒号或 `new CustomEvent`** 的写法：`addEventListener("click")`
   * 这类 DOM 事件不在本条账里。
   *
   * 出口：`~/lib/app-events` 的 `emitAppEvent` / `subscribeAppEvent` +
   * `AppEvents` 表（事件名与载荷同处定义）。
   */
  P61: {
    label:
      "视图 / 逻辑 / 服务端里裸写应用事件（应使用 ~/lib/app-events 的 emitAppEvent / subscribeAppEvent）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/app-events"/.test(t2)) return 0;
      const dispatched = (t2.match(/\bnew CustomEvent\s*\(/g) || []).length;
      const namespaced = (
        t2.match(
          /\.(?:add|remove)EventListener\s*\(\s*(?:[A-Za-z_$][\w$]*\s*,\s*)?["'][a-z][\w-]*:[\w:-]+["']/g,
        ) || []
      ).length;
      return dispatched + namespaced;
    },
  },

  /* ── P62「把一组 props 转成另一个键的 props」（硬闸，§16.2.4.66）──────
   * 全库 42 处 `onChange={(e) => FUNC(e.target.value)}` 这一族：都做同一件事
   *（把 DOM 事件里取出的**值**交给只关心值的回调），而写法分四派，每一派都
   * 编译、都运行、类型都对 —— 差别只在几个从没被写下来的决定上：
   * 取 `target.value` 还是 `target.checked`；要不要就地 `Number(...)`；
   * 过滤规则写在谁那里；对象改写的**键名**靠人眼对齐（写错一个字符就静默
   * 写到另一个字段上）。
   *
   * 判据取**两种形态**（都以「事件对象的取值」为锚，不取函数名）：
   *   ① `X => FUNC(X.target.value)` —— 文本类控件的改写样板；
   *   ② `X => FUNC(X.target.checked)` —— 复选框 / 开关的改写样板。
   * **刻意不数**带语句体的处理（`onChange={(e) => { … }}`）：那一族里常常要
   * 在同一个事件里做别的事（读 `scrollHeight` 调高度、按值分派多个字段），
   * 数它只会逼人把多步逻辑塞进一个表达式去迎合判据。那一侧的合规由
   * `readTextInput` 提供（取值仍只有一处），判据够不着、也不该硬够。
   *
   * 出口：`~/lib/form-props` 的 `textHandler` / `checkedHandler` /
   * `numberHandler` / `bindKey` / `readTextInput`。
   */
  P62: {
    label:
      "视图里自写「事件值 → 值回调」的改写样板（应使用 ~/lib/form-props 的 textHandler / checkedHandler）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/form-props"/.test(t2)) return 0;
      const value = (
        t2.match(
          /=>\s*[A-Za-z_$][\w$.\[\]?]*\(\s*[A-Za-z_$][\w$]*\.(?:target|currentTarget)\.value\s*\)/g,
        ) || []
      ).length;
      const checked = (
        t2.match(
          /=>\s*[A-Za-z_$][\w$.\[\]?]*\(\s*[A-Za-z_$][\w$]*\.(?:target|currentTarget)\.checked\s*\)/g,
        ) || []
      ).length;
      return value + checked;
    },
  },

  /* ── P63「给一个列表做分页 / 窗口切片」（硬闸，§16.2.4.67）────────────
   * 全库做「从一个列表里切出一段」的算术，而它们是**三种方向相反的窗口**，
   * 此前从未被写下来：倒序分页（第 1 页最新）、尾部窗口（恒取最后 N 条）、
   * 平行分块（从头按片长切）。三者的边界处理各异，而每一种差异都是静默的：
   * 空列表让 `end` 变负、页码越界不钳回（「看着第 1 页、state 里却是第 9 页」）、
   * `pageSize` 传 0 让 `ceil(total / 0)` 变成 `Infinity` 页。
   *
   * 判据取**三种形态**：
   *   ① `… . length - … * …` —— 倒序分页的偏移算式（含 `Math.max(0, …)`
   *     那种「防负」包法）；
   *   ② `Math.ceil(… / …)` —— 总页数 / 总块数；
   *   ③ **接收者像集合**的 `.slice(-N)` —— 尾部窗口的字面写法。
   * **刻意不数**通用字符串 `slice`（`slice(0, 6)` 取短码、`slice(1)` 去前缀
   * 到处都是，数它只会逼人改坏代码）；③ 的接收者必须像集合
   *（`logs` / `items` / `entries` / `lines`…）而非任意字符串 ——
   * `id.slice(-4)` 与 `.toString(36).slice(-4)` 是**取短码**（显示位数），
   * 与「取列表尾部 N 条」不是同一件事。
   *
   * 出口：`~/lib/page-window` 的 `tailPages` / `countAfterPage` /
   * `tailWindow` / `chunkRange` / `LOG_MODAL_MAX_ROWS`。
   */
  P63: {
    label:
      "自写分页 / 窗口切片的算术（应使用 ~/lib/page-window 的 tailPages / tailWindow / chunkRange）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/lib\/page-window"/.test(t2)) return 0;
      const offset = (
        t2.match(
          /\.length\s*-\s*[A-Za-z_$][\w$.\[\]?]*\s*\*\s*[A-Za-z_$0-9][\w$.\[\]?]*/g,
        ) || []
      ).length;
      const ceilDiv = (
        t2.match(
          /Math\.ceil\s*\(\s*[A-Za-z_$][\w$.\[\]?]*\s*\/\s*[A-Za-z_$0-9][\w$.\[\]?]*\s*\)/g,
        ) || []
      ).length;
      const tail = (
        t2.match(
          /\b(?!Date\b)(?:logs?|items?|entries|rows?|lines?|list|arr|all|values?|records?|history|sessions?|segments?|collected|out)\b[\w$.\[\]?]*\.slice\(\s*-\s*(?:[A-Za-z_$][\w$]*|\d+)\s*\)/g,
        ) || []
      ).length;
      return offset + ceilDiv + tail;
    },
  },

  /* ── P64「把一次进度回调节流后写进 state」（硬闸，§16.2.4.68）─────────
   * `watchTask` 的 `onProgress` 是**高频**回调（SSE 每帧一次，一次生成可调
   * 几百次），而全库 6 处把它直接接到 `setState` 上，六处**没有一处节流**。
   * 差别不在「怎么写这一行」，而在三个从未被写下来的决定上：多久写一次、
   * 同值要不要短路、卸载之后还写不写。
   *
   * 判据取**「进度回调」这一形态**：
   * `onProgress: (…) => setXxx(` 或 `onProgress: (…) => { … setXxx(…` ——
   * 即「订阅回调用的是 setter」。**刻意不取 `setProgress(` 这个函数名**：
   * 那条名字在全库既是「进度」也是「上传进度」「提取进度」
   *（`use-dynamic-workflow-form` 的 `onUploadProgress` 就是另一条通道），
   * 按名字数会连「不是订阅回调的写入点」一起算进来。
   *
   * 出口：`~/components/ui/use-throttled-progress` 的 `useThrottledProgress`
   *（单值）/ `useThrottledProgressMap`（按条目）/ `createThrottleGate`（只判闸门）。
   */
  P64: {
    label:
      "把高频进度回调直接写进 state（应使用 ~/components/ui/use-throttled-progress 的 useThrottledProgress / useThrottledProgressMap / createThrottleGate）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/components\/ui\/use-throttled-progress"/.test(t2)) return 0;
      /* 只认「订阅回调里写 state」：`onProgress:` 之后同一段里出现 setter。 */
      const hits =
        t2.match(
          /onProgress\s*:\s*\([^)]*\)\s*=>\s*(?:\{[\s\S]{0,400}?)?set[A-Z][\w$]*\s*\(/g,
        ) || [];
      return hits.length;
    },
  },

  /* ── P65「一次异步动作的忙碌位的复位写在成功路径上」（硬闸，§16.2.4.71）──
   * 全库 20 处「先置忙碌位、跑完再复位」的执行态把复位写在**成功路径**上
   *（`await …; setBusy(false);`）而不是 `finally` 里。差别是静默的：
   * 动作只要抛错（网络异常、`await` 之后那一行 `setXxx` 抛、`runAsyncAction`
   * 之外的任何一行），忙碌位就**永远停在 true** —— 界面从此显示「正在保存…」，
   * 按钮再也点不动，只有刷新页面才恢复。设置页的 6 个启动 / 关闭动作、
   * 工坊两个批处理、影片台、训练页、登录页都在这一族里。
   *
   * 判据锚**「复位的位置」**这一形态，不锚 API、不锚名字：
   *   · `setX(true)` 与 `setX(false)` 同现（该 setter 有忙 / 闲两态）；
   *   · 两者之间跨了 `await`（它是「一次异步动作」的执行态，不是同步开关）；
   *   · 而 `setX(false)` 之前**没有** `finally` / `catch`（复位只在成功路径上）。
   * **刻意不数**「复位写在 `finally` 里」的那些 —— 那形态本身是对的
   *（`use-workflow-detail-loader` 的竞态令牌、`use-custom-nodes-settings`
   * 的按子包忙碌位都属于这一类），数它们只会逼人改坏代码。
   *
   * 出口：`~/components/ui/use-busy-action` 的 `useBusyAction`（复位绑在
   * `finally` 上、卸载守卫、不吞错），store 级忙碌位见
   * `~/components/update-check/update-check-store` 的 `runChecking`。
   */
  P65: {
    label:
      "把一次异步动作的忙碌位复位写在成功路径上（应使用 ~/components/ui/use-busy-action 的 useBusyAction）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/components\/ui\/use-busy-action"/.test(t2)) return 0;
      const decl =
        /const\s*\[\s*\w+\s*,\s*(set[A-Z][\w$]*)\s*\]\s*=\s*(?:React\.)?useState\s*\(/g;
      const setters = new Set();
      let m;
      while ((m = decl.exec(t2)) !== null) setters.add(m[1]);
      let hits = 0;
      for (const setter of setters) {
        const off = new RegExp("\\b" + setter + "\\(\\s*false\\s*\\)");
        if (!off.test(t2)) continue;
        const on = new RegExp("\\b" + setter + "\\(\\s*true\\s*\\)", "g");
        let o;
        while ((o = on.exec(t2)) !== null) {
          /* 取置忙之后的一段，够跨过动作体（含 NDJSON 流式消费那种长回调）。 */
          const window = t2.slice(o.index, o.index + 1500);
          const offAt = window.search(off);
          if (offAt < 0) continue;
          const awaitAt = window.search(/\bawait\b/);
          if (awaitAt < 0 || awaitAt > offAt) continue;
          const before = window.slice(0, offAt);
          if (/\bfinally\b/.test(before) || /\bcatch\b/.test(before)) continue;
          hits++;
        }
      }
      return hits;
    },
  },

  /* ── P66「一次异步动作的重入闸门」（硬闸，§16.2.4.69）──────────────────
   * 同一件事全库有三种做法：**没有**闸门（靠读 state 判，而 `setState` 是
   * 异步的，同一次事件循环里两次点击都读到 `false`）、**自建 ref 闸门**
   *（`const xxRef = useRef(false)` + 读它判重入 + 置位 / 复位各一处）、
   * 以及出口。第二族此前散在五个文件里，每个都写了同一段样板、且复位分散。
   *
   * 判据锚**「自建的重入闸门」这一形态**：一个 `useRef` 声明的名字带
   * `busy` / `pending` / `inflight` / `locked` / `running` / `checked`，
   * 且在同一段里有 **写**（`.current = …`）与**至少两处读**（判重入 + 复位）。
   * `useReentrancyLock` 自己那份实现在 EXEMPT_FILES 里显式登记。
   *
   * **刻意不数**纯「最近一次的值」ref（`justDraggedRef` / `prevXRef` /
   * `projectIdRef` 这类镜像 ref）：它们只读不写、或只写一次，不是闸门。
   * 形态上的分界线是**名字所指的语义**与**写 + 两读**这两个条件同时成立。
   *
   * 出口：`~/components/ui/use-reentrancy-lock` 的 `useReentrancyLock`（同步 `tryEnter` /
   * `exit`）/ `createReentrancyLock`（跨组件实例、非 hook 场景）。
   */
  P66: {
    label:
      "自建「同一时刻只跑一件」的重入闸门（应使用 ~/components/ui/use-reentrancy-lock 的 useReentrancyLock / createReentrancyLock）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 已用出口的文件跳过（换用出口即自动合规）。 */
      if (/from "~\/components\/ui\/use-reentrancy-lock"/.test(t2)) return 0;
      const decl = /(?:const|let)\s+(\w+)\s*=\s*(?:React\.)?useRef\s*\(/g;
      let m;
      let hits = 0;
      while ((m = decl.exec(t2)) !== null) {
        const name = m[1];
        /* 只认「闸门语义」的名字 —— 镜像 ref / 计数 ref 不算。 */
        if (!/busy|pending|inflight|locked|running|checked/i.test(name))
          continue;
        const window = t2.slice(m.index, m.index + 900);
        const writes = (
          window.match(new RegExp("\\b" + name + "\\.current\\s*=", "g")) || []
        ).length;
        const reads = (
          window.match(new RegExp("!?\\b" + name + "\\.current", "g")) || []
        ).length;
        if (writes >= 1 && reads >= 2) hits++;
      }
      return hits;
    },
  },

  P67: {
    label:
      "ui/ 层自造组件绕开已装 shadcn 基元（Badge / Progress / Slider / Empty / Field —— 规范 §16.2.3 / §12.18）",
    count: (t) => {
      const t2 = stripComments(t);
      let hits = 0;

      /* a. Badge 绕开：`export function X(Badge|Chip|Tag)` 命名形态，且没
       *    import `~/components/ui/badge`。shadcn 已装基元（avatar/combobox/
       *    sidebar）内部的 `function AvatarBadge` / `function ComboboxChip` /
       *    `function SidebarMenuBadge` 都**不带 export function**（只在文件
       *    末尾 `export { ... }` 聚合导出），判据以 `export function` 为形态
       *    锚点即可精准避开——不用逐个基元走 EXEMPT_FILES。
       *    实测 2026-09-23：命中 status-badge / list-badge / source-tag /
       *    task-type-chip 四处真轮子；badge.tsx 自身（`function Badge`）不命中。 */
      if (
        !/from ["']~\/components\/ui\/badge["']/.test(t2) &&
        /export function \w*(?:Badge|Chip|Tag)\s*\(/.test(t2)
      )
        hits++;

      /* b. Progress 绕开：手写 `role="progressbar"` 却没用 shadcn Progress
       *    也没直接引 base-ui Progress。`ui/progress.tsx` 自身走的是
       *    `ProgressPrimitive.Root`（base-ui 会自己挂 role），源码里不含
       *    字面 `role="progressbar"`——因此不需 EXEMPT_FILES。 */
      if (
        !/from ["']~\/components\/ui\/progress["']/.test(t2) &&
        !/from ["']@base-ui\/react\/progress["']/.test(t2) &&
        /role=["']progressbar["']/.test(t2)
      )
        hits++;

      /* c. Slider 绕开：原生 `<input type="range">` 却不用 shadcn Slider。
       *    `ui/slider.tsx` 自身是 base-ui 复合控件，源码里不含字面
       *    `type="range"`（已实测）。 */
      if (
        !/from ["']~\/components\/ui\/slider["']/.test(t2) &&
        !/from ["']@base-ui\/react\/slider["']/.test(t2) &&
        /type=["']range["']/.test(t2)
      )
        hits++;

      /* d. Empty 绕开：`export function Empty*` 命名形态。`ui/empty.tsx` 已装
       *    （Empty / EmptyHeader / EmptyTitle / EmptyDescription / EmptyMedia /
       *    EmptyContent，业务侧已有多处消费），所以这条没有「起点」可言，须为 0。
       *    ⚠️ 别拿 `components.json` 当安装判据：它只有 aliases / registries 这些
       *    配置键，**不记录装过哪些组件**（本条原先就以「里面没有 empty」为据把
       *    判据放软过，那个前提从来不存在）。安装与否看磁盘：`ui/empty.tsx`。 */
      if (
        !/from ["']~\/components\/ui\/empty["']/.test(t2) &&
        /export function Empty\w*\s*\(/.test(t2)
      )
        hits++;

      /* e. Field 绕开：手拼 `<label htmlFor=` 与 `aria-describedby=` 的表单
       *    行 —— `ui/field.tsx` 已装（Field / FieldSet / FieldGroup / FieldContent /
       *    FieldTitle / FieldLabel / FieldDescription / FieldError / FieldSeparator /
       *    FieldLegend），本仓库的薄封装是 `ui/form-field.tsx`，两条都算「用了基元」。
       *    当年列进起点名单的那两条，现在这样定性：
       *      · `ui/form-field.tsx`（真轮子，见 outputs 审计报告 A5）—— 它就是被
       *        本条要替换掉的那一侧，靠 `ui/form-field` 治理批次清零；
       *      · `ui/form.tsx`（shadcn 已装、react-hook-form 集成版，
       *        `FormLabel` 就是 `<Label htmlFor>` + 内部挂 `aria-describedby`）
       *        —— 走 EXEMPT_FILES 显式豁免（它是**已装基元**，不算轮子）。
       *    aria-describedby 的锚点**必须同时吃两种写法**：JSX 属性
       *    （`aria-describedby="…"`）与 JS 对象键（`"aria-describedby": …`
       *    —— form-field.tsx 通过 a11y 对象把三条 aria-* 透传给 children，
       *    只有后者），否则真轮子会漏检。 */
      if (
        !/from ["']~\/components\/ui\/field["']/.test(t2) &&
        /<label[\s\S]{0,60}?htmlFor=/.test(t2) &&
        /aria-describedby["']?\s*[:=]/.test(t2)
      )
        hits++;

      return hits;
    },
  },

  /* ── P68「视图层手写 `<input>` 或 `<textarea>`」（硬闸，§16.2.3 / §12.18）─────
   * P67 是 ui/ 层判据（UI_ONLY_RULES），P68/P69 是**视图层**判据（默认作用域：
   * view + app + server，`ui/` `hooks/` `lib/` 走原有 EXEMPT_DIRS 短路）。
   * 2026-09-23 治理 settings/ 目录 9 处 raw input 之后，全库还剩约 40 处
   * 视图层轮子（workshop / studio / login / model 等）；本条按棘轮冻结起点、
   * 后续按域分片治理。
   *
   * 锚点分两半：
   *   ① 显式 `type="text|number|password|url|email|search|tel"` 的 `<input>`
   *     （`type` 属性可能换行、用 `[\s\S]{0,80}` 窗口匹配）；
   *   ② `<textarea>`（本项目 textarea 一律走 `ui/textarea`，无正当原生
   *     落点）。
   *
   * 未列 `<input>` 无 type（默认 text）与 `type="file"`：前者实测视图层没有
   * 出现（都写了显式 type）、判据先保守；后者由 P7（file-picker 硬闸）管，
   * 不重复计。`type="checkbox|radio"` 走 P69。
   *
   * 已 import `~/components/ui/{input,textarea,number-field}` 的文件短路
   * 清零（换用基元即自动合规）。 */
  P68: {
    label:
      "视图层手写 <input> 或 <textarea>（应使用 ~/components/ui/{input,textarea,number-field}）",
    count: (t) => {
      const t2 = stripComments(t);
      if (
        /from ["']~\/components\/ui\/(?:input|textarea|number-field)["']/.test(
          t2,
        )
      )
        return 0;
      const inputs =
        t2.match(
          /<input[\s\S]{0,80}type=["'](?:text|number|password|url|email|search|tel)["']/g,
        ) || [];
      const textareas = t2.match(/<textarea[\s\n>]/g) || [];
      return inputs.length + textareas.length;
    },
  },

  /* ── P69「视图层手写 `<input type="checkbox|radio">`」（硬闸，§16.2.3 / §12.18）
   * shadcn `ui/checkbox.tsx` 与 `ui/radio-group.tsx` 早已装（PR #925 拉齐到
   * 最新形态），但视图层仍有多处原生 `<input type="checkbox">` + `accent-*`
   * 着色档——浏览器 OS 级控件、深色主题下勾选态与整站焦点档不协调、
   * `accent-color` 跨浏览器渲染不一致。本条按棘轮冻结起点、后续按域分片治理。
   *
   * 已 import `~/components/ui/{checkbox,radio-group}` 的文件短路清零。 */
  P69: {
    label:
      "视图层手写 <input type=checkbox|radio>（应使用 ~/components/ui/{checkbox,radio-group}）",
    count: (t) => {
      const t2 = stripComments(t);
      if (/from ["']~\/components\/ui\/(?:checkbox|radio-group)["']/.test(t2))
        return 0;
      return (
        t2.match(/<input[\s\S]{0,80}type=["'](?:checkbox|radio)["']/g) || []
      ).length;
    },
  },

  /* ── P70「视图层用 space-y-N / space-x-N」（硬闸，shadcn styling.md）─────
   * shadcn `styling.md` 明确「No `space-x-N` or `space-y-N`. Use `flex` with
   * `gap-*`.」`space-y-N` 靠给子元素加 `margin-top`（`:not(:last-child) > *`
   * 选择器）实现间距，与 flex / grid 的 `gap` 是两套机制——混用会让
   * 「改间距」要同时找 `space-y-*` 与 `gap-*` 两种写法，且 `space-y-*` 在
   * 嵌套 flex 容器里会被父级的 `gap` 叠加出非预期间距。
   * 2026-09-24 一次治理把全库 107 处 `space-y-*` 清零，本条从此是硬闸。 */
  P70: {
    label:
      "视图层用 space-y-* / space-x-*（应使用 flex + gap-*，shadcn styling.md）",
    count: (t) => {
      const t2 = stripComments(t);
      return (t2.match(/space-[xy]-\d/g) || []).length;
    },
  },

  /* ── P71「视图层手写 dark:palette 色（应走语义 token）」（硬闸，§4.11.1）───
   * shadcn `styling.md`「No manual `dark:` color overrides. Use semantic
   * tokens」+ 规范 §4.11.1「映射表里的颜色也必须走语义 token」。项目的
   * `--color-success` / `--color-warning` / `--color-destructive` 几类
   * `--color-primary-*` 等 token 内部已含深浅两态，写 `text-amber-700
   * dark:text-amber-400` 这种「字面量 + 手写 dark:」等于把同一件事在明暗
   * 两处各写一遍，改主题跟不动。
   *
   * 锚点：`dark:` 前缀 + Tailwind 调色板色名 + 数字档位（覆盖
   * `dark:text-red-400` 这类红 / `dark:bg-emerald-500/15` 这类绿 /
   * `dark:border-amber-*` 这几条字面量）。`text-ink-*` / `bg-subtle` / `text-muted-foreground` 这类语义类
   * 不含调色板色名 + 数字档，天然不命中。
   *
   * 例外块：`// p71-allow:start <一句话理由>` 与 `// p71-allow:end` 之间的
   * 代码整段不计入 P71。用于 §3.6.1 文档化例外——palette 字面量本身就是
   * 语义（例如 ANSI SGR 终端 8 色，代表 terminal color identity、不是主题
   * 状态色），不能被 token 化；用它比留一堆永久基线债更诚实。理由文本
   * 写短、写具体，别拿它当「随手关掉一条判据」的逃生口。
   *
   * 棘轮（非硬闸）：2026-09-24 全界面扫网实测视图层 230 处存量，本批折叠
   * log-level 色系统后冻结为 215 处起点、只许降。「精确等值」的状态文字
   * （text-amber-700/red-700 配 dark:）已在本批折叠；其余（状态底色
   * bg/border、品牌紫 violet→primary、类型青 cyan）token 值非精确等值、
   * 需逐案视觉核对，按域分片降基线。 */
  P71: {
    label:
      "视图层手写 dark:palette 色（应走语义 token，shadcn styling.md / §4.11.1）",
    count: (t) => {
      const t2 = stripComments(stripP71AllowBlocks(t));
      return (
        t2.match(
          /dark:(?:bg|text|border|ring|from|to|shadow|fill|stroke|outline|decoration|accent|caret|divide|placeholder|file|space)-\[?[a-z-]*?(?:emerald|green|rose|red|amber|sky|cyan|violet|blue|purple|fuchsia|indigo|teal|lime|orange|yellow)-[0-9]/g,
        ) || []
      ).length;
    },
  },

  /* ── P72「模态无可访问名」（硬闸，shadcn composition.md / WCAG 4.1.2）─────
   * `<DialogContent>` / `<SheetContent>` 打开的模态必须能被读屏器播报"这是
   * 什么面板"。base-ui（Radix 同）在缺少标题时不会自动补 aria-labelledby，
   * 用户进入模态只能听到"对话框"、上下文完全丢失。合规写法二选一：
   *   · 组件树里放 `<DialogTitle>` / `<SheetTitle>`（可以是 sr-only）；
   *   · 在 `<DialogContent>` / `<SheetContent>` 上直接给 `aria-label` 或
   *     `aria-labelledby`。
   * 本仓库形态约定是「自绘 header + 关闭」，多数落点走第二条；两种都放行。
   *
   * 判据按**标签块**扫（`<DialogContent` … `</DialogContent>`、
   * `<SheetContent` … `</SheetContent>`），块内既无对应 Title 组件又无
   * aria-label/labelledby 即计 1。`ui/` 层通过 EXEMPT_DIRS 短路（基元自身
   * 是这些标签的实现处、不该被自己扫到）。 */
  P72: {
    label:
      "视图层 <DialogContent>/<SheetContent> 缺可访问名（应加 <DialogTitle>/<SheetTitle> 或 aria-label/aria-labelledby，shadcn composition.md）",
    count: (t) => {
      const t2 = stripComments(t);
      let n = 0;
      for (const [open, close, nameRe] of [
        ["<DialogContent", "</DialogContent>", /<DialogTitle\b/],
        ["<SheetContent", "</SheetContent>", /<SheetTitle\b/],
      ]) {
        let cursor = 0;
        while (true) {
          const start = t2.indexOf(open, cursor);
          if (start < 0) break;
          const end = t2.indexOf(close, start);
          if (end < 0) {
            cursor = start + open.length;
            continue;
          }
          const block = t2.slice(start, end);
          if (
            !/aria-label\s*=|aria-labelledby\s*=/.test(block) &&
            !nameRe.test(block)
          ) {
            n++;
          }
          cursor = end + close.length;
        }
      }
      return n;
    },
  },

  /* ── P73「视图层自闭合 <div className="border-t">」（硬闸，shadcn composition.md）──
   * shadcn `composition.md`：`Use Separator instead of <hr> or
   * <div className="border-t">.`
   *
   * 视图里出现「**自闭合** `<div>` + className 含 `border-{t|b|l|r}`」=
   * 用 border 手搓了一条线、该走 `~/components/ui/separator` 的 `<Separator>`。
   * 与含子内容的卡片结构边框（`<div className="border-t ...">文字…</div>`）
   * 区分开——那种是"容器边框的一部分"、不是分隔线、不该被算。锚点**必须
   * 要求自闭合**（`/>` 收尾、无 children）。
   *
   * 本会话内一次治理 4 处清零（SectionHeader / GroupedControls /
   * IoEndpointsSection ×2 · 全是 `flex-1 border-t border-dashed` 类虚线
   * 填充线 · 迁 `<Separator className="... border-dashed bg-transparent
   * h-0/h-px" />` 保留原视觉）· 直接进硬闸。 */
  P73: {
    label:
      '视图层自闭合 <div className="border-{t|b|l|r}">（应使用 ~/components/ui/separator 的 <Separator>，shadcn composition.md）',
    count: (t) => {
      const t2 = stripComments(t);
      /* 自闭合 div + className 含 border-{t|b|l|r}。用 `[^>]*?/>` 而非
       * `[^/>]*?/>` 是因为 className 值可能带 `/`（如 `w-1/2`），但 `>`
       * 是硬边界、不能跨。 */
      return (
        t2.match(
          /<div\b[^>]*?className="[^"]*\bborder-[tblr]\b[^"]*"[^>]*?\/>/g,
        ) || []
      ).length;
    },
  },

  /* ── P75「视图层手搓空态卡」（硬闸，shadcn composition.md · Empty 基元）───
   * `pnpm dlx shadcn@latest add empty` 已装 `~/components/ui/empty.tsx`
   * （`<Empty>` + `EmptyHeader/Title/Description/Content/Media` 组合）、
   * 项目自立 `~/components/ui/empty-state.tsx`（`<EmptyState>` · page/error/hint
   * 三档 · 是官方 Empty 的薄封装 · 补 icon 位与最小高度）。视图层里出现
   * 「自闭合之外、className 含 border-dashed + rounded-(xl|2xl|3xl)、含子文本、
   * 无 onClick / cursor-pointer」= 手搓了一张"这里现在是空的"占位卡、该走
   * `<EmptyState>` 或 `<Empty>` 组合。
   *
   * 判据是**三重条件**、少一条都不算：
   *   ① className 里 `border-dashed` + `rounded-(xl|2xl|3xl)` 双有；
   *   ② **非自闭合**（自闭合的是 P73 那条虚线、或 flex-1 装饰填充线）；
   *   ③ className 里**不含** `cursor-pointer`、inner 里**不含** `onClick=`
   *     （排除"点击添加占位卡"这类合法交互 · HomePage 里"新建项目" dashed
   *     按钮就是这种）；
   *   ④ inner trim 后至少 5 字符（排除装饰性空 div）。
   *
   * 走棘轮（非硬闸）：本会话摸底命中 12 处（都是清晰"空态卡"· 见
   * `changelog.d/0-session-final`）· 冻结起点。下一批按域分片把每个
   * `<div>` 迁到 `<EmptyState variant="page" title="…" description="…" />`
   * 或 `<Empty>` 组合 · 清零后独立 PR 升硬闸。
   *
   * P74 编号跳过：`bg-X/N + text-X-strong` 组合锚点在本仓库**命中 0** ·
   * 手搓 callout 里同用两件事的模式稀有 · 判据立起来会变"死判据"（无假阳 ·
   * 也几乎无真命中）· 若将来发现真需要 · 由更精的 AST 扫描器做 · 不塞进
   * 这条正则棘轮。 */
  P75: {
    label:
      '视图层手搓空态卡 `<div className="border-dashed rounded-xl/2xl/3xl">`（应使用 ~/components/ui/empty-state 的 <EmptyState> 或 ~/components/ui/empty 的 <Empty>，shadcn composition.md）',
    count: (t) => {
      const t2 = stripComments(t);
      let n = 0;
      /* 扫每个 `<div>` 起始标签 · 三重条件命中才计一次。 */
      const openRe = /<div\b([^>]*)>/g;
      for (const open of t2.matchAll(openRe)) {
        const attrs = open[1];
        /* 排除自闭合（`/` 结尾 · 那是 P73 虚线的账）。 */
        if (attrs.trimEnd().endsWith("/")) continue;
        const cm = attrs.match(/className=["']([^"']+)["']/);
        if (!cm) continue;
        const cls = cm[1];
        if (!/\bborder-dashed\b/.test(cls)) continue;
        if (!/\brounded-(?:xl|2xl|3xl)\b/.test(cls)) continue;
        if (/\bcursor-pointer\b/.test(cls)) continue;
        /* 找匹配的 </div> · 简化：从 open.index 起、扫第一个 </div> ·
         * 不递归嵌套（视图里"空态卡"极少嵌套同层 div · 简化足够）。 */
        const after = t2.slice(open.index + open[0].length);
        const close = after.indexOf("</div>");
        if (close < 0) continue;
        const inner = after.slice(0, close);
        if (/\bonClick=/.test(inner)) continue;
        /* 装饰性空 div（padding 或 min-h 撑位）不算。 */
        if (inner.trim().length < 5) continue;
        n++;
      }
      return n;
    },
  },

  /* ── P76「视图层裸写 <select>」（硬闸，规范 §16.2.3 / §12.18）───────────
   * P68 拦住了裸 `<input>` / `<textarea>`、P69 拦住了裸
   * `<input type=checkbox|radio>`；`<select>` 是同一族里的漏项。
   * 项目里已有两个合规出口：
   *   · `~/components/ui/native-select` 的 `<NativeSelect>`（保留原生外观 +
   *     统一样式与 a11y 契约）
   *   · `~/components/ui/select-menu` 的 `<SelectMenu>`（Base UI 派，与
   *     项目里其它富 ReactNode 标签的下拉同一口径）
   * 视图里出现 `<select` = 这个文件在**第三处**手拼同一件事。
   *
   * 判据按形态取（`<select` 标签字面量），只看视图与业务落点：
   * `ui/native-select.tsx` 是这条账要收口的唯一实现、走 EXEMPT_DIRS 天然豁免。
   *
   * 走棘轮（非硬闸）：本批评据上线时视图层实测 13 处存量，冻结起点、
   * 只许降。下一批按域分片把每个 `<select>` 迁到上述两个出口之一，
   * 与 P71 的引入节奏一致（先冻结、后治理）。
   *
   * P72 / P76 编号跳空是**有意**的：P73 / P74 / P75 预留给 Separator /
   * Alert / EmptyState 三条同批的判据、下一批落地；本批只做「模态可访问名
   * （硬闸，#993）」与「原生 select（棘轮，本条）」两条最独立、迁移路径最
   * 明确的判据。 */
  P76: {
    label:
      "视图层裸写 <select>（应使用 ~/components/ui/native-select 的 NativeSelect 或 ~/components/ui/select-menu 的 SelectMenu）",
    count: (t) => {
      const t2 = stripComments(t);
      /* 只数 `<select` 标签起始形态（后接空白、`>`、`/` 之外的字符），
       * 不误伤 `selectedValue` / `select-none` 这类同前缀的标识符与类名。 */
      return (t2.match(/<select[\s/>]/g) || []).length;
    },
  },

  /* ── P78「视图层裸写 <label>」（硬闸，规范 §16.2.4.26 / §12.18）─────────
   * 与 P23 是同一族账的两层：
   *   · **P23**（硬闸，视图层已清零）数的是「`<label>` + 控件同文件出现」的
   *     **表单行组合形态**——15 处已收口到 `~/components/ui/form-field` 的
   *     `FormField`（内部走 shadcn `ui/field` 的 `FieldLabel`，`htmlFor` 与
   *     `aria-describedby` 由 FormField 派生）。
   *   · **P78**（本条，棘轮）数的是**任何** `<label` 起始标签——包含那些
   *     没配显式控件、只做视觉分组或给 Base UI Checkbox 当点击区的孤立 label。
   *     这类不该套 `FormField`（它是一行表单），但 shadcn `ui/field` 里的
   *     `FieldLabel` 或 Base UI `Checkbox` 的 children 才是合规出口——
   *     裸 `<label>` 缺 `htmlFor` 时点标签不聚焦控件、读屏器把它读成孤立文本。
   *
   * 判据按形态取（`<label[\s/>]`），不误伤 `labelClassName` / `label=` 这类
   * 同前缀属性名（后面接的是标识符字符而不是空白/`>`/`/`）；`ui/` 通过
   * EXEMPT_DIRS 天然豁免（`ui/label.tsx` 与 `ui/field.tsx` 自身要写 `<label>`）。
   *
   * 走棘轮（非硬闸）：本批评据上线时视图层实测 15 处存量，冻结起点、只许降。
   * 下一批按域分片把每个 `<label>` 迁到 `FieldLabel` / `FormField` /
   * Base UI `Checkbox`（children 形式），与 P71/P76 引入节奏一致。
   *
   * P77 号**故意跳过**：P77 预留给 ToggleGroup 判据（`<Button aria-pressed>`
   * 循环），锚点需要「同一 map 里出现 aria-pressed」这种跨行组合、下一条
   * 独立 PR 更稳。 */
  P78: {
    label:
      "视图层裸写 <label>（表单行应走 ~/components/ui/form-field 的 FormField 或 ~/components/ui/field 的 FieldLabel；checkbox/radio 点击区走 ~/components/ui/{checkbox,radio-group} 的 children 语义）",
    count: (t) => {
      const t2 = stripComments(t);
      return (t2.match(/<label[\s/>]/g) || []).length;
    },
  },

  /* ── P77「视图层手写 aria-pressed」（硬闸，shadcn forms.md）────────────
   * shadcn `forms.md` 原文：`Option sets (2–7 choices) use ToggleGroup. Don't loop Button with manual active state.`
   *
   * 项目里 `~/components/ui/toggle-group` 装了（shadcn base-nova 版，内部
   * 走 Base UI `ToggleGroup` / `ToggleGroupItem`），但视图层里出现
   * `aria-pressed={cond}` = 这个文件在**手写一份"哪一个是选中"的状态契约**。
   * `aria-pressed` 是 toggle 语义的 ARIA 硬要求，Base UI 的 `ToggleGroupItem`
   * 会自己打这一份、并给键盘 / 读屏器 / `data-state="on|off"` 一致的样式；
   * 手写 `<Button aria-pressed>` 循环少了这一层：读屏器只能听到"按下"但
   * 拿不到组内互斥关系（`role="group"` 与 `aria-labelledby` 都得手写），
   * 视觉的 active 态也得每处 `className={\`${cond ? A : B}\`}` 重抄。
   *
   * 判据按形态取：视图里出现 `aria-pressed\s*=` 字面量 = 该文件手搓了一份
   * toggle 状态。`ui/toggle-group.tsx` 是这条账要收口的唯一实现、`ui/` 走
   * EXEMPT_DIRS 天然豁免；`ui/image-viewer.tsx` 里的两处 `aria-pressed`
   * 是**项目自定义基元**内部的形态（视图模式切换器），也在豁免范围内、
   * 视图层不该学它。
   *
   * 走棘轮（非硬闸）：本批评据上线时视图层实测约 6 处存量（LogFilterBar /
   * FilmStudio ×2 / LlmLocalSection / UsageTestDialog / RgthreeBodies），
   * 冻结起点、只许降。下一批按域分片把每个循环 `<Button aria-pressed>`
   * 迁到 `<ToggleGroup>` + `<ToggleGroupItem>`，与 P71 / P76 / P78 引入
   * 节奏一致（先冻结、后治理）。
   *
   * P77 号回填：**这条**在 P76（原生 `<select>`）与 P78（裸 `<label>`）
   * 之间的跳空位、由这一批填上（P73 / P74 / P75 三条 Separator / Alert /
   * EmptyState 判据的锚点还需打磨、留下批）。 */
  P77: {
    label:
      "视图层手写 aria-pressed（2–7 项的选项组应走 ~/components/ui/toggle-group 的 ToggleGroup + ToggleGroupItem；shadcn forms.md）",
    count: (t) => {
      const t2 = stripComments(t);
      return (t2.match(/aria-pressed\s*=/g) || []).length;
    },
  },

  /* ── P79「视图层无 dark: 前缀的浅色原色板」（硬闸，shadcn styling.md）──
   * P71 只管 `dark:` 前缀的调色板（把同一件事在明暗两处各写一遍），P79 补上
   * **无前缀的浅色版原色板** —— shadcn `styling.md` 原则 4 原文：`Use semantic colors. bg-primary, text-muted-foreground — never raw values like bg-blue-500.`
   *
   * 项目的 `--color-primary-strong` / `--color-info` / `--color-success-strong`
   * / `--color-warning-strong` / `--color-destructive` / `--color-subtle`
   * / `--color-border-strong` 等 token 内部已含浅/深两态（`globals.css`），
   * 视图里出现 `bg-violet-500/40` / `text-fuchsia-700` / `border-sky-400`
   * / `ring-emerald-400` / `from-red-*` / `to-amber-*` 这类**具体 palette
   * 色名 + 数字档位**（无论是否带 `dark:` 前缀）就是绕开语义 token、把主题
   * 色硬编码。改主题跟不动、深浅两态一致性靠人肉。
   *
   * 锚点复用 P71 的调色板色名表 + 前缀集，做两点收窄：
   *   · **去掉 `dark:` 前缀强制**（这一条就是数无前缀的浅色版）；
   *   · **再排除掉已经命中 P71 的**（带 `dark:` 的归 P71 管、避免双计）。
   *
   * 例外块复用 P71 的 `p71-allow:start … p71-allow:end` —— 同一族账：
   * palette 字面量本身就是语义（ANSI SGR 8 色 / workshop 域专有装饰色 /
   * 媒体类型色 / 文件夹黄橙 / 品牌渐变端点 …），不能被 token 化，走同一份
   * allow 块；一条 `p71-allow` 覆盖两条判据，比再造一个 `p79-allow` 更省
   * 也更难漏标。
   *
   * 走棘轮（非硬闸）：本批上线时实测视图层约 60 处（`studio/**` 35、
   * `workshop/**` 9、`ui/**` 自研件 12、其它 4），冻结起点、只许降。下一批
   * 按域分片迁语义 token（与 P71 治理同批节奏）。P79 号回填：填 P78 之后
   * 下一个可用号（P73/P74/P75/P76/P77 都已用或留）。 */
  P79: {
    label:
      "视图层无 dark: 前缀的浅色原色板（应走语义 token，shadcn styling.md 原则 4；例外块走 p71-allow 与 P71 共享）",
    count: (t) => {
      const t2 = stripComments(stripP71AllowBlocks(t));
      /* 与 P71 同款前缀集 + 色名表，但**不带 `dark:` 前缀**。用 `(?!dark:)`
       * 前瞻把带前缀的排掉、避免与 P71 双计。 */
      return (
        t2.match(
          /(^|[\s"'`{])(?!dark:)(?:bg|text|border|ring|from|to|shadow|fill|stroke|outline|decoration|accent|caret|divide|placeholder|file)-\[?[a-z-]*?(?:emerald|green|rose|red|amber|sky|cyan|violet|blue|purple|fuchsia|indigo|teal|lime|orange|yellow)-[0-9]/g,
        ) || []
      ).length;
    },
  },

  /* ── P80「视图层 w-N 与 h-N 同值应换 size-N」（硬闸，shadcn styling.md）──
   * shadcn `styling.md` 原则：`Use size-* when width and height are equal.
   * size-10 not w-10 h-10.` `size-N` 是 `w-N h-N` 的简写、由 tailwind
   * 内建；同一份 `w-N h-N` 手写会：
   *   · 让「改尺寸」要动两处、且两处不同步就会漂（`w-8 h-9` 是不是有意
   *     的还是漏改？机器看不出来）；
   *   · 与 `rounded-full` / `size-*` 混用时视觉一致性问题（圆点用 size
   *     表达"这是个圆"，用 w/h 表达的是"两个方向独立设"）。
   *
   * JS 正则**支持 backreference**（不像 ripgrep 默认不支持），锚点用两个
   * 方向都数一次、避免顺序漂移：`w-N ... h-N` 与 `h-N ... w-N`。数字
   * 支持小数（`w-1.5 h-1.5` 也是同款形态）。
   *
   * ⚠️ 只管 className 字符串里的**等值** w/h 对；不等值（`w-8 h-9` 之类）
   * 是**有意**的宽×高、不算这条账。也不看 style 属性里的 `width: N; height: N`
   * （那是另一层、动态尺寸常见）。
   *
   * `ui/` 走 EXEMPT_DIRS 天然豁免；`ui/avatar.tsx` 里 size-* 变体表本身就是
   * 这条判据要推荐的写法。视图层实测约 90 处，走棘轮冻结起点。 */
  P80: {
    label:
      "视图层 w-N 与 h-N 同值（应换 size-N，shadcn styling.md「Use size-* when width and height are equal」）",
    count: (t) => {
      const t2 = stripComments(t);
      let n = 0;
      /* 扫每个 `className="…"` / `className='…'` / `className={\`…\`}` 字符串，
       * 收集里面出现的 w-N 与 h-N 的数字集，看交集。同字符串里 w-8 与 h-8
       * 只算一处（`size-8` 是唯一修法）；不同 className 之间相互独立。
       * 夹在中间的其它 utility（`w-8 rounded-lg h-8`）不影响判定，也不
       * 会被数字前后有 `.` `/` 之类的分隔符（如 `w-1.5`）误伤。 */
      const clsRe = /className\s*=\s*(?:"([^"]*)"|'([^']*)'|`\([^`]*`\s*)/g;
      for (const m of t2.matchAll(clsRe)) {
        const cls = m[1] ?? m[2] ?? "";
        if (!cls) continue;
        const ws = new Set();
        const hs = new Set();
        /* 前面必须是**行首 / 空白 / 引号**（`(^|[^-\w])` + 捕获后续），
         * 否则会把 `min-h-0` / `max-w-md` 这类带前缀的容器写法误当
         * 成 `h-0` / `w-md`（JS 正则 `\b` 在 `-h-` 处也算边界）。 */
        for (const x of cls.matchAll(
          /(?:^|[^-\w])w-(\d+(?:\.\d+)?)(?=\s|$)/g,
        )) {
          ws.add(x[1]);
        }
        for (const x of cls.matchAll(
          /(?:^|[^-\w])h-(\d+(?:\.\d+)?)(?=\s|$)/g,
        )) {
          hs.add(x[1]);
        }
        for (const w of ws) if (hs.has(w)) n++;
      }
      return n;
    },
  },

  /* ── P81「视图层 `<Button>` 内 icon 缺 `data-icon=`」（硬闸，shadcn composition.md）──
   * shadcn `composition.md`：`Icons in buttons need data-icon="inline-start"
   * or "inline-end" (Base UI + Tailwind v4 has-* selector).` 项目 `ui/button.tsx`
   * 的 `buttonVariants` size 变体（default / xs / sm / lg）里显式依赖这个 hook：
   *   `has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2`
   * —— **有 `data-icon` 才切内边距**。视图里 `<Button>` 直接放 icon 但忘了标
   * `data-icon=` 的表现：按钮左右内边距停在 `px-2.5`（无 icon 档），文字
   * 与 icon 挤在一起、或纯 icon 按钮宽度不对；改主题或换尺寸档时得逐处补。
   *
   * 判据按形态取：视图层 `<Button>...</Button>` 块内、**深度 1**（Button 的
   * 直接子节点）处出现 icon-like 起始标签、且该标签开括号里不含 `data-icon=`
   * 即计一处。icon-like 判据（`isP81IconName`）：
   *   · 项目自研 `<Icon name="…">`、原生 `<svg>`；
   *   · 后缀是 `Icon` 的 PascalCase（`ChevronLeftIcon` 等 lucide 别名约定）；
   *   · 已知 lucide 组件名集合（视图里目前用到的 25 项，够覆盖 111 处
   *     实测存量、避免全量 lucide 名单在扫描里做前缀匹配的假阳）。
   *
   * 深度 1 之外不算：`<Button><span><Plus/></span>Label</Button>` 里 Plus
   * 被 span 包着、shadcn 的 `has-data-*` 选择器只吃**直接子级**、那种写法
   * 就算加了 `data-icon` 也不生效，不属这条账。
   *
   * 走棘轮（非硬闸）：本批上线时视图层实测 111 处（跨 52 文件 · 见
   * `changelog.d/0-p81-gate.md`），冻结起点、只许降。下一批按域分片
   * （studio / workshop / message-center / ui 内部）把每个 icon 补上
   * `data-icon="inline-start" | "inline-end"`（前者是「icon 在文字前」、
   * 后者是「icon 在文字后」），再走一次清零 → 升硬闸。 */
  P81: {
    label:
      '视图层 <Button> 直接子 icon 缺 data-icon="inline-start|end"（shadcn composition.md；buttonVariants 的 has-data-[icon=*] 选择器只吃直接子级）',
    count: (t) => {
      const t2 = stripComments(t);
      let n = 0;
      for (const m of t2.matchAll(/<Button\b[^>]*>([\s\S]*?)<\/Button>/g)) {
        const inner = m[1];
        let depth = 0;
        /* tag 匹配：`<` 后紧跟 `[A-Za-z]` 起始的名字、属性段允许引号字面量
         * 与 `{…}` 表达式（不递归平衡、够用即可）、以 `>` 或 `/>` 收尾。
         * 未闭合的 `<` 在 TSX 泛型里存在（`<T,>` 带尾逗号）—— 那条不像
         * JSX 标签、这里靠 `[^>]*` 会吞到下一行；作为棘轮判据、少计一次
         * 不影响清零节奏。 */
        for (const tg of inner.matchAll(
          /<(\/?)([A-Za-z][A-Za-z0-9]*)((?:"[^"]*"|'[^']*'|\{[^{}]*\}|[^>])*?)(\/?)>/g,
        )) {
          const closing = tg[1] === "/";
          const name = tg[2];
          const attrs = tg[3];
          const selfClose = tg[4] === "/";
          if (closing) {
            if (depth > 0) depth--;
            continue;
          }
          if (
            depth === 0 &&
            isP81IconName(name) &&
            !/\bdata-icon\s*=/.test(attrs)
          ) {
            n++;
          }
          if (!selfClose) depth++;
        }
      }
      return n;
    },
  },

  /* ── P82「视图层 `<Button>` 原生 `title=`（应走 `<Tooltip>`）」（硬闸）────
   * shadcn `composition.md`：`For icon-only or hover-help affordances use
   * Tooltip, not native title.` 原生 `title=` 的三个短板：
   *   · 屏幕阅读器多数浏览器只读一次、且不参与 aria 关系（读屏器对 `title`
   *     的支持在 Chrome / Firefox 长期不一致，Safari 上 VoiceOver 直接忽略）；
   *   · 显示延迟不可控、移动端不显示；
   *   · 样式不能主题化（浏览器原生 tooltip 灰底、脱离设计 token 系统）。
   * 合规出口是 `~/components/ui/hint` 的 `<Hint label=…>`（`Tooltip` +
   * `<TooltipTrigger render={…} />` 的薄封装 · Base UI render prop · 不用
   * asChild）；三个 prop 分别挡「条件态提示不出」「图标按钮丢可访问名」
   * 「禁用按钮弹不出原因」三类场景。
   *
   * 判据按形态取：视图层 `<Button` 后紧跟空白 / `>` / `/`（不误伤
   * `<ButtonLink>`）时，**平衡扫描**它的整个开标签、解析出属性、再判
   * `title=` 的取值档位（见 `countButtonTitle`）：
   *   · 属性段边界交给扫描器（`scanJsxAttrs`），不用 `[^>]*` 那种粗锚 ——
   *     箭头函数 `onClick={() => …}` 里的 `>` 会让粗锚早停、把后面带 `title=`
   *     的 Button 漏掉（引入时粗锚实测 78 处、AST 复扫 157 处）；
   *   · 属性名**整名匹配**（`parseJsxProps` 里 `-` `.` `$` `:` 都算名字字符）——
   *     旧的 `\btitle\s*=` 会把 `data-title=` / `aria-label="title=x"` 误报；
   *   · 取值分五档，只有 static（`title="文字"`）与 dynamic（`title={expr}`）
   *     计违规；empty（`title=""` / `{undefined}` / `{null}`）等同没写、不计；
   *     `{...props}` 展开的 unknown 单列人工抽查（静态判不了，见 `--report`
   *     的 `P82-unknown` 通道）。
   *   ⚠️ 已知边界：**字符串 / 模板字面量里**字面出现的 `<Button title=…>`
   *   （如测试夹具的字符串）仍会被命中 —— 这一档只有 AST（`@babel/parser`
   *   开 jsx 插件或 ts-morph 遍历 `JsxOpeningElement`）能根治；本仓库实测
   *   该形态真实出现 0 处（落在注释里的已被 `stripComments` 剥掉），故不在
   *   正则/扫描器上继续打补丁（§12.18）。 */
  P82: {
    label:
      "视图层 <Button> 用原生 title=（应走 ~/components/ui/hint 的 <Hint label=…>；shadcn composition.md）",
    /* 五档判定（见 countButtonTitle）：只有 static / dynamic 计入违规；
     * empty（空值等同没写）与 unknown（{...props} 展开、静态判不了）不进
     * 这条硬闸，后者单列人工抽查。 */
    count: (t) => countButtonTitle(t).violations,
  },

  /* ── P83「屏级标题不走字阶档 / 在 h1 上硬写字号」（硬闸）─────────────────
   * `globals.css` 里 `.u-title-page` 注明就是「页面级标题（h1）统一规范」，可它
   * 引入至今只有 1 处消费者；屏级标题实际写在 11 个 h1 上，尺寸有 18 / 20 / 24 /
   * 34px 四五种 —— 同一个角色在不同屏大小不一，而 `.u-title` / `.u-title-page`
   * 的数值本身也是工具类里的硬编码字面量（规范 03 §3.2 反对的那一类）。
   *
   * 判据只管 **h1（屏级）**：属性段里必须出现屏级档
   * （`u-title-page` / `u-title-hero` / `text-page` / `text-hero`），且不得再叠
   * 硬写字号（`text-lg`、`text-[34px]` 这类）。`u-title-hero` 是有意留的第二档：
   * 首页欢迎区的大标题确实不是屏级标题那一档，但例外必须有名字，不能留成某处
   * 内联的 `text-[34px]` —— 否则「唯一档」这句话在第一屏就先破了。
   *
   * 区块级标题（h2 / h3）**不入本条**：那里刻意保留 10.5–14px 的多档微排版，
   * 并成一档会压平信息层次，那是另一件事，不该由这条判据顺手管。
   *
   * 属性段用 `readJsxAttrsPastTag` 平衡扫描（同 P82 的教训）：`className={cn(...)}`
   * 里的 `>` 不提前收尾、`className={[..].join("")}` 的数组形态也能读全 ——
   * 粗锚 `[^>]*` 会在这两种写法上漏计。 */
  P83: {
    label:
      "屏级标题 <h1> 未走字阶档 u-title-page / u-title-hero，或在 h1 上硬写字号（字号由档位给，不在调用点写）",
    count: (t) => {
      const t2 = stripComments(t);
      let n = 0;
      const re = /<h1(?=[\s/>])/g;
      let m;
      while ((m = re.exec(t2)) !== null) {
        const attrs = readJsxAttrsPastTag(t2, re.lastIndex);
        if (attrs === null) continue;
        const hasTier =
          /\b(?:u-title-page|u-title-hero|text-page|text-hero)\b/.test(attrs);
        const hardSize =
          /\btext-(?:xs|sm|base|md|lg|xl|2xl|3xl|4xl|5xl)\b|\btext-\[/.test(
            attrs,
          );
        if (!hasTier || hardSize) n++;
      }
      return n;
    },
  },

  /* ── P84「视图层手搓面包屑」（硬闸，规范 §16.2.4.72）───────────────────
   * 锚**形态**（「谁在砌一段 `A / B / 当前 C` 的行」），不按名字找
   * （§16.2.4.6 的教训：按目录名扫会得出「没场景」的误判）。
   *
   * 形态是两件同时出现，缺一不算：
   *   ① 一个**分隔符 span**：JSX 里一段**文本只有 `/`** 的元素
   *      （`<span …>/</span>`，可带 class / 转义）；
   *   ② 一个**段数组的 map**：回调里出现末尾判定（`isLast` / 下标与长度比较
   *      那一族）—— 这只是把「路径段」与任何别的 `.map` 区分开。
   *
   * 出口是 `~/components/ui/breadcrumb-path` 的 `<BreadcrumbPath>`
   * （它自己建在 `ui/breadcrumb` 的整套 slot 上）—— 把 `ol` / `li` 的层级
   * 与 `aria-current="page"` 一并给到，而手搓的 `span` + `/` 里这两样都没有。
   */
  P84: {
    label:
      "视图层手搓面包屑（`/` 分隔 span + 段数组 map；应使用 ~/components/ui/breadcrumb-path 的 BreadcrumbPath）",
    count: (t) => {
      const t2 = stripComments(t);
      /* ① 分隔符 span：`<span …>` 的内容只有 `/`（允许前后空白）。
       *    属性段放开到 `[^>]*`，但**要求不以 `/` 结尾**（避开自闭合
       *    `<span … />` 这种不承载文本的形态）。 */
      const sepRe = /<span\b[^>]*>\s*\/\s*<\/span>/g;
      if (!sepRe.test(t2)) return 0;
      /* ② 段数组的 map：回调里有末尾判定。三种常见写法都算。 */
      const tailRe =
        /\bisLast\b|\bi\s*===\s*[^\n]*\.length\s*-\s*1\b|\bindex\s*===\s*[^\n]*\.length\s*-\s*1\b/;
      const mapRe = /\.map\s*\(/g;
      let m;
      while ((m = mapRe.exec(t2)) !== null) {
        /* 看 map 回调这一小段（到下一个 `)` 或 200 字符，够判末尾判定了）。 */
        const window = t2.slice(m.index, m.index + 400);
        if (tailRe.test(window)) return 1;
      }
      return 0;
    },
  },

  /* ── P85「视图层手写 `<table>`」（硬闸，规范 §16.2.4.72）───────────────
   * 锚 `<table` 标签起始形态（同 P76 对 `<select` 的口径，不误伤
   * `tableData` / `Table` 组件名 —— 后面必须接空白 / `>` / `/`）。
   *
   * 出口是 `~/components/ui/table`：它此前**全库零引用**（`ui/` 里躺着
   * 一整套 `Table` / `TableHeader` / `TableRow` / `TableCell` / `TableHead`，
   * 而视图里手写裸 `<table>` + `<thead>` / `<tr>` / `<td>`）。直接写裸标签
   * 会丢掉基元给的 `data-slot` 与统一排版（边框 / 悬停 / 末行去边框）。
   */
  P85: {
    label:
      "视图层手写 <table>（应使用 ~/components/ui/table 的 Table / TableHeader / TableRow / TableCell / TableHead）",
    count: (t) => {
      const t2 = stripComments(t);
      return (t2.match(/<table[\s/>]/g) || []).length;
    },
  },
};

/* ── P82 判据：JSX 开标签扫描 + 属性解析 + 五档判定 ────────────────
 * 判据的三段拆开写，各管一件事（正则只定位起点，边界交给扫描器）：
 *   ① scanJsxAttrs()       —— 从属性段起点扫到收尾 `>`：`{}` 计深度、引号
 *      （含模板串）内不判结构、`\` 跳转义、`{…}` 里再进一层嵌套表达式；
 *   ② parseJsxProps()      —— 把属性段切成一段段属性，**按整名匹配**（于是
 *      `data-title=` / `mytitle=` / `aria-label="title=x"` 都不会被当成 title）；
 *   ③ classifyTitleValue() —— 对每个 title 取值分档，只有 static / dynamic 算违规。
 * 全部返回结构化结果，`--report` 可直接印出 unknown 清单人工抽查。 */

/** 名字字符集：JSX 标签名与属性名的可接受字符（含 `-` `.` `$` `:`）。 */
const JSX_NAME_CHAR = /[A-Za-z0-9_$:.-]/;

/** 从 `i`（引号起点）跳到字符串结束后的下标；处理转义与模板串 `${…}` 插值。 */
function skipJsxString(src, i) {
  const q = src[i];
  i++;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\") {
      i += 2;
      continue;
    }
    if (q === "`" && ch === "$" && src[i + 1] === "{") {
      /* 模板串插值：吃下平衡的一对花括号（内部可能再含字符串）。 */
      i += 2;
      let depth = 1;
      while (i < src.length && depth > 0) {
        const c = src[i];
        if (c === '"' || c === "'" || c === "`") {
          i = skipJsxString(src, i);
          continue;
        }
        if (c === "{") depth++;
        else if (c === "}") depth--;
        i++;
      }
      continue;
    }
    if (ch === q) return i + 1;
    i++;
  }
  return i;
}

/** 从属性段起点 `from` 扫到收尾 `>`，返回 { attrs, end } 或 null（取不到收尾）。 */
function scanJsxAttrs(src, from) {
  let i = from;
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipJsxString(src, i);
      continue;
    }
    if (c === "{") {
      depth++;
      i++;
      continue;
    }
    if (c === "}") {
      depth = Math.max(0, depth - 1);
      i++;
      continue;
    }
    /* 只有 depth === 0 且不在字符串里时的 `>` 才算标签结束。 */
    if (depth === 0 && c === ">")
      return { attrs: src.slice(from, i), end: i + 1 };
    i++;
  }
  return null;
}

/** 属性段文本（`scanJsxAttrs` 的只取 attrs 版本）：取不到收尾 `>` 返回 `null`。
 *  P83（屏级标题 `<h1>`）等处只关心属性段内容、不关心收尾下标，用这个更直白。 */
function readJsxAttrsPastTag(src, from) {
  const scanned = scanJsxAttrs(src, from);
  return scanned ? scanned.attrs : null;
}

/** 从 `i`（`{` 起点）吃下一整对平衡花括号，返回 `}` 之后的下标。
 *  与 scanJsxAttrs 的区别：本函数**只**吃一层 `{…}`、不把 `>` 当终点 ——
 *  属性值 `onClick={() => a > b}` 里那个 `>` 属于表达式内部，标签的收尾
 *  `>` 在其后。内部字符串照样跳（`title={"a}b"}` 里的 `}` 不参与配对）。 */
function skipJsxBraceExpr(src, i) {
  let depth = 0;
  while (i < src.length) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      i = skipJsxString(src, i);
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

/** 把属性段解析成属性对象列表：[{ name, kind }]，kind ∈ value|spread|bare。
 *  · spread —— `{...props}`（名字为 `...`），title 可能由此带进来；
 *  · value  —— `name=…`（值可能是引号串 / `{…}` 表达式 / 裸标记）；
 *  · bare   —— 只有名字（如 `disabled` / `accessibleName`）。
 *  按整名匹配，`-` `.` `$` `:` 都是名字字符，所以 `data-title` 不会命中 `title`。 */
function parseJsxProps(attrs) {
  const props = [];
  let i = 0;
  const n = attrs.length;
  while (i < n) {
    const c = attrs[i];
    if (/\s|\//.test(c)) {
      i++;
      continue;
    }
    if (c === "{") {
      const after = skipJsxBraceExpr(attrs, i);
      const inner = attrs.slice(i, after);
      /* 属性级的 `{…}` 只有 `{...props}` 是展开；其余（如 `{cond && <X/>}`）
       * 不是属性，跳过即可。 */
      if (/^\{\s*\.\.\./.test(inner))
        props.push({ name: "...", kind: "spread" });
      i = after;
      continue;
    }
    if (!JSX_NAME_CHAR.test(c)) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && JSX_NAME_CHAR.test(attrs[j])) j++;
    const name = attrs.slice(i, j);
    let k = j;
    while (k < n && /\s/.test(attrs[k])) k++;
    if (attrs[k] !== "=") {
      props.push({ name, kind: "bare" });
      i = j;
      continue;
    }
    k++;
    while (k < n && /\s/.test(attrs[k])) k++;
    const vc = attrs[k];
    if (vc === '"' || vc === "'" || vc === "`") {
      const after = skipJsxString(attrs + ">", k);
      props.push({ name, kind: "value", raw: attrs.slice(k, after) });
      i = after;
    } else if (vc === "{") {
      const after = skipJsxBraceExpr(attrs, k);
      props.push({ name, kind: "value", raw: attrs.slice(k, after) });
      i = after;
    } else {
      let m = k;
      while (m < n && !/[\s{("'`]/.test(attrs[m])) m++;
      props.push({ name, kind: "value", raw: attrs.slice(k, m) });
      i = m;
    }
  }
  return props;
}

/** 扫视图层每个 `<Button>` 开标签，按「有没有原生 `title=`」判 P82 违规。
 *
 *  **注意 polarity**：P82 是「不许用原生 `title=`」（该走 `<Hint>`），不是
 *  「必须给 title」。所以计违规的是 `title=` 的**出现**，不是缺席。
 *
 *  五档取名的方向沿用「这一处该怎么处置」：
 *    · clean   —— 没有 title 属性、也没有 spread          → 合规，不计
 *    · empty   —— `title=""` / `title={undefined|null}`    → 空值不产生原生
 *                 tooltip，等同于没写，不计违规（**旧判据把这一档也当违规，
 *                 是误报**）
 *    · static  —— `title="有内容"`                       → 真·原生 tooltip，违规
 *    · dynamic —— `title={expr}`                          → 运行时才知值，默认
 *                 当违规（`<Hint label={expr}>` 才是出口）
 *    · unknown —— 有 `{...props}` 展开且无显式 title       → 静态判不了 title
 *                 会不会被带进来，单列人工抽查、不计违规（**旧判据漏计**）
 *  返回值里 `violations = static + dynamic`，P82 只把它计入硬闸。 */
function countButtonTitle(text) {
  const t = stripComments(text);
  const res = {
    clean: 0,
    empty: 0,
    static: 0,
    dynamic: 0,
    unknown: 0,
    violations: 0,
    unknownHits: [],
  };
  const re = /<Button(?=[\s/>])/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    const scanned = scanJsxAttrs(t, re.lastIndex);
    if (!scanned) continue;
    const props = parseJsxProps(scanned.attrs);
    const titles = props.filter((p) => p.name === "title");
    if (titles.length) {
      /* 同名重复时取最后一个（JSX 后者覆盖前者）。 */
      const tier = classifyTitleValue(titles[titles.length - 1]);
      res[tier]++;
      if (tier === "static" || tier === "dynamic") res.violations++;
    } else if (props.some((p) => p.kind === "spread")) {
      res.unknown++;
      res.unknownHits.push(m.index);
    } else {
      res.clean++;
    }
  }
  return res;
}

/** 单条 `title=` 取值分档：空串 / `{undefined}` / `{null}` / `{void 0}` → empty；
 *  引号串（含空模板串）按内容判；`{…}` 表达式有非空内容 → dynamic。 */
function classifyTitleValue(prop) {
  const raw = (prop.raw ?? "").trim();
  if (!raw) return "empty";
  if (raw.startsWith("{")) {
    const expr = raw.slice(1).replace(/}$/, "").trim();
    if (/^(undefined|null|void\s+0|)$/.test(expr)) return "empty";
    return "dynamic";
  }
  const unquoted = raw.replace(/^["'`]/, "").replace(/["'`]$/, "");
  return unquoted ? "static" : "empty";
}

/** P37 的「忙碌位」名字判据：按变量名区分「忙碌位」与「选中位」（与 P30 同款）。 */
function isBusySlotName(name) {
  return /[Bb]usy/.test(name) || /^\w*[Rr]etry\w*Id$/.test(name);
}

/** P81 的「icon-like 标签名」判据：视图里作为 Button 直接子级的 icon 有
 *  三种来源 —— 项目自研 `<Icon name="…">`、原生 `<svg>`、lucide 组件；
 *  后者按 lucide 的两种命名习惯：
 *    · 别名约定（`import { ChevronLeft as ChevronLeftIcon }`）→ `*Icon` 后缀；
 *    · 直接名（`import { Plus }`）→ 需要一份白名单，避免前缀匹配把 `<Push>`
 *      之类误当 icon。
 *  白名单是「视图实测出现过的 25 项 + 常见 20 项」，够用即可；未来新用到
 *  未登记的 lucide 名会被少计、棘轮不会假红，走治理时按 `--report` 补齐。 */
const P81_ICON_NAMES = new Set([
  "Plus",
  "Minus",
  "X",
  "Check",
  "CheckCheck",
  "Copy",
  "Search",
  "Trash",
  "Trash2",
  "RefreshCw",
  "RefreshCcw",
  "Settings",
  "Play",
  "Pause",
  "Upload",
  "Download",
  "ExternalLink",
  "Link",
  "Unlink",
  "Paperclip",
  "Eye",
  "EyeOff",
  "Edit",
  "Menu",
  "MoreHorizontal",
  "MoreVertical",
  "File",
  "FileText",
  "Folder",
  "FolderOpen",
  "Star",
  "Heart",
  "Zap",
  "Sparkles",
  "Terminal",
  "Wrench",
  "Clock",
  "Bell",
  "Info",
  "AlertCircle",
  "AlertTriangle",
  "Ban",
  "Loader",
  "Loader2",
  "LoaderCircle",
  "ArrowLeft",
  "ArrowRight",
  "ArrowUp",
  "ArrowDown",
  "ChevronLeft",
  "ChevronRight",
  "ChevronUp",
  "ChevronDown",
  "CircleCheck",
  "CircleAlert",
  "CircleX",
  "TriangleAlert",
  "OctagonAlert",
  "Film",
  "Image",
  "ImagePlus",
  "Camera",
  "Video",
  "Music",
  "Mic",
  "MicOff",
  "Volume2",
  "VolumeX",
  "Send",
  "Share2",
  "LayoutGrid",
  "List",
  "ClipboardCheck",
  "Clipboard",
  "Maximize2",
  "Minimize2",
  "Undo2",
  "Redo2",
  "Save",
  "Power",
]);
function isP81IconName(name) {
  if (name === "Icon" || name === "svg") return true;
  if (name.length > 4 && name.endsWith("Icon")) return true;
  return P81_ICON_NAMES.has(name);
}

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
   * · `studio/ProjectOutputs.tsx` · `studio/TrainingStudio.tsx`
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
]);

/* ── 采集 ────────────────────────────────────────────────── */

function walk(dir, out = []) {
  const abs = path.join(ROOT, dir);
  if (!fs.existsSync(abs)) return out;
  for (const e of fs.readdirSync(abs, { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === "__snapshots__") continue;
      walk(rel, out);
    } else {
      out.push(rel);
    }
  }
  return out;
}

const isTest = (r) =>
  /\.test\.[cm]?[jt]sx?$/.test(r) || r.includes("/__tests__/");

/** 收集当前各文件的违规计数：rel -> { P1?, P2?, P3?, P4? }。
 *  硬闸判据（HARD_GATE_RULES）一并收进来，由 main 分开判定：棘轮只看前者，
 *  后者必须恒为 0。 */
function collect() {
  const files = {};
  for (const dir of SCAN_DIRS) {
    for (const rel of walk(dir)) {
      if (!/\.[jt]sx?$/.test(rel) || rel.endsWith(".d.ts")) continue;
      if (isTest(rel)) continue;
      /* `ui/` 豁免与 `hooks/` 豁免都**只对「数视图实现」的判据**成立：
       *   · P1/P2/P3 数的是视图里手写 `<button>` / portal / spinner ——
       *     `ui/` 与 `hooks/` 里出现不是「自己实现一份」；
       *   · 反过来，P40「复制之后给什么反馈」在 `ui/json-viewer` 也有消费点，
       *     整体跳过会让出口的消费点无从校验 —— 所以本批三条不走 `ui/` 豁免。 */
      const inUi = /^src\/components\/ui\//.test(rel);
      const inHooks = /\/hooks\//.test(rel);
      const inLib = /^src\/(lib|server)\//.test(rel);
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const [id, rule] of Object.entries(RULES)) {
        if (isExemptFile(id, rel)) continue;
        /* P67 引入的对偶判据：这条账问的就是 ui/ 层自己有没有绕开 shadcn
         * 基元（Badge / Progress / Slider / Empty / Field），视图层里同样的
         * 命名形态是消费基元的业务包装、不该被算进来。见 UI_ONLY_RULES 上方
         * 的注释。**分支必须短路在下面三条之前**：否则 ui/ 会先被
         * `inUi && !UI_ALSO_SCANNED.has(id)` 早一步 continue 掉、UI_ONLY
         * 反而永远扫不到自己该扫的那一层。 */
        if (UI_ONLY_RULES.has(id)) {
          if (!inUi) continue;
        } else {
          if (inUi && !UI_ALSO_SCANNED.has(id)) continue;
          if (inHooks && !HOOKS_ALSO_SCANNED.has(id)) continue;
          if (inLib && !LIB_SCANNED_RULES.has(id)) continue;
        }
        const n = rule.count(text);
        if (n > 0) (files[rel] ||= {})[id] = n;
      }
    }
  }
  return files;
}

/** 棘轮口径的计数：剔掉硬闸判据（它们的判据是「必须为 0」，不进基线）。 */
function ratchetOnly(map) {
  const out = {};
  for (const [rel, counts] of Object.entries(map)) {
    const keep = {};
    for (const [id, n] of Object.entries(counts)) {
      if (!HARD_GATE_RULES.has(id)) keep[id] = n;
    }
    if (Object.keys(keep).length) out[rel] = keep;
  }
  return out;
}

/** 硬闸判据的命中清单（须为空，否则阻断）。 */
function hardGateHits(map) {
  const hits = [];
  for (const [rel, counts] of Object.entries(map)) {
    for (const id of Object.keys(counts)) {
      if (HARD_GATE_RULES.has(id))
        hits.push(`${id} → ${rel}（${counts[id]} 处）`);
    }
  }
  return hits;
}

function total(map) {
  let n = 0;
  for (const v of Object.values(map)) for (const c of Object.values(v)) n += c;
  return n;
}

/* ── 基线读写（棘轮只许下降） ────────────────────────────── */

function writeBaseline(files) {
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        note:
          "视图层自实现 UI 基元的存量（规范 16 §16.2.3）。当前全部判据都是硬闸" +
          "（须为 0），下面的 rules 只登记**仍是棘轮**的那几条 —— 空对象是正常状态，" +
          "不是基线丢了。新增违规请先改用 ui/ 基元，不要用 --update 放水。" +
          "豁免口径见脚本内 EXEMPT_DIRS（与规范 §16.2.3 同源）。",
        rules: Object.fromEntries(
          Object.entries(RULES)
            .filter(([id]) => !HARD_GATE_RULES.has(id))
            .map(([id, r]) => [id, r.label]),
        ),
        total: total(files),
        files,
      },
      null,
      2,
    ) + "\n",
  );
}

function main() {
  const now = collect();
  const prev = fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    : null;
  let baseFiles = prev?.files ?? null;

  if (UPDATE) {
    const gate = hardGateHits(now);
    if (gate.length) {
      console.error(
        "[ui-primitives] 拒绝更新基线：硬闸判据未清零（" +
          `${HARD_GATE_RULES.size} 条，全部须为 0）。\n  ` +
          gate.join("\n  ") +
          "\n  改法：视图里不再写 `::-webkit-scrollbar` 外观（改用 globals.css 的 .custom-scrollbar / .soft-scrollbar）、" +
          "不再自写剪贴板与 Blob 下载（改用 ~/lib/browser-io 的 copyText / downloadText / downloadJson）、" +
          "不再裸写 <img> / <video>（改用 ~/components/ui/media-thumbnail 的 MediaThumbnail）、" +
          "不再手写媒体拖拽源（改用 ~/components/ui/media-drag-source 的 useMediaDragSource）、" +
          "不再自己挂 keydown（改用 ~/components/ui/use-hotkey 的 useHotkey）、" +
          "不再手写滚动贴底（改用 ~/components/ui/use-scroll-follow 的 useScrollFollow）、" +
          "不再自己拼表单行（改用 ~/components/ui/form-field 的 FormField）。",
      );
      process.exit(1);
    }
    const before = baseFiles ? total(baseFiles) : 0;
    const after = total(ratchetOnly(now));
    if (before && after > before) {
      /* 按 rule id 逐个比较：只有**旧基线里已经有的规则**上升才是「放宽」，
       * 拒绝；旧基线里没有这条规则、after 是这次新登记的起点，视作
       * 「判据引入」，允许通过。P71 / P76 / P78 三条棘轮的引入都要走这条路径
       * （此前用总数一把梭会把正当的规则引入误判成放宽）。 */
      const prevByRule = {};
      for (const counts of Object.values(baseFiles ?? {})) {
        for (const [id, n] of Object.entries(counts)) {
          prevByRule[id] = (prevByRule[id] ?? 0) + n;
        }
      }
      const nowByRule = {};
      for (const counts of Object.values(ratchetOnly(now))) {
        for (const [id, n] of Object.entries(counts)) {
          nowByRule[id] = (nowByRule[id] ?? 0) + n;
        }
      }
      const regressions = [];
      for (const [id, afterN] of Object.entries(nowByRule)) {
        const beforeN = prevByRule[id];
        if (beforeN !== undefined && afterN > beforeN) {
          regressions.push(`${id}：${beforeN} → ${afterN}`);
        }
      }
      if (regressions.length) {
        console.error(
          `[ui-primitives] 拒绝放宽基线（棘轮只许下降）：\n  ${regressions.join("\n  ")}\n` +
            "  新增的自实现请先改用 ui/ 基元（<Button> / ui/dialog / page-loading），不要用 --update 掩盖。" +
            "  （**新加一条判据**不受本条限制：只要旧基线里没有过这个 rule id，`--update` 就会把当前实测登记为起点。）",
        );
        process.exit(1);
      }
      /* 剩下的差额都来自**新加规则**（旧基线里没有的 rule id），允许登记为起点。 */
    }
    writeBaseline(ratchetOnly(now));
    console.log(
      `[ui-primitives] 基线已更新：${before} → ${after}（${path.relative(ROOT, BASELINE)}）`,
    );
    process.exit(0);
  }

  /* 报告层：只出清单（排批次用，不判失败）。 */
  /* P82 的 unknown 通道：title 可能经 `{...props}` 带进来，静态判不了 ——
   * 不进硬闸，只在 --report 里单列出来人工抽查（用户明确的口径：missing 计违规、
   * unknown 单列）。 */
  if (REPORT_ONLY) {
    const unknownRows = [];
    for (const dir of SCAN_DIRS) {
      for (const rel of walk(dir)) {
        if (!/\.[jt]sx?$/.test(rel) || rel.endsWith(".d.ts")) continue;
        if (isTest(rel)) continue;
        const inUi = /^src\/components\/ui\//.test(rel);
        if (inUi && !UI_ALSO_SCANNED.has("P82")) continue;
        const r = countButtonTitle(
          fs.readFileSync(path.join(ROOT, rel), "utf8"),
        );
        if (r.unknown) unknownRows.push([rel, r.unknown]);
      }
    }
    for (const [id, rule] of Object.entries(RULES)) {
      const hits = Object.entries(now)
        .filter(([, c]) => c[id])
        .sort((a, b) => b[1][id] - a[1][id]);
      const sum = hits.reduce((n, [, c]) => n + c[id], 0);
      console.log(
        `[ui-primitives] ${id} ${rule.label} —— ${sum} 处 / ${hits.length} 文件`,
      );
      for (const [rel, c] of hits.slice(0, 15)) {
        console.log(`  · ${rel}（${c[id]} 处）`);
      }
      if (hits.length > 15) console.log(`  … 另 ${hits.length - 15} 个文件`);
    }
    const ukSum = unknownRows.reduce((n, [, c]) => n + c, 0);
    console.log(
      `[ui-primitives] P82-unknown 展开 props 里可能带 title（人工抽查，不计违规）—— ${ukSum} 处 / ${unknownRows.length} 文件`,
    );
    for (const [rel, c] of unknownRows.slice(0, 15)) {
      console.log(`  · ${rel}（${c} 处）`);
    }
    if (unknownRows.length > 15)
      console.log(`  … 另 ${unknownRows.length - 15} 个文件`);
    console.log("[ui-primitives] --report 模式：只出清单，不判失败 ✓");
    process.exit(0);
  }

  /* 「先有基线才能判」只对**棘轮**成立：硬闸的判据是「恒为 0」，跟基线在不在
   * 没关系。把两者绑死会造出一个假前置 —— 全库判据都升成硬闸之后，删掉基线文件
   * 竟能让门禁报「先跑 --update」而不去数那 84 条（`--update` 此时还会被硬闸拒，
   * 于是门禁自己把自己锁死）。 */
  const hasRatchetRules = Object.keys(RULES).some(
    (id) => !HARD_GATE_RULES.has(id),
  );
  if (!baseFiles && hasRatchetRules) {
    console.error(
      "[ui-primitives] 基线文件缺失：先执行 node scripts/check-ui-primitives.cjs --update",
    );
    process.exit(1);
  }
  if (!baseFiles) {
    // 没有棘轮判据可比：给一份空账，后面的比对天然只剩硬闸一条路。
    baseFiles = {};
  }

  const problems = hardGateHits(now);
  const dropped = [];
  for (const [rel, counts] of Object.entries(ratchetOnly(now))) {
    const b = baseFiles[rel];
    for (const [id, n] of Object.entries(counts)) {
      if (!b || b[id] === undefined) {
        problems.push(`新增 ${id}（${RULES[id].label}）→ ${rel}（${n} 处）`);
      } else if (n > b[id]) {
        problems.push(
          `${id} 上升 ${b[id]} → ${n} → ${rel}（${RULES[id].label}）`,
        );
      } else if (n < b[id]) {
        dropped.push(`${id} ${b[id]} → ${n}：${rel}`);
      }
    }
  }
  for (const [rel, b] of Object.entries(baseFiles)) {
    const cur = now[rel];
    for (const [id, n] of Object.entries(b)) {
      if (!cur || cur[id] === undefined) dropped.push(`${id} ${n} → 0：${rel}`);
    }
  }

  const ratchetNow = ratchetOnly(now);
  const sum = total(ratchetNow);
  console.log(
    `[ui-primitives] 当前自实现存量 ${sum} 处 / ${Object.keys(ratchetNow).length} 个文件` +
      `（规范 16 §16.2.3）`,
  );
  console.log(
    /* 不把每条硬闸的名字手抄进输出：那份清单已经漂过（写着 P4~P66，而 P67~P83
     * 与本轮升闸的 12 条都不在里面）。名字看 `--report`，这里只报「多少条、响了几条」。 */
    `[ui-primitives] 硬闸判据 ${HARD_GATE_RULES.size} 条（全部须为 0）：` +
      `${hardGateHits(now).length} 处命中`,
  );

  if (problems.length) {
    console.error("[ui-primitives] 违规（阻断）：\n  " + problems.join("\n  "));
    console.error(
      "  规范见 docs/standards/16-shadcn-ui与表单校验.md §16.2.3；\n" +
        "  改法：`<button>` → `<Button>`（~/components/ui/button）、自建 portal → ui/dialog / popover / sheet、\n" +
        "  自写 animate-spin → ui/page-loading、自绘滚动条 → globals.css 的 .custom-scrollbar / .soft-scrollbar、\n" +
        "  剪贴板 / Blob 下载 → ~/lib/browser-io 的 copyText / downloadText / downloadJson、\n" +
        "  隐藏文件选择框 → ~/components/ui/file-picker 的 useFilePicker / FilePickerButton、\n" +
        "  「值不存在显示 —」→ ~/lib/display-value 的 displayValue / EMPTY_PLACEHOLDER、\n" +
        "  自绘模态外壳 → ui/dialog 的 Dialog / DialogContent（居中卡片）或 ui/sheet 的 SheetContent（抽屉）；\n" +
        "  裸写 <img> / <video> → ~/components/ui/media-thumbnail 的 MediaThumbnail（失败兜底收在出口里）；\n" +
        "  媒体拖拽源 → ~/components/ui/media-drag-source 的 useMediaDragSource；全局快捷键 → ~/components/ui/use-hotkey 的 useHotkey；\n" +
        "  数字按精度成串 → ~/lib/number-format 的 fixed / trimmed / trimFixed / alphaText；\n" +
        "  去重合并与区域设置排序 → ~/lib/ordered-set 的 unique / uniqueSorted / uniqueBy / union / compareText；\n" +
        "  拼 data URL / 取回它的载荷 → ~/lib/media/data-url 的 toDataUrl / wrapBase64 / parseDataUrl / base64PayloadOf；\n" +
        "  元素上的键动作 → ~/components/ui/simple-key-handler 的 simpleKeyHandler（键名归一走 ~/lib/keyboard 的 normalizeKeyName / isKeyIn）；\n" +
        "  剥掉 / 判断 SGR → ~/lib/log/log-ansi 的 hasSgr / stripSgr / stripAnsi（横幅色板取 BANNER_ANSI）；\n" +
        "  驼峰 ⇄ kebab 换算 → ~/lib/case-token 的 toKebabCase / toCamelCase；\n" +
        "  路径变成展示文本（相对化 / 分隔符归一 / 取末段 / 中段省略）→ ~/lib/path-display 的 toDisplayPath / stripPathPrefix / lastSegments / ellipsisMiddle / normalizeSlashes；\n" +
        "  透传 props 前剔掉自己的私有字段 → ~/lib/dom-props 的 OmitOwnProps（类型表）与 splitDomProps（运行时剥）；\n" +
        "  给异步结果加超时 → ~/lib/with-timeout 的 withTimeout / withTimeoutResult（共用一条「胜出即清定时器」的收尾）；\n" +
        "  异步动作的反馈样板 → ~/lib/async-action 的 runAsyncAction（失败文案走 errorMessage）；\n" +
        "  读媒体自然尺寸 → ~/lib/media/natural-size 的 readNaturalSize / naturalAspectRatio / isPortraitMedia；\n" +
        "  手拼查询串 → ~/lib/query-string 的 buildQueryString / withQuery（媒体预览地址走 ~/lib/media/media-url）；\n" +
        "  按条目的错误位 → ~/components/ui/use-item-errors 的 useItemErrors（错误挂在**那一条**上）；\n" +
        "  取数 effect 的作废守卫 → ~/lib/stale-run 的 beginStaleRun（`commit` 一次给全「这一轮的写入」）；\n" +
        "  服务端错误信封 → ~/lib/api-error 的 apiErrorBody / readApiError（纯错误走 ~/server/lib/error-response）；\n" +
        "  唯一 id → ~/lib/unique-id 的 nextId / uniqueStamp；ComfyUI 报错建议 → ~/lib/comfyui/error-advice 的 adviseOnError；\n" +
        "  往画布放节点 → ~/lib/project-canvas/canvas-helpers 的 placeCanvasNode；\n" +
        "  等一帧再做事 → ~/lib/next-frame 的 onNextFrame / afterNextPaint；\n" +
        "  复制之后的反馈 → ~/components/ui/use-copy-feedback 的 useCopyFeedback；\n" +
        "  REST 入参收窄 → ~/server/lib/request-body 的 readJsonRecord（`unknown` 收窄用 ~/lib/is-record 的 isRecord）；\n" +
        "  异步动作的忙碌位 → ~/components/ui/use-busy-action 的 useBusyAction（复位绑在 finally 上）；\n" +
        "  同一时刻只跑一件 → ~/components/ui/use-reentrancy-lock 的 useReentrancyLock / createReentrancyLock；\n" +
        "  视图层手写 <input type=text|number|password|…> 或 <textarea> → ~/components/ui/input 的 <Input>、\n" +
        "  ~/components/ui/textarea 的 <Textarea>、~/components/ui/number-field 的 <NumberField>（P68）；\n" +
        "  视图层手写 <input type=checkbox|radio> → ~/components/ui/checkbox 的 <Checkbox>、\n" +
        "  ~/components/ui/radio-group 的 <RadioGroup> + <RadioGroupItem>（P69）；\n" +
        "  ui/ 层自造组件绕开 shadcn 基元 → 徽章改 ~/components/ui/badge 的 <Badge>（cva 扩 size/tone 而非各写 <span>）、\n" +
        "  进度条改 ~/components/ui/progress 的 <Progress>+ProgressTrack/Indicator/Label/Value、\n" +
        '  滑块改 ~/components/ui/slider 的 <Slider>（原生 <input type="range"> 只接管取材时也要显式说明理由），\n' +
        "  空态改 ~/components/ui/empty 的 <Empty>(+EmptyHeader/Title/Description/Media/Content)、\n" +
        "  已成块的「图标+标题+说明+动作」空态改 ~/components/ui/empty-state 的 <EmptyState>（P75），\n" +
        "  表单行改 ~/components/ui/field 的 <Field>+FieldLabel/FieldDescription/FieldError（或直接用\n" +
        "  ~/components/ui/form-field 的 <FormField>，它已把 ARIA 关联收在一处）。\n" +
        "  ⚠️ 别拿 `components.json` 判断某个基元装没装：它只记 aliases / registries，\n" +
        "  不记录装过哪些组件；装了没装有争议时看 src/components/ui/ 目录下有没有同名文件。\n" +
        "  治理后执行 --update 收紧基线。",
    );
    process.exit(1);
  }

  if (dropped.length) {
    const msg =
      `[ui-primitives] 检测到 ${dropped.length} 处下降，请收紧基线：\n  ` +
      dropped.join("\n  ") +
      "\n  执行 node scripts/check-ui-primitives.cjs --update";
    if (STRICT) {
      console.error(msg);
      process.exit(1);
    }
    console.log(msg + "（当前非 --strict，仅提示）");
  }
  console.log("[ui-primitives] OK");
}

main();
