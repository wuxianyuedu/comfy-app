#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：非原生可交互元素上的「鼠标专属」点击棘轮（供 .githooks/pre-commit 的 D 组调用）
/**
 * 「鼠标点得开、键盘点不开」——非原生可交互元素上的 `onClick` 棘轮
 * （规范 06 §6.1 / §6.10、16 §16.2.4.29、16 §16.2.4.57）。
 *
 * ── 立案现场：装了 39 条 a11y 规则，只启用 6 条 ────────────────────────
 *
 * `eslint-plugin-jsx-a11y` 装着 **39** 条规则，`eslint.config.js`（经
 * `eslint-config-next`）只启用 6 条。剩下那批里，和本项目真实形态最相关的是
 * `no-static-element-interactions` / `click-events-have-key-events` /
 * `no-noninteractive-element-interactions` —— 它们判的是同一件事：
 *
 *   一个**不是原生可交互**的元素（`div` / `li` / `span` / `img` …）挂了
 *   `onClick`，却没有键盘等价物。
 *
 * 全仓实测（立案时）**27 处**。它们不是「一种风格」，是**同一条规则的三档**：
 *
 *   · **真病灶** —— 整行可点、只有 `onClick`：`MessageCenterPanel` 的消息行、
 *     `HistoryTaskCard` 的主体块、`DebugChainFooter` 的「点击查看源码」药丸、
 *     `ModelTagManager` 的「双击重命名」、`MultiModeSelect` / `AttributeMultiSelect`
 *     的选项行。鼠标用户点得开，键盘用户**根本进不来**（后两处连 `tabIndex`
 *     都没有）。
 *   · **规则看不穿的** —— 已经写了 `{...simpleKeyHandler([...], fn)}`（§16.2.4.57
 *     的出口），但那是**属性展开**，规则按字面量找 `onKeyDown` 找不到，于是
 *     一并报出来。这类是**误报**，判据必须自己认下来，否则「修到 0」的唯一
 *     办法是把出口拆掉、改回手写 `onKeyDown` —— 那是把判据改坏。
 *   · **结构性的** —— HTML5 拖放容器（`onDrop` / `onDragOver`：DnD 本就要求
 *     「提供替代路径」，不是给容器加个键）、指针手势面（画布手势、看图缩放、
 *     标题行拖窗口）、`stopPropagation` 守卫、容器点击转焦点。这几档**不该**
 *     被这条规则算成账。
 *
 * ── 它判什么、不判什么 ────────────────────────────────────────────────
 *
 * 判**棘轮**：真站点数不许超过 `scripts/.click-keyboard-baseline.json`
 * （`--update` 收紧，且**拒绝把数字往上涨**）。
 *
 * **不判**（明写在案，别当成漏报）：
 *   · 原生可交互标签（`button` / `a` / `summary` / `option` / `label` /
 *     `input` / `select` / `textarea`）—— 键语义是浏览器给的；
 *   · **首字母大写的组件**（`<Button>` / `<SelectMenu>` …）—— 判定它的键语义
 *     要看它的实现，那是 P1（`check-ui-primitives.cjs`）的账，本判据不越界；
 *   · 元素上有 `onKeyDown`，或挂了**键盘出口的属性展开** —— 目前只有
 *     `simpleKeyHandler(...)`（§16.2.4.57 的元素级键出口）。
 *     这里**刻意不给「任意 `{...spread}`」开口**：本仓最常见的两个非键盘展开是
 *     `{...props}`（`input-group` 的透传）与 `{...hoverEvents}`（画布卡片的悬浮
 *     钩子），把「有展开」当成「有关键盘处理」会让这两处静默漏过去 —— 而它们
 *     恰恰是立案时要看的形态。认哪些展开是白名单，不是「有没有展开」；
 *   · 同一元素上还挂着 `onDrop` / `onDragOver` —— HTML5 拖放的落点标记，
 *     不是可交互元素；
 *   · `onClick` 体里**只有** `stopPropagation` / `preventDefault` 调用 —— 那是
 *     守卫，不是交互；
 *   · 登记在 `EXEMPT_SITES` 里的结构性站点（画布手势面、容器点击转焦点），
 *     每条写明**为什么不需要键盘等价物**。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 走 TypeScript AST（JSX 结构用正则判不准），扫 `src/**` 的 `.tsx`，
 * 与 `check-form-field-wiring.cjs` 同档 —— 照 §13.5.4 该进钩子。
 *
 * 用法：
 *   node scripts/check-click-keyboard.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-click-keyboard.cjs --report   # 只出清单不判失败（盘点用）
 *   node scripts/check-click-keyboard.cjs --update   # 收口后收紧基线（拒绝上涨）
 *
 * 退出码 0 = 通过，1 = 阻断。
 */
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const SHOULD_UPDATE = ARGS.has("--update");
const STAGED = ARGS.has("--staged");

