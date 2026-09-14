/**
 * 画布上的「对外参数节点」只表达映射，不得改动工作流图。
 *
 * 背景：勾选 IO 与画布节点曾经被绑死过一次 —— 那套派生节点复用了工作流节点的
 * 视觉，取消勾选 / 切模式时还会以另一种形态残留，看图时分不清哪些是真实节点。
 *
 * 但映射本身**必须**在画布上看得见、并且可连线（ISSUE #355）：作者要知道
 * 「这个对外口落到工作流的哪一行」，最自然的地方就是画布本身 —— 一张接线卡片
 * 拖一条线到宿主节点的端口。所以这里的约束不是「画布上不许有对外参数」，而是
 * 四条边界：
 *
 *   ① 图节点只来自工作流自身（`buildInitialNodes` / 图内连线 `buildEdges`）；
 *      对外参数节点只能由 `buildParamNodes` 产出、连线只能由 `buildParamEdges`
 *      产出 —— 谁都不许把 IO 条目拼进图节点/图连线的数组里；
 *   ② 对外参数节点必须与图节点在 id、类型、可拖性上分开：`pio:<条目id>` 前缀、
 *      `wfParam` 类型、`draggable:false`（位置派生自宿主节点）；
 *   ③ 连线只表达映射：目标是宿主节点上真实存在的端口（ioKey），且**不改工作流
 *      图** —— 拉线 / 删线只写 `paramMap`，不写图；
 *   ④ 卡片是**编辑态**工具：只在「编辑 IO」模式下上画布（`ioEditMode` 门控）。
 *      卡片的 `zIndex` 是 20（压在图节点之上），常态查看工作流时会把图挡掉一片
 *      —— 用户口径：「工作流编辑器画布中，不应该显示对外暴露的参数节点」。
 *      落点数据在 `paramMap` 里，与「是否显示」无关，隐藏不丢线。
 *
 * 这条守卫是源码级的：视图层出现第三条「派生画布节点/连线」的来源即被拦下。
 */
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const EDITOR_DIR = path.resolve(__dirname);
const LIBRARY_DIR = path.resolve(__dirname, "../workflow-library");

/** 视图层里「工作流图」的允许来源（对外参数节点/连线是另一条受约束的通道）。 */
const ALLOWED_GRAPH_SOURCES = ["buildInitialNodes", "buildEdges"];
/** 视图层里「对外参数节点 / 映射连线」的允许来源。 */
const ALLOWED_PARAM_SOURCES = ["buildParamNodes", "buildParamEdges"];

/** 曾经把「对外参数映射」渲染成画布节点/连线的模块名 —— 一个都不许回来。
 *  它们与当前这套的区别是：卡片复用了工作流节点的视觉与节点类型，且连线被
 *  当成图连线的一部分（切模式 / 取消勾选会留下残影）。 */
const BANNED_MODULES = [
  "workflow-param-node-data.test.ts",
  "WorkflowParamMapLayer.tsx",
  "WorkflowParamMapLayer.test.tsx",
  "workflow-library-canvas-config.ts",
  "workflow-library-canvas-config.test.ts",
];

/** 去掉块注释与行注释，避免文档里提到旧机制时误伤断言。 */
function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
}

