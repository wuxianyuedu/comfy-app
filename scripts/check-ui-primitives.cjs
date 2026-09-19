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
 *   —— P1~P3 合计走一条棘轮：**按文件记账、只许降不许升**，与
 *      `check-ui-logic-separation.cjs` / `check-theme-colors.cjs` 同一口径
 *      （基线 `scripts/.ui-primitives-baseline.json`）。
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
 *   node scripts/check-ui-primitives.cjs            # 检查（棘轮：只许降不许升）
 *   node scripts/check-ui-primitives.cjs --strict   # 基线下调也失败（强制收紧）
 *   node scripts/check-ui-primitives.cjs --report   # 只出清单，不判失败（排批次用）
 *   node scripts/check-ui-primitives.cjs --update   # 治理后重写基线（须伴随下降）
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
const SCAN_DIRS = ["src/components", "src/app"];

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
 * 按文件豁免（正则 + 理由，均按仓库相对 POSIX 路径匹配）——只给**某一条判据**
 * 用，不是整目录放行；每条都必须写清「为什么这一处不属于该判据」。
 */
const EXEMPT_FILES = {
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
      re: /^src\/components\/ui\//,
      reason: "ui/ 基元自身实现（`use-hotkey` 就要挂 keydown）。",
    },
  ],
  P23: [
    {
      re: /^src\/components\/studio\/canvas\/WorkflowCanvasSettings\.tsx$/,
      reason:
        "画布设置里的 `LabeledSlider`：标签行是**标签与当前值左右并排**" +
        "（左边「细线透明度」、右边实时读数），而 `FormField` 的标签行是" +
        "「一行标签 + 下方控件」的块级形态。套上去会把那个并排的读数挪走，" +
        "改掉渲染结果（§16.2.4.2 第 9 条）。控件是 `ui/range-slider`，" +
        "已经不在本判据的照管范围内。",
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
};

/** 硬闸判据：清零后直接阻断新增，不进棘轮基线（P4~P15 属此类）。 */
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
      if (EXEMPT_DIRS.some((e) => e.re.test(rel))) continue;
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const [id, rule] of Object.entries(RULES)) {
        if (isExemptFile(id, rel)) continue;
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
          "视图层自实现 UI 基元的存量（规范 16 §16.2.3）。棘轮只许下降；" +
          "新增请先改用 ui/ 基元，不要用 --update 放水。" +
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
  const baseFiles = prev?.files ?? null;

  if (UPDATE) {
    const gate = hardGateHits(now);
    if (gate.length) {
      console.error(
        "[ui-primitives] 拒绝更新基线：硬闸判据未清零（P4~P15）。\n  " +
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
      console.error(
        `[ui-primitives] 拒绝放宽基线：${before} → ${after}（棘轮只许下降）。\n` +
          "  新增的自实现请先改用 ui/ 基元（<Button> / ui/dialog / page-loading），不要用 --update 掩盖。",
      );
      process.exit(1);
    }
    writeBaseline(ratchetOnly(now));
    console.log(
      `[ui-primitives] 基线已更新：${before} → ${after}（${path.relative(ROOT, BASELINE)}）`,
    );
    process.exit(0);
  }

  /* 报告层：只出清单（排批次用，不判失败）。 */
  if (REPORT_ONLY) {
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
    console.log("[ui-primitives] --report 模式：只出清单，不判失败 ✓");
    process.exit(0);
  }

  if (!baseFiles) {
    console.error(
      "[ui-primitives] 基线文件缺失：先执行 node scripts/check-ui-primitives.cjs --update",
    );
    process.exit(1);
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
    `[ui-primitives] 硬闸判据（P4 自绘滚动条 / P5 剪贴板 / P6 Blob 下载 / P7 手工文件选择 / P8 自写缺值占位符 / P9 自绘模态浮层 / P10 自绘折叠开关 / P11 自绘浮层选项列表 / P12 自写轮询 / P13 自写搜索归一化 / P14 自写展开集合 / P15 自写加宽档 / P16 自绘进度条 / P17 自写键值行 / P18 裸写 img·video / P19 手写媒体拖拽源 / P20 自写全局快捷键 / P21 自写滚动跟随 / P22 自写外部导航 / P23 自写表单行，须为 0）：${hardGateHits(now).length} 处`,
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
        "  媒体拖拽源 → ~/components/ui/media-drag-source 的 useMediaDragSource；全局快捷键 → ~/components/ui/use-hotkey 的 useHotkey。\n" +
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
