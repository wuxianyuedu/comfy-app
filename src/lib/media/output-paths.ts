/* 任务产物（生成的图 / 视频 / 音频）在「磁盘」与「浏览器地址」两个命名空间里的
 * 同一套布局 —— 只在这里定义一次。
 *
 * 为什么单独一处（规范 §12.12：跨文件不许复制实现）：
 * 同一句「project 任务是 `public/generated/projects/<pid>/<tid>`、其余是
 * `public/generated/<tid>`」此前被三个调用点各自拼一遍 ——
 *   · `executor-finalize` 按它 `mkdir` 落盘，并把 `/api/generated/...` 写进
 *     `TaskImage.localPath`；
 *   · `task.openFolder` 按它算「在文件夹里打开」的目录；
 *   · `task.delete` 按它删目录。
 * 前两处认 `projects/<pid>/<tid>`，第三处只认 `<tid>`，于是**删除项目里的任务
 * 从来没删掉过产物目录**（磁盘单调增长）；同一函数里逐张 `unlink` 的那条路径又
 * 把 `localPath` 解析成 `public/api/generated/...`（多了一段 `api`）而永远
 * ENOENT。两条失败都被 `.catch(() => undefined)` 吞掉，所以既没有日志、也没有
 * 任何数字会动 —— 这正是「分叉靠记忆保持一致」防不住的那类问题。
 *
 * 附带收口的是**越界判据**：`projectId` 由客户端生成、`taskId` 由服务端生成，
 * 落盘侧此前没有任何包含校验，一个形状为 `../../x` 的 projectId 就能把产物写到
 * 产物根之外（而 `/api/generated/[...path]` 的白名单只认根内，写出去就读不到）。
 * `taskOutputDir()` 把「算目录」和「判越界」绑成同一次调用，返回 null 让调用点
 * 自己处置：打开 → FORBIDDEN，删除 → 什么都不删，落盘 → 硬失败。
 *
 * 现在吃这份定义的四处：`executor-finalize`（落盘 + 写 localPath）、
 * `task.openFolder`、`task.delete`、`/api/generated/[...path]`（产物根与根内判据）。
 *
 * **本层同时是「地址 → 磁盘」的唯一映射**（`artifactDiskPath()`）：素材库、工坊媒体源、
 * 首帧、成片合成四处原先各自解析同一个地址，而两份实现**结论相反** ——
 * `firstframe.ts` 剥了 `api/` 段、`compose-steps.ts` 只剥前导斜杠，于是后者把
 * `/api/generated/…` 解析成 `public/api/generated/…`（该目录不存在），
 * 「合成成片」对每一条由执行器产出的镜头都必败（台账 A8 那条 ENOENT 的第二处幸存）。
 * 子层（`materials/`、`films/`、`films/bgm/`）的磁盘位置也都从 `generatedRoot()` 派生，
 * 任何一处再写 `"public", "generated"` 字面量都由
 * `tests/artifact-layout-single-source.test.ts` 拦下。 */
/* §18.4 三选一：走第三类（纯 Node 地基，登记在
 * `tests/lib-node-only-declarations.test.ts` 的 `PURE_NODE_HOSTS`）。
 * 理由是这一层的消费方本来就跨宿主：Next 侧的 `task.openFolder` / `task.delete`
 * 与执行器宿主的 `executor-finalize` 落盘必须算出同一个目录，而
 * `executor-finalize.ts` 按它自己头部的约定**不保留任何 server-only 侧静态边**
 * （它的入口在纯 Node 宿主里加载，`server-only` 的入口是 throw）—— 给它挂声明
 * 就等于把「布局只有一处定义」重新拆成两份。 */
import path from "path";

/** 产物根：`<cwd>/public/generated`，也就是 `/api/generated/[...path]` 服务的那一层。 */
export function generatedRoot(cwd: string = process.cwd()): string {
  return path.resolve(cwd, "public", "generated");
}

/** `abs` 是否「等于产物根」或「落在产物根之下」。
 *  用 `path.sep` 收边界：`abs.startsWith(root)` 这种写法会把同级的
 *  `public/generatedX` 也算进来（前缀相同，并不是子路径）。
 *  第二个参数允许换一格比（素材库拿 `materials/` 当根来判同一件事），
 *  判据仍只有这一处。 */
export function isWithinGeneratedRoot(
  abs: string,
  root: string = generatedRoot(),
): boolean {
  return abs === root || abs.startsWith(root + path.sep);
}

