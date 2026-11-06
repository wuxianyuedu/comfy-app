#!/usr/bin/env node
/**
 * 构建缓存槽 —— 把 Turbopack 的**构建缓存**接到一个**常驻目录**上，
 * 让「换一个工作区路径再构建」不再从零编译（ISSUE #2158）。
 *
 * ## 它补的是哪一格（规范 §13.5.3.4.3 那张表里的 `.next` 那一行）
 *
 * 那一行此前写的是「`.next` 的键里带绝对路径 ⇒ 在「每跑换目录」下能省 0」。
 * **实测把这句话拆成了两半**：`.next` 里的**产物**确实带绝对路径（搬不动），
 * 而 **Turbopack 的持久缓存**（`<distDir>/cache`）**换路径照样命中** ——
 * 本机同日同源三跑（`next build` 自报的编译段）：
 *
 * | 跑 | 缓存目录 | 编译段 | 总墙钟 |
 * | --- | --- | --- | --- |
 * | 冷 | 一个**空**目录 | `Compiled successfully in 95s` | 135.7s |
 * | 暖 | **上一个工作区**留下的常驻目录 | `Compiled successfully in 14.9s` | 55.0s |
 * | 暖 + 改了源码 | 同上 | `Compiled successfully in 14.8s` | 88.3s |
 *
 * ⇒ **省的是整个编译段（95s → 14.9s）**，而第三跑那一行是这份机制的**正确性**证据：
 * 改了源码再用同一份缓存重建，产物里出现了新源码的内容（18 个文件命中哨兵，
 * 0 个陈旧）—— 缓存按内容失效，不按路径失效。
 *
 * ## 机制（四步，每一步都能单独不成立而不影响构建）
 *
 * ① **槽根**：与依赖面那套槽**同一个推导**（问 `pnpm store path` 取它所在卷，
 *    再拼 `ci-build-cache/<包名>`）—— 写在 `ci-cache-slot.mjs` 的 `resolveBuildCacheRoot`
 *    里，两处各问一次 store 就会有两份「槽在哪」的答案（§12.12）。
 * ② **构建面指纹**：`pnpm-lock.yaml` / `package.json` / `next.config.js` /
 *    `tsconfig.json` 四份的**内容** sha256 ⇒ 槽按面分目录。工具链变了就换一份目录，
 *    旧目录整棵可删（那是我们自己的边界；Turbopack 内部那份不是）。
 * ③ **接槽**：`<仓库>/.next/cache` ← **junction** → `<槽根>/<面指纹>`。
 *    Next 往里写就是往常驻目录写（实测：构建后 `.next/cache` 仍是链接，缓存目录体积在长）。
 * ④ **收尾**：摘链 + 放锁（`finally` 里做，构建失败也收）。
 *
 * ## 边界（逐条**实测**过，不是推的）
 *
 * · **runner 收尾不穿链**：平台那句 `Remove-Item -Path <workspace> -Recurse -Force`
 *   实测**不跟着链接删**（链接在 `.next/cache` 与在 `.next` 两种嵌套形态各测一次），
 *   所以常驻目录活得过作业结束。
 * · **换路径照样命中**（上表第二行：暖缓存是在**另一个工作区**留下的）。
 * · **改了源码不会给出陈旧产物**（上表第三行 + 哨兵）。
 * · **`.next/cache` 已经是一个真实目录 ⇒ 这一跑不接槽**（本地形态：`.next` 是上一跑
 *   留下的）。接上去要删掉本地那份缓存 —— 那是对工作区的副作用，不该由一个缓存机制
 *   顺手做掉。CI 形态（工作区全新）不受这条限制。
 * · **任何一步不成立都退回「照常构建」**：开关、槽根、指纹、空间四道门任一不成立，
 *   或者那把单写锁没抢到，就只打一行读数，不改行为。缓存是**加速**，不是**前提**。
 *
 * ## 开关
 *
 * `COMFY_CI_BUILD_CACHE=1` 才接（默认关）。理由与依赖面那套槽同源：先让判据在场，
 * 再把开关拨过去（规范 §13.5.25）。唯一拨上它的地方是平台的「每日生产构建」那一格
 * （`ci-daily-build.mjs` → `artifact-run.mjs` → `pnpm run build`），因为那是这台节点上
 * 唯一每天都会发生的构建。
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

import { resolveBuildCacheRoot } from "./ci-cache-slot.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";
import { acquireSlotLock, hasRoomForSlot } from "./ci-slot-apply.mjs";

const HERE = import.meta.dirname;
const ROOT = path.resolve(HERE, "..");

/** 开关：置着才接槽（默认关）。 */
export const BUILD_CACHE_ENABLED_ENV = "COMFY_CI_BUILD_CACHE";

/**
 * 构建面：碰了任一项，槽就不是同一份（工具链 / 配置变了）。
 *
 * ⚠️ **不含源码**：源码变了不该换槽 —— 换槽等于丢掉缓存，而 Turbopack 自己按**内容**
 * 失效（上面第三跑那行实测）。把源码算进键会把这份机制的收益整个吃掉。
 */
