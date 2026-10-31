/**
 * 「探针要改真实入库文档」那一族的**隔离**口径 —— 一次性的 `git worktree` 克隆（ISSUE #2665）。
 *
 * ## 它补的是哪一格（与 `probe-restore.ts` 的分工）
 *
 * ISSUE #2593 把**还原**那一半修好了：还原只认「进本文件那一刻的字节快照」，不再拿
 * `git status` 当「探针留脏了」的证据去 `git checkout --`（那吃过两次未提交的文档改动）。
 * 但**读的那一侧仍然敞着**：这类用例的现场是「往真实入库文档改一笔 → 起子进程跑判据 → 还原」，
 * 于是从写入到还原之间，任何**并发读者**读到的都是探针那一笔，不是仓库事实。
 * vitest 按文件并行，而本仓已确认在场的读者不止一位：
 *
 * - `tests/comment-language.test.ts` 直读 `docs/reference-facts.md`（逐行找
 *   `comment.language.asciiOnly` 那一行，与解析结果逐项对）—— 而那份文件正在写探针的名单里；
 * - `tests/check-doc-references.test.ts` 自己每组探针都开着这么一段窗口，一次跑测十几组。
 *
 * 窗口长度当场量过：一次 `node scripts/check-doc-references.cjs` = **252ms / 242ms**
 * （同进程连跑两次，本机 ReFS）。这不是「偶尔撞上」的形状，是**每次都留着的那道口子**。
 *
 * ## 本件的做法
 *
 * 把探针整体搬进一份**一次性工作树克隆**：`git worktree add --detach <临时目录> HEAD`
 * 出一份干净快照，再把**当前工作树里脏的那几份**（含未跟踪、含已删除）覆盖进去 ——
 * 于是克隆是「此刻工作树的忠实副本」，判据在里面看到的与在真实树里看到的一样，
 * 而真实树**一次都不被写**。代价当场量：worktree add = **4.81s**（本机，3156 份文件），
 * 每个用例文件一次（不是每组探针一次），跑完 `worktree remove --force`。
 *
 * ⚠️ 两条边界，写在拿它的人眼前：
 * 1. **不许静默退回真实树**。建不出来就抛 —— 退回真实树等于把本件存在的全部理由关掉，
 *    而账面照样绿（用例本来就是这么过的）。
 * 2. 本件**不建 `node_modules` 的 junction**：判据与被测脚本只要 `node:` 内建 + 本地 `.cjs`
 *    （`check-doc-references.cjs` / `render-doc-placeholders.cjs` / `doc-facts.cjs` 三个的
 *    `require` 面当场看过，无第三方件），实测在裸工作树里都跑得起来。将来若真要在克隆里
 *    跑需要依赖的件，先读 `scripts/base-check.mjs` 文件头那段
 *    「**必须先摘 junction 再删 worktree**」—— 少那一步，`worktree remove` 会顺着链接
 *    删进调用者的 `node_modules`。
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/** 一份一次性克隆：`dir` 是它的工作树根，`dispose()` 注销它。 */
export interface ProbeTree {
  /** 覆盖进克隆的那些相对路径（带状态前缀）。出问题第一个该看的就是这份清单。 */
  carried: Array<string>;
  dir: string;
  dispose: () => void;
}

/** `git status --porcelain=v1 -z` 的一条记录。 */
interface StatusEntry {
  path: string;
  /** 两格状态码（`??` = 未跟踪） */
  xy: string;
}

/**
 * 解析 `-z` 形的工作树状态。
 *
 * 只认这一形、不认人读形：路径带空格或中文时人读形要靠猜引号，而 `-z` 是 NUL 分隔、
 * 无引号无转义。重命名/复制（`R`/`C`）会额外多出一个 NUL 分隔的**源**路径 —— 本件只要
 * 目的路径，所以按状态码决定要不要吞掉那一格（不吞就会把源路径当成又一条记录去复制，
 * 而那个源多半已经不存在）。
 */
