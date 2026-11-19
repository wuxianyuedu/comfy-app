/**
 * 画布帧的视口口径：**装不下要显式认账**（ISSUE #1381 续，规范 16 §16.2.3.13）。框高是常量（`CANVAS_FRAME_CLASS` 560px）
 * 而节点渲染器尺寸是消费方的事，比框高时会切掉内容且 tsc/lint/构建全绿（与 §16.2.3.12「handle 写错、边静默不画」同族）。
 * 规则：传了 `nodeTypes` 的消费方要么传 `fit`、要么用 `pinZoom` 场景；两者都没有 = 没人回答「装得下吗」，不传不受约束。按 AST 判。
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const ROOT = resolve(".");
const FLOW = join(ROOT, ".storybook", "flow-canvas.tsx");
const SRC = join(ROOT, "src");

/** 注入层的出口名（消费方认的就是它）。 */
const CANVAS_COMPONENT = "StorybookFlowCanvas";

function parse(file: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    readFileSync(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

/** 读一段字面量的文本（`about: "…"` 那种）。 */
function stringLiteralText(node: ts.Node): string | null {
  return ts.isStringLiteral(node) ? node.text : null;
}

/**
 * 从 `flow-canvas.tsx` 的 `CANVAS_SCENES` 里读出**带 `pinZoom` 的场景名**。
 * 场景注册表是注入层的**唯一**事实源 —— 从它现算，不另抄名单
 * （§12.14：会漂的读数不写死；§12.18：不在调用点重抄）。
 */
function pinnedScenes(): Set<string> {
  const source = parse(FLOW);
  const pinned = new Set<string>();
  const visit = (node: ts.Node): void => {
    /* `CANVAS_SCENES` 是 `{ name: { … } satisfies Record<string, CanvasScene> }`：
       直接按「属性赋值 + 对象字面量」的形状找，不依赖它的声明写法。 */
    if (ts.isPropertyAssignment(node) && ts.isObjectLiteralExpression(node.initializer)) {
      const name = ts.isIdentifier(node.name) ? node.name.text : stringLiteralText(node.name);
      const hasPinZoom = node.initializer.properties.some(
        (prop) =>
          ts.isPropertyAssignment(prop) &&
          ts.isIdentifier(prop.name) &&
          prop.name.text === "pinZoom",
      );
      if (name !== null && hasPinZoom) {
        pinned.add(name);
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return pinned;
}

type CanvasUsage = {
  /** 消费方文件（相对仓库根）。 */
  readonly file: string;
  readonly hasFit: boolean;
  /** 这个 `<StorybookFlowCanvas>` 传了 `nodeTypes`（自定义渲染器，高度未知）。 */
  readonly hasNodeTypes: boolean;
  /** `scene={… canvasScene("名字") …}` 里的场景名（读不到就是 null）。 */
  readonly sceneName: string | null;
};

/** 扫一个文件里的所有 `<StorybookFlowCanvas>` 用法。 */
function canvasUsagesIn(file: string): Array<CanvasUsage> {
  const source = parse(file);
  const usages: Array<CanvasUsage> = [];
  const visit = (node: ts.Node): void => {
    /* `<X … />` 是 **`JsxSelfClosingElement`**、`<X …>…</X>` 才是 `JsxOpeningElement`
       —— 只看后者会把 `<StorybookFlowCanvas … />` 这种写法**整片漏掉**
       （本仓的用法恰好全是自闭合，实测漏成空集）。 */
    if (
      (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === CANVAS_COMPONENT
    ) {
      let hasNodeTypes = false;
      let hasFit = false;
      let sceneName: string | null = null;
      for (const attr of node.attributes.properties) {
        if (!ts.isJsxAttribute(attr) || !ts.isIdentifier(attr.name)) {
          continue;
        }
        if (attr.name.text === "nodeTypes") {
          hasNodeTypes = true;
        }
        /* `fit` 是简写属性（`fit`）或 `fit={true}`：两种都算。 */
        if (attr.name.text === "fit") {
          hasFit = true;
        }
        if (attr.name.text === "scene" && attr.initializer) {
          /* 场景名经 `canvasScene("twoNodes")` 求值 —— 从**调用实参**取字面量，
             不按整个属性文本猜（`withNodeType(canvasScene("x"), "story")` 里
             还有别的字符串）。 */
          const findCall = (n: ts.Node): void => {
            if (
              ts.isCallExpression(n) &&
              ts.isIdentifier(n.expression) &&
              n.expression.text === "canvasScene" &&
              n.arguments.length > 0
            ) {
              const arg = n.arguments[0];
              if (arg !== undefined) {
                sceneName = stringLiteralText(arg) ?? sceneName;
              }
            }
            ts.forEachChild(n, findCall);
          };
          findCall(attr.initializer);
        }
      }
      usages.push({ file, hasNodeTypes, hasFit, sceneName });
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return usages;
}

/** 递归找 `src/` 下的故事文件。 */
function storyFiles(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...storyFiles(full));
    } else if (full.endsWith(".stories.tsx")) {
      out.push(full);
    }
  }
  return out;
}

describe("画布帧的视口口径（装不下要显式认账）", () => {
  const pinned = pinnedScenes();
  const files = storyFiles(SRC);
  const usages = files.flatMap(canvasUsagesIn);

  it("解析器不是空转：扫得出场景标记与消费方", () => {
    /* 没这半，下面两条会在「解析器什么都没解析出来」时恒绿 —— 判据空转比没有更坏。 */
    expect(pinned.size, "带 pinZoom 的场景一个都没解析出来").toBeGreaterThan(0);
    expect(usages.length, "一份 <StorybookFlowCanvas> 都没扫到").toBeGreaterThan(0);
    /* 「传 nodeTypes 的」与「传 fit 的」都得真出现过，否则规则的另一半没被验过。 */
    expect(
      usages.some((u) => u.hasNodeTypes),
      "没有任何消费方传 nodeTypes —— 规则的分支没被覆盖",
    ).toBe(true);
    expect(
      usages.some((u) => u.hasFit),
      "没有任何消费方传 fit —— 新口径没被任何 story 用上",
    ).toBe(true);
  });

  it("传了 nodeTypes 的消费方要么传 fit、要么用 pinZoom 场景", () => {
    const offenders = usages
      .filter((u) => u.hasNodeTypes && !u.hasFit && !pinned.has(u.sceneName ?? ""))
      .map((u) => `${u.file}（场景 ${u.sceneName ?? "读不到"}：渲染器尺寸未知、又没传 fit）`);
    expect(
      offenders,
      [
        "自定义节点渲染器比框高时不传 fit，会把内容切掉一截 ——",
        "而 tsc / eslint / 构建全绿、只有画布上少一块。",
        "修法：传 fit（缩进框里），或把场景标成 pinZoom（这一档被测的就是缩放）。",
      ].join("\n"),
    ).toEqual([]);
  });

  it("pinZoom 的场景没有被 fit 缩走（缩走 = 看的不是那一档了）", () => {
    /* 反向那条：`pinZoom` 的场景若被消费方传了 `fit`，看的是「缩到装得下的样子」，
       而 story 名与 `about` 讲的仍是那个缩放 —— 同样「画布上有内容、证明的不是
       那一件事」。 */
    const offenders = usages
      .filter((u) => u.hasFit && pinned.has(u.sceneName ?? ""))
      .map((u) => `${u.file}（场景 ${u.sceneName} 带 pinZoom，却被 fit 缩走）`);
    expect(offenders).toEqual([]);
  });

  it("fit 交回的是 React Flow 自己的 fitView，不是手搓的缩放", () => {
    const flow = readFileSync(FLOW, "utf8");
    /* 机制必须是**真的那一个**：`ProjectCanvas` 的「适应视图」也走它。
       手搓一个 `zoom` 算出来的视口，在真机上与 React Flow 的算法不一定一致
      （padding / 视口尺寸 / 边界都参与），而画布上照样「看着装下了」。 */
    expect(flow, "fit 档必须走 React Flow 的 fitView").toContain("fitView: true");
    expect(flow).toContain("fitViewOptions");
    /* 钉住的那条口径不许被顺手删掉（有些档的被测对象就是缩放）。
       **按接线判，不按文件里出现没出现过这个字符串** —— 上面那句 JSDoc 里也写着
       `onViewportChange`，只查 `toContain` 会在「从代码里删掉、注释还在」时恒绿
       （本判据的第一版就是这么被变异实测抓出来的）。 */
    const pinnedBranch = flow.slice(
      flow.indexOf(": {", flow.indexOf("...(fit")),
      flow.indexOf("proOptions", flow.indexOf("...(fit")),
    );
    expect(
      pinnedBranch,
      "钉住视口那条口径（viewport + onViewportChange 空实现）不许被删",
    ).toContain("viewport: scene.viewport");
    expect(pinnedBranch, "受控视口的 onViewportChange 空实现不许被删").toContain(
      "onViewportChange: () => undefined",
    );
  });

  it("两种口径互斥：fit 档不传受控的 viewport", () => {
    /* 同时传 `fitView` 与 `viewport` 时 React Flow 只用前者 —— 留着 `viewport`
       会让下一个人以为「钉住 + 自适应」能同时成立（§16.2.3.13 写在文档里的那句）。 */
    const flow = readFileSync(FLOW, "utf8");
    /* `viewport: scene.viewport` 与 `fitView: true` 必须在三元的两支里，
       而不是并列传给 <ReactFlow>。 */
    const start = flow.indexOf("...(fit");
    expect(start, "两种口径互斥的那个三元找不到 —— fit 接线被改写了").toBeGreaterThan(-1);
    const spread = flow.slice(start, flow.indexOf("proOptions", start));
    expect(spread).toContain("fitView: true");
    expect(spread).toContain("viewport: scene.viewport");
    /* 两支各自给出自己的口径（`? … : …` 里 `fitView` 在前、`viewport` 在后）。 */
    expect(spread.indexOf("fitView: true")).toBeLessThan(
      spread.indexOf("viewport: scene.viewport"),
    );
  });
});
