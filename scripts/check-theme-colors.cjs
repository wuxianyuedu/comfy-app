#!/usr/bin/env node
// @ts-nocheck -- 主题色扫描（供 .githooks/pre-commit 与 CI 调用）
/**
 * 主题色扫描 —— 规范见 docs/standards/03-样式与-tailwind.md §3.6 / §3.6.1。
 *
 * 背景（ISSUE #75「取消暗色优先，全应用浅色主题彻底铺开」）：
 * 专项推进过程中反复出现同一件事 —— **每轮扫描都要重新判定一次「哪些写死色值
 * 是有意保留、哪些是漏改」**。判定口径虽然写在规范 §3.6.1 里，但规范是人读的、
 * 扫描是机器跑的：没有机器可读的豁免清单，同一批「类型色」（端口类型色 /
 * 节点类别色 / 参数分组色，约 320 处）每轮都被当成漏网再报一遍，白耗一轮。
 *
 * 本脚本把这件事机器化，分三层：
 *   ① **豁免层**（`EXEMPT_TABLES` / `EXEMPT_FIXED_DARK`）：按 §3.6.1 的两类
 *      例外**逐条显式**放行 —— 「类型色例外」（成组集中的端口类型色 / 节点类别色 /
 *      参数分组色常量表）与「固定暗色清单」（画布极小面积叠层）。豁免项从此
 *      不再进入报告；
 *   ② **棘轮层**（`scripts/.theme-color-baseline.json`）：豁免后仍有存量的
 *      未 token 化写死色值，按「文件 → 处数」记账，**只许降不许升** ——
 *      新写的写死色值一律阻断，逐批治理时基线跟着收紧；
 *   ③ **报告层**（`--report`）：只出清单不判失败，供盘点/排批次用。
 *
 * ⚠️ 豁免必须**显式**：清单里逐条列出「文件 + 该文件里被豁免的顶层标识符 + 理由」，
 * 不做「按目录/按关键字通配」的模糊放行 —— 模糊放行会让真正的漏改混在豁免里
 * 悄悄溜过。新增豁免一律在本脚本 `EXEMPT_TABLES` 里写清理由，并在 PR 描述里
 * 说明；与 `globals.css` 的「固定暗色清单」及规范 §3.6.1 保持同源。
 *
 * 判定口径：
 *   检查  = 遍历 `src/**`，统计每个文件的写死色值，减去显式豁免；
 *   通过  = 未豁免计数 ≤ 基线（且新增文件/新增处数不得抬高基线）；
 *   失败  = 出现基线外的新增写死色值（退出码 1），并列出行号。
 *
 * 用法：
 *   node scripts/check-theme-colors.cjs            # 检查（棘轮：只许降不许升）
 *   node scripts/check-theme-colors.cjs --strict   # 基线下调也失败（CI 用，强制收紧）
 *   node scripts/check-theme-colors.cjs --report   # 只出报告，不判失败（盘点用）
 *   node scripts/check-theme-colors.cjs --update   # 治理后重写基线（须伴随下降）
 */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const ARGS = new Set(process.argv.slice(2));
const REPORT_ONLY = ARGS.has("--report");
const UPDATE = ARGS.has("--update");
const STRICT = ARGS.has("--strict");
const BASELINE = path.join(__dirname, ".theme-color-baseline.json");

/* ── 扫描范围 ────────────────────────────────────────────── */

/** 只扫应用源码：src/**（含 .ts/.tsx），排除测试与快照。 */
const SCAN_DIR = "src";
const SOURCE_EXT = /\.(ts|tsx)$/;
const isTestFile = (rel) =>
  /\.test\.[cm]?[jt]sx?$/.test(rel) ||
  /\.snap$/.test(rel) ||
  rel.includes("/__tests__/");

/* ── 写死色值的识别 ──────────────────────────────────────── */

