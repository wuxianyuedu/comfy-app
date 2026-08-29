// @ts-nocheck -- 一次性迁移脚本,checkJs 不适用
/**
 * studio/ 平铺文件按域分组迁移(一次性,2026-08-29 文件组织审查)。
 * 解析每个 import 说明符(相对 + @/、~/ 别名),若指向被移动文件则重写为
 * 相对「导入方新位置」的正确路径;未移动目标也会按新目录重新相对化。
 * 幂等:再次运行无改动。
 * 用法:node scripts/restructure-studio.cjs [--apply](默认 dry-run)
 */
const fs = require("node:fs");
const path = require("node:path");

const STUDIO = "src/components/studio";
const moves = {
  // workflow-editor/
  "WorkflowEditorCanvas": "workflow-editor/WorkflowEditorCanvas",
  "WorkflowEditorInner": "workflow-editor/WorkflowEditorInner",
  "WorkflowEditorNodes": "workflow-editor/WorkflowEditorNodes",
  "WorkflowEditorTopbar": "workflow-editor/WorkflowEditorTopbar",
  "workflow-editor-build-nodes": "workflow-editor/workflow-editor-build-nodes",
  "workflow-editor-derived": "workflow-editor/workflow-editor-derived",
  "workflow-editor-detail-loader": "workflow-editor/workflow-editor-detail-loader",
  "workflow-editor-persistence": "workflow-editor/workflow-editor-persistence",
  "workflow-stores": "workflow-editor/workflow-stores",
  // workflow-library/
  "WorkflowLibrary": "workflow-library/WorkflowLibrary",
  "WorkflowLibraryHeader": "workflow-library/WorkflowLibraryHeader",
  "WorkflowLibraryFilters": "workflow-library/WorkflowLibraryFilters",
  "workflow-library-actions": "workflow-library/workflow-library-actions",
  "workflow-library-card": "workflow-library/workflow-library-card",
  "workflow-library-helpers": "workflow-library/workflow-library-helpers",
  "workflow-library-import": "workflow-library/workflow-library-import",
  // history/
  "HistoryList": "history/HistoryList",
  "HistoryTaskCard": "history/HistoryTaskCard",
  "HistoryDetailModal": "history/HistoryDetailModal",
  "history-types": "history/history-types",
  "history-utils": "history/history-utils",
  // logs/
  "LogPanel": "logs/LogPanel",
  "LogProvider": "logs/LogProvider",
  "log-store": "logs/log-store",
  // debug/
  "DebugChainFooter": "debug/DebugChainFooter",
  "debug-store": "debug/debug-store",
  // canvas/(studio 私有节点画布)
  "CanvasArea": "canvas/CanvasArea",
  "WorkflowCanvasEditor": "canvas/WorkflowCanvasEditor",
  "WorkflowSubgraphNode": "canvas/WorkflowSubgraphNode",
  "SubgraphHeader": "canvas/SubgraphHeader",
  "WorkflowEdge": "canvas/WorkflowEdge",
  "WorkflowNode": "canvas/WorkflowNode",
  "FlowNodeHeader": "canvas/FlowNodeHeader",
  "FlowNodeCollapsedAnchors": "canvas/FlowNodeCollapsedAnchors",
  "FlowNodePinRows": "canvas/FlowNodePinRows",
  "FlowNodeWidgetRows": "canvas/FlowNodeWidgetRows",
  "NodeFrost": "canvas/NodeFrost",
  "RgthreeBodies": "canvas/RgthreeBodies",
  "workflow-canvas-render-chain": "canvas/workflow-canvas-render-chain",
  "workflow-canvas-settings": "canvas/workflow-canvas-settings",
  "workflow-render-chain": "canvas/workflow-render-chain",
  "workflow-node-entries": "canvas/workflow-node-entries",
  "workflow-node-palette": "canvas/workflow-node-palette",
  "io-edit-context": "canvas/io-edit-context",
  // ui/
  "ModalDialog": "ui/ModalDialog",
  "CodeBlock": "ui/CodeBlock",
  "JsonViewer": "ui/JsonViewer",
  "MediaThumbnail": "ui/MediaThumbnail",
  "string-textarea": "ui/string-textarea",
  "AuroraBackground": "ui/AuroraBackground",
};

