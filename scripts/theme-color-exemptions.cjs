#!/usr/bin/env node
// @ts-nocheck -- 主题色判据的**豁免声明层**(供 check-theme-colors.cjs 与用例 import)
/**
 * `check-theme-colors.cjs` 的豁免清单 —— ① 类型色例外与 ② 固定暗色清单两张表。
 *
 * 为什么拆出来(ISSUE #1811):那条脚本 901 行,其中 EXEMPT_TABLES 一张表就占了
 * 232 行。表是「加了要同步改规范 §3.6.1 与 globals.css」的那部分,逻辑是
 * 「读一遍就够」的那部分 —— 混在一份文件里,R5「超 900 行须拆」拦的正是这个形态。
 *
 * 这里**只放表**,不放判定函数:扫描、豁免索引与退出码都留在主文件,
 * 保证 import 本模块零副作用。
 */

/* ── 显式豁免清单 ────────────────────────────────────────── */
/*
 * 每一条都对应规范 03 §3.6.1 里的一类例外，理由写在同一行注释里。
 * 新增时同步改 docs/standards/03-样式与-tailwind.md §3.6.1 与 PR 描述。
 */

/**
 * ① 类型色例外（规范 §3.6.1「Type-color exemption」）：成组集中的
 *    端口类型色 / 节点类别色 / 参数分组色常量表 —— 色值本身就是语义 id
 *    （ComfyUI 端口类型），不是页面/面板/控件那类结构性表面。
 *
 * `exports` 是该文件里被豁免的顶层标识符；空数组表示**整文件**豁免
 * （仅用于「整个文件就是一个类型色常量表」的情形）。
 */