export const BUILD_FACE_FILES = [
  "pnpm-lock.yaml",
  "package.json",
  "next.config.js",
  "tsconfig.json",
];

/** 槽目录名用的面指纹长度（16 位十六进制 —— 够分辨，且目录名不至于太长）。 */
const FACE_DIR_LEN = 16;

/**
 * 构建面的**内容**指纹（读不到任一份就回 null —— 调用方据此不接槽）。
 *
 * @param {string} root 仓库根
 * @returns {string | null}
 */
export function buildFaceFingerprint(root) {
  const hash = crypto.createHash("sha256");
  for (const file of BUILD_FACE_FILES) {
    try {
      hash.update(file);
      hash.update(fs.readFileSync(path.join(root, file)));
    } catch {
      return null;
    }
  }
  return hash.digest("hex");
}

/**
 * 槽目录：`<槽根>/<面指纹>`。
 *
 * @param {string} root 槽根
 * @param {string} face 面指纹
 * @returns {string}
 */
export function buildCacheSlotPath(root, face) {
  return path.join(root, face.slice(0, FACE_DIR_LEN));
}

/**
 * 这一跑要不要接槽 —— 纯函数，把四道门各自的结论收成一句话。
 *
 * 为什么不合成一档：四道门各自的失败形状不同（开关没开 / 槽根算不出 / 面算不出 /
 * 工作区里已有缓存 / 空间不够），合成一档之后日志上那句「不接槽」就说不清是哪一种。
 * （单写锁是**接上之后**才拿的 —— 拿不到锁时那一档另有话说，见 {@link withBuildCacheSlot}。）
 *
 * @param {{enabled: boolean, cacheRoot: string | null, face: string | null,
 *   localCachePresent: boolean, spaceOk: boolean}} input
 * @returns {{action: "link" | "no-cache", path: string | null, why: string}}
 */
export function planBuildCache(input) {
  const { enabled, cacheRoot, face, localCachePresent, spaceOk } = input;
  if (!enabled) {
    return {
      action: "no-cache",
      path: null,
      why: `开关 ${BUILD_CACHE_ENABLED_ENV} 没置着 ⇒ 不接槽（缓存是加速，不是前提）`,
    };
  }
  if (!cacheRoot) {
    return { action: "no-cache", path: null, why: "算不出槽根 ⇒ 不接槽" };
  }
  if (!face) {
    return { action: "no-cache", path: null, why: "算不出构建面指纹 ⇒ 不接槽" };
  }
  if (localCachePresent) {
    return {
      action: "no-cache",
      path: null,
      why:
        "工作区里已经有 `.next/cache`（真实目录，本地形态）⇒ 不接槽：" +
        "接上去要删掉本地那份缓存，那是对工作区的副作用，不该由缓存机制顺手做掉",
    };
  }
  if (!spaceOk) {
    return { action: "no-cache", path: null, why: "空闲空间不够 ⇒ 不接槽" };
  }
  return {
    action: "link",
    path: buildCacheSlotPath(cacheRoot, face),
    why: "四道门都成立 ⇒ 把 `.next/cache` 接到常驻目录",
  };
}

/**
 * Node 在 `catch` 里给的是 `unknown`，而这里要的只有那一格 `code`。
 *
 * @param {unknown} err
 * @returns {string}
 */
function errCode(err) {
  if (typeof err === "object" && err !== null && "code" in err) {
    return String(/** @type {{code?: unknown}} */ (err).code);
  }
  return String(err);
}

/**
 * 「那个路径上有没有东西」—— **lstat**，不是 `existsSync`。
 *
 * `existsSync` **跟链走**：一个**悬空**的链接（目标已被删）会被读成「不在」⇒ 于是去建链接
 * ⇒ 撞 `EEXIST`。本机实测踩到过这个形态（一次实验把 `.next/cache` 指到后来删掉的目录）。
 *
 * @param {string} p
 * @returns {boolean}
 */
function pathOccupied(p) {
  try {
    fs.lstatSync(p);
    return true;
  } catch {
    return false;
  }
}

/**
 * 把 `<仓库>/.next/cache` 接到槽上（junction），并给一条**收尾**动作。
 *
 * ⚠️ **摘链不许穿链**：Windows 上删一个目录链接要删「链接本身」而不是「它指着的目录」。
 * `fs.rmSync(link, { recursive: true })` 走的是 lstat —— 链接被判成符号链接 ⇒ 删链接，
 * 不动目标（Node 的 rimraf 对符号链接是 unlink，不是递归进去）。
 * 这条边界**必须**成立：穿链删 = 一次构建把常驻缓存整个删掉（§13.5.3.4.3 第 3 条同族）。
 *
 * @param {{repoRoot: string, slotDir: string}} io
 * @returns {{linked: boolean, why: string, restore: () => void}}
 */
