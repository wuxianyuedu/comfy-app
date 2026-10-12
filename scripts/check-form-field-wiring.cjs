#!/usr/bin/env node
// @ts-nocheck -- 提交门槛脚本：`<FormField>` 的标签 ⇄ 控件接线棘轮（供 .githooks/pre-commit 的 D 组调用）
/**
 * `FormField` 的 `htmlFor` ⇄ 控件 `id` 接线 —— 规范见
 * docs/standards/16-shadcn-ui与表单校验.md §16.2.4.26。
 *
 * ── 立案现场：同一个组件承诺了两件事，而只有一种调用形态真的兑现 ────────
 *
 * `FormField` 文件头把它的存在理由写在三件事上，第一件就是：
 *
 *   > **`htmlFor` / `id` 关联** —— 15 处里**没有一处**把 `<label>` 与控件关联起来
 *   > （设置页的 label 全是裸 `<label>`，点标签不聚焦输入框；读屏器把标签读成孤立文本）。
 *
 * 组件**有能力**兑现它：`children` 写成 render-prop 时，`{ id, "aria-invalid",
 * "aria-describedby" }` 交给调用处 spread 到控件上，`<FieldLabel htmlFor={fieldId}>`
 * 的箭头指得着。而 `children` 写成**普通节点**时，`fieldId` 谁都没拿到 ——
 * `<FieldLabel htmlFor>` 指向一个 DOM 里不存在的 id。
 *
 * 于是同一个组件有两种调用形态，**其中一种静默地只兑现一半**：
 *
 *   · `fieldId` 由 `useId()` 兜底生成 → 看着「有 id」，实际是自说自话的箭头；
 *   · 读屏器读到的是一段孤立标签文本，控件本身**没有可访问名**；
 *   · 点标签不聚焦 —— 这正是组件注释点名的那个「病灶」原样复发；
 *   · 而且**没有任何东西会报**：`jsx-a11y/control-has-associated-label` 只认
 *     同一 JSX 子树里的可见文本，wrap 了一层 `<FormField>` 的控件不在它的靶子里。
 *
 * 实测（收口前）：全仓 **35 处** plain-children 站点，其中 **22 处是真控件**
 * （`<input>` / `<Textarea>` / `<Input>` / `<SelectMenu>` …）。`form-field.test.tsx`
 * 里 4 条用例**清一色**用 render-prop，这条路径一次都没被测过 —— 判据在场 ≠
 * 判据在跑，这里连判据都没有。
 *
 * ── 它判什么、不判什么 ────────────────────────────────────────────────
 *
 * 判**棘轮**：plain-children 站点数不许超过 `scripts/.form-field-wiring-baseline.json`
 * （`--update` 收紧，且**拒绝把数字往上涨**）。
 *
 * **不判**（明写在案，别当成漏报）：
 *   · `label` 缺失（`label={null}` / 不给 `label`）的站点 —— 没有标签行就没有箭头
 *     可悬空，`FormField` 注释也明说这一档「要 `aria-label` 就自己加」；
 *   · `children` 是 `undefined`（自闭合 `<FormField label=… />`）—— 同上；
 *   · 剩下若干处是**合法的「小标题」形态**：只读展示行、按钮组 —— 控件是多个按钮或
 *     根本不是表单控件，没有一个能被 `htmlFor` 指到。这几处由 `FormField` 自己
 *     兜住（它只在 `children` 是函数时才给 `htmlFor`），并在基线里记账。
 *
 * ── 成本 ──────────────────────────────────────────────────────────────
 *
 * 走 TypeScript AST（JSX 结构用正则判不准），扫 `src/**` 的 `.tsx`，
 * 与 `check-non-null-assertions.cjs` 同档 —— 照 §13.5.4 该进钩子。
 *
 * 用法：
 *   node scripts/check-form-field-wiring.cjs            # 检查（进 pre-commit D 组）
 *   node scripts/check-form-field-wiring.cjs --report   # 只出清单不判失败（盘点用）
 *   node scripts/check-form-field-wiring.cjs --update   # 收口后收紧基线（拒绝上涨）
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

const BASELINE = path.join(__dirname, ".form-field-wiring-baseline.json");

/** 扫描范围：视图层与用例（stories 也是调用点，一起判）。
 *  **必须在 `--staged` 短路之前**，所以提到 `require("typescript")` 上面。 */
