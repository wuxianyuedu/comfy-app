/**
 * 缓存根的**推导家**（ISSUE #2525 / #2503 / #2158 的共用底座）+ 槽锁文件名（#3479 裁剪后）。
 *
 * ## 这份文件现在是什么
 *
 * 它曾经是**依赖面缓存槽**的键控与计划读数（#2022：`planSlot` 三档 / `listSlots` 配额
 * 读数 / `main()` 的 `缓存槽读数` 格）。依赖面那套槽的执行面已随 #3378 薄化消失
 * （`COMFY_CI_SLOT` 无任何置点），#3479 按退役把那半边剪掉 —— 三档计划、配额 / TTL、
 * 淘汰器与 CLI 读数都不在了，机制与实测记录在规范 §13.5.3.4.3 与 §13.5.37。
 *
 * 留下来的是**四套根共用的一份推导**与执行档的锁文件名：
 *   · `resolveBuildCacheRoot` —— 构建缓存槽（`ci-build-cache-slot.mjs`，Turbopack 持久缓存）；
 *   · `resolveArtifactRoot` —— 成品目录（`publish-desktop-bundle.mjs`）；
 *   · `resolveToolRoot` —— 第三方构建工具镜像（`tauri-tools-cache.mjs` / `ci-actionlint.mjs`）；
 *   · `SLOT_LOCK_FILE` —— 槽锁文件名（`ci-slot-apply.mjs` 的锁原语写它）。
 *
 * 为什么四套根共用一份推导：两处各问一次 `pnpm store path` 就会有两份「槽在哪」的答案，
 * 而它们必须同源 —— 「构建缓存槽在 F:、成品目录在 G:」没有任何好处，只会让人以为那是
 * 故意的（§12.12：同一件事只允许一处实现）。
 */

import fs from "node:fs";
import path from "node:path";

/**
 * 成品目录（安装包）的根由环境变量给出；没配就从 store 所在卷推导（见 `resolveArtifactRoot`）。
 */
export const ARTIFACT_ROOT_ENV = "COMFY_CI_ARTIFACT_ROOT";

/**
 * 第三方构建工具镜像的根（见 `resolveToolRoot`）——它不是缓存，删了今天就没包。
 */
export const TOOLS_ROOT_ENV = "COMFY_CI_TOOLS_ROOT";

/**
 * 槽根的**两份事实**（卷根 + 包名）—— 四套根**共用**这一份推导。
 *
 * 为什么问 `pnpm store path` 而不是问 runner 目录或盘符：那条命令用的解析面与
 * `pnpm install` 在同一次构建里用的是**同一条**（实测随 cwd 变：从 `F:\AI\…` 答
 * `F:\.pnpm-store\v11`、从 `G:\runner` 答 `G:\.pnpm-store\v11`、从 `C:` 的用户临时目录
 * 答 `C:\Users\…\pnpm\store\v11`）。所以只要 store 搬到哪儿，根就跟到哪儿，不需要有人
 * 记得改配置 —— 而「有人记得改」正是被删掉的那个写死值的失效方式。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{volumeRoot: string | null, name: string, from: string}}
 */
function cacheRootFacts(io) {
  const run = io.run;
  if (!run) {
    return { volumeRoot: null, name: "", from: "无 pnpm 出口 ⇒ 不猜路径" };
  }
  const res = run(["store", "path"], { cwd: io.cwd });
  const store = String(res?.stdout ?? "").trim();
  if ((res?.status ?? 1) !== 0 || !store) {
    return { volumeRoot: null, name: "", from: "问不出 store ⇒ 不设根（宁可不省，也不猜一个卷）" };
  }
  let name = "repo";
  try {
    name = String(
      JSON.parse(fs.readFileSync(path.join(io.cwd, "package.json"), "utf8")).name ?? "repo",
    ).toLowerCase();
  } catch {
    /* 读不到包名就用一个中性目录名 —— 它只用于区分同机上的不同仓库。 */
  }
  return {
    volumeRoot: path.parse(store).root,
    name,
    from: `由 store ${store} 所在卷推导`,
  };
}

/**
 * **构建缓存槽**的根（`scripts/ci-build-cache-slot.mjs` 用它）。
 *
 * 与（已退役的）依赖面那套槽**同卷**、不同目录（`ci-build-cache/` 而不是 `ci-cache/`）——
 * 目录分离是既有事实：换根等于把机器上现存的缓存目录搬走，而各套的键域本来就不同。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}}
 */
export function resolveBuildCacheRoot(io) {
  const facts = cacheRootFacts(io);
  if (!facts.volumeRoot) {
    return { root: null, from: facts.from };
  }
  return {
    root: path.join(facts.volumeRoot, "ci-build-cache", facts.name),
    from: facts.from,
  };
}

/**
 * **成品目录**的根（`scripts/publish-desktop-bundle.mjs` 用它，ISSUE #2503）。
 *
 * 与构建缓存槽同卷、第二个目录（`ci-artifacts/<包名>`）。它是**第三个**目录而不是复用
 * 构建缓存的根的历史理由是「各自的键域互不相扰」；退役后这条边界继续成立 ——
 * 成品不是缓存：删了就没了，缓存删了只是下一次慢。
 *
 * 显式出口 `COMFY_CI_ARTIFACT_ROOT` 优先。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}}
 */
export function resolveArtifactRoot(io) {
  const explicit = String(io.env?.[ARTIFACT_ROOT_ENV] ?? "").trim();
  if (explicit) {
    return { root: explicit, from: `环境变量 ${ARTIFACT_ROOT_ENV}` };
  }
  const facts = cacheRootFacts(io);
  if (!facts.volumeRoot) {
    return { root: null, from: facts.from };
  }
  return {
    root: path.join(facts.volumeRoot, "ci-artifacts", facts.name),
    from: facts.from,
  };
}

/**
 * **第三方构建工具镜像**的根（`scripts/tauri-tools-cache.mjs` / `ci-actionlint.mjs` 用它，
 * ISSUE #2525）。它**不是缓存**：缓存删了只是下一次慢，这一份删了那条流水线今天就打不出包。
 *
 * 显式出口 `COMFY_CI_TOOLS_ROOT` 优先（一个变量只管自己那一套根）。
 *
 * @param {{cwd: string, env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} io
 * @returns {{root: string | null, from: string}}
 */
export function resolveToolRoot(io) {
  const explicit = String(io.env?.[TOOLS_ROOT_ENV] ?? "").trim();
  if (explicit) {
    return { root: explicit, from: `环境变量 ${TOOLS_ROOT_ENV}` };
  }
  const facts = cacheRootFacts(io);
  if (!facts.volumeRoot) {
    return { root: null, from: facts.from };
  }
  return {
    root: path.join(facts.volumeRoot, "ci-tools", facts.name),
    from: facts.from,
  };
}
