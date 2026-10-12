#!/usr/bin/env node
// @ts-nocheck -- UI 基元复用判据的**文本引擎**（被 check-ui-primitives.cjs require，自己不判成败）
/**
 * 文本引擎：从源码里「剥注释」「按平衡扫描读 JSX 开标签」「把属性段解析成属性」。
 *
 * 为什么单独立一份（ISSUE #1747 的「分层」）：`check-ui-primitives.cjs` 已经
 * 到 5030 行、挂在基础设施层文件长度棘轮上（`scripts/check-infra-file-size.cjs`，
 * 阈值 900、基线 4820）。这一份抽出来的是**与判据无关的那部分** —— 它不回答
 * 「这算不算违规」，只回答「这段源码里第 N 个 `<Button>` 开标签的属性是什么」。
 * 判据（85 条 rule）一个字不动地留在主脚本里。
 *
 * 两条纪律，与主脚本同源：
 *
 *   · **正则只负责定位起点，边界交给扫描器**（`scanJsxAttrs`）。P82 立据时用粗锚
 *     `[^>]*` 读属性段，被箭头函数的 `>` 截断，把真存量 157 处报成 78 处 ——
 *     硬闸因此建在看不见的存量上。同一课写在主脚本的 RULES.P82 注释里。
 *   · **剥注释的结果按文本缓存**（`stripCommentsCached`）。这是主脚本唯一一处
 *     O(判据 × 文件) 的白付：84 条判据各自剥一遍同一份文本。缓存的是**纯函数**
 *     （键是文本自身，不是路径），与「哪条判据在问」无关，语义上零风险。
 *
 * ⚠️ **这个模块必须保持纯函数、零 IO、零副作用**：它被主脚本在
 * `--report` / `--update` / `--staged` 三条路径上以同一进程直接 require，
 * 任何「加载即读工作区」的副作用都会让那三条路径读到不一致的世界。
 */

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

/** `stripComments` 的按文本缓存键 —— 见下方「分层」一节。 */
const STRIP_CACHE = new Map();

/**
 * 取「这一份文本剥完注释之后的样子」，**同一份文本只算一次**。
 *
 * 这是本判据唯一的算法级白付：85 条规则里 84 条以 `stripCommentsCached(t)` 开头，
 * 而 `collect()` 对每个文件跑全部规则 —— 于是同一份文本被剥 84 遍。
 * 实测（1070 份源文件 · 8 核）：逐条现剥 **8.6s**，按文本缓存后 **0.4s**。
 *
 * **为什么缓存的是 `stripComments` 而不是「规则结果」**：剥注释是纯函数、
 * 输入是文本本身，缓存命中与否与「哪条规则在问」无关，语义上零风险；
 * 而缓存「某条规则在某份文件上的计数」会把判据的实现细节（正则、豁免、
 * 上下文窗口）一起钉进缓存键 —— 改了规则却忘了失效缓存，红会静默变成绿。
 *
 * 键是**文本自身**（不是路径）：临时工作区的用例会把同一路径写成不同内容，
 * 按路径缓存会让第二条用例读到第一条的结论。文本作为键天然免疫这件事，
 * 代价只是多占一份内存（实测源文件全量文本约 7.6MB）。
 */
function stripCommentsCached(text) {
  let hit = STRIP_CACHE.get(text);
  if (hit === undefined) {
    hit = stripComments(text);
    STRIP_CACHE.set(text, hit);
  }
  return hit;
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
  const t = stripCommentsCached(text);
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


module.exports = {
  stripComments,
  stripCommentsCached,
  stripP71AllowBlocks,
  countNestedMinMax,
  countNonContainment,
  skipJsxString,
  scanJsxAttrs,
  readJsxAttrsPastTag,
  skipJsxBraceExpr,
  parseJsxProps,
  classifyTitleValue,
  countButtonTitle,
  isBusySlotName,
  isP81IconName,
  P81_ICON_NAMES,
};
