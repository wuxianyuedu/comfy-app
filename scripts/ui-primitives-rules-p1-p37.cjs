#!/usr/bin/env node
// @ts-nocheck -- UI 基元判据的规则表分片：P1 ~ P37（四种基本元素 / 浏览器能力地基 / 结构件 / 挂钩与生命周期 / lib 固化小工具）
/**
 * `ui-primitives-rules.cjs` 的规则表分片（ISSUE #1811）。
 *
 * 85 条判据的 `count` 实现合计 2754 行 —— 按 R5「单文件超 900 行须拆」的尺子，
 * 一张表放不下，于是按 P 编号区间切成四份；四份都是**同构的对象片段**，
 * 由 `ui-primitives-rules.cjs` 用 `{...a, ...b}` 合并成 `RULES`。
 *
 * 切法只跟**编号区间**走（不按档位）：档位表 `RULE_TIER_IDS` 是另一维度，
 * 把它和「实现住在哪一份」绑在一起，会让「改判据所属档位」变成跨文件搬家。
 * 合并顺序即对象键顺序，与拆分前逐字一致。
 */
/* 引擎 helper 按本片实际用量解构（core no-unused-vars 守着）；跨片搬规则时同步增删。 */
const { stripCommentsCached, isBusySlotName } = require("./ui-primitives-engine.cjs");