export function linkBuildCache(io) {
  const { repoRoot, slotDir } = io;
  const nextDir = path.join(repoRoot, ".next");
  const link = path.join(nextDir, "cache");
  const noop = { linked: false, why: "没接上", restore: () => {} };
  if (pathOccupied(link)) {
    return {
      ...noop,
      why: "`.next/cache` 那个路径上已经有东西（目录或链接，含悬空的）⇒ 不接槽",
    };
  }
  try {
    fs.mkdirSync(nextDir, { recursive: true });
    fs.mkdirSync(slotDir, { recursive: true });
    fs.symlinkSync(slotDir, link, process.platform === "win32" ? "junction" : "dir");
  } catch (error) {
    return { ...noop, why: `建链接失败（${errCode(error)}）⇒ 不接槽` };
  }
  return {
    linked: true,
    why: `已把 .next/cache 接到 ${slotDir}`,
    restore: () => {
      try {
        fs.rmSync(link, { recursive: true, force: true });
      } catch {
        /* 摘链失败不该把构建的结论改掉 —— 它只会在下一跑表现为「`.next/cache` 已存在」。 */
      }
    },
  };
}

/**
 * 在「缓存槽已接上」的状态下跑一段东西，**收尾一定做**（构建失败也收）。
 *
 * 这一层是**库**而不是命令外壳：接线在 `artifact-run.mjs` 里（那一格是这台节点上
 * 唯一每天都会发生的构建），外面不再套一层进程 —— 多一层进程就多一份「谁负责摘链」
 * 的含糊。
 *
 * @template T
 * @param {() => T} run 要跑的东西（返回值原样传出）
 * @param {{cwd?: string, env?: Record<string, string | undefined>,
 *   log?: (line: string) => void,
 *   hasRoom?: (path: string) => {ok: boolean},
 *   cacheRoot?: string,
 *   runStorePath?: (args: string[], opts: object) => {status: number | null, stdout?: string}}} [io]
 * @returns {T}
 */
export function withBuildCacheSlot(run, io = {}) {
  const cwd = io.cwd ?? ROOT;
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const runStorePath =
    io.runStorePath ?? ((args, opts) => runPnpmSync(args, { ...opts, stdio: "pipe" }));
  /* 空间闸门的探针可注入：它答的是「卷上还够不够」，而用例不该因为某台机器当时盘满
     而红（那是环境事实，不是判据的结论）。 */
  const hasRoom = io.hasRoom ?? ((p) => hasRoomForSlot({ path: p }));
  const enabled = String(env[BUILD_CACHE_ENABLED_ENV] ?? "").trim() === "1";

  /* 槽根可注入：POSIX 上卷根 `/` 不可写，而槽根按设计就落在卷根下 —— 那是**平台
     事实**，不该让用例红（#3095）。生产路径永远走推导；用例注入只是换一个可写目录。 */
  const resolved = io.cacheRoot
    ? { root: io.cacheRoot, from: "用例注入" }
    : resolveBuildCacheRoot({ cwd, env, run: runStorePath });
  const face = buildFaceFingerprint(cwd);
  const localCachePresent = pathOccupied(path.join(cwd, ".next", "cache"));
  const spaceOk = resolved.root ? hasRoom(resolved.root).ok : false;

  const plan = planBuildCache({
    enabled,
    cacheRoot: resolved.root,
    face,
    localCachePresent,
    spaceOk,
  });
  log(`[构建缓存槽] 槽根来源：${resolved.from}`);
  log(
    `[构建缓存槽] 面 ${(face ?? "取不到").slice(0, 12)}·结论 ${plan.action}${plan.path ? `·槽 ${plan.path}` : ""}`,
  );
  log(`[构建缓存槽]   ${plan.why}`);

  if (plan.action !== "link" || !plan.path || !resolved.root) {
    return run();
  }

  /* 锁在**槽根**上而不是槽目录上：同一台机上的两个作业共用一个槽根，
     而它们各自的槽目录（面指纹）不同 —— 锁住槽根等于「这个仓库一次只跑一个构建」，
     正好是「同一份缓存不被两个写者同时写」需要的那一条。
     抢不到就**不接槽**（而不是等）：等会把这一格的墙钟拖成另一跑的两倍。 */
  try {
    fs.mkdirSync(resolved.root, { recursive: true });
  } catch {
    /* 建不出来就当没锁到（下面那次抢锁会失败 ⇒ 不接槽）。 */
  }
  const lock = acquireSlotLock({ slot: resolved.root });
  if (!lock.acquired) {
    log(`[构建缓存槽]   抢锁失败：${lock.why} ⇒ 不接槽`);
    return run();
  }
  const link = linkBuildCache({ repoRoot: cwd, slotDir: plan.path });
  if (!link.linked) {
    log(`[构建缓存槽]   ${link.why}`);
    lock.release();
    return run();
  }
  log(`[构建缓存槽]   ${link.why}`);
  try {
    return run();
  } finally {
    link.restore();
    lock.release();
    log("[构建缓存槽] 已摘链并放锁（常驻目录留着，下一跑接着用）");
  }
}