/** `#rrggbb` / `#rgb` / `#rrggbbaa`（8 位），以及 `rgba(...)` / `rgb(...)`。 */
const HEX_RE = /#[0-9a-fA-F]{3,8}\b/g;
const FUNC_COLOR_RE = /\brgba?\s*\(/g;
/**
 * `#346` / `#262` 这类 **ISSUE 引用**会被 `HEX_RE` 误当 3 位色值：
 * 3~4 位短写法只接受「整行里没有别的数字型引用迹象」的情形。判据用
 * 「短 hex 后面紧跟引号/空格/分号/括号等值终止符」——`#fff"`、`#abc)`
 * 是真色值，`#346 ` 后面跟中文/数字则是 ISSUE 号。为稳妥起见，短写法
 * 只在**去注释后的代码**里判定（注释里的 `#fff` 本来就该忽略）。
 */
const SHORT_HEX_RE = /#[0-9a-fA-F]{3,4}(?=["';)\s]|$)/g;
const SHORT_HEX_CONTEXT_RE =
  /(?:bg|text|border|fill|stroke|color|background|COLOR)[^#]*$/i;

/**
 * 去掉 `//` 行注释与 `/* … *\/` 块注释（保留行数，便于报行号）。
 *
 * 注释里写色值（如「Card #16161C / border #26262E」的设计稿说明）**不是代码**，
 * 计入扫描只会产生噪声；且注释里的 `#346` 是 ISSUE 号，误报概率最高。
 */
function stripComments(text) {
  let out = "";
  let i = 0;
  const n = text.length;
  let inBlock = false;
  let inLine = false;
  let inStr = null;
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
    if (inStr) {
      if (ch === "\\") {
        out += ch + (nx ?? "");
        i += 2;
        continue;
      }
      if (ch === inStr) inStr = null;
      out += ch;
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
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
    }
    out += ch;
    i++;
  }
  return out;
}

/**
 * 该行是否「像」一个颜色字面量行（**先去过注释**）。
 *
 * 判据是**值本身**，不是所在目录 —— 与规范 §3.6.1 的边界一致：
 * 「这行色值是『内容自己的颜色』还是『某个表面的颜色』？」
 * 这一层只负责「这行有没有写死色值」，分堆交给 `EXEMPT_*` 清单。
 */
function colorHitsInLine(line) {
  const hits = [];
  for (const m of line.matchAll(HEX_RE)) {
    const v = m[0];
    // 3~4 位短写法只在「有颜色语境」时才算色值（避开 ISSUE #346 这类引用）。
    if (v.length <= 5 && !SHORT_HEX_CONTEXT_RE.test(line.slice(0, m.index)))
      continue;
    hits.push(v);
  }
  for (const m of line.matchAll(FUNC_COLOR_RE))
    hits.push(m[0].replace(/\s*\($/, "("));
  return hits;
}

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
    file: "src/components/ui/seed-mode-button.tsx",
    exports: [],
    reason: "seed 模式图标的类型配色（内联 SVG fill/stroke），内容色",
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
    file: "src/components/studio/workflow-library/WorkflowParamCardColumn.tsx",
    exports: [],
    reason: "工作流库参数卡端口圆点类型色（与 PORT_COLORS 同源）",
  },
  {
    file: "src/components/studio/workflow-library/CustomNodesSettings/constants.ts",
    exports: [],
    reason: "自定义节点状态徽标配色（已加载/目录不存在/解析出错…）常量表",
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
    file: "src/components/studio/canvas/WorkflowCanvasDecorations.tsx",
    exports: [],
    reason:
      "画布网格线色（148,163,184 + **透明度档由用户设置实时计算**）—— 两条网格线是浮在画布上的装饰，" +
      "浅色下也仍然读得出，判据 2 不成立",
  },
  {
    file: "src/components/studio/WorkflowCanvasDecorations.tsx",
    exports: [],
    reason:
      "同理：项目画布侧的同名装饰组件，与工作流画布共用同一份网格线参数（148,163,184 + 实时透明度档）",
  },
  {
    file: "src/components/studio/project-canvas/CanvasNode/CanvasNode.tsx",
    exports: [],
    reason:
      "三处端口圆点的内圈高光（rgba(255,255,255,0.08)，与 PORT_STYLE 的 glow 成对出现）" +
      "与选中节点的高亮环（品牌紫 2px 实线 + 两层光晕，与 `--color-primary` 同值）—— 前者的判断同 CanvasNodePrimitives 的条目",
  },
  {
    file: "src/components/ui/water-fill-progress.tsx",
    exports: [],
    reason:
      "内容视图内的**极小面积叠层**（水幕），固定暗色清单判据 1+2 都成立：" +
      "它骑在预览图/视频之上、刻意保留 ~0.9 让底层内容隐约可见，" +
      "换成浅色会与浅色内容糊在一起；条目同时登记进 globals.css 的固定暗色清单",
  },
  {
    file: "src/components/model/ModelCard.tsx",
    exports: [],
    reason:
      "模型卡封面的类别渐变（模型类别 → 品牌双色档），与 canvas-types 的 NODE_META.color 同构的内容类型色",
  },
  {
    file: "src/components/studio/debug/DebugChainFooter.tsx",
    exports: [],
    reason: "调试链路条的类型色（琥珀描边 + 底色），色值即「调试态」语义",
  },
  {
    file: "src/components/studio/workflow-library/WorkflowLibraryCanvas.tsx",
    exports: [],
    reason:
      "画布网格线的 `var(--color-canvas-grid-line, …)` 兜底值（与 WorkflowCanvasDecorations 同源）",
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
    file: "src/components/studio/project-canvas/CanvasContextMenu.tsx",
    exports: [],
    reason:
      "「测试自定义工作流」菜单项的 W 徽标渐变（品牌双色渐变，与 --color-primary / --color-accent 同值但需两色渐变）",
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
  {
    file: "src/components/workshop/stage-config.ts",
    /* 这 3 处在 `buildMissingSummary` 的返回数组里，不是顶层常量表，故按**行号**
     * 逐条豁免（比整函数豁免更精确）：缺失素材清单的每条强调色，与阶段/类别色同源。 */
    lines: [164, 169, 174],
    reason: "工坊「缺失素材」清单每条的类型强调色（角色卡/场景/分镜）",
  },
];

/**
 * ② 固定暗色清单（规范 §3.6.1 判据 1+2）：内容视图内**极小面积叠层**，
 *    叠在画布/媒体之上、必须比承载对象更暗。整条清单的权威副本是
 *    `src/app/globals.css` 的「固定暗色清单」注释块。
 */
const EXEMPT_FIXED_DARK = [
  {
    file: "src/components/studio/workflow-editor/WorkflowEditorInner.tsx",
    exports: [],
    reason:
      "画布底部操作提示气泡 bg-black/60 + 子工作流加载遮罩 bg-black/20（清单条目 1、2）",
  },
];

/** 全部豁免落点索引：rel → [entry…]。 */
const EXEMPT_INDEX = new Map();
for (const entry of [...EXEMPT_TABLES, ...EXEMPT_FIXED_DARK]) {
  const list = EXEMPT_INDEX.get(entry.file) ?? [];
  list.push(entry);
  EXEMPT_INDEX.set(entry.file, list);
}

/* ── 豁免判定 ────────────────────────────────────────────── */

/**
 * 计算「每行身处哪个顶层声明」：从文件头往下扫，记录当前最近的顶层声明名。
 *
 * 顶层声明有四种豁免粒度（见 `EXEMPT_TABLES` 条目的字段）：
 *   · `exports: ["X"]`  只豁免声明 `X` 的作用域；
 *   · `exports: []`     整文件豁免（仅限「整个文件就是一张类型色常量表」）；
 *   · `lines: [164]`    只豁免指定行（表外内联、比整函数豁免更精确）；
 *   · 都不给 = 整文件豁免（同 `exports: []`）。
 */
function scopeResolver(text) {
  const lines = text.split("\n");
  const scopeAtLine = new Array(lines.length).fill(null);
  let current = null;
  let depth = 0;
  /* 顶层声明名：`export const NODE_META: Record<` 这类**跨行声明**必须能认出来 ——
   * 名字后面紧跟 `:` / `=` / `(` / `{` 即视为声明开始，随后逐行按括号配对跟踪，
   * 直到配平（回到 depth 0）才关闭作用域。若在 depth 0 时又遇到新声明，直接切换。 */
  const DECL_RE =
    /^\s*(?:export\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)\s*[:=({<]/;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const decl = line.match(DECL_RE);
    if (depth === 0 && decl) current = decl[1];
    scopeAtLine[i] = current;
    let opened = false;
    for (const ch of line) {
      if (ch === "{" || ch === "(" || ch === "[") {
        depth++;
        opened = true;
      } else if (ch === "}" || ch === ")" || ch === "]")
        depth = Math.max(0, depth - 1);
    }
    /* 只有「开过括号并配平」才算这次声明结束；`export const X = 1;` 这种
     * 单行声明由下一个声明的出现自然切换，不必在这里清空。 */
    if (depth === 0 && opened) current = null;
  }
  return scopeAtLine;
}

/** 命中集合：rel → { wholeFile | exports[], lines[] }。 */
function classifyFile(rel) {
  const entries = EXEMPT_INDEX.get(rel) ?? [];
  if (entries.length === 0) return null;
  const wholeFile = entries.some(
    (e) => (e.exports ?? []).length === 0 && !e.lines,
  );
  const names = new Set(entries.flatMap((e) => e.exports ?? []));
  const lines = new Set(entries.flatMap((e) => e.lines ?? []));
  return { wholeFile, names, lines };
}

/* ── 主流程 ──────────────────────────────────────────────── */

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === "node_modules" || e.name === ".next") continue;
      walk(p, out);
    } else out.push(p);
  }
  return out;
}