module.exports = {
  P1: {
    label: "视图内手写 <button>（应使用 ~/components/ui/button 的 <Button>）",
    count: (t) => (stripCommentsCached(t).match(/<button\b/g) ?? []).length,
  },
  P2: {
    label: "视图内自建 createPortal 浮层（应使用 ui/dialog / popover / sheet）",
    count: (t) => (stripCommentsCached(t).match(/\bcreatePortal\s*\(/g) ?? []).length,
  },
  P3: {
    label:
      "视图内自写加 spinner/pulse 动画（应使用 ui/page-loading 的 PageLoading / Spinner、ui/skeleton / ui/progress）",
    count: (t) => (stripCommentsCached(t).match(/\banimate-(?:spin|pulse)\b/g) ?? []).length,
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
    count: (t) => (stripCommentsCached(t).match(/\boverlayClass\s*\(/g) ?? []).length,
  },
  P4: {
    label:
      "视图内自写 ::-webkit-scrollbar 外观（应复用 globals.css 的 .custom-scrollbar / .soft-scrollbar）",
    count: (t) => (stripCommentsCached(t).match(/::-webkit-scrollbar/g) ?? []).length,
  },
  P5: {
    label: "视图内自写剪贴板写入（应使用 ~/lib/browser-io 的 copyText）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      return (
        (t2.match(/navigator\.clipboard/g) ?? []).length +
        (t2.match(/document\.execCommand\(/g) ?? []).length
      );
    },
  },
  P6: {
    label: "视图内自写 Blob 下载（应使用 ~/lib/browser-io 的 downloadText / downloadJson）",
    count: (t) => (stripCommentsCached(t).match(/URL\.createObjectURL\s*\(/g) ?? []).length,
  },
  P8: {
    label: "视图内自写「值不存在显示 —」的判据（应使用 ~/lib/display-value 的 displayValue）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 数两种写法：① 字面量里直接写占位符；② 比较算子后面紧跟占位符。
       * 两条都要求占位符**字面出现**在代码里 —— 用了 `displayValue` 的地方
       * 自然不含它。 */
      return (t2.match(/"—"|'—'/g) ?? []).length + (t2.match(/\?\?\s*"[^"]*—/g) ?? []).length;
    },
  },
  P12: {
    label:
      "视图 / 逻辑层里自写 setInterval 轮询（应使用 ~/components/ui/use-interval 的 useInterval）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      return (t2.match(/\bsetInterval\s*\(/g) ?? []).length;
    },
  },
  P11: {
    label:
      "视图内自绘可滚动浮层选项列表（应使用 ~/components/ui/option-list-popover 的 OptionListPopover）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 「手搓 chip 浮层」= 本文件里既自建 `PopoverTrigger`、又自己画 `▾`
       * 展开标记。两个条件同时成立才计 —— 见文件头 P11 说明。 */
      if (!/\bPopoverTrigger\b/.test(t2)) {
        return 0;
      }
      return (t2.match(/▾/g) ?? []).length;
    },
  },
  P10: {
    label: "视图内自绘折叠/展开开关（应使用 ~/components/ui/disclosure 的 Disclosure）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 两种形态：① 原生 `<details>`；② 自绘折叠开关 —— `role="button"` 配
       * `▸` / `▾` 展开标记。第二种要求**同一文件里两者同时出现**，否则会把
       * 「浮层触发器上的装饰箭头」（chip / 下拉 / 弹窗触发器都画一个 `▾`）
       * 误判成折叠 —— 那些属于浮层形态（P9 / 基元），不是 disclosure。
       * 箭头图标（lucide `Chevron*`）不计：它在导航 / 分页 / 浮层触发里都有，
       * 单看图标判不出意图；`▸` / `▾` 这两个字符在本库只用于「折起来」与
       * 「打开面板」，配上 `role="button"` 才唯一指向折叠。 */
      const details = (t2.match(/<details\b/g) ?? []).length;
      const markers = (t2.match(/[▸▾]/g) ?? []).length;
      const roleButton = /role\s*=\s*["']button["']/.test(t2);
      return details + (roleButton ? markers : 0);
    },
  },
  P13: {
    label:
      "视图 / 逻辑层里自写搜索关键字归一化（应使用 ~/lib/list-filter 的 normalizeNeedle / matchesNeedle）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
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
      const both = (t2.match(/\S+\.trim\(\)\.toLowerCase\(\)/g) ?? []).length;
      const trimmed = (
        t2.match(
          /\b(?:kw|needle|term|query|search|keyword|q)\w*\s*=\s*[^;\n]*\.trim\(\)(?!\.toLowerCase\(\))/gi,
        ) ?? []
      ).length;
      return both + trimmed;
    },
  },
  P14: {
    label:
      "视图内自写展开集合的翻转样板（应使用 ~/components/ui/expansion-set 的 useExpansionSet）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`{ ...src, [key]: !src[key] }` —— **同一个标识符**既被展开、
       * 又是翻转的取值源。这就是「自己在维护一份展开集合」的签名。
       *
       * 参数名故意不写死（`prev` / `state` / `parents` / `nodeList` / `expanded`
       * 各种都有）—— 收口前那三处的形参名就是三种。双条件（展开 + 翻转同源）
       * 是必须的：只数 `[k]: !x[k]` 会把「在跑标记」这类**不是折叠语义**的
       * 映射误判成展开集合（见文件头 P14）。 */
      const flips =
        t2.match(/[A-Za-z_$][\w$]*\s*,?\s*\[\s*[^\]]+\s*\]\s*:\s*!\s*[A-Za-z_$][\w$]*\s*\[/g) ?? [];
      let n = 0;
      for (const flip of flips) {
        const src = /!\s*(?<src>[A-Za-z_$][\w$]*)\s*\[/.exec(flip)?.groups?.src;
        if (src && new RegExp(String.raw`\.\.\.\s*` + src + String.raw`\b`).test(t2)) {
          n++;
        }
      }
      return n;
    },
  },
  P15: {
    label:
      "视图内自写面板加宽档与切换钮（应使用 ~/components/ui/wide-panel 的 useWidePanel / WidePanelToggle）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`<flag> ? <X>.wide : <X>.base` —— 加宽档的三元写法。
       * 单看 `useState(false)` 会把所有弹窗开关算上（见文件头 P15）。 */
      return (t2.match(/\?\s*[A-Za-z_$][\w$]*\.wide\s*:\s*[A-Za-z_$][\w$]*\.base/g) ?? []).length;
    },
  },
  P16: {
    label:
      "视图内自绘进度条填充（应使用 ~/components/ui/progress-bar 的 ProgressBar；数值走 ~/lib/progress）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`style={{ width: `${…}%` }}` —— 自己按百分比摆宽度。
       * 这是进度条填充的签名，且不会被圆角 / 背景色这类通用类误伤。 */
      return (t2.match(/style=\{\{\s*width:\s*`\$\{[^}]+\}%`/g) ?? []).length;
    },
  },
  P17: {
    label: "视图内自写键值行（应使用 ~/components/ui/key-value-rows 的 KeyValueRows）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 已经用了出口的文件**不可能**是「自己写一份」—— 它的标签 / 值节点
       * 是作为 `items` 传给 `KeyValueRows` 的，形态判据会把它们连起来误报
       * （`WorkshopEncapsulationPanel` 的键节点里有个 muted 色的口 id span）。
       * 与 P13「同时数更差的那种写法」是同一枚硬币的两面：判据要覆盖所有
       * 不合规的写法，也要**一个都不误伤**合规的。 */
      if (/from\s+["']~\/components\/ui\/key-value-rows["']/.test(t2)) {
        return 0;
      }
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
      return (t2.match(pattern) ?? []).length;
    },
  },
  P18: {
    label: "视图内裸写 <img> / <video>（应使用 ~/components/ui/media-thumbnail 的 MediaThumbnail）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：视图里自己出现 `<img` / `<video` 标签。收口后 `MediaThumbnail`
       * 是「渲染一张可能失败的媒体图」的唯一出口，调用处不再出现这两个标签。
       *
       * ⚠️ 单看 `onError=` 会漏掉那 14 处**压根没有兜底**的 `<img>` —— 而
       * 「没有出现 onError」正是这条账里更差的那一半（与 P13 同源）。
       * `<video` 一并数：`MediaThumbnail` 管的就是「图片 / 视频二选一」。 */
      return (t2.match(/<img\b/g) ?? []).length + (t2.match(/<video\b/g) ?? []).length;
    },
  },
  P19: {
    label: "视图内自写媒体拖拽源（应使用 ~/components/ui/media-drag-source 的 useMediaDragSource）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：手写本项目跨组件拖拽的自定义 MIME。
       * 单看 `draggable` 会把组件内拖拽（React Flow 节点、表单行）算进来。 */
      return (t2.match(/setData\(\s*["']application\/x-comfyapp-media["']/g) ?? []).length;
    },
  },
  P20: {
    label: "视图 / 逻辑层里自写全局快捷键监听（应使用 ~/components/ui/use-hotkey 的 useHotkey）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：自己往 window / document 上挂 keydown。
       * ⚠️ 单看 `metaKey` / `ctrlKey` 会漏掉「只判 ctrlKey」那两处 ——
       * 而它们才是这条账里更差的那一种（macOS 上按 ⌘ 没反应）。 */
      return (t2.match(/addEventListener\(\s*["']keydown["']/g) ?? []).length;
    },
  },
  P21: {
    label: "视图内自写滚动跟随到底（应使用 ~/components/ui/use-scroll-follow 的 useScrollFollow）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`el.scrollTop = el.scrollHeight` 这个**赋值**（两侧都在）。
       * 只数「写 scrollTop」会漏掉「用别的变量名接 contentHeight 再赋」的写法；
       * 而只数 `scrollHeight` 会把 `log-virtual` 的贴底算术（只读不写）与
       * textarea 自动增高（写 `style.height`）算进来。两边同时出现才计。 */
      return (t2.match(/scrollTop\s*=[^;\n]*scrollHeight/g) ?? []).length;
    },
  },
  P22: {
    label:
      "视图内自写外部目标导航（应使用 ~/lib/external-open + ~/components/ui/use-external-action）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`window.location.href = <…>` —— 把控制权交给外部程序
       * （本项目唯一实例是 `comfyapp://` 打开目录）。
       * ⚠️ **不数**对内的路由跳转：那在 App Router 里走 `router.push`
       * （`next/navigation`），不是同一个形态；也不数与文件选择相关的
       * `input.click()`（那是 P7 的账）。 */
      return (t2.match(/window\.location\.href\s*=/g) ?? []).length;
    },
  },
  P23: {
    label: "视图内自写「标签 + 控件」的表单行（应使用 ~/components/ui/form-field 的 FormField）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
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
      return (t2.match(re) ?? []).length;
    },
  },
  P24: {
    label: "视图里自写读文件（应使用 ~/lib/file-io 的 readFileAsText / readFileAsDataUrl）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：FileReader 的 `readAs*` 调用，或 `await <x>.text()`。
       * 单看 `FileReader` 会漏掉 `file.text()` 那一族（它们才是多数）；
       * `readAs*` 是 FileReader 的唯一签名，漏不掉「手搓 reader」那种。 */
      return (
        (t2.match(/readAs(?:Text|DataURL|ArrayBuffer|BinaryString)\s*\(/g) ?? []).length +
        /* **不带 `await` 的 `.text()` 也要数**：那是这条账里更差的一半 ——
         * `void file.text().then(...)` 没有 rejection 分支，读失败被整个吞掉
         *（`VideoQueueModal` / `WorkshopStageBody` 原先就是这两处）。
         * 与 P13「更差的那种写法也要数」同源：判据漏掉更差的那一种，
         * 被拦下的就永远只是合规者。 */
        /* 只数**像文件**的接收者（`file` / `fileToRead` / `files[0]` /
         * `input.files[0]`）—— `.text()` 也是 `fetch` 读响应体的方法
         *（`res.text()`），那是网络读取，不是「读用户选的文件」。
         * 用名字前缀而不是白名单：调用处给 File 变量的命名几乎都带 `file`。 */
        (t2.match(/\b(?:[A-Za-z_$]*[Ff]iles?(?:\[\d+\])?(?:\.\w+)?)\.text\s*\(\s*\)/g) ?? []).length
      );
    },
  },
  P25: {
    label:
      "自写 localStorage 存取（应使用 ~/lib/browser-storage 的 readStorageItem / readStorageJson / writeStorageItem / writeStorageJson）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`localStorage.getItem(` 这类**调用**。
       * 不数 `typeof localStorage` —— 那只是它的一个前置判据，
       * 而这条账里更差的一半正是「压根没判」（与 P13 / P18 同源）。 */
      return (
        t2.match(/(?:window\.)?localStorage\.(?:getItem|setItem|removeItem|clear)\s*\(/g) ?? []
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
      const t2 = stripCommentsCached(t);
      const blocks =
        t2.match(/try\s*\{[\s\S]{0,3000}?\}\s*catch\s*(?:\([^)]*\))?\s*\{[\s\S]{0,600}?\n\s*\}/g) ??
        [];
      return blocks.filter((b) => {
        if (!/\bawait\b/.test(b)) {
          return false;
        }
        const catchBody = b.slice(b.indexOf("catch"));
        if (
          !/\b(?:toast\.error|setError|setErr|setMsg|showFlash|onFailed|setImportErr|setActionError)\s*\(/.test(
            catchBody,
          )
        ) {
          return false;
        }
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
      const t2 = stripCommentsCached(t);
      return (
        (t2.match(/\bnatural(?:Width|Height)\b/g) ?? []).length +
        (t2.match(/\bvideo(?:Width|Height)\b/g) ?? []).length
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
    label: "手拼查询串（应使用 ~/lib/query-string 的 buildQueryString / withQuery）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      const re = /(?:^|[\w./\-'"`(])[?&][A-Za-z][\w.-]*=(?:\$\{|["'`])/g;
      return (t2.match(re) ?? []).length;
    },
  },

  P26: {
    label:
      "视图里自写「Enter 提交」键位判据（应使用 ~/components/ui/use-enter-commit 的 enterCommit）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 形态：`onKeyDown` 里判 `"Enter"`。这是「输入框回车提交」的签名。
       * ⚠️ **不看挂到 window / document 的全局快捷键**（那是 P20 的账，
       * 出口是 `use-hotkey`）；也够不着 `role="button"` 元素复刻浏览器默认
       * 行为那 6 处 —— 那类要的是 `<Button>`（P1 的账）。 */
      /* 只数**输入类控件**上的回车提交：`onKeyDown` 块里同时出现
       * `"Enter"` 判据，且它所在的那个元素是 `<input` / `<textarea`。
       * `role="tab"` / `role="button"` 上复刻浏览器默认行为的那几处
       * （`e.key === "Enter" || e.key === " "`）是**另一种账** ——
       * 它们要的是 `<Button>`（P1），不是「输入框回车提交」。 */
      const blocks = t2.match(/onKeyDown=\{[\s\S]{0,600}?\}\s*\}/g) ?? [];
      return blocks.filter((b) => {
        if (!/\.key\s*===\s*"Enter"/.test(b)) {
          return false;
        }
        /* 同一段里不得出现 Space 键位判据 —— 那是「复刻按钮默认行为」
         *（`role="tab"` / `role="button"` 上补 Enter/Space），要的是
         * `<Button>`（P1 的账），不是「输入框回车提交」。 */
        if (/\.key\s*===\s*" "/.test(b)) {
          return false;
        }
        return true;
      }).length;
    },
  },
  P7: {
    label:
      "视图内自写「隐藏 <input type=file> + 手工触发」（应使用 ~/components/ui/file-picker 的 useFilePicker）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* 只数**隐藏**的 input：可见 input 是另一种形态（见文件头 P7 说明）。
       * 判据要同时看到 `type="file"` 与「它被藏起来了」—— 两种常见写法是
       * 同类元素上的 `className="hidden"`，以及同文件里再写一遍
       * `className="hidden"` 的另一处；用「同一元素标签内出现两者」判定。 */
      const tags = t2.match(/<input\b[^>]*>/g) ?? [];
      return tags.filter((tag) => /type\s*=\s*["']file["']/.test(tag) && /\bhidden\b/.test(tag))
        .length;
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
      const t2 = stripCommentsCached(t);
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
          /\bconst\s*\[\s*(?:[A-Za-z_$][\w$]*[Ee]rror)\s*,\s*(?:[A-Za-z_$][\w$]*)\s*\]\s*=\s*(?:React\.)?useState(?:<[^>]*>)?\s*\(/g,
        ) ?? [];
      if (slots.length === 0) {
        return 0;
      }
      let hits = 0;
      for (const slot of slots) {
        const m = slot.match(
          /\[\s*(?:[A-Za-z_$][\w$]*[Ee]rror)\s*,\s*(?<setter>[A-Za-z_$][\w$]*)\s*\]/,
        );
        const setter = m.groups?.setter ?? "";
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
            /(?:async\s+)?function\s+\w+\s*\((?<params>[^)]*)\)[^{]*\{[^{}]*$/,
          );
          if (!fn) {
            continue;
          }
          const params = (fn.groups?.params ?? "").trim();
          if (!params) {
            continue;
          }
          /* 唯一实参是错误对象 / 事件对象 → 那是「一个失败回调」，不是条目。 */
          if (/^(?:event|e|ev|err|error|reason)[\s:]/i.test(params)) {
            continue;
          }
          if (/^(?:event|e|ev|err|error|reason)$/i.test(params)) {
            continue;
          }
          perItem += 1;
        }
        if (perItem > 0) {
          hits += 1;
        }
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
    label: "自写「这一轮已作废」的守卫样板（应使用 ~/lib/stale-run 的 beginStaleRun）",
    count: (t) => {
      const t2 = stripCommentsCached(t);
      /* `let cancelled = false;` 这类声明：名字带作废语义。 */
      const decls = t2.match(/\blet\s+(?:[A-Za-z_$][\w$]*)\s*=\s*false\s*;/g) ?? [];
      let hits = 0;
      for (const decl of decls) {
        const name = decl.match(/\blet\s+(?<name>[A-Za-z_$][\w$]*)\s*=/).groups?.name ?? "";
        if (!/cancel|abort|stale|alive|disposed/i.test(name)) {
          continue;
        }
        /* 读法：`if (x)` / `if (!x)` —— 只要有读，且有置位。 */
        const readRe = new RegExp(`if\\s*\\(\\s*!?\\s*(?:this\\.)?${name}\\b`);
        const setRe = new RegExp(`\\b${name}\\s*=\\s*true\\s*;`);
        if (readRe.test(t2) && setRe.test(t2)) {
          hits += 1;
        }
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
      const t2 = stripCommentsCached(t);
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
        t2.match(/NextResponse\.json\([\s\S]{0,400}?\)|JSON\.stringify\([^)]{0,200}\)/g) ?? [];
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
          /(?:isRecord\s*\(\s*(?<recordVar>\w+)\s*\)[\s\S]{0,80}?|\b(?<bodyVar>\w*(?:body|json|data)\w*)\s+as\s*\{[\s\S]{0,80}?)[\s\S]{0,80}?\b\k<recordVar>\k<bodyVar>\.error\b/g,
        ) ?? [];
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
      const t2 = stripCommentsCached(t);
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
      const ID_HINT_RE = /(?:\b[A-Za-z_$]*[Ii]d\b|Math\.random\(\)|\.toString\(36\)|_\$?\{)/;
      const templates = t2.match(/`[^`]*`/g) ?? [];
      for (const tpl of templates) {
        if (!/\bDate\.now\(\)/.test(tpl)) {
          continue;
        }
        if (ID_HINT_RE.test(tpl)) {
          hits += 1;
        }
      }
      /* ② 字符串拼接里的同类写法：`"x_" + Date.now()` / `Date.now() + "_"`。
       *    ⚠️ 判据要求 `Date.now()` 的**另一侧是一个字符串字面量** ——
       *    否则 `Date.now() + 10 * 60 * 1000`（算截止时刻）这类算术会被算上，
       *    而那与 id 无关（实测踩到：`VideoStudio` 的轮询超时 deadline）。 */
      hits += (
        t2.match(
          /(?:"[^"\n]*"\s*\+\s*(?:Date\.now\(\)|new Date\(\)\.getTime\(\)))|(?:(?:Date\.now\(\)|new Date\(\)\.getTime\(\))\s*\+\s*"[^"\n]*")/g,
        ) ?? []
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
      const t2 = stripCommentsCached(t);
      const hasAdviceText = /建议[:：]/.test(t2);
      if (!hasAdviceText) {
        return 0;
      }
      const faultRe =
        /out of memory|OOM|cuda out|tried to allocate|checkpoint|ckpt|\.safetensors|econnrefused|econnreset|fetch failed|server_busy|prompthelperror|not installed/i;
      const literalRe = /\/(?:[^/\\\n]|\\.)*\/[gimsuy]*/g;
      const literals = t2.match(literalRe) ?? [];
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
      const t2 = stripCommentsCached(t);
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
        if (/\bposition\s*:/.test(window)) {
          hits += 1;
        }
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
      const t2 = stripCommentsCached(t);
      /* 引导线 + 缩进同处一个 class 串 —— 即「子行集合」的形态。 */
      const railRe =
        /["'`][^"'`\n]*\b(?:ml|pl)-(?:2|3|4|5|6|8)\b[^"'`\n]*\bborder-l-\d\b[^"'`\n]*["'`]/g;
      const rails = t2.match(railRe) ?? [];
      if (rails.length === 0) {
        return 0;
      }
      /* 展开判据：`isExpanded(` 这类读取，或 `<flag> && (` 条件渲染。 */
      const expandRe = /isExpanded\s*\(|\b(?:isOpen|open|expanded|expand\w*)\s*&&/;
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
      const t2 = stripCommentsCached(t);
      /* 已用出口的文件直接跳过 —— 它的忙位由 `useItemAction` 给。 */
      if (/useItemAction/.test(t2)) {
        return 0;
      }
      const slotRe =
        /(?:const|let)\s*\[\s*(?<slotName>\w+)\s*,[^\]]*\]\s*=\s*(?:React\.)?useState<\s*string\s*\|\s*null\s*>\(\s*null\s*\)/g;
      let hits = 0;
      let m;
      while ((m = slotRe.exec(t2)) !== null) {
        if (isBusySlotName(m.groups?.slotName ?? "")) {
          hits += 1;
        }
      }
      /* 视图侧的比较形态：`<busy 名字> === <x>.id`。 */
      const cmpRe = /\b(?<busyName>\w*[Bb]usy\w*|\w*[Rr]etry\w*Id\w*)\s*===?\s*\w+\.id\b/g;
      while ((m = cmpRe.exec(t2)) !== null) {
        if (isBusySlotName(m.groups?.busyName ?? "")) {
          hits += 1;
        }
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
};
