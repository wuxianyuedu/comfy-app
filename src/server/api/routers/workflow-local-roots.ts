/* workflow 路由共享的「本地工作流目录」事实与安全边界。
 *
 * 从 workflow.ts（943 行）拆出的第 0 块：list 的磁盘扫描、create 的导入守卫
 * 读的是**同一组根目录**，此前散在大文件两处的 helper 各写一份——更糟的是
 * 两处读 `LOCAL_WORKFLOWS_PATH` 的方式不同（扫描用 `readEnvVar` 实时读 .env
 * 文件、守卫用 `process.env` 启动快照），`.env` 新增目录后界面会出现
 * 「待导入」项、点击导入却被守卫拒绝。现在两个口径收成本文件的一份出处。
 */
import { createHash } from "node:crypto";
import path from "node:path";

import {
  deriveComfyuiWorkflowsDir,
  getSettingsSync,
} from "~/lib/app-settings/app-settings.server";
import { hasRawContent } from "~/lib/comfyui/execution-shape";
import { readEnvVar } from "~/lib/envfile";
import { normalizeSlashes } from "~/lib/path-display";
import type { WorkflowIOMap } from "~/lib/workflow/workflow-io-types";

/** 列表行下发给前端的「可执行形态」事实 —— 判据全在
 *  `~/lib/comfyui/execution-shape`（原件是 RAW 才可执行）。
 *
 *  · `usable`：这条工作流能不能跑；
 *  · `hasRaw`：RAW 原件列有没有内容（如实标注，不判可用性）。 */
function executionShapeOf(row: { rawJson: unknown }): {
  hasRaw: boolean;
  usable: boolean;
} {
  const hasRaw = hasRawContent(row.rawJson);
  return { hasRaw, usable: hasRaw };
}

/* 解析本地工作流的扫描根目录。
 *  主路径：设置里配置的 ComfyUI 安装根下的用户工作流目录（自动推导，
 *  见 deriveComfyuiWorkflowsDir —— 兼容 user/default/workflows 与旧 workflows）。
 *  `.env` 的 LOCAL_WORKFLOWS_PATH 仍作为覆盖项保留（向后兼容，可加扫额外目录）。 */
function getLocalWorkflowRoots(): string[] {
  const derived = deriveComfyuiWorkflowsDir(getSettingsSync().comfyuiPath);
  const extra = (readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "")
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter(Boolean);
  return derived ? [derived, ...extra] : extra;
}

/* 给「磁盘上有、但还没导入过」的文件生成的稳定、确定的占位 id。 */
function pendingId(absPath: string): string {
  return (
    "pending-" + createHash("sha1").update(absPath).digest("hex").slice(0, 12)
  );
}

/* 追加到 `list` 里的「本地待导入」占位行的形状。
 * 刻意与数据库里 `enriched` 出来的行保持结构一致，
 * 让前端的 `LibraryRow` 合并不必做额外适配。 */
interface LocalPendingRow {
  id: string;
  name: string;
  taskType: string;
  modes: string[];
  defaultMode: string | null;
  createdAt: string;
  paramMap: Record<string, unknown>;
  sourcePath: string;
  sourceRoot: string | undefined;
  source: "local-pending";
  typeLabel: string;
  typeCategory: string;
  typeDescription: string;
  isGenerative: boolean;
  hasRaw: boolean;
  usable: boolean;
  preview: { nodes: unknown[]; edges: unknown[]; w: number; h: number };
  workflowIO: WorkflowIOMap;
  modelTags: string[];
  pending: boolean;
  pendingSize: number;
  pendingMtime: number;
}

/* 按 `localWorkflows.pathKey` 的同一口径归一化绝对路径。 */
function pathKey(p: string): string {
  if (!p) return "";
  try {
    return normalizeSlashes(path.resolve(p).toLowerCase()).replace(/\/+$/, "");
  } catch {
    return normalizeSlashes(p.toLowerCase()).replace(/\/+$/, "");
  }
}

/* 找出「`absPath` 是 `filePath` 路径前缀」的那个已配置根目录。 */
function findRootFor(
  filePath: string,
  roots: Array<{ rawPath: string; absPath: string }>,
): string | undefined {
  if (!filePath || roots.length === 0) return undefined;
  const target = pathKey(filePath);
  if (!target) return undefined;
  let best: { len: number; raw: string } | undefined;
  for (const r of roots) {
    const rk = pathKey(r.absPath);
    if (!rk) continue;
    const exact = target === rk;
    const child = target.startsWith(rk + "/");
    if (!exact && !child) continue;
    if (!best || rk.length > best.len) {
      best = { len: rk.length, raw: r.rawPath };
    }
  }
  return best?.raw;
}

function normalizePathKey(p: string): string {
  try {
    return path.resolve(p).replace(/\\/g, "/").toLowerCase();
  } catch {
    return p.replace(/\\/g, "/").toLowerCase();
  }
}

/** 允许导入本地工作流的目录集合（与本地工作流扫描器同源，单一事实来源）。
 *
 *  读 `LOCAL_WORKFLOWS_PATH` 与 `getLocalWorkflowRoots` 同走 `readEnvVar`：
 *  此前守卫用 `process.env`（启动快照），.env 新增目录后扫描器看得到、
 *  守卫却拒绝——「界面给得出待导入项、点了导入被拒」的死胡同。 */
function getAllowedLocalWorkflowRoots(): string[] {
  const derived = deriveComfyuiWorkflowsDir(getSettingsSync().comfyuiPath);
  const extra = (readEnvVar("LOCAL_WORKFLOWS_PATH") ?? "")
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);
  return derived ? [derived, ...extra] : extra;
}

/** 判定 absPath 是否落在允许导入的根目录内（忽略大小写 / 正反斜杠）。 */
function isWithinAllowedLocalWorkflowRoot(absPath: string): boolean {
  const key = normalizePathKey(absPath);
  return getAllowedLocalWorkflowRoots().some((root) => {
    const rk = normalizePathKey(root);
    return key === rk || key.startsWith(rk + "/");
  });
}

export {
  executionShapeOf,
  pendingId,
  getLocalWorkflowRoots,
  pathKey,
  findRootFor,
  normalizePathKey,
  getAllowedLocalWorkflowRoots,
  isWithinAllowedLocalWorkflowRoot,
};
export type { LocalPendingRow };
