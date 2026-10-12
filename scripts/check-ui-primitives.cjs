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
 *      `HARD_GATE_RULES`：**现在 85 条全部须为 0**。棘轮这条路径留着，是给
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
 *      `HistoryDetailModal` 的生成参数卡与 `<table>` 参数表、
 *      `BrowserStatusBar` 的显存/内存内联项（另含已删的训练工作室 Metrics 网格）。
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
 *      直接改 DOM，失败的那一格留下**空洞**）、已删的训练工作室数据集缩略图用
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
 *   node scripts/check-ui-primitives.cjs            # 检查（85 条硬闸全部须为 0）
 *   node scripts/check-ui-primitives.cjs --strict   # 基线下调也失败（强制收紧）
 *   node scripts/check-ui-primitives.cjs --report   # 只出清单，不判失败（排批次用）
 *   node scripts/check-ui-primitives.cjs --update   # 只给**新引入的棘轮判据**登记起点
 *                                                  # （硬闸未清零时直接拒绝，不写基线）
 *   --staged（钩子用）仅当暂存改动落在扫描面内才扫 —— 口径见 §13.5.8.2 */
const fs = require("node:fs"), path = require("node:path");
const { skipUnlessStagedTouches } = require("./gate-scan-read.cjs");
const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const BASELINE = path.join(__dirname, ".ui-primitives-baseline.json");

/* 文本引擎（剥注释 / JSX 平衡扫描 / 属性解析）单独立一份 —— 见那条文件头的
 * 「分层」说明。判据（85 条 rule）全留在本脚本里，这里只借机器。 */
const {
  stripCommentsCached,
  stripP71AllowBlocks,
  countNestedMinMax,
  countNonContainment,
  scanJsxAttrs,
  readJsxAttrsPastTag,
  parseJsxProps,
  countButtonTitle,
  isBusySlotName,
  isP81IconName,
} = require("./ui-primitives-engine.cjs");

const {
  VIEW_SCAN_DIRS,
  SCAN_DIRS,
  LIB_SCANNED_RULES,
  UI_ALSO_SCANNED,
  HOOKS_ALSO_SCANNED,
  EXEMPT_DIRS,
  UI_ONLY_RULES,
  EXEMPT_FILES,
  RULES,
  RULE_TIER_IDS,
  HARD_GATE_RULES,
} = require("./ui-primitives-rules.cjs");

/* ── 扫描范围 ────────────────────────────────────────────── */


/** 某文件是否被指定判据豁免。 */
function isExemptFile(id, rel) {
  return (EXEMPT_FILES[id] ?? []).some((e) => e.re.test(rel));
}




/** rule id → 档位名；未登记的 id 返回 `null`（调用方据此报错）。 */
function tierOf(id) {
  for (const [tier, ids] of Object.entries(RULE_TIER_IDS)) {
    if (ids.includes(id)) return tier;
  }
  return null;
}

/** 档位清单（顺序即输出顺序）：CORE 在前 —— 它是地基本身。 */
const TIER_ORDER = Object.keys(RULE_TIER_IDS);

/** 档位的人话名字（只用于 `--report` 的分组标题，不是判据）。 */
const RULE_TIER_LABEL = {
  CORE: "基元层 · 出口是已固化的基元/小工具，形态长期不动",
  SURFACE: "业务面 · 出口多为近几批接上的零引用基元，形态随业务走",
};

/**
 * 分档自检：每条判据**恰好**落在一档里 —— 漏登记与重复登记都是真故障。
 *
 * 为什么要在脚本自己里判（而不是靠人记得登记）：这一层是**给人看的组织方式**，
 * 漏登记的形态恰恰是静默的 —— 新判据照常跑、照常阻断，只是它不出现在任何一档的
 * 分组里，于是 `--report` 少列一条、失败输出把它漏掉。这与 §13.5.12
 * 「判据在场 ≠ 判据在跑」是同一族：**这里判的是「判据在场 ≠ 判据被分类」**。
 *
 * @returns {string[]} 问题清单（空数组 = 通过）
 */
function tierProblems() {
  const problems = [];
  const seen = new Map();
  for (const [tier, ids] of Object.entries(RULE_TIER_IDS)) {
    for (const id of ids) {
      if (!RULES[id]) problems.push(`${tier} 登记了不存在的判据 ${id}`);
      if (seen.has(id)) {
        problems.push(`${id} 同时登记在 ${seen.get(id)} 与 ${tier}`);
      }
      seen.set(id, tier);
    }
  }
  for (const id of Object.keys(RULES)) {
    if (!seen.has(id)) {
      problems.push(`${id} 未登记档位（RULES 里有、RULE_TIER_IDS 里没有）`);
    }
  }
  return problems;
}



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
  /* 分档自检**放在最前面**：判据还没跑就先保证「85 条每条都有档位」——
   * 等到失败输出里才发现某条没被分类，那时人已经在看红、不会去补分类。 */
  const tierBad = tierProblems();
  if (tierBad.length) {
    console.error(
      "[ui-primitives] 判据分档自检失败（每条 rule id 必须恰好落在一档里）：\n  " +
        tierBad.join("\n  ") +
        "\n  改法：在脚本的 RULE_TIERS 里给这条判据登记 CORE（基元层）或 SURFACE（业务面），" +
        "\n  口径见文件头「分层」一节。",
    );
    process.exit(1);
  }
  if (ARGS.has("--staged") && !REPORT_ONLY && !UPDATE) skipUnlessStagedTouches({ roots: SCAN_DIRS, tag: "[ui-primitives]" });
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
    /* 按档分组输出：85 条平铺看不出「响的是地基层还是业务面」——
     * 档位口径见文件头「分层」一节。 */
    for (const tier of TIER_ORDER) {
      const ids = Object.keys(RULES).filter((id) => tierOf(id) === tier);
      console.log(
        `[ui-primitives] ── ${tier}（${RULE_TIER_LABEL[tier]}）· ${ids.length} 条 ──`,
      );
      for (const id of ids) {
        const rule = RULES[id];
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
   * 竟能让门禁报「先跑 --update」而不去数那 85 条（`--update` 此时还会被硬闸拒，
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
  /* 分档读数：85 条里哪一档在响 —— 全绿时不打（避免每次提交都多两行噪声），
   * 有命中时它是「这次该往哪个方向看」的第一条线索。 */
  if (hardGateHits(now).length) {
    const hitIds = new Set(
      Object.values(now)
        .flatMap((counts) => Object.keys(counts))
        .filter((id) => HARD_GATE_RULES.has(id)),
    );
    console.log(
      `[ui-primitives] 命中分档：` +
        TIER_ORDER.map((tier) => {
          const ids = [...hitIds].filter((id) => tierOf(id) === tier);
          return `${tier} ${ids.length ? ids.join("/") : "0"}`;
        }).join(" · "),
    );
  }

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
        "  剥掉 / 判断 SGR → ~/lib/log/log-ansi 的 hasSgr / stripSgr / stripAnsi；\n" +
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