const rel = (p) =>
  p
    .split(path.sep)
    .join("/")
    .replace(ROOT.split(path.sep).join("/") + "/", "");

const violations = [];
const exempted = [];

for (const abs of walk(path.join(ROOT, SCAN_DIR))) {
  const r = rel(abs);
  if (!SOURCE_EXT.test(r) || isTestFile(r)) continue;
  const text = fs.readFileSync(abs, "utf8");
  if (!colorHitsInLine(text).length && !/[^\x00-\x7F]/.test(text)) {
    /* 没有色值就没得报；中文只用于豁免清单命中时的说明，跳过纯 ASCII 快路。 */
  }
  const lines = text.split("\n");
  /** 去注释后的行（保留行号），色值只在代码里判 —— 注释里的色值与 ISSUE 号都不是代码。 */
  const codeLines = stripComments(text).split("\n");
  const cl = classifyFile(r);
  const scopes = cl ? scopeResolver(text) : null;

  for (let i = 0; i < lines.length; i++) {
    const hits = colorHitsInLine(codeLines[i]);
    if (!hits.length) continue;
    const lineNo = i + 1;
    if (
      cl &&
      (cl.wholeFile ||
        cl.lines.has(lineNo) ||
        (scopes[i] && cl.names.has(scopes[i])))
    ) {
      exempted.push({
        file: r,
        line: lineNo,
        hits: hits.length,
        scope: scopes[i],
      });
      continue;
    }
    violations.push({
      file: r,
      line: lineNo,
      hits: hits.join(" "),
      text: lines[i].trim(),
    });
  }
}

