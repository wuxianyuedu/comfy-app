/**
 * snapshot-link.mjs —— 复算快照的**依赖链接**那一层（ISSUE #3043 拆出）。
 *
 * `base-check.mjs` 加上合并态那一档后越过 900 行硬闸（§12.6 R5 / infra 尺寸），
 * 而这一对函数是文件里**自包含**的一块：只碰 `fs` / `path`，不碰 git、不跑判据，
 * 且早就有自己的用例（`tests/base-check-snapshot-link.test.ts`）。拆的是职责，
 * 不是行数 —— 搬走之后两边的判据都不动。
 *
 * @module scripts/base-check/snapshot-link — 快照依赖链接（建 / 摘，无 git 依赖）
 */
import fs from "node:fs";
import path from "node:path";

/**
 * 把本检出的依赖树**链**进干净快照（符号链接，只读方向）。
 *
 * 为什么必须有：`git worktree add` 只检出受版本控制的文件，`node_modules`
 * 不在其中 —— 而复算批次里近一半判据要它（tsc / eslint / TS AST 那几条）。
 * 缺了它不是「跑不了」，而是**跑出一个看起来像红的读数**：Node 找不到模块时退出
 * 码是 1，与「判据跑了且红」同形，于是「合并后会不会红」这个问题的答案被污染。
 *
 * 只链 `node_modules` 这一项：其余缺件（`.env` / `db.sqlite` / `.next`）都在
 * 「判据自己该不该在快照上跑」的判定里 —— 要它们才跑得动的判据本就不该进这一批。
 *
 * 失败（已有同名目录 / 权限）不打红：那是「这一条判据在这个快照上跑不起来」，
 * 由 `inconclusive` 那一档接管，不是复算过程本身的失败。
 *
 * **返回值是这次真的建出来的链接路径**（没建则 `null`）—— 收尾**必须先摘它**，
 * 理由见 {@link unlinkDependencies}：`git worktree remove --force` 会**穿 junction 把
 * 链出去的那半边一起删掉**，而链出去的那半边就是调用者的工作树。
 *
 * @param {string} from 本检出根
 * @param {string} to 快照根
 * @returns {string | null} 建出来的 `node_modules` 链接路径
 */
export function linkDependencies(from, to) {
  const target = path.join(to, "node_modules");
  const source = path.join(from, "node_modules");
  if (fs.existsSync(target) || !fs.existsSync(source)) {
    return null;
  }
  try {
    fs.symlinkSync(source, target, "junction");
    return target;
  } catch {
    try {
      /* `junction` 是 Windows 上不需要提权的形态（`dir` 要开发者模式）；
       * POSIX 上没有这个 type，退回默认。 */
      fs.symlinkSync(source, target);
      return target;
    } catch {
      /* 链不上就让它按「没跑起来」报 —— 由 `inconclusive` 那一档说清楚。 */
      return null;
    }
  }
}

/**
 * 摘掉快照里那条 `node_modules` 链接 —— **只摘 reparse point 本身**。
 *
 * 为什么这一步是硬要求而不是优化：`git worktree remove --force` 与
 * `fs.rmSync(dir, {recursive:true})` 在 Windows 上都会**跟着 junction 走进目标目录**
 * 逐个删除（实测：临时 repo + worktree + 指回主树的 junction，一次
 * `git worktree remove --force` 之后主树的 `node_modules/.bin` 与根上的受版本
 * 控制文件一起没了）。也就是说这条链的方向是「快照 → 你的工作树」，
 * 清理快照就是清理你的工作树。而 `fs.rmSync(link, {recursive:false})` 对
 * reparse point **只删链接**（同一实测里主树毫发无损），所以顺序固定为：
 * **先摘链、后摘 worktree**。
 *
 * **两种形态走同一条路径**（ISSUE #2997）：同是「指向目录的链接」，junction 与 symlink
 * 在**外部命令**里的结果不同 —— 一次 `cmd /c rmdir` 摘得掉 junction，对 MSYS `ln -s`
 * 的 symlink 退 145 且链接仍在；收尾那串命令又常把退出码丢掉，留下的链接随后被
 * `git worktree remove --force` 穿进主检出。所以这里改走 Node 的原语阶梯
 * （`rmSync` → `rmdirSync` → `unlinkSync`），并且**只认 `lstat` 的在场/不在场**：
 * `existsSync` 对断链为假，不能当「摘掉了」的结论。
 *
 * @param {string | null} link {@link linkDependencies} 建出来的链接路径
 * @returns {boolean} 链接本体是否已经不在了（真目录或摘不掉 = false，调用方据此别再往下删）
 */
export function unlinkDependencies(link) {
  if (!link) {
    return true;
  }
  let stat;
  try {
    stat = fs.lstatSync(link);
  } catch {
    return true; // 本来就不在 = 已摘
  }
  if (!stat.isSymbolicLink()) {
    return false; // 真目录：不碰（可能已是别人装出来的树）
  }
  const primitives = [
    () => {
      fs.rmSync(link, { recursive: false, force: true });
    },
    () => {
      fs.rmdirSync(link);
    },
    () => {
      fs.unlinkSync(link);
    },
  ];
  for (const attempt of primitives) {
    try {
      attempt();
    } catch {
      /* 换下一个原语：两形在 Windows 上认的实现不同；POSIX 上第一个就够了。 */
    }
    if (!linkStillThere(link)) {
      return true;
    }
  }
  /* 摘不掉也不能继续走 `git worktree remove --force`：那一下会删到调用者的树。
   * 宁可乐意留下一个临时目录（在系统临时区，重启即清），也不许把销毁工作树
   * 当成一次复算的代价。 */
  return false;
}

/**
 * `existsSync` 对断链为假；这一格要问的是「链接本体还在不在」。
 *
 * @param {string} link 链接路径
 * @returns {boolean}
 */
function linkStillThere(link) {
  try {
    fs.lstatSync(link);
    return true;
  } catch {
    return false;
  }
}