function parseStatusZ(out: string): Array<StatusEntry> {
  const fields = out.split("\0");
  const entries: Array<StatusEntry> = [];
  for (let i = 0; i < fields.length; i += 1) {
    const field = fields[i];
    if (field === undefined || field === "") {
      continue;
    }
    const xy = field.slice(0, 2);
    const path = field.slice(3);
    entries.push({ xy, path });
    if (xy.startsWith("R") || xy.startsWith("C")) {
      i += 1;
    }
  }
  return entries;
}

/** 递归列出目录里的文件（不穿符号链接 —— 跟着走会把链接目标的内容搬进克隆）。 */
function listFilesRec(dir: string): Array<string> {
  const out: Array<string> = [];
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, ent.name);
    if (ent.isSymbolicLink()) {
      continue;
    }
    if (ent.isDirectory()) {
      out.push(...listFilesRec(abs));
    } else if (ent.isFile()) {
      out.push(abs);
    }
  }
  return out;
}

function git(cwd: string, args: Array<string>): string {
  return execFileSync("git", ["-C", cwd, ...args], {
    encoding: "utf8",
    maxBuffer: 1 << 26,
  });
}

/**
 * 落盘注入口。
 *
 * 只开 `copyFile` 一格，而它存在的理由是一条**必须能红**的性质：
 * 「`add` 成功之后中途抛错时，那条 worktree 登记有没有被注销」。不注入就只能靠真的
 * 把磁盘弄坏去测，那不可重复 —— 而这一格恰恰是本次改动里最容易悄悄漏掉的一条
 * （现场：第一版的 `sep` 写错，拷贝那一步当场抛，登记就留在了仓库上）。
 */
export interface ProbeTreeIo {
  copyFile: (src: string, dst: string) => void;
}

const realIo: ProbeTreeIo = {
  copyFile: (src, dst) => copyFileSync(src, dst),
};

/** 把一份文件拷进克隆（父目录按需建；目标落在克隆外一律抛）。 */
function copyInto(treeDir: string, dst: string, src: string, io: ProbeTreeIo): void {
  /* 分隔符用具名引入的 `sep`：写成 `resolve.sep` 是 undefined（`resolve` 是函数，
   * `sep` 挂在模块对象上），拼出来是「<克隆目录>undefined」⇒ 每次合法拷贝都会被
   * 这道守卫自己拦下。本件第一次跑就是这么红的 —— 守卫方向对，形状错。 */
  const root = treeDir.endsWith(sep) ? treeDir : treeDir + sep;
  if (dst !== treeDir && !dst.startsWith(root)) {
    throw new Error(`拒绝往克隆外写：${dst}（工作树根 ${treeDir}）`);
  }
  mkdirSync(dirname(dst), { recursive: true });
  io.copyFile(src, dst);
}

/**
 * 出一份一次性克隆（HEAD + 当前工作树里脏的那几份）。
 *
 * @param realRoot 真实仓库根（绝对路径）
 * @param io 落盘注入口（见 `ProbeTreeIo` 那段，只服务于「中途抛错要不要注销登记」那条）
 */