/* ── 报告 / 棘轮 ────────────────────────────────────────── */

const byFile = new Map();
for (const v of violations) {
  const list = byFile.get(v.file) ?? [];
  list.push(v);
  byFile.set(v.file, list);
}

/** 未豁免计数（按文件）：rel -> 处数。 */
const counted = Object.fromEntries(
  [...byFile].map(([f, list]) => [f, list.length]),
);

const exemptByFile = new Map();
for (const e of exempted) {
  exemptByFile.set(e.file, (exemptByFile.get(e.file) ?? 0) + e.hits);
}
const totalExemptHits = exempted.reduce((n, e) => n + e.hits, 0);

/** 打印豁免清单（让人一眼看出「哪些是被有意放行的」）。 */
function printExemptions() {
  if (!exemptByFile.size) return;
  console.log("[theme-colors] 已显式豁免（规范 §3.6.1 例外，不再进入报告）：");
  for (const [f, n] of [...exemptByFile].sort((a, b) => b[1] - a[1])) {
    const entry = EXEMPT_INDEX.get(f)[0];
    console.log(`  · ${f} — ${n} 处 — ${entry.reason}`);
  }
}

/** 打印未豁免命中（按处数降序）。 */
function printViolations() {
  if (!byFile.size) return;
  console.log("[theme-colors] 未豁免命中（按规范 §3.6.1 须 token 化）：");
  for (const [f, list] of [...byFile].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    const isNew = !baselineFiles || (baselineFiles[f] ?? 0) < list.length;
    console.log(`  ${isNew ? "✗" : "·"} ${f}（${list.length} 处）`);
    for (const v of list.slice(0, 5)) {
      console.log(`      L${v.line}: ${v.hits}  ${v.text.slice(0, 90)}`);
    }
    if (list.length > 5) console.log(`      … 另 ${list.length - 5} 处`);
  }
}

const totalCounted = Object.values(counted).reduce((a, b) => a + b, 0);

console.log(
  `[theme-colors] 扫描 ${SCAN_DIR}/**：未豁免写死色值 ${totalCounted} 处 / ${byFile.size} 文件；` +
    `显式豁免 ${totalExemptHits} 处 / ${exemptByFile.size} 文件`,
);