const BASELINE = path.join(__dirname, ".click-keyboard-baseline.json");

/** 扫描根。**必须在 `--staged` 短路之前**，所以提到 `require("typescript")` 上面。 */
const SCAN_DIRS = ["src"];

/* `--staged`（钩子用）＝ 输入面跳过，口径见 §13.5.8.2。
 * 短路点在 `require("typescript")` 之前 —— 那一步 ≈180ms，放后面就白跳过。 */
if (STAGED && !REPORT_ONLY && !SHOULD_UPDATE) {
  require("./gate-scan-read.cjs").skipUnlessStagedTouches({ roots: SCAN_DIRS, tag: "[click-keyboard]" });
}

const ts = require("typescript");

const FILE_RE = /\.tsx$/;

/** 判据自己的夹具**不进扫描面**（§11.14.2：量具不是存量）。 */
const FIXTURE_SKIP = new Set(["tests/click-keyboard-gate.test.ts"]);

/** 认下「这一串展开提供了键盘处理」的出口名 —— 白名单，不是「有没有展开」。 */
const KEYBOARD_SPREAD_EXITS = ["simpleKeyHandler"];

/** 原生可交互：键语义由浏览器给，不在此判据靶子里。 */
const NATIVE_INTERACTIVE = new Set([
  "button",
  "a",
  "summary",
  "option",
  "label",
  "input",
  "select",
  "textarea",
  "details",
]);

/**
 * 结构性的「点击站点」——**不需要**键盘等价物，逐条写明理由。
 *
 * 判据认三种形态，认不下来（判据自己看不出「这个 div 是画布手势面」）的就
 * 登记在这里。**登记不是豁免存量**：每一条都要说清为什么这一档不该有键。
 *
 * @type {Record<string, string>}
 */
const EXEMPT_SITES = {
  "src/components/ui/input-group.tsx":
    'InputGroupAddon：onClick 是**点击代理** —— 把焦点转给同组里的 <input>（可聚焦、可输入的是那个 input，不是这个容器）。role="group" 的容器本身不该可聚焦。',
  "src/components/studio/workflow-editor/WorkflowParamCard.tsx":
    "画布参数卡：onSelect 只做**选中高亮**，连线的选中可点线本身（React Flow 的边），卡片只是鼠标便捷落点；卡片上真正的动作按钮（↺ 重置）是 <Button>。",
};

function walk(dir) {
  const out = [];
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      out.push(...walk(p));
    } else if (FILE_RE.test(e.name)) {
      out.push(p);
    }
  }
  return out;
}

/** `onClick` 体里只有 `stopPropagation` / `preventDefault` 调用 ⇒ 守卫，不是交互。 */
function isGuardOnly(init) {
  if (!init) return false;
  const expr = ts.isJsxExpression(init) ? init.expression : null;
  if (!expr) return false;
  // 箭头 / 函数表达式，体里只允许守卫调用
  let body = null;
  if (ts.isArrowFunction(expr) || ts.isFunctionExpression(expr)) {
    body = expr.body;
  } else {
    return false;
  }
  const calls = [];
  const collect = (node) => {
    if (ts.isCallExpression(node)) {
      calls.push(node.expression.getText());
      return;
    }
    ts.forEachChild(node, collect);
  };
  collect(body);
  if (calls.length === 0) return false;
  return calls.every((c) =>
    /^(e|ev|evt|event)?\.?(currentTarget|target)?\.?(stopPropagation|preventDefault)$/.test(
      c,
    ),
  );
}

/**
 * 扫一份 TSX，返回「有 onClick、没有键盘等价物、且不是原生可交互」的站点。
 *
 * @returns {{line:number, tag:string, kind:string}[]}
 */
function scanSource(fileName, src) {
  return scanTree(
    ts.createSourceFile(
      fileName,
      src,
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    ),
  );
}

/**
 * 规则本体：**只吃已解析的 `SourceFile`**，不自己解析。
 *
 * 这是「共享颗粒度」的落点（§13.5.8.2「第四笔账」）：解析（`createSourceFile`，实测
 * 全量 ≈550ms）由 `gate-ast-read.cjs` / `run-ast-gates.cjs` 做一次，规则在这一层
 * **只遍历、只判定**。把两者分开，才能让「同一份文本被 N 个判据各解析一遍」变成
 * 「解析一次、规则各遍历一遍」——而各规则的语义一个字不动。
 *
 * @param {import("typescript").SourceFile} sf
 * @returns {{line:number, tag:string, kind:string}[]}
 */