export function createProbeTree(realRoot: string, io: ProbeTreeIo = realIo): ProbeTree {
  const parent = mkdtempSync(join(tmpdir(), "doc-probe-tree-"));
  const dir = join(parent, "tree");
  try {
    git(realRoot, ["worktree", "add", "--detach", dir, "HEAD"]);
  } catch (e) {
    rmSync(parent, { recursive: true, force: true });
    throw new Error(
      `建一次性工作树克隆失败 —— 本件**不退回真实树**（那等于把隔离关掉而账面照样绿）：` +
        String(e instanceof Error ? e.message : e),
      /* cause 留着：这一句要说的是「不退回」这件事，而**为什么**建不出来是 git 的原文，
       * 少了 cause 排查的人只能去手跑一次 worktree add。 */
      { cause: e },
    );
  }
  const carried: Array<string> = [];
  /* `add` 之后到 `return` 之间的任何一步抛错，都必须先把这条登记注销掉再往外抛：
   * 只清 `parent` 目录不够 —— `.git/worktrees/` 里那条登记会留在**仓库**上，
   * 指向一个已经不存在的路径，而它进的是所有人以后每次 `git worktree list`。
   * 现场就是这么撞上的：本件第一版把 `sep` 写成 `resolve.sep`（undefined），
   * 拷贝那一步当场抛 ⇒ 一条登记留在了临时目录上。 */
  try {
    carryWorkingTreeChanges(realRoot, dir, carried, io);
  } catch (e) {
    try {
      git(realRoot, ["worktree", "remove", "--force", dir]);
    } catch {
      /* 注销也失败了：不吞掉原始的那一句（它才是本件要回答的问题），
       * 但要把这条留在哪说清楚，否则人只能自己 `git worktree list` 去撞。 */
      rmSync(parent, { recursive: true, force: true });
      throw new Error(
        `${String(e instanceof Error ? e.message : e)}` +
          ` —— 且克隆注销失败，需要手工执行：git worktree remove --force ${dir}`,
      );
    }
    rmSync(parent, { recursive: true, force: true });
    throw e;
  }
  return {
    dir,
    carried,
    dispose: () => {
      /* 先 `worktree remove`（它负责注销 `.git/worktrees/` 那条登记），再删临时目录：
       * 反过来的话登记会留在仓库里，指向一个已经不存在的路径。remove 失败也要把
       * 临时目录摘掉，但不能吞掉 remove 的错 —— 所以 try/finally 而不是 try/catch。 */
      try {
        git(realRoot, ["worktree", "remove", "--force", dir]);
      } finally {
        rmSync(parent, { recursive: true, force: true });
      }
    },
  };
}

/**
 * 把真实工作树里「与 HEAD 不同」的那几份搬进克隆（未跟踪的也搬，已删除的跟着删）。
 *
 * 单独成函数是为了让上面那段「抛错必须先注销登记」的因果只有一处，而不是散在循环里。
 */
function carryWorkingTreeChanges(
  realRoot: string,
  dir: string,
  carried: Array<string>,
  io: ProbeTreeIo,
): void {
  for (const { xy, path } of parseStatusZ(git(realRoot, ["status", "--porcelain=v1", "-z"]))) {
    const src = resolve(realRoot, path);
    const dst = resolve(dir, path);
    /* 「删了但没 stage」在 porcelain 里是 <空格>D（D 在**第二位**），stage 过的是 D<空格>：
     * 两形都算「这份在工作树里已经没有了」。本件第一版只查了第一位，于是真实树里
     * 删掉的那份在克隆里照样留着 HEAD 那一版 —— 而判据里恰好有一类格判的就是
     * 「这份文档在不在」，两边不一致就会造出一个真实树里不存在的结论。 */
    if (xy.includes("D")) {
      /* 真实树里已经删掉的那份，克隆里得跟着删：判据里恰好有一类格判「这份文档在不在」，
       * 两边不一致就会造出一个真实树里不存在的结论。 */
      rmSync(dst, { force: true });
      carried.push(`D ${path}`);
      continue;
    }
    if (!existsSync(src)) {
      continue;
    }
    if (lstatSync(src).isDirectory()) {
      /* 未跟踪**目录**在 porcelain 里是一条目录记录（不展开）⇒ 自己展开；
       * 不展开就等于「克隆里没有这批新文档」，而那正是探针要判的东西。 */
      for (const file of listFilesRec(src)) {
        const rel = relative(src, file).split(sep).join("/");
        copyInto(dir, join(dir, path, rel), file, io);
      }
      carried.push(`dir ${path}`);
      continue;
    }
    copyInto(dir, dst, src, io);
    carried.push(`${xy} ${path}`);
  }
}