const SCAN_DIRS = ["src"];

/* `--staged`（钩子用）＝ 输入面跳过，口径见 §13.5.8.2。
 * 短路点在 `require("typescript")` 之前 —— 那一步 ≈180ms，放后面就白跳过。 */
if (STAGED && !REPORT_ONLY && !SHOULD_UPDATE) {
  require("./gate-scan-read.cjs").skipUnlessStagedTouches({ roots: SCAN_DIRS, tag: "[form-field-wiring]" });
}

const ts = require("typescript");

const FILE_RE = /\.tsx$/;

/**
 * 判据自己的夹具**不进扫描面**：它喂给本判据的被测源码，判它等于判自己的量具
 * （§11.14.2 的通用口径）。
 */
const FIXTURE_SKIP = new Set(["tests/form-field-wiring-gate.test.ts"]);

/** 目标组件名。 */
const TARGET = "FormField";

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

/**
 * 扫一份 TSX，返回 plain-children 站点。
 *
 * 判定「接上了」的口径：唯一的**非空白**子节点是一个 JSX 表达式、且它的表达式是
 * 箭头函数 / 函数表达式（render-prop）。其余形态一律计入 —— 包括等价写法
 * `<FormField label="x">{renderCtl()}</FormField>` 这类「函数调用返回节点」，
 * 它同样拿不到 `a11y`（要拿就得写成函数本身）。
 *
 * @returns {{line:number,label:string,tag:string}[]}
 */
function scanSource(fileName, src) {
  return scanTree(
    ts.createSourceFile(fileName, src, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX),
  );
}

/**
 * 规则本体：**只吃已解析的 `SourceFile`**，不自己解析（口径见
 * `check-click-keyboard.cjs` 的 `scanTree()` 与规范 §13.5.8.2「第四笔账」）。
 *
 * @param {import("typescript").SourceFile} sf
 * @returns {{line:number,label:string,tag:string}[]}
 */
