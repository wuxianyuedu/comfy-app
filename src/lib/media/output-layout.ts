/* 产物布局里「不需要文件系统就能算出来」的那一半 —— 纯字符串，浏览器安全。
 *
 * 为什么要单独一层（规范 §18.4 / §12.12）：`./output-paths.ts` 是纯 Node 地基
 * （它 `import path`，所以视图层引不到 —— 客户端打包判据
 * `tests/client-bundle-node-builtins.test.ts` 会拦），但界面里确实要告诉用户
 * 「文件落在哪儿」，于是这一句形状曾经被抄进组件的文案字面量里。抄的那一份
 * 不会随搬迁而红，表现是「界面让人去翻一个已经不存在的目录」。
 *
 * 分工因此是：本模块定义**形状**（目录名、子层名、URL 前缀、相对段），
 * `output-paths.ts` 在它之上做**磁盘解析**（绝对路径、越界判据）。
 * 两边不许出现第二份字面量（`tests/artifact-layout-single-source.test.ts` 判）。
 */

/** 产物根相对应用根的目录名（`<cwd>/generated`；以前是 `public/generated`，见台账 A13）。 */
export const ARTIFACT_ROOT_DIR = "generated";

/** 历史落点的两段（只给一次性搬迁用；界面向用户说话时**不许**用它）。 */
export const LEGACY_ARTIFACT_ROOT_DIRS = ["public", ARTIFACT_ROOT_DIR] as const;

/** 画布项目任务的子层名。 */
export const PROJECTS_SUBDIR = "projects";

/** 产物地址前缀：写侧唯一的形状来源，也是**对外承诺** ——
 *  库里存的正是它（`TaskImage.localPath` / `Film.localPath`），
 *  磁盘根将来搬到哪都不能改这个前缀，否则历史产物全部读不到。 */
export const ARTIFACT_URL_PREFIX = "/api/generated";

/** 由「根内相对段」拼产物地址。film / materials 各自重抄前缀就会分叉（台账 A8）。 */
export function artifactUrl(segments: readonly (string | number)[]): string {
  return `${ARTIFACT_URL_PREFIX}/${segments.join("/")}`;
}

/** 布局的唯一形状：project 任务在 `projects/<projectId>/<taskId>` 下，其余直接在 `<taskId>` 下。
 *  磁盘与 URL 两条出口都由它派生。 */
export function taskOutputSegments(
  taskId: string,
  projectId?: string | null,
): string[] {
  return projectId ? [PROJECTS_SUBDIR, projectId, taskId] : [taskId];
}

/** 浏览器地址前缀：写进 `TaskImage.localPath` / `resultImages` 的那一段。 */
export function taskOutputUrl(
  taskId: string,
  projectId?: string | null,
): string {
  return artifactUrl(taskOutputSegments(taskId, projectId));
}

/** 给人看的**相对**落点（`generated/projects/<pid>/<tid>/`）。
 *  相对应用根而不给绝对路径：那台机器上根在哪儿由壳 / launcher 决定，
 *  界面写死一个绝对形状就一定会说错。 */
export function artifactDirDisplay(
  taskId: string,
  projectId?: string | null,
): string {
  return `${ARTIFACT_ROOT_DIR}/${taskOutputSegments(taskId, projectId).join(
    "/",
  )}/`;
}