describe("对外参数节点只在画布上表达映射", () => {
  it("曾经的「复用图节点视觉」的映射模块没有回来", () => {
    for (const dir of [EDITOR_DIR, LIBRARY_DIR]) {
      for (const banned of BANNED_MODULES) {
        expect(existsSync(path.join(dir, banned))).toBe(false);
      }
    }
  });

  it("工作流图上没有「对外参数卡片」这类 node type —— 它们有独立类型", () => {
    const nodes = readFileSync(
      path.join(EDITOR_DIR, "WorkflowEditorNodes.tsx"),
      "utf8",
    );
    expect(nodes).toMatch(/export const workflowNodeTypes = \{/);
    /* 对外参数卡片注册在 `wfParam` 名下（不是工作流图的一部分）。 */
    expect(nodes).toContain("wfParam: WorkflowParamNode");
  });

  it("图节点只来自工作流自身；对外参数节点只来自 buildParamNodes", () => {
    const inner = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"), "utf8"),
    );
    for (const allowed of ALLOWED_GRAPH_SOURCES)
      expect(inner).toContain(allowed);
    for (const allowed of ALLOWED_PARAM_SOURCES)
      expect(inner).toContain(allowed);
    /* 图节点 / 图连线数组里不许出现 IO 派生的卡片与映射线：它们各自有独立
     *  的构建入口（buildParamNodes / buildParamEdges），与图一起并排推送。 */
    expect(inner).not.toMatch(/setNodes\(\[\.\.\.[^\]]*param/i);
    expect(inner).not.toMatch(/buildEdges\([^)]*param/i);
  });

  it("对外参数卡片只在「编辑 IO」模式下上画布：常态查看只剩工作流图", () => {
    /* 用户口径：「工作流编辑器画布中，不应该显示对外暴露的参数节点」。卡片
     *  zIndex 20 压在图节点之上，常态查看时会把工作流本身挡掉一片；它们是
     *  **编辑态**的接线工具，因此由 `ioEditMode` 门控，映射线同批撤掉（卡片不在
     *  时留线头就是悬空线）。落点数据在 `paramMap` 里，隐藏不影响已连的线。 */
    const inner = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"), "utf8"),
    );
    expect(inner).toContain("showParamWiring = ioEditMode");
    /* 卡片：非编辑态只推图节点。 */
    expect(inner).toMatch(/showParamWiring\s*\?[\s\S]{0,120}paramNodes[\s\S]{0,80}: graphNodes/);
    /* 映射线 / 输出取值线同批门控。 */
    expect(inner).toContain(
      "...(showParamWiring ? [...paramEdges, ...outputEdges] : [])",
    );
  });

  it("拉线 / 删线只写映射，不写工作流图", () => {
    const inner = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"), "utf8"),
    );
    /* 连线的源必须是 `pio:` 卡片（entryIdFromParamNodeId 反解），落点写入
     * paramMapping.connect —— 两者都在，且 savePatch 不出现在这两个回调里。 */
    const connectBlock = inner.slice(
      inner.indexOf("const onConnect = useCallback"),
    );
    expect(connectBlock).toContain("paramMapping.connect");
    const deleteBlock = inner.slice(
      inner.indexOf("const onEdgesDelete = useCallback"),
    );
    expect(deleteBlock).toContain("paramMapping.connect");
    for (const block of [connectBlock, deleteBlock]) {
      const body = block.slice(0, block.indexOf("const ", 10));
      expect(body).not.toContain("savePatch");
      expect(body).not.toContain("workflowIO");
    }
  });

  it("对外参数卡片是接线面板：不可拖，但**必须可连线**", () => {
    /* 卡片的位置派生自宿主节点，所以自己拖不动；但它是唯一的连线起点，
     *  `connectable` 必须为真 —— React Flow 把「这一端能不能拉线」算作
     *  `handle.connectable && handle.connectableend`，节点上写 false 会让每颗
     *  端点变成点不动的装饰，用户表现为「点击端点拉线出现禁用标记」（ISSUE #355）。 */
    const build = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-nodes.ts"), "utf8"),
    );
    expect(build).toContain("draggable: false");
    expect(build).toContain("connectable: true");
    expect(build).not.toContain("connectable: false");
    expect(build).toContain("placeParamNodes");
  });

  it("没有模式也连得上：端点渲染与模式无关，候选端点只收窄到真能连的行", () => {
    /* 「对外参数卡片连不了线，点击端点拉线会出现禁用标记」：成因之一是卡片把
     *  「有没有模式」当成「能不能连线」，没选中模式时端点整体不渲染。模式只决定
     *  这条线归属哪个命名空间，不决定拖线本身是否成立 —— 因此：
     *   ① `canWire` 恒为真（源码级：不许再出现 `!!mode`）；
     *   ② 候选端点交上「宿主卡片真的画出来、连得上」的行集合（reachableKeys），
     *      端点不会画在一颗落不上去的句柄上。 */
    const build = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-nodes.ts"), "utf8"),
    );
    expect(build).toContain("canWire: true");
    expect(build).not.toContain("canWire: !!mode");
    expect(build).toContain("reachableKeys");
  });

  it("映射连线带得动两个键空间：source 是卡片、targetHandle 是落点 ioKey", () => {
    const edges = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-edges.ts"), "utf8"),
    );
    expect(edges).toContain("paramNodeId(entry.id)");
    expect(edges).toContain("targetHandle: wired.ioKey");
    /* 卡片不存在时不画线 —— 否则图上会多出一条指向不存在节点的线头。 */
    expect(edges).toContain("renderedCardIds");
  });

  it("一个对外参数可以接多个端口：默认状态按组合控件一对多，手工落点只画一条", () => {
    /* 「尺寸」由宽高比 / 像素量 / 倍数共同组成（同一块组合控件录入），默认状态
     *  下这三个端口各接一条线 —— 只画自动判定挑中的那一条，会让「尺寸」看着只有
     *  一个出口（ISSUE #355：「尺寸现在有三个参数，就应该可以连三条线出来」）。
     *
     *  这条规则必须只有一份：画布连线与库内连线都经 `wiredTargetsForEntry`，
     *  两处不会一个画三条、一个画一条。 */
    const lib = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
        "utf8",
      ),
    );
    expect(lib).toContain("export function wiredTargetsForEntry");
    expect(lib).toContain("groupedKeys");

    const edges = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-edges.ts"), "utf8"),
    );
    expect(edges).toContain("wiredTargetsForEntry");
    const cards = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "workflow-library-param-cards.ts"),
        "utf8",
      ),
    );
    expect(cards).toContain("wiredTargetsForEntry");
  });

  it("对外输出参数卡片列在节点右侧：可拖改取值行、圆点在左、与宿主输出行同源", () => {
    /* ISSUE #355：「红框中的输出端口也要有端口圆点，然后工作流节点右侧需要显示
     *  对外输出参数」。左列（输入）说「对外要什么、落到哪一行」，右列（输出）
     *  说「对外给什么」—— 两列共用同一张卡片本体，端点各在自己那侧。
     *
     *  输出侧**同样可拖**（复审：「需要可拖」，例如临时把 images 指到别处）：
     *  拖卡片左缘那颗圆点到宿主卡片的另一行输出上即改「从哪一行取值」。落点覆盖
     *  写在 `paramMap.output.mode:<模式>`（与输入的 `source` 不是同一张表）。
     *  卡片列自身仍不许碰 React Flow：手势在连线层，量测与输入侧共用一套。 */
    const column = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "WorkflowOutputParamCardColumn.tsx"),
        "utf8",
      ),
    );
    expect(column).toContain('side="left"');
    expect(column).toContain("data-wire-anchor");
    /* 圆点声明自己是「输出取值行」的起手位（连线层据此收窄可落点并分流回调）。 */
    expect(column).toContain("data-wire-kind");
    for (const forbidden of [
      "@xyflow/react",
      "Handle",
      "onConnect",
      "<svg",
      "<path",
      "resolveDropTarget",
    ]) {
      expect(column).not.toContain(forbidden);
    }
    /* 宿主卡片的输出行要**画出圆点**（此前库内预览的 outputs 行没有端点）。 */
    const preview = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"), "utf8"),
    );
    expect(preview).toContain("renderHandle");
    expect(preview).toContain("WorkflowOutputParamCardColumn");
    /* 输出侧连线与输入侧同一层、同一套量测（不是各画一套）。 */
    const wires = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "WorkflowParamWires.tsx"), "utf8"),
    );
    expect(wires).toContain("hostToParam");
  });

  it("工作流库不叠「对外参数映射层」（库内是只读说明，不是画布节点）", () => {
    const preview = readFileSync(
      path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"),
      "utf8",
    );
    const code = stripComments(preview);
    expect(code).not.toContain("WorkflowParamMapLayer");
    expect(code).not.toContain("deriveLibraryCanvas");
    expect(code).not.toContain("resolveManualEntryIds");
  });

  it("对外参数卡片列不是画布节点：无 React Flow、无端点、无连线", () => {
    /* 卡片列是画布之外的只读视图：它只能 import 卡片视觉本体与纯派生函数，
     * 不许碰 React Flow（Handle / 边 / 节点类型），也不许自己画线。 */
    const column = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "WorkflowParamCardColumn.tsx"),
        "utf8",
      ),
    );
    for (const forbidden of [
      "@xyflow/react",
      "Handle",
      "onConnect",
      "<svg",
      "<path",
    ]) {
      expect(column).not.toContain(forbidden);
    }
    /* 卡片视觉本体本身也不许依赖 React Flow —— 端点由消费方注入。 */
    const card = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowParamCard.tsx"), "utf8"),
    );
    for (const forbidden of ["@xyflow/react", "Handle"]) {
      expect(card).not.toContain(forbidden);
    }
  });

  it("输出的取值行覆盖写在独立的键空间，不混进输入侧的 source 表", () => {
    /* 输入侧的 `paramMap.source` 是**运行期**载荷覆盖表（后端把对外值派到那个
     *  端口）；输出侧的选取纯属视图层「这个概念从哪一行读值」。混在同一张表里，
     *  运行期会把一个输出 ioKey 当成输入覆盖去查，落空后行为不可预期。
     *
     *  两边各有一份纯函数编排（applyWireEdit / applyOutputBindingEdit），
     *  库内与画布都只经它们写。 */
    const lib = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-output-binding.ts"),
        "utf8",
      ),
    );
    expect(lib).toContain("OUTPUT_BINDING_NAMESPACE");
    expect(lib).toContain("applyOutputBindingEdit");
    expect(lib).toContain("resolveOutputSource");
    /* 输出侧没有自动判定：默认落点就是工作流自己排在最前的那一行。 */
    expect(lib).toContain("defaultOutputSource");

    /* 库内手柄与画布手柄都经同一份纯函数写，不各写一套。 */
    for (const file of [
      path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"),
      path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"),
    ]) {
      const code = stripComments(readFileSync(file, "utf8"));
      expect(code).toContain("applyOutputBindingEdit");
    }
  });

  it("画布上的输出卡片是独立通道：`pout:` 前缀、wfOutput 类型、不可拖但可连", () => {
    /* 与输入卡片对称：位置派生自宿主节点（拖不动），端点可连线。id 与输入卡片
     *  同一条命名空间但前缀不同 —— 一个输出 ioKey 与某个输入条目 id 可能同名，
     *  不加前缀会撞车（React Flow 节点 id 唯一）。 */
    const build = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-output-nodes.ts"), "utf8"),
    );
    expect(build).toContain("outputNodeId");
    expect(build).toContain("draggable: false");
    expect(build).toContain("connectable: true");
    expect(build).toContain("placeOutputNodes");
    const lib = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
        "utf8",
      ),
    );
    expect(lib).toContain("OUTPUT_NODE_PREFIX");
    expect(lib).toContain("placeOutputNodes");
    /* 注册表里有这张卡片的渲染器。 */
    const nodes = readFileSync(
      path.join(EDITOR_DIR, "WorkflowEditorNodes.tsx"),
      "utf8",
    );
    expect(nodes).toContain("wfOutput: WorkflowOutputParamNode");
    /* 闸门必须按「卡片端是哪一列的 id」分流：同名 id 在两列各有一张卡时，
     *  这是唯一能分清的一条依据。 */
    const edges = stripComments(
      readFileSync(path.join(EDITOR_DIR, "workflow-param-edges.ts"), "utf8"),
    );
    expect(edges).toContain("isValidOutputConnection");
    expect(edges).toContain("outputIoKeyFromNodeId");
    expect(edges).toContain('direction === "output"');
  });

  it("库内也能改连线：卡片列不碰 React Flow，手势与落库在独立层", () => {
    /* ISSUE #355：「对外参数右侧有小圆点的端口，可和工作流节点上的参数相连」，
     * 且「连线要能编辑，现在编辑不了」。库内因此**不再是只读呈现** —— 但连线
     * 能力不许把 React Flow 引进卡片列：
     *
     *   · 卡片列只画圆点 + 标锚点（`data-wire-anchor`），手势由连线层承担；
     *   · 连线层用指针事件 + 命中测试（`resolveDropTarget`，与画布闸门同一套
     *     判据），画 SVG；它落库一律经 `onConnect` 回调上抛，**自己不写
     *     paramMap**（写入编排在 `hooks/use-param-wiring.ts`，经 tRPC 落库）。
     */
    const column = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "WorkflowParamCardColumn.tsx"),
        "utf8",
      ),
    );
    /* 圆点带锚点（连线层据此量位置 + 起手拖动）。 */
    expect(column).toContain("data-wire-anchor");
    for (const forbidden of ["@xyflow/react", "Handle"]) {
      expect(column).not.toContain(forbidden);
    }
    /* 连线层独立成文件：量位置 + 画 SVG + 上抛手势结果；不直接动数据。 */
    const wires = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "WorkflowParamWires.tsx"), "utf8"),
    );
    expect(wires).toContain("data-wire-anchor");
    /* 落点两种形状都要认：独立参数行（`data-io-key`）与组合参数控件
     *  （`data-io-pins`，宽高 / 比例像素由同一控件录入，没有独立行）。属性名
     *  来自共享契约（workflow-io-types），两边用同一个字符串。 */
    expect(wires).toContain("WIRE_ROW_ATTR");
    expect(wires).toContain("WIRE_PINS_ATTR");
    /* 命中判定与画布同一份纯函数（两边同一个手势不该一个受理一个拒绝）。 */
    expect(wires).toContain("resolveDropTarget");
    for (const forbidden of ["@xyflow/react", "savePatch", "mutateAsync"]) {
      expect(wires).not.toContain(forbidden);
    }
    /* 写入编排收在 hooks/ 里（第②层），经回调落库；连线层只上抛。 */
    const hook = stripComments(
      readFileSync(
        path.join(LIBRARY_DIR, "hooks/use-param-wiring.ts"),
        "utf8",
      ),
    );
    expect(hook).toContain("applyWireEdit");
    expect(hook).toContain("onPatchParamMap");
  });

  it("工作流库详情不靠单侧定宽留白给卡片列腾位置", () => {
    /* 卡片列与宿主卡片并排居中。历史上这里曾经用一条约 300px 的左侧 gutter 给
     * 卡片列挂靠，卡片层撤掉后 gutter 没跟着撤 —— 表现就是用户看到的「卡片没
     * 看到、左边空出块区域」。容器只负责居中，不做单侧留白。 */
    const body = readFileSync(
      path.join(LIBRARY_DIR, "sections/DetailBody.tsx"),
      "utf8",
    );
    const code = stripComments(body);
    expect(code).not.toMatch(/pl-\[\d+px\]/);
    expect(code).toContain("flex min-h-0 flex-1 justify-center overflow-auto");
  });

  it("输出端口=候选落点本身：每颗点各带 handle id，连线两端同名（ISSUE #355 复审）", () => {
    /* 「尺寸这里明明有 2 个参数，却只有一个输出端点，需要补充」：卡片右侧的输出
     *  端口不再是「一颗无属性的点」，而是**每个候选一颗**，各自带 handle id；
     *  宿主节点的行/控件用 ioKey 当 handle id，两端才对得上 —— 同名 pin 出现在
     *  别的节点上时也不会接到那一行。 */
    const node = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowParamNode.tsx"), "utf8"),
    );
    /* 端点 id 用 ioKey：与宿主行 handle 同名（两个键空间见 handleIdForIoKey），
     *  同名 pin 出现在别的节点上时也不会接到那一行。 */
    expect(node).toContain("id={port.ioKey}");
    const rows = stripComments(
      readFileSync(
        path.resolve(
          __dirname,
          "../../studio/shared/DynamicWorkflowForm/sections/WidgetInputRow.tsx",
        ),
        "utf8",
      ),
    );
    expect(rows).toContain("data-io-pins");
    expect(rows).toContain("handleId ?? entry.ioKey");
  });

  it("画布 / 库内的组合控件收窄成一块，不再摊成逐行参数清单 —— ISSUE #355", () => {
    /* 「组合参数不要现在这种样式」「改回之前的样式」「改成之前带有下拉菜单的
     *  样式」「让你减小宽度的也是这个控件」：画布 / 库内保留那块带下拉的组合控件
     *  （`narrow` 只收窄宽度），不再把覆盖到的端口摊成逐行参数清单。 */
    const grouped = stripComments(
      readFileSync(
        path.resolve(__dirname, "../shared/GroupedControls.tsx"),
        "utf8",
      ),
    );
    expect(grouped).toContain("collapseGrouped");
    expect(grouped).toContain("narrow");
    /* 摊成逐行参数清单的形态已被撤掉：它既丢了控件，又让同一件事有两处入口。 */
    expect(grouped).not.toContain("CollapsedGroupRows");
    const preview = stripComments(
      readFileSync(path.join(LIBRARY_DIR, "WorkflowCanvasNodePreview.tsx"), "utf8"),
    );
    /* 卡片列与宿主卡片之间留出走线空间（太近就看不清哪条线连到哪一行）。 */
    expect(preview).toContain("gap-24");
  });

  it("对外参数清单只来自契约（按模式），不再逐节点列出工作流内部参数", () => {
    /* 「对外参数」是产品对用户承诺的那几个口子（提示词 / 尺寸 / 首帧…），
     * 由模式决定，与具体工作流无关 —— 契约表是唯一来源。视图层与映射层都不许
     * 自己按 pin 名聚类出一份「跟着工作流走」的清单。 */
    const lib = readFileSync(
      path.resolve(__dirname, "../../../lib/workflow-exposed-params.ts"),
      "utf8",
    );
    expect(lib).toContain("exposedParamsForMode");
    const mapping = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
        "utf8",
      ),
    );
    expect(mapping).toContain("exposedParamsForMode");
  });

  it("节点上已经选了模式时，卡片不再写「先选模式才能连线」", () => {
    /* 模式解析收敛到 resolveWorkflowMode（defaultMode → modes[0] → taskType）：
     * 编辑器此前只认 defaultMode，声明了模式但没写默认值时卡片就提示「先选模式
     * 才能连线」，而库里 / 画布上的模式 chip 明明已经显示着「单图生视频」了。 */
    const inner = readFileSync(
      path.join(EDITOR_DIR, "WorkflowEditorInner.tsx"),
      "utf8",
    );
    const code = stripComments(inner);
    expect(code).toContain("resolveWorkflowMode");
    expect(code).not.toMatch(/wiringMode\s*=\s*detail\?\.defaultMode/);
    /* 只读卡片（库内）不写「先选模式才能连线」—— 那是编辑态才有的信息。 */
    const card = stripComments(
      readFileSync(path.join(EDITOR_DIR, "WorkflowParamCard.tsx"), "utf8"),
    );
    expect(card).not.toContain("先选模式才能连线");
    const column = readFileSync(
      path.join(LIBRARY_DIR, "WorkflowParamCardColumn.tsx"),
      "utf8",
    );
    expect(stripComments(column)).toContain("readOnly");
  });

  it("映射几何只由纯函数给出（位置派生，不落库）", () => {
    const lib = stripComments(
      readFileSync(
        path.resolve(__dirname, "../../../lib/workflow-param-mapping.ts"),
        "utf8",
      ),
    );
    /* 位置 / 尺寸必须来自这里，视图层不许自己算卡片坐标。 */
    for (const required of [
      "PARAM_NODE_PREFIX",
      "paramNodeId",
      "entryIdFromParamNodeId",
      "placeParamNodes",
      "paramNodeHeight",
    ]) {
      expect(lib).toContain(required);
    }
    /* 位置是派生的：不写回 paramMap / positions。 */
    expect(lib).not.toContain("positions[");
  });
});