function scanTree(sf) {
  const sites = [];
  const visit = (node) => {
    if (
      ts.isJsxElement(node) &&
      ts.isIdentifier(node.openingElement.tagName) &&
      node.openingElement.tagName.text === TARGET
    ) {
      const attrs = node.openingElement.attributes.properties;
      const labelAttr = attrs.find(
        (a) => ts.isJsxAttribute(a) && a.name.text === "label",
      );
      // `label` 不给、或给成 `null`（`FormField` 只在 `label != null` 时渲染标签行）
      // ⇒ 没有箭头可悬空，不是站点。
      const init = labelAttr && labelAttr.initializer;
      /* `label={null}` / `label={undefined}` 也不渲染标签行 —— 属性的
       * `initializer` 是 `JsxExpression`，字面量在它的 `.expression` 里。 */
      const bound =
        init && ts.isJsxExpression(init) ? init.expression : init;
      const literalNull =
        Boolean(bound) &&
        (bound.kind === ts.SyntaxKind.NullKeyword ||
          (ts.isIdentifier(bound) && bound.text === "undefined"));
      const labeled = Boolean(init) && !literalNull;
      if (labeled) {
        const kids = node.children.filter((c) => !(ts.isJsxText(c) && c.text.trim() === ""));
        const wired =
          kids.length === 1 &&
          ts.isJsxExpression(kids[0]) &&
          kids[0].expression &&
          (ts.isArrowFunction(kids[0].expression) || ts.isFunctionExpression(kids[0].expression));
        if (!wired) {
          const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
          /* 取第一个「开标签」的可读名字：`JsxElement` 与 `JsxSelfClosingElement`
           * 都有 `openingElement`，`JsxExpression` 没有 —— 先判类型再取。 */
          const first = kids.find(
            (c) => ts.isJsxElement(c) || ts.isJsxSelfClosingElement(c),
          );
          let tag = "";
          if (first && first.openingElement) {
            tag = first.openingElement.tagName.getText(sf);
          } else if (kids[0] && ts.isJsxExpression(kids[0]) && kids[0].expression) {
            const first = kids[0];
            tag = `{${first.expression.getText(sf).split("\n")[0].slice(0, 24)}}`;
          }
          sites.push({
            line: pos.line + 1,
            label: labelAttr.initializer.getText(sf).slice(0, 40),
            tag: tag || "（无子节点）",
          });
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
 *   传了就复用，不再各文件 `createSourceFile` —— 只共享解析产物，不共享遍历/判定。
 *   不传 = 单条脚本的老路径，行为一字不变。
 */
function collect(parsed) {
  const sites = new Map();
  for (const abs of SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)))) {
    const rel = path.relative(ROOT, abs).split(path.sep).join("/");
    if (FIXTURE_SKIP.has(rel)) continue;
    const shared = parsed && parsed.get(abs);
    const hit = shared ? scanTree(shared) : scanFile(abs);
    if (hit.length) sites.set(rel, hit);
  }
  return sites;
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
          "  收紧基线的前提是**先收口**：把下面这些站点改成 render-prop 再来。",
      );
      for (const [rel, list] of [...sites.entries()].sort()) {
        console.error(`  · ${rel}: ${list.length} 处`);
      }
      return 1;
    }
    const files = {};
    for (const [rel, list] of [...sites.entries()].sort()) files[rel] = list.length;
    fs.writeFileSync(BASELINE, `${JSON.stringify({ total, files }, null, 2)}\n`);
    console.log(`[form-field-wiring] 基线已收紧到 ${total} 处（${BASELINE}）。`);
    return 0;
  }

  if (REPORT_ONLY) {
    console.log(`[form-field-wiring] 盘点：${total} 处 / ${sites.size} 份文件。`);
    for (const [rel, list] of [...sites.entries()].sort()) {
      console.log(
        `  · ${rel}: ${list.length} 处\n` +
          list.map((s) => `      ${s.line}: label=${s.label} 控件=${s.tag}`).join("\n"),
      );
    }
    return 0;
  }

  const base = readBaseline();
  if (total > base.total) {
    console.error(
      `[ERROR] \`<FormField>\` 的 plain-children 站点涨了：${total} 处 > 基线 ${base.total} 处。\n` +
        "\n  §16.2.4.26：`FormField` 的 `htmlFor` ⇄ 控件 `id` 关联只在 render-prop" +
        "\n  形态下成立 —— 普通子节点拿不到 `a11y`，`<FieldLabel htmlFor>` 指向一个" +
        "\n  DOM 里不存在的 id，点标签不聚焦、控件没有可访问名。\n" +
        "\n" +
        "\n  // ❌ plain children：id 谁都没拿到，箭头悬空" +
        "\n  <FormField label=\"镜头名称\">" +
        "\n    <input value={v} onChange={…} />" +
        "\n  </FormField>" +
        "\n  // ✅ render-prop：a11y 落到控件上" +
        "\n  <FormField label=\"镜头名称\">" +
        "\n    {(field) => <input {...field} value={v} onChange={…} />}" +
        "\n  </FormField>" +
        "\n" +
        "\n  例外（本判据认下、记在基线里）：「标签行只作小标题」的形态 ——" +
        "\n  控件是多个按钮或纯展示节点，没有单个能被 `htmlFor` 指到。这几处" +
        "\n  `FormField` 已兜住（只在 `children` 是函数时才给 `htmlFor`）。\n" +
        "\n" +
        "\n  （收口后跑 `node scripts/check-form-field-wiring.cjs --update` 收紧基线。）" +
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
            .map((s) => `      ${s.line}: label=${s.label} 控件=${s.tag}`)
            .join("\n"),
      );
    }
    console.error("\n口径见 docs/standards/16-shadcn-ui与表单校验.md §16.2.4.26。");
    return 1;
  }

  console.log(`[form-field-wiring] OK —— ${total} 处 ≤ 基线 ${base.total} 处。`);
  if (total < base.total) {
    console.log(
      `  比基线还少了 ${base.total - total} 处：跑 \`--update\` 把基线收紧。`,
    );
  }
  return 0;
}

/* 自测（`tests/form-field-wiring-gate.test.ts`）钉的是**站点识别口径**。 */
module.exports = { scanSource, scanTree, scanFile, collect, main, FIXTURE_SKIP, TARGET };

if (require.main === module) process.exit(main());
