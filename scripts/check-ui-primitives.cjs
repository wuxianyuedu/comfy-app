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
]);

/**
 * 按文件豁免（正则 + 理由，均按仓库相对 POSIX 路径匹配）——只给**某一条判据**
 * 用，不是整目录放行；每条都必须写清「为什么这一处不属于该判据」。
 */
const EXEMPT_FILES = {
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
        t2.match(/\bnatural(?:Width|Height)\b/g) || []
      ).length +
        (t2.match(/\bvideo(?:Width|Height)\b/g) || []).length;
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
      const re =
        /(?:^|[\w./\-'"`(])[?&][A-Za-z][\w.-]*=(?:\$\{|["'`])/g;
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
      const decls = t2.match(/\blet\s+([A-Za-z_$][\w$]*)\s*=\s*false\s*;/g) || [];
      let hits = 0;
      for (const decl of decls) {
        const name = decl.match(/\blet\s+([A-Za-z_$][\w$]*)\s*=/)[1];
        if (!/cancel|abort|stale|alive|disposed/i.test(name)) continue;
        /* 读法：`if (x)` / `if (!x)` —— 只要有读，且有置位。 */
        const readRe = new RegExp(
          `if\\s*\\(\\s*!?\\s*(?:this\\.)?${name}\\b`,
        );
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
      const read = t2.match(
        /(?:isRecord\s*\(\s*(\w+)\s*\)[\s\S]{0,80}?|\b(\w*(?:body|json|data)\w*)\s+as\s*\{[\s\S]{0,80}?)[\s\S]{0,80}?\b\1\2\.error\b/g,
      ) || [];
      return write + read.length;
    },
  },
};

/** 硬闸判据：清零后直接阻断新增，不进棘轮基线（P4~P32 属此类）。 */
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
      /* `ui/` 永远豁免（基元自身实现）；`hooks/` 只对「逻辑层也成立」的判据
       * 不豁免（见 `HOOKS_ALSO_SCANNED`）。 */
      if (/^src\/components\/ui\//.test(rel)) continue;
      const inHooks = /\/hooks\//.test(rel);
      const text = fs.readFileSync(path.join(ROOT, rel), "utf8");
      for (const [id, rule] of Object.entries(RULES)) {
        if (isExemptFile(id, rel)) continue;
        if (inHooks && !HOOKS_ALSO_SCANNED.has(id)) continue;
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
        "[ui-primitives] 拒绝更新基线：硬闸判据未清零（P4~P32）。\n  " +
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
    `[ui-primitives] 硬闸判据（P4 自绘滚动条 / P5 剪贴板 / P6 Blob 下载 / P7 手工文件选择 / P8 自写缺值占位符 / P9 自绘模态浮层 / P10 自绘折叠开关 / P11 自绘浮层选项列表 / P12 自写轮询 / P13 自写搜索归一化 / P14 自写展开集合 / P15 自写加宽档 / P16 自绘进度条 / P17 自写键值行 / P18 裸写 img·video / P19 手写媒体拖拽源 / P20 自写全局快捷键 / P21 自写滚动跟随 / P22 自写外部导航 / P23 自写表单行 / P24 自写读文件 / P25 自写 localStorage /
  P26 自写 Enter 提交 / P27 自写异步动作反馈样板 / P28 自读媒体自然尺寸 /
  P29 手拼查询串 / P30 按条目共用错误位 / P31 自写作废守卫 / P32 手拼错误信封，须为 0）：${hardGateHits(now).length} 处`,
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
        "  异步动作的反馈样板 → ~/lib/async-action 的 runAsyncAction（失败文案走 errorMessage）；\n" +
        "  读媒体自然尺寸 → ~/lib/media/natural-size 的 readNaturalSize / naturalAspectRatio / isPortraitMedia；\n" +
        "  手拼查询串 → ~/lib/query-string 的 buildQueryString / withQuery（媒体预览地址走 ~/lib/media/media-url）；\n" +
        "  按条目的错误位 → ~/components/ui/use-item-errors 的 useItemErrors（错误挂在**那一条**上）；\n" +
        "  取数 effect 的作废守卫 → ~/lib/stale-run 的 beginStaleRun（`commit` 一次给全「这一轮的写入」）；\n" +
        "  服务端错误信封 → ~/lib/api-error 的 apiErrorBody / readApiError（纯错误走 ~/server/lib/error-response）。\n" +
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