function scanTree(sf) {
  const sites = [];
  const visit = (node) => {
    let opening = null;
    if (ts.isJsxElement(node)) opening = node.openingElement;
    else if (ts.isJsxSelfClosingElement(node)) opening = node;
    if (opening) {
      const tagName = opening.tagName.getText(sf);
      /* 首字母大写 = 组件：键语义在它的实现里，属 P1 的账。 */
      const isComponent = /^[A-Z]/.test(tagName) || tagName.includes(".");
      if (!isComponent && !NATIVE_INTERACTIVE.has(tagName)) {
        const attrs = opening.attributes.properties;
        const hasClick = attrs.some(
          (a) => ts.isJsxAttribute(a) && a.name.text === "onClick",
        );
        if (hasClick) {
          const hasKeyDown = attrs.some(
            (a) => ts.isJsxAttribute(a) && a.name.text === "onKeyDown",
          );
          /* 只认**键盘出口**的展开：`{...simpleKeyHandler(...)}`。其余展开
           *（`{...props}` / `{...hoverEvents}` / `{...mediaProps}`）不算覆盖。 */
          const hasKeyboardSpread = attrs.some((a) => {
            if (!ts.isJsxSpreadAttribute(a)) return false;
            const expr = a.expression;
            if (!ts.isCallExpression(expr)) return false;
            const callee = expr.expression.getText(sf);
            return KEYBOARD_SPREAD_EXITS.includes(callee);
          });
          const hasDnd = attrs.some(
            (a) =>
              ts.isJsxAttribute(a) &&
              (a.name.text === "onDrop" || a.name.text === "onDragOver"),
          );
          const clickAttr = attrs.find(
            (a) => ts.isJsxAttribute(a) && a.name.text === "onClick",
          );
          const guardOnly = clickAttr
            ? isGuardOnly(clickAttr.initializer)
            : false;
          if (!hasKeyDown && !hasKeyboardSpread && !hasDnd && !guardOnly) {
            const pos = sf.getLineAndCharacterOfPosition(opening.getStart(sf));
            sites.push({ line: pos.line + 1, tag: tagName, kind: "click" });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return sites;
}

function scanFile(abs) {
  return scanSource(abs, fs.readFileSync(abs, "utf8"));
}

/**
 * @param {Map<string, import("typescript").SourceFile>} [parsed]
 *   聚合档 `run-ast-gates.cjs` 注入的**共享解析结果**（键 = 绝对路径）。
 *   传了就复用，不再各文件 `createSourceFile` —— 这是「共享颗粒度」的边界：
 *   **只共享解析产物，不共享遍历/判定**。不传 = 单条脚本的老路径，行为一字不变。
 */
function collect(parsed) {
  const sites = new Map();
  for (const abs of SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (FIXTURE_SKIP.has(rel)) continue;
    if (EXEMPT_SITES[rel]) continue;
    const shared = parsed && parsed.get(abs);
    const hit = shared ? scanTree(shared) : scanFile(abs);
    if (hit.length) sites.set(rel, hit);
  }
  return sites;
}

/**
 * 被 `EXEMPT_SITES` 挡下的站点 —— **只为 `--report` 展现**：豁免是「认下这一档
 * 不该有键」，不是「这一档不存在」。把它们打出来，人才看得见自己免了什么，
 * 也才有人会去复核那些理由还成不成立。
 */
function collectExempt(parsed) {
  const out = new Map();
  for (const [rel, reason] of Object.entries(EXEMPT_SITES)) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) continue;
    const shared = parsed && parsed.get(abs);
    const hit = shared ? scanTree(shared) : scanFile(abs);
    if (hit.length) out.set(rel, { reason, sites: hit });
  }
  return out;
}

function readBaseline() {
  try {
    const raw = JSON.parse(fs.readFileSync(BASELINE, "utf8"));
    return {
      total: typeof raw.total === "number" ? raw.total : 0,
      files: raw.files && typeof raw.files === "object" ? raw.files : {},
    };
  } catch {
    return { total: 0, files: {} };
  }
}

function main(parsed) {
  const sites = collect(parsed);
  const total = [...sites.values()].reduce((n, v) => n + v.length, 0);

  if (SHOULD_UPDATE) {
    const base = readBaseline();
    if (total > base.total) {
      console.error(
        `[ERROR] --update 拒绝把基线往上涨（${base.total} → ${total}）。\n` +
          "  收紧基线的前提是**先收口**：给下面这些元素补键等价物（`simpleKeyHandler`），" +
          "\n  或证明它是结构性站点、登记进 EXEMPT_SITES 并写明理由。",
      );
      for (const [rel, list] of [...sites.entries()].sort()) {
        console.error(`  · ${rel}: ${list.length} 处`);
      }
      return 1;
    }
    const files = {};
    for (const [rel, list] of [...sites.entries()].sort())
      files[rel] = list.length;
    fs.writeFileSync(
      BASELINE,
      `${JSON.stringify({ total, files }, null, 2)}\n`,
    );
    console.log(`[click-keyboard] 基线已收紧到 ${total} 处（${BASELINE}）。`);
    return 0;
  }

  if (REPORT_ONLY) {
    console.log(`[click-keyboard] 盘点：${total} 处 / ${sites.size} 份文件。`);
    for (const [rel, list] of [...sites.entries()].sort()) {
      console.log(
        `  · ${rel}: ${list.length} 处\n` +
          list.map((s) => `      ${s.line}: <${s.tag}>`).join("\n"),
      );
    }
    const exempt = collectExempt(parsed);
    const exemptTotal = [...exempt.values()].reduce(
      (n, v) => n + v.sites.length,
      0,
    );
    console.log(
      `\n[click-keyboard] 已登记豁免：${exemptTotal} 处 / ${exempt.size} 份文件（不进基线，逐条写明理由）：`,
    );
    for (const [rel, { reason, sites: list }] of [...exempt.entries()].sort()) {
      console.log(
        `  · ${rel}: ${list.length} 处\n` +
          `      理由：${reason}\n` +
          list.map((s) => `      ${s.line}: <${s.tag}>`).join("\n"),
      );
    }
    return 0;
  }

  const base = readBaseline();
  if (total > base.total) {
    console.error(
      `[ERROR] 「鼠标点得开、键盘点不开」的站点涨了：${total} 处 > 基线 ${base.total} 处。\n` +
        "\n  §6.1 / §6.10：非原生可交互元素挂了 `onClick` 却没有键等价物 ——" +
        "\n  鼠标用户点得开，键盘用户进不来。两种改法：" +
        "\n" +
        "\n  // ✅ 整行就是一个动作 → 用原生可交互元素（键语义免费）" +
        '\n  <Button variant="ghost" onClick={fn} className="…">…</Button>' +
        "\n" +
        "\n  // ✅ 元素里还有别的动作（不能合成一个 button）→ 补键出口" +
        '\n  <div role="checkbox" tabIndex={0} onClick={fn}' +
        '\n    {...simpleKeyHandler(["Space", "Enter"], fn)} />' +
        "\n" +
        "\n  例外（本判据认下）：原生标签、组件（`<Button>` 等）、已有" +
        "\n  `onKeyDown` / `{...spread}`、拖放容器（`onDrop` / `onDragOver`）、" +
        "\n  `stopPropagation` 守卫，以及 `EXEMPT_SITES` 里登记的结构性站点。" +
        "\n" +
        "\n  （收口后跑 `node scripts/check-click-keyboard.cjs --update` 收紧基线。）" +
        "\n" +
        "\n  下方是本轮站点，指针**新增**的那些：",
    );
    for (const [rel, list] of [...sites.entries()].sort()) {
      const was = base.files[rel] ?? 0;
      const mark = list.length > was ? " ← 涨了" : "";
      console.error(
        `  · ${rel}: ${list.length} 处（基线 ${was}）${mark}\n` +
          list
            .slice(0, 8)
            .map((s) => `      ${s.line}: <${s.tag}>`)
            .join("\n"),
      );
    }
    console.error("\n口径见 docs/standards/06-无障碍访问-a11y.md §6.11。");
    return 1;
  }

  console.log(`[click-keyboard] OK —— ${total} 处 ≤ 基线 ${base.total} 处。`);
  if (total < base.total) {
    console.log(
      `  比基线还少了 ${base.total - total} 处：跑 \`--update\` 把基线收紧。`,
    );
  }
  return 0;
}

/* 自测（`tests/click-keyboard-gate.test.ts`）钉的是**站点识别口径**。 */
module.exports = {
  scanSource,
  scanTree,
  main,
  scanFile,
  collect,
  collectExempt,
  FIXTURE_SKIP,
  EXEMPT_SITES,
  KEYBOARD_SPREAD_EXITS,
};

if (require.main === module) process.exit(main());