/** 产物地址的前缀：写侧唯一的形状来源（`taskOutputUrl` 与 film / materials 共用）。
 *  读侧还认历史留下的 `/generated/…`，见 `artifactDiskPath()`。 */
export const ARTIFACT_URL_PREFIX = "/api/generated";

/** 由「根内相对段」拼产物地址。film / materials 各自重抄前缀就会分叉 ——
 *  A8 那批的教训是同一句布局被三个调用点各拼一遍，其中一个还拼错了。 */
export function artifactUrl(segments: readonly (string | number)[]): string {
  return `${ARTIFACT_URL_PREFIX}/${segments.join("/")}`;
}

/** 素材库子层（用户手工丢进盘的文件）。归属判据在 `materials.ts`，位置在这里。 */
export function materialsRoot(root: string = generatedRoot()): string {
  return path.join(root, "materials");
}

/** 成片与配乐的子层。写侧（`compose-film`）、上传侧（`/api/film/bgm`）与归属判据
 *  （`output-access` 的 `films/bgm` 无主条目）都从这里派生。 */
export function filmsRoot(root: string = generatedRoot()): string {
  return path.join(root, "films");
}

export function filmBgmRoot(root: string = generatedRoot()): string {
  return path.join(filmsRoot(root), "bgm");
}

/** 「地址 → 磁盘绝对路径」的唯一映射。两种形状都吃：写侧的 `/api/generated/…`
 *  与静态直发时代留在老数据里的 `/generated/…`。
 *
 *  返回 `null` 的两种情况由调用点各自处置（口径同 `taskOutputDir()`：判据只写一份、
 *  处置留在调用点）：「这根本不是产物地址」与「解出来的位置在产物根之外」。
 *
 *  剥 `api/` 那一段是这条判据存在的理由：`compose-steps.ts` 曾只剥前导斜杠，
 *  于是执行器写进 `TaskImage.localPath` 的 `/api/generated/…` 被解析成
 *  `public/api/generated/…`（该目录不存在），ffmpeg 每次都报「没有这个文件」，
 *  「合成成片」对每一条镜头必败。
 *
 *  百分号编码：地址由请求方/画布数据给，坏编码不是越权，但也不能顺着半截字符串
 *  去读盘 —— 判成「不是产物地址」。`path.resolve` 会把以 `/` 开头的残留段当绝对路径，
 *  那种位置一定在根外，因此同样落到 `null`。 */
export function artifactDiskPath(
  url: string,
  root: string = generatedRoot(),
): string | null {
  const matched = /^\/(?:api\/)?generated\/(.+)$/.exec(url)?.[1];
  if (!matched) return null;
  let decoded: string;
  try {
    decoded = decodeURIComponent(matched);
  } catch {
    return null;
  }
  const abs = path.resolve(root, path.normalize(decoded));
  return isWithinGeneratedRoot(abs, root) ? abs : null;
}

/** 布局的唯一形状来源：project 任务在 `projects/<projectId>/<taskId>` 下，
 *  其余直接在 `<taskId>` 下。磁盘与 URL 两条出口都由它派生，不再各写一遍。 */
export function taskOutputSegments(
  taskId: string,
  projectId?: string | null,
): string[] {
  return projectId ? ["projects", projectId, taskId] : [taskId];
}

/** 浏览器地址前缀：写进 `TaskImage.localPath` / `resultImages` 的那一段。 */
export function taskOutputUrl(
  taskId: string,
  projectId?: string | null,
): string {
  return artifactUrl(taskOutputSegments(taskId, projectId));
}

/** 任务产物目录的绝对路径；当 `taskId` / `projectId` 的形状会让结果落到产物根
 *  之外、或**根本就不是一个任务目录**（空串、`.` —— 解析结果就是产物根本身）时
 *  返回 `null`（而不是抛）。
 *
 *  为什么这里比 `isWithinGeneratedRoot()` 还严一档：调用点拿它做的是
 *  `fs.rm(dir, { recursive: true })` 与「在文件夹里打开」，把产物根本身当成
 *  某个任务的目录返回，等于允许「删掉全部产物」或把整个根暴露给用户。
 *  越界的处置方式三个调用点各不相同，所以判据只写一次、处置留在调用点。 */
export function taskOutputDir(
  taskId: string,
  projectId?: string | null,
  root: string = generatedRoot(),
): string | null {
  const abs = path.resolve(root, ...taskOutputSegments(taskId, projectId));
  if (abs === root) return null;
  return isWithinGeneratedRoot(abs, root) ? abs : null;
}