const exts = [".tsx", ".ts", ".test.tsx", ".test.ts"];
const apply = process.argv.includes("--apply");

// 1. 计划不依赖磁盘状态(幂等:重复运行时移动步骤自动跳过,重写仍生效)
const plan = [];
for (const [name, rel] of Object.entries(moves)) {
  for (const ext of exts) {
    const from = path.join(STUDIO, name + ext);
    const to = path.join(STUDIO, rel + ext);
    if (apply ? fs.existsSync(to) : fs.existsSync(from)) {
      plan.push({ from, to, key: name, rel });
      break;
    }
  }
}

// 2. 移动文件(仅当旧位置仍存在)
if (apply) {
  let moved = 0;
  for (const m of plan) {
    if (fs.existsSync(m.from)) {
      fs.mkdirSync(path.dirname(m.to), { recursive: true });
      fs.renameSync(m.from, m.to);
      moved++;
    }
  }
  console.log("moved:", moved);
}

// 3. 重写全 src 的 import 说明符
//    关键:被移动的导入方,其旧相对引用按「旧目录(STUDIO 根)」解析。
const movedByOldAbs = new Map(); // 旧绝对路径(posix,无扩展) -> 新 studio 内相对路径(无扩展)
const newRelToKey = new Map(); // 新 studio 内相对路径(无扩展) -> 旧 key
for (const m of plan) {
  movedByOldAbs.set(m.from.replace(/\\/g, "/").replace(/\.(tsx|ts)$/, ""), m.rel);
  newRelToKey.set(path.posix.join(STUDIO, m.rel), m.key);
}

const srcRoot = "src";
const allFiles = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|mjs|cjs|js)$/.test(e.name)) allFiles.push(p);
  }
})(srcRoot);

// importer 的 key(studio 内被移动文件的旧名,无扩展)→ 其旧目录恒为 STUDIO 根
const importerOldKey = (relFile) => {
  if (!relFile.startsWith(STUDIO + "/")) return null;
  const noExt = relFile.slice(STUDIO.length + 1).replace(/\.(tsx|ts|test\.tsx|test\.ts)$/, "");
  return newRelToKey.get(path.posix.join(STUDIO, noExt)) ?? null;
};

let changed = 0;
for (const file of allFiles) {
  const rel = file.replace(/\\/g, "/");
  const before = fs.readFileSync(file, "utf8");
  const key = importerOldKey(rel); // 该文件自身是否被移动
  const oldDir = key ? STUDIO : (rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : ".");
  const newDir = key ? path.posix.join(STUDIO, path.posix.dirname(moves[key])) : oldDir;

  const rewriteSpec = (spec) => {
    let absOld = null; // 解析位置(无扩展);统一用导入方当前目录,保证幂等且可自我修复
    let alias = false;
    const aliasM = spec.match(/^(@\/|~\/)components\/studio\/([A-Za-z0-9/-]+)$/);
    if (aliasM) {
      alias = true;
      absOld = STUDIO + "/" + aliasM[2];
    } else if (spec.startsWith("./") || spec.startsWith("../")) {
      absOld = path.posix.normalize(path.posix.join(newDir, spec));
    } else return spec;
    // 被移动的目标换新位置;未移动的目标保持原位——两者都按当前目录重新相对化
    const movedTarget = movedByOldAbs.get(absOld);
    const absFinal = movedTarget ? STUDIO + "/" + movedTarget : absOld;
    if (alias) return movedTarget ? aliasM[1] + "components/studio/" + movedTarget : spec;
    let out = path.posix.relative(newDir, absFinal);
    if (!out.startsWith(".")) out = "./" + out;
    return out;
  };

  const after = before.replace(
    /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(")([^"]+)(")/g,
    (m, head, q1, spec, q2) => head + q1 + rewriteSpec(spec) + q2,
  );
  if (after !== before) {
    fs.writeFileSync(file, after);
    changed++;
    if (!apply) console.log("would rewrite:", rel);
  }
}
console.log(apply ? "rewritten files: " + changed : "dry-run: files to rewrite = " + changed);