const EXEMPT_TABLES = [
  {
    file: "src/lib/comfyui/types.ts",
    exports: ["PORT_COLORS", "DEFAULT_PORT_COLOR"],
    reason:
      "ComfyUI 32 个端口类型色（对齐 litegraph 官方调色板），色值即类型语义",
  },
  {
    file: "src/config/custom-nodes.ts",
    exports: [],
    reason:
      "自定义节点类别色（CATEGORY_COLORS + colorFor 兜底色），整文件是类别色模块",
  },
  {
    file: "src/lib/comfyui/node-registry.ts",
    exports: [],
    reason: "节点注册表的类别 `color` 字段：整表就是节点类别色常量",
  },
  {
    file: "src/lib/project-canvas/canvas-types.ts",
    exports: ["NODE_META"],
    reason: "项目画布节点类别色（生图/生视频/剧本… 的 color 字段）",
  },
  {
    file: "src/components/studio/project-canvas/CanvasNode/CanvasNodePrimitives.tsx",
    exports: [],
    reason:
      "端口类型粉彩渐变表（PORT_STYLE 六色）—— 内容自身的颜色；" +
      "同文件里同一套类型色散落的档位（端口圆点的内外圈高光 rgba(255,255,255,…)" +
      "与三条节点状态渐变）一并登记，避免它们既不是豁免、也不是待治理项",
  },
  {
    file: "src/components/studio/workflow-form/WorkflowPortHandle.tsx",
    exports: [],
    reason:
      "端口类型色 / 描边常量（PORT_STROKE、portColorFor、portChipStyle 的**文字色**）：色值即类型语义；chip 的**底色**已两态化（--color-chip-type-*-bg），不在豁免范围",
  },
  {
    file: "src/components/studio/workflow-form/DynamicWorkflowForm/constants.ts",
    exports: ["ACCENT", "SECTION_ACCENT", "PIN_ACCENT"],
    reason:
      "动态表单控件类型色（ACCENT：image/select/int/float… 分组色常量表），" +
      "以及由它派生的段头两档（SECTION_ACCENT / PIN_ACCENT：此前在 " +
      "GroupedControls 与 IoEndpointsSection 各写一份同值字面量）",
  },
  {
    file: "src/components/studio/workflow-library/workflow-library-wire-graph.ts",
    exports: ["AUTO_STROKE", "MANUAL_STROKE", "DRAG_STROKE", "SELECTED_STROKE"],
    reason:
      "工作流库画布的连线状态色常量（自动/手改/拖动预览/选中）：与编辑器画布同一套「线本身是什么状态」的语义，不是表面色",
  },
  {
    file: "src/components/studio/workflow-library/workflow-param-mapping-ui.ts",
    exports: ["PARAM_CLASS_COLOR", "PARAM_OUTPUT_STYLE"],
    reason:
      "契约参数口配色（prompt/negative/size… 分组色常量表），" +
      "以及输出侧的伪分类 `PARAM_OUTPUT_STYLE`（与分组表同一张卡片视觉）",
  },
  {
    file: "src/components/studio/project-canvas/EmptyCanvasHint.tsx",
    exports: [],
    reason: "空画布提示的节点类别配色示意（与 NODE_META 同源）",
  },
  {
    file: "src/components/studio/project-canvas/WorkflowNodeArdot.tsx",
    exports: ["PORT_TYPE_COLORS", "PORT_DOT_SHADOW"],
    reason:
      "设计稿参考件的端口类型色常表（仅 IMAGE/VIDEO/BOOLEAN 三档，与 PORT_COLORS 同源），色值即类型语义",
  },
  {
    file: "src/components/studio/canvas/WorkflowNode.tsx",
    exports: [],
    reason:
      "节点角色色（PORT_ROLES：正向/反向提示词、模型、采样器、输入图像）—— 色值即角色语义，与 PORT_COLORS 同源的类型色；" +
      "画布 WorkflowEditorCanvas 的 minimap 也用它上色",
  },
  {
    file: "src/components/studio/canvas/workflow-node-palette.ts",
    exports: [],
    reason:
      "整文件是三类**两态**外观常量表，色值即语义、且都成组集中：" +
      "① 卡片底色的混色基准（LIGHT_PALETTE_BASE / DARK_PALETTE_BASE，只作为 `mixHex()` 的数值输入，不是可见表面）；" +
      "② `nodeMode` 的 bypass / disabled 两档模式色；" +
      "③ 锚点圆柱的金属渐变（ANCHOR_CYLINDER 两态：本色值与 `--color-node` / `--color-port-surface` 同一判断，两态表比一串 token 更可读）",
  },
  {
    file: "src/components/studio/workflow-utils.ts",
    exports: [],
    reason:
      "画布 3D 节点 rgthree 的「漏光」着色（Warm/Cool/Shadow 三层渐变 + 未受光角落），" +
      "与 `RgthreeBodies.tsx` 是同一套 3D 光照参数的两半：色值即光照语义，不是表面色",
  },
  {
    file: "src/components/studio/canvas/RgthreeBodies.tsx",
    exports: [],
    reason:
      "同理：RgthreeBodies 的注塑/线框配色是同一套 3D 光照参数的另一半，色值即光照语义而非表面色",
  },
  {
    file: "src/lib/comfyui/workflow-detail.ts",
    exports: [],
    reason:
      "自定义节点类别色的兜底色（manifest 的 rec.color 缺失时用 #3b3b3b），与 node-registry 同源",
  },
  {
    file: "src/lib/comfyui/workflow-subgraph-parse.ts",
    exports: [],
    reason:
      "同上：子图解析里同一处类别色兜底色（manifest 的 `rec.color` 缺失时用 #3b3b3b），与 node-registry 同源",
  },
  {
    file: "src/components/studio/workflow-editor/WorkflowEditorNodes.tsx",
    exports: [],
    reason:
      "① 节点分组框护栏色 GROUP_RAIL_COLOR（分组是画布内容自身的一种元素）；" +
      "② `--color-note-tint-base` 的 **useCssColorToken 兜底值**——那是混色基准的种子值，不参与渲染",
  },
  {
    file: "src/components/studio/canvas/SubgraphHeader.tsx",
    exports: [],
    reason:
      "同理：`--color-node-mix-base` 的 useCssColorToken 兜底值只是混色种子值，不参与渲染",
  },
  {
    file: "src/components/studio/workflow-form/WorkflowNodeParts.tsx",
    exports: [],
    reason:
      "分组框护栏底色（#2A1F4A），与 WorkflowEditorNodes 的 GROUP_RAIL_COLOR / 项目画布同名样式同源",
  },
  {
    file: "src/components/studio/HomePage.tsx",
    exports: [],
    reason:
      "项目类别色（画布/生成/工作流/视频），与 canvas-types 的 NODE_META.color 同构；" +
      "**底色**不再写死透明色 —— 由 `kindTint()` 的 color-mix 现取",
  },
  {
    file: "src/components/studio/ProjectCanvas.tsx",
    exports: [],
    reason:
      "MiniMap 的未知节点兜底色，与 canvas-types 的 NODE_META.color 同一张类别色表",
  },
  {
    file: "src/components/studio/workflow-library/CustomNodesSettings/NodePreviewCard.tsx",
    exports: [],
    reason:
      "节点预览卡的头部**实色色带**（类别色底 + 白字）与带上的两枚半透明小徽标：" +
      "底色是 `colorFor(category)` 的类型色本身，叠在上面的白/黑蒙版是它的明暗档，不是可换主题的表面",
  },
  {
    file: "src/components/studio/HomePage.tsx",
    exports: ["KIND_CONFIG"],
    reason:
      "项目类别色（画布/生成/工作流/视频），与 canvas-types 的 NODE_META.color 同构；" +
      "**底色**不再写死透明色 —— 由 `kindTint()` 的 color-mix 现取",
  },
  {
    file: "src/components/studio/canvas/IOEditContext.tsx",
    exports: [],
    reason:
      "画布 IO 编辑模式的端点强调色（勾选琥珀 / 未勾选灰），色值即模式语义",
  },
  {
    file: "src/components/studio/canvas/WorkflowEdge.tsx",
    exports: [],
    reason:
      "连线描边色：默认描边（167,139,250 紫）与**混色基准 / 兜底值**（#ffffff、rgb() 逐通道混色）—— 画的是线本身，不是表面",
  },
  {
    file: "src/components/studio/canvas/WorkflowSubgraphNode.tsx",
    exports: [],
    reason:
      "子图节点两处类型色：默认端口色三档（#ec4899 / #6b7280 / #7C5CFC）与选中描边（rgba(56,189,248,0.9)）",
  },
  {
    file: "src/components/studio/project-canvas/CanvasNode/CanvasNode.tsx",
    exports: [],
    reason:
      "三处端口圆点的内圈高光（rgba(255,255,255,0.08)，与 PORT_STYLE 的 glow 成对出现）" +
      "与非选中态投影（rgba(0,0,0,0.25)）—— 前者的判断同 CanvasNodePrimitives 的条目。" +
      "（选中节点的高亮环与两层光晕已改取 `var(--color-primary)`，不在本条射程内）",
  },
  {
    file: "src/components/ui/water-fill-progress.tsx",
    exports: [],
    reason:
      "内容视图内的**极小面积叠层**（水幕），固定暗色清单判据 1+2 都成立：" +
      "它骑在预览图/视频之上、刻意保留 ~0.9 让底层内容隐约可见，" +
      "换成浅色会与浅色内容糊在一起；百分比那行白字的 drop-shadow 与字色同层、同判据；条目同时登记进 globals.css 的固定暗色清单",
  },
  {
    file: "src/components/model/model-cover.ts",
    exports: [],
    reason:
      "模型封面的装饰渐变表（六支互不相同的色对，按 id 哈希取一支，同一模型每次同色）。" +
      "**刻意不跟品牌走**：查过这张表里没有「品牌封面」那个特权位——`#7C5CFC` 只出现在其中一支与" +
      "空表兜底里，跟另外四支（蓝/绿/琥珀/青）是平级的装饰色；把它焊进 `--color-primary` 会让今后任何一次" +
      "品牌调整只带走六分之一张表，用户看到的是「有几分变了、有几分没变」，比全不跟手更难解释。" +
      "色表原先长在 ModelCard.tsx 里，现收在这一个出口，卡片与详情弹窗共用同一支兜底色",
  },
  {
    file: "src/components/studio/debug/DebugChainFooter.tsx",
    exports: [],
    reason: "调试链路条的类型色（琥珀描边 + 底色），色值即「调试态」语义",
  },
  {
    file: "src/components/studio/workflow-library/CustomNodesSettings/SettingsParts.tsx",
    exports: [],
    reason:
      "端口分类圆点色（isOut ? 青 : 类别色）与 `custom-nodes.ts` 的 CATEGORY_COLORS 同源；" +
      "同文件的状态徽标底色/文字色已改走语义 token",
  },
  {
    file: "src/components/studio/project-canvas/ContentAssetNode.tsx",
    exports: ["ASSET_ACCENT"],
    reason:
      "内容载体节点（文本/图片/影片）的类型强调色，与 canvas-types 的 NODE_META.color 同值",
  },
  {
    file: "src/components/studio/project-canvas/WorkflowNode.tsx",
    exports: [],
    reason: "设计参考件的分组框护栏底色（#2A1F4A），与 WorkflowNodeParts 同源",
  },
  {
    file: "src/components/studio/project-canvas/CanvasNode/CanvasNodePrimitives.tsx",
    exports: [],
    reason:
      "**本条目之下的余量**：端口圆点的内外圈高光（rgba(255,255,255,0.06 / 0.08)）与三条节点状态渐变" +
      "（与 PORT_STYLE 六色同源的粉彩档）—— 该文件顶部的 PORT_STYLE 既已在豁免范围内，同一套类型色散落的档位一并登记",
  },
];

/**
 * ② 固定暗色清单（规范 §3.6.1 判据 1+2）：内容视图内**极小面积叠层**，
 *    叠在画布/媒体之上、必须比承载对象更暗。整条清单的权威副本是
 *    `src/app/globals.css` 的「固定暗色清单」注释块。
 */
const EXEMPT_FIXED_DARK = [];

module.exports = { EXEMPT_TABLES, EXEMPT_FIXED_DARK };
