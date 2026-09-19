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

/** 硬闸判据：清零后直接阻断新增，不进棘轮基线（P4 属此类）。 */
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
        "[ui-primitives] 拒绝更新基线：硬闸判据未清零（P4~P9）。\n  " +
          gate.join("\n  ") +
          "\n  改法：视图里不再写 `::-webkit-scrollbar` 外观（改用 globals.css 的 .custom-scrollbar / .soft-scrollbar）、" +
          "不再自写剪贴板与 Blob 下载（改用 ~/lib/browser-io 的 copyText / downloadText / downloadJson）。",
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
    `[ui-primitives] 硬闸判据（P4 自绘滚动条 / P5 剪贴板 / P6 Blob 下载 / P7 手工文件选择 / P8 自写缺值占位符 / P9 自绘模态浮层 / P10 自绘折叠开关 / P11 自绘浮层选项列表 / P12 自写轮询，须为 0）：${hardGateHits(now).length} 处`,
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
        "  自绘模态外壳 → ui/dialog 的 Dialog / DialogContent（居中卡片）或 ui/sheet 的 SheetContent（抽屉）。\n" +
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