const prev =
  !UPDATE && fs.existsSync(BASELINE)
    ? JSON.parse(fs.readFileSync(BASELINE, "utf8"))
    : null;
const baselineFiles = prev?.files ?? null;

/* ── 模式一：只出报告（盘点） ── */
if (REPORT_ONLY) {
  printExemptions();
  printViolations();
  console.log("[theme-colors] --report 模式：只出清单，不判失败 ✓");
  process.exit(0);
}

/* ── 模式二：更新基线（棘轮只许下降） ── */
if (UPDATE) {
  const before =
    (prev?.files && Object.values(prev.files).reduce((a, b) => a + b, 0)) ?? 0;
  if (before && totalCounted > before) {
    console.error(
      `[theme-colors] 拒绝放宽基线：${before} → ${totalCounted}（棘轮只许下降）。\n` +
        "  新增写死色值必须先 token 化，不要用 --update 掩盖。",
    );
    process.exit(1);
  }
  printExemptions();
  fs.writeFileSync(
    BASELINE,
    JSON.stringify(
      {
        generatedAt: new Date().toISOString().slice(0, 10),
        note:
          "未豁免的写死色值处数（规范 03 §3.6.1 之外）。棘轮只许下降；" +
          "新增豁免请改 scripts/check-theme-colors.cjs 的 EXEMPT_TABLES/EXEMPT_FIXED_DARK，不要用 --update 放水。",
        total: totalCounted,
        files: counted,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    `[theme-colors] 基线已更新：${before} → ${totalCounted}（scripts/.theme-color-baseline.json）`,
  );
  process.exit(0);
}

/* ── 模式三：检查（未豁免不得超过基线） ── */
printExemptions();

if (!baselineFiles) {
  console.error(
    "[theme-colors] 基线文件缺失：先执行 node scripts/check-theme-colors.cjs --update",
  );
  process.exit(1);
}

const increased = [];
const dropped = [];
for (const [f, list] of byFile) {
  const base = baselineFiles[f] ?? 0;
  if (list.length > base)
    increased.push({ file: f, from: base, to: list.length, list });
}
for (const [f, base] of Object.entries(baselineFiles)) {
  const nowCount = counted[f] ?? 0;
  if (nowCount < base) dropped.push({ file: f, from: base, to: nowCount });
}
let tightened = false;
for (const [f, base] of Object.entries(baselineFiles)) {
  if (!baselineFiles[f]) continue;
  if (!(f in counted) && base > 0) tightened = true;
}

if (increased.length) {
  console.log("[theme-colors] 基线外新增写死色值：");
  for (const inc of increased) {
    console.log(`  ✗ ${inc.file}：${inc.from} → ${inc.to}`);
    for (const v of inc.list.slice(-Math.max(1, inc.to - inc.from))) {
      console.log(`      L${v.line}: ${v.hits}  ${v.text.slice(0, 90)}`);
    }
  }
  console.error(
    "\n[theme-colors] 失败：新增了未经豁免的写死色值。\n" +
      "  判据（规范 03 §3.6.1）：能写成类名的必须是类名 —— 表面/文字语义的 #hex /\n" +
      "  rgba(...) 一律改语义 token。仅「类型色例外」（成组集中的端口类型色 / 节点\n" +
      "  类别色 / 参数分组色常量表）与「固定暗色清单」（画布极小面积叠层）可豁免；\n" +
      "  新增豁免须在 scripts/check-theme-colors.cjs 的 EXEMPT_TABLES / EXEMPT_FIXED_DARK\n" +
      "  里逐条写明理由，并与 globals.css 清单、规范 §3.6.1 同步。",
  );
  process.exit(1);
}

if (dropped.length) {
  const msg =
    "[theme-colors] 未豁免计数已下降（治理有进展）：\n" +
    dropped.map((d) => `  · ${d.file}：${d.from} → ${d.to}`).join("\n") +
    "\n  建议执行 node scripts/check-theme-colors.cjs --update 收紧基线。";
  if (STRICT) {
    console.error(msg + "\n  --strict 模式：未收紧基线即失败。");
    process.exit(1);
  }
  console.log(msg);
}

printViolations();
console.log(
  `[theme-colors] 通过 ✓（未豁免 ${totalCounted} 处 ≤ 基线 ${Object.values(
    baselineFiles,
  ).reduce((a, b) => a + b, 0)} 处；豁免 ${totalExemptHits} 处不参与判定）`,
);
