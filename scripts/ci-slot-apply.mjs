/**
 * 缓存槽的**执行档**（ISSUE #2022 第二步的第二增量）：把 `planSlot` 那三档读数变成动作 ——
 * 装进槽、把整棵 `node_modules` 接进作业、并补上接不过去的那一笔。
 *
 * ## 四条实测（机制是照着这四个数写的，不是反过来；规范 §13.5.3.4.3）
 *
 * 1. **接过去对 `tsc` / `vitest` 是干净的，对 `next build` 不是**：`node_modules` 整体接成
 *    junction 的作业检出上，`tsc --noEmit` 退 0、零诊断（干净检出没有 `.next/`，这一条不依赖它），
 *    `vitest` 三份 29 条全绿 ——
 *    其中 `check-allow-builds` 那条判据是**真去走 `node_modules/.pnpm` 的事实**的，
 *    `db-schema-ready` 那条要 `require` 到原生 `.node`。建链的实测代价 **12 KB**。
 *    ⚠️ 这半句是**同一条链上第三个消费者**教的（ISSUE #2081，2026-10-21）：Turbopack 对
 *    `[project]/node_modules` 有「不许指向项目根之外」的要求，接槽形态下它当场
 *    `Symlink … is invalid, it points out of the filesystem root`。而本仓 PR 那条流水线
 *    2026-10-18 起不跑构建（规范 §13.5.23），所以这条链**从来没有**在 PR 上被它的构建消费者
 *    拒绝过 —— 第一次遇到就是每日档红的那天。处置见下面「开关」那一节。
 * 2. **冷装那一跳才是被省的东西**：节点侧 2026-10-20 同日同机三档（各跑自己的打印）——
 *    普通装 `Done in 51s`、为该键第一次建槽 `Done in 1m 9.2s`、命中时整步 ≈2s。
 *    ⇒ 命中省 ≈49s，但**未命中比不建槽贵 18s**，所以盈亏平衡是「每个键至少命中一次」；
 *    本机那两个数（全量检出 69s / 只放依赖面输入 52.6s）只当形状看，不当节点系数用。
 * 3. **槽的净成本不是 GB 级**：一份装出来的 `node_modules` 表观 982 MiB / 83,664 个文件，
 *    其中只有 2,599 个（3.1%）是 `nlink==1` 的独占数据、合计 1.7 MiB；删掉之后磁盘实测
 *    **回收 52 MiB**（其余是目录项）。所以配额按「个」定，不按「GB」定。
 * 4. **槽里只需要依赖面那几份输入**：拿 `DEP_FILES` + `patches/` 装出来的闭包与拿整棵
 *    检出装的**逐条相同**（虚拟 store 1379 vs 1379，两侧差集均为 0），前提是把
 *    `package.json` 自己的 `scripts` 摘掉。摘它不是省事：本仓那条 postinstall 写的是
 *    **检出的 `.git/config`**（`core.hooksPath` + `git lfs install --local --manual`），
 *    那不在 `node_modules` 里、接槽接不过来 —— 于是由作业自己补（`runJobLifecycle`）。
 *
 * ## 开关：按档拨（PR 接、每日不接）
 *
 * `Install dependencies` 每一次构建都过，它红了后面就没有任何一步。把「机制」与
 * 「换执行者」同批推上去的形态是一次键算错就让所有 PR 装不上 —— 与本仓在档位那一刀上
 * 立的纪律相反，所以机制先落地、开关后拨（#2045 与本次之间就是这一隔）。
 * 2026-10-20 那一刻的状态是「PR 与每日两格都置 `COMFY_CI_SLOT=1`」，而它被上面第 1 条
 * 那半句新事实推翻：**每日那一跑后面背着 `每日生产构建`，接槽让它 13.8s 就死**
 * （ISSUE #2081）。现在状态：PR 那格接，**每日那格不接**。
 * 代价写在明处：每日那一跳从 13.8s（命中）回到 48.8s（暖）/ 216s（冷）——
 * 每天多付 ~35s，换回一个能构建的工作区；槽是优化，不是前提。
 * 这条差别**不是**「两格各漂一份」：判据 `tests/no-platform-ci-config.test.ts` 里它是一条
 * 登记过的例外（`DAILY_ENV_ONLY_ON_PR`），钉的形状是「PR 侧必须正好置着一行 `KEY: "1"`、
 * 每日侧一个字都不许出现」，其余各行仍逐字相同。回退 = 摘掉 PR 那格的 env **并同批**把
 * 那行从名单里删掉，只动一边会被那条判据当场点名。
 *
 * ## 两条硬边界
 *
 * - **绝不穿过链装**：要在作业里真装，先把作业那条指进槽的链摘掉（`clearJobLink`）。
 *   §13.5.3.4.3 第一条从散文变成有执行者 —— 留着链接着装，pnpm 会顺着链把新的一套写进
 *   **槽**、键却仍是旧的，下一跑按旧键命中那半新半旧的树：表现是依赖不对而门禁全绿。
 * - **盘不够 / 抢不到锁 ⇒ 退回作业内普通装并打印原因**：槽是优化不是前提，把它做成
 *   前提就是「没配缓存的机器一律红」那一型判据。
 *
 * 退出码由调用方负责；本模块只报 `{handled, action, why}`，`handled` 为真表示
 * 调用方**不必再装**。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import {
  DEP_FILES,
  FINGERPRINT_FILE,
  normalizePackageJson,
  pnpmInstallFingerprint,
} from "./ci-deps-face.mjs";
import { linkDependencies, unlinkDependencies } from "./base-check.mjs";
import {
  MAX_SLOT_KEYS,
  planSlot,
  readSlotState,
  resolveCacheRoot,
  sameVolumeAs,
  slotLastUsed,
  slotPath,
  SLOT_TTL_MS,
  SLOT_USED_FILE,
} from "./ci-cache-slot.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";

/* 「配额是几个」「TTL 是多久」「读一个槽的现状」这几份**策略与读数**住在读数那一侧
 * （`ci-cache-slot.mjs`）—— 执行档从那里取，不另抄一份。漂了之后的表现是
 * 「读数说够、执行按另一份算」，而淘汰那一刀是**会删盘**的动作。
 * 旧调用点不必跟着改：这三个名字照旧从这里转出。 */
export {
  MAX_SLOT_KEYS,
  readSlotState,
  slotLastUsed,
  SLOT_TTL_MS,
  SLOT_USED_FILE,
} from "./ci-cache-slot.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 开关：不打开时本模块一次都不该被调用（见文件头「为什么带开关」）。 */
export const SLOT_ENABLED_ENV = "COMFY_CI_SLOT";

/** 空闲下限（字节）。低于它就不建槽 —— 槽省的是时间，不该拿能写盘的空间去换。 */
export const FREE_SPACE_FLOOR_BYTES = 20 * 1024 ** 3;

/** 锁的失效时刻（毫秒）：拿着一把没主的锁比没有锁更坏，所以给一个明确的过期。 */
export const LOCK_STALE_MS = 20 * 60 * 1000;

const LOCK_FILE = ".ci-slot.lock";
const JOB_HOOK_SCRIPT = path.join("scripts", "install-git-hooks.mjs");

/**
 * 槽里要放哪些输入 = **键算的那一份**，一处不多一处不少。
 *
 * 刻意复用 `DEP_FILES` 而不是另列一份清单：那份列表同时是「碰了依赖面就得真装」的判据，
 * 两处各列一份的漂移形态就是「槽照着旧的一套装、判据照着新的一套认」。`patches/` 也在
 * 指纹里（`readPatchesDigest`），所以它必须在复制面上。
 *
 * @param {string} jobRoot @returns {string[]} 相对作业根、且这一份是真文件的路径
 */
export function slotInputs(jobRoot) {
  const list = [...DEP_FILES];
  try {
    for (const name of fs.readdirSync(path.join(jobRoot, "patches")).sort()) {
      list.push(path.join("patches", name));
    }
  } catch {
    /* 没有补丁目录是正常状态（与 `readPatchesDigest` 的 `patches:absent` 同一读法）。 */
  }
  return list.filter((rel) => {
    try {
      return fs.statSync(path.join(jobRoot, rel)).isFile();
    } catch {
      return false;
    }
  });
}

/**
 * 把输入落进槽目录；`package.json` 走 `normalizePackageJson`（摘 `scripts`，
 * 理由见文件头第 4 条实测）。
 *
 * ⚠️ 这一份规范化与算键那一侧**必须是同一个函数**：两边各写一份，sha 就会随
 * 「有没有摘 scripts」漂（ISSUE #2489）。
 *
 * @param {{jobRoot: string, slot: string, log?: (line: string) => void}} input
 * @returns {string[]} 实际写进去的条目（`package.json` 那条带「已摘 scripts」）
 */
export function materializeSlotInputs(input) {
  const { jobRoot, slot } = input;
  const say = input.log ?? (() => {});
  const written = [];
  fs.mkdirSync(slot, { recursive: true });
  for (const rel of slotInputs(jobRoot)) {
    const to = path.join(slot, rel);
    fs.mkdirSync(path.dirname(to), { recursive: true });
    if (rel !== "package.json") {
      fs.copyFileSync(path.join(jobRoot, rel), to);
      written.push(rel);
      continue;
    }
    const raw = fs.readFileSync(path.join(jobRoot, rel), "utf8");
    fs.writeFileSync(to, normalizePackageJson(raw));
    written.push(`${rel}（已摘 scripts）`);
  }
  say(`[缓存槽] 输入落位 ${written.length} 份：${written.join(", ")}`);
  return written;
}

/**
 * 作业侧补那一笔接不过来的生命周期写入（`node scripts/install-git-hooks.mjs`）。
 *
 * 只在**接槽成功**之后跑：走普通安装那条路时 `pnpm install` 本来就会跑它，而复用路径
 * 整个跳过了 install —— 不补就是作业少一次 `.git/config` 写入（后果不是「构建红」，
 * 是那次构建里后续任何一次 `git checkout` / `git lfs pull` 拿回一段指针文本）。
 *
 * @param {{jobRoot?: string, spawn?: (exe: string, args: string[], opts: object) => {status: number | null}}} [io]
 * @returns {{ok: boolean, why: string}}
 */
export function runJobLifecycle(io = {}) {
  const jobRoot = io.jobRoot ?? ROOT;
  const spawn =
    io.spawn ??
    ((exe, args, opts) => ({ status: spawnSync(exe, args, opts).status }));
  const res = spawn(process.execPath, [JOB_HOOK_SCRIPT], {
    cwd: jobRoot,
    stdio: "inherit",
  });
  const status = res.status ?? 1;
  if (status !== 0) {
    return { ok: false, why: `补跑 install-git-hooks 退 ${status}` };
  }
  return {
    ok: true,
    why: "作业侧 `.git/config` 那笔已补（hooksPath + lfs 过滤器）",
  };
}

/**
 * 作业里那条指进槽的 `node_modules` 链接：要在作业里真装之前先摘掉它。
 *
 * 只摘 reparse point 本身（`unlinkDependencies` 的既定职责），不许顺着它删进去。
 * 作业里是一棵真树时返回 `false` 且不碰 —— 那种情况交回普通那条路，本模块没有资格
 * 动别人装出来的东西。
 *
 * @param {string} jobRoot @returns {boolean} 是否真的摘掉了一条链
 */
export function clearJobLink(jobRoot) {
  const link = path.join(jobRoot, "node_modules");
  let stat;
  try {
    stat = fs.lstatSync(link);
  } catch {
    return false;
  }
  if (!stat.isSymbolicLink()) return false;
  unlinkDependencies(link);
  return true;
}

/**
 * Node 在 `catch` 里给的是 `unknown`，而这里要的只有那一格 `code`。
 * 写成 `err?.code` 会让判据在类型面上落到 `{}`（本机 tsc 实测报 TS2339 —— 也就是说
 * 「读不到 EEXIST 就当没抢到」这条分支在类型检查之前根本没被执行过）。
 *
 * @param {unknown} err @returns {string}
 */
function errCode(err) {
  return typeof err === "object" && err !== null && "code" in err
    ? String(/** @type {{code?: unknown}} */ (err).code)
    : String(err);
}

/**
 * 单写锁：`wx` 建一个只写「pid 时刻」的小文件，抢不到就是「别的作业正在装这个键」。
 *
 * 需要它的理由是实测出来的那一格：接槽之后作业的**运行期写入落在槽里** —— 一次
 * `vitest` 就在 `<槽>/node_modules/.vite`、`.vite-temp` 里留东西（mtime 对得上起跑时刻），
 * 而 `.pnpm` 一个条目都没多。也就是说依赖树只读、缓存可写 —— 会撞的正是那份可写缓存。
 *
 * @param {{slot: string, staleMs?: number, now?: () => number}} io
 * @returns {{acquired: boolean, why: string, release: () => void}}
 */
export function acquireSlotLock(io) {
  const { slot, staleMs = LOCK_STALE_MS } = io;
  const now = io.now ? io.now() : Date.now();
  const file = path.join(slot, LOCK_FILE);
  const release = () => {
    try {
      fs.rmSync(file, { force: true });
    } catch {
      /* 锁已经没了就是已经释放 —— 不该把收尾写成一次红。 */
    }
  };
  const stamp = `${process.pid} ${now}\n`;
  try {
    fs.writeFileSync(file, stamp, { flag: "wx" });
    return { acquired: true, why: "拿到写锁", release };
  } catch (err) {
    if (errCode(err) !== "EEXIST") {
      return { acquired: false, why: `锁建不起来（${errCode(err)}）`, release };
    }
  }
  let held = Number.NaN;
  try {
    held = Number(fs.readFileSync(file, "utf8").trim().split(/\s+/)[1]);
  } catch {
    /* 读不动就当作过期：卡在一把读不出来的锁上，比重新拿一把坏得更快。 */
  }
  if (Number.isFinite(held) && now - held < staleMs) {
    const age = Math.round((now - held) / 1000);
    return { acquired: false, why: `另一作业持锁已 ${age}s`, release };
  }
  try {
    fs.writeFileSync(file, stamp);
    return { acquired: true, why: "接管一把过期的锁", release };
  } catch (err) {
    return { acquired: false, why: `接管失败（${errCode(err)}）`, release };
  }
}

/**
 * 盘还够不够建一个槽。**读不到就答「不够」** —— 不在没有证据的时候断言空间充足。
 *
 * 用 `fs.statfsSync`（Node 自带的卷级读数），不外部调 `df`：钩子与平台都在 PowerShell
 * 宿主里跑，那里没有 `df`，而「读不到」按上面的口径会一律退回普通装 —— 那是一条
 * 让机制在唯一需要它的地方静默失效的路。
 *
 * @param {{path: string, floorBytes?: number, probe?: (p: string) => number | null}} io
 * @returns {{ok: boolean, freeBytes: number | null, why: string}}
 */
export function hasRoomForSlot(io) {
  const floor = io.floorBytes ?? FREE_SPACE_FLOOR_BYTES;
  const probe = io.probe ?? statfsFreeBytes;
  let free = null;
  try {
    free = probe(io.path);
  } catch {
    free = null;
  }
  if (free === null || !Number.isFinite(free)) {
    return { ok: false, freeBytes: null, why: "读不到空闲空间 ⇒ 按不够处理" };
  }
  /** @param {number} n @returns {string} */
  const gib = (n) => (n / 1024 ** 3).toFixed(1);
  if (free < floor) {
    return {
      ok: false,
      freeBytes: free,
      why: `空闲 ${gib(free)} GiB 低于下限 ${gib(floor)} GiB`,
    };
  }
  return { ok: true, freeBytes: free, why: `空闲 ${gib(free)} GiB` };
}

/**
 * 一个路径所在卷的空闲字节 —— **路径还不存在时向上找到最近存在的祖先**。
 *
 * 为什么必须向上找，而不是「读不到就 null」：`fs.statfsSync` 对不存在的目标抛 `ENOENT`
 * （本机实测），而**槽根在第一次被建出来之前必然不存在**。按「读不到」处理时那句
 * 「读不到 ⇒ 按不够处理」就把第一次那一跑永久判成不建槽，于是开关拨下去也是空转 ——
 * 这个形态在节点上实测到了：#2049 合并后 `F:\runner\ci-cache\comfy-app-t3` 仍然没有
 * 被创建，CI 全绿（回退本来就是绿的），而槽一次都没生效。
 *
 * 自由空间本来就是**卷级**事实，沿同一卷向上取任意一个存在的目录，读到的就是同一个数，
 * 所以这不是「放宽判据让它通过」，是把量具指对量具。真正读不到的情形（盘符不存在、
 * 权限拒绝）照旧返回 `null` 并被判成不够。
 *
 * @param {string} target @returns {number | null}
 */
export function statfsFreeBytes(target) {
  let dir = path.resolve(target);
  for (;;) {
    try {
      const info = fs.statfsSync(dir);
      const bytes = info.bsize * info.bavail;
      return Number.isFinite(bytes) ? bytes : null;
    } catch (err) {
      const code = errCode(err);
      if (code !== "ENOENT" && code !== "ENOTDIR") return null;
      const parent = path.dirname(dir);
      if (parent === dir) return null;
      dir = parent;
    }
  }
}

/**
 * 「这一跑开始用这个槽了」的记号 —— 接槽那一刻写一个毫秒时刻。
 *
 * 为什么不能拿目录 mtime 当「最近用过」：接槽（在**作业**里建一条 junction）根本不碰槽目录，
 * 而运行期那些写入（`.vite` 之类）落在 `node_modules` 里面、也不碰槽根那一层的 mtime。
 * 于是「天天被命中的热键」可能看起来最旧 —— 按 mtime 淘汰会**删掉另一个作业正在用的树**，
 * 那一个构建的依赖当场消失。这一枚邮票就是为了让淘汰读到「用过」这个真事实。
 *
 * @param {string} slot @param {number} [now] @returns {boolean} 写成功与否（失败不判红）
 */
export function markSlotUsed(slot, now = Date.now()) {
  try {
    fs.writeFileSync(path.join(slot, SLOT_USED_FILE), `${now}\n`);
    return true;
  } catch {
    /* 邮票写不上 ⇒ 该键之后会被「读不到最近使用」保护住（不淘汰），不该为此让这一跑红。 */
    return false;
  }
}

/**
 * 这个槽最近什么时候被用过。
 *
 * ⚠️ **实现搬到读数那一侧**（`ci-cache-slot.mjs`）—— 「读过」的读法与「配额 / TTL」
 * 是同一份策略，分两处各写一遍的话，漂了之后的表现是「读数说够、执行按另一份算」。
 * 本文件照旧转出同一个名字（旧调用点不必跟着改）。
 */

/**
 * 这个槽是不是一个**没人要的空壳**（崩在半路的安装留下的那种）。
 *
 * 三个条件缺一不可：
 * - **没有产物也没有指纹** —— 里面没有可用依赖树 ⇒ 没有任何作业会命中它；
 * - **没有锁** —— 锁是「有人正在往里装」的唯一出处（`acquireSlotLock` 写的）；
 * - **目录 mtime 过了 TTL** —— 「建目录」与「拿锁」之间有一个窗口，一个刚建出来的
 *   空目录不该被当成垃圾。
 *
 * ⚠️ **mtime 在这一档里是可用的**，而在「按最近使用淘汰」那一档里不可用 ——
 * 差别在于**这一档只判空壳**：没有产物的目录里没有任何东西值得保护，而目录自己
 * 的 mtime 就是「它从哪儿来」的证据。上一档（按 mtime 做 LRU）栽的坑是
 * 「天天被命中的热键看起来最旧」—— 那是在**有产物**的目录上按 mtime 排序。
 *
 * @param {string} abs 槽目录的绝对路径
 * @param {number} now @param {number} ttlMs
 * @returns {boolean}
 */
function isUselessShell(abs, now, ttlMs) {
  const state = readSlotState(abs);
  /* 有产物、有指纹、或读不动 ⇒ 一律不碰（读不动尤其不能碰：那是「不知道」）。 */
  if (state.treePresent || state.fingerprint !== null || state.unreadable) {
    return false;
  }
  try {
    if (fs.existsSync(path.join(abs, LOCK_FILE))) return false;
  } catch {
    return false;
  }
  let mtime = 0;
  try {
    mtime = fs.statSync(abs).mtimeMs;
  } catch {
    return false;
  }
  return now - mtime >= ttlMs;
}

/**
 * 删一个槽目录。删不掉就回 `false` —— 调用方把「删不掉」记成「留着」，
 * 多留一个槽不坏正确性，报一次红才坏。
 *
 * @param {string} abs
 * @returns {boolean}
 */
function removeSlot(abs) {
  try {
    fs.rmSync(abs, { recursive: true, force: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * 按键控的 LRU 淘汰，**外加一道 TTL 闸门**。
 *
 * 两道的分工要说清，因为它们是两件事：
 * - `keep` 管**盘**（实测每键净占约 52 MiB，四个不到 0.3 GiB）；
 * - `ttlMs` 管**别的作业还在不在用**。并发作业下我的键是 Y，把键 X 判成「最久没用」删掉，
 *   而 X 上正有一个构建接在那棵树 ⇒ 那一个构建的依赖树当场消失。TTL 比一次构建的墙钟长
 *   （默认 26 小时 vs 单条流水线实测几分钟到二十几分钟），所以「正在用」的键必然落在闸门内；
 *   代价是盘可能暂时超出 `keep` —— 那是**正确性换空间**，方向只许这么换。
 * - **读不到邮票的键一律留着**：宁可留一个来历不明的槽多占 52 MiB，也不赌它没人用。
 *
 * @param {{cacheRoot: string, keep?: number, currentKey?: string | null,
 *   now?: number, ttlMs?: number}} io
 * @returns {{evicted: string[], held: string[]}} 删掉的与因闸门留下的
 */
export function pruneSlots(io) {
  const {
    cacheRoot,
    keep = MAX_SLOT_KEYS,
    currentKey = null,
    now = Date.now(),
    ttlMs = SLOT_TTL_MS,
  } = io;
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return { evicted: [], held: [] };
  }
  const keyed = entries
    .filter((e) => e.isDirectory() && e.name !== currentKey)
    .map((e) => ({
      key: e.name,
      abs: path.join(cacheRoot, e.name),
      lastUsed: slotLastUsed(path.join(cacheRoot, e.name)),
    }))
    .sort((a, b) => (b.lastUsed ?? 0) - (a.lastUsed ?? 0));
  const budget = Math.max(0, keep - (currentKey ? 1 : 0));
  const evicted = [];
  const held = [];
  for (const [index, item] of keyed.entries()) {
    /* **空壳那一档**：没有产物、没有指纹、没有锁、目录 mtime 过了 TTL ⇒ 回收。
     * 它**不受配额约束** —— 空壳不是「一个槽」，它是崩在半路的安装留下的渣，
     * 留着既不好用也永远不会自己好起来。与上面那档的区别在于**保护对象**：
     * 上面那档要保护的是「别人正在用的依赖树」，这一档没有任何东西要保护。 */
    if (isUselessShell(item.abs, now, ttlMs)) {
      if (removeSlot(item.abs)) {
        evicted.push(item.key);
      } else {
        held.push(item.key);
      }
      continue;
    }
    if (index < budget) continue;
    const fresh = item.lastUsed === null || now - item.lastUsed < ttlMs;
    if (fresh) {
      held.push(item.key);
      continue;
    }
    if (removeSlot(item.abs)) {
      evicted.push(item.key);
    } else {
      /* 删不掉就留在账上：多留一个槽不坏正确性，报一次红才坏。 */
      held.push(item.key);
    }
  }
  return { evicted, held };
}

/**
 * 跑一次淘汰并把结果打出来（两条路共用一份，免得两处各写一遍话术）。
 *
 * @param {{cacheRoot: string, key: string | null, now: number,
 *   log: (line: string) => void}} io
 * @returns {{evicted: string[], held: string[]}}
 */
function pruneAndReport(io) {
  const { evicted, held } = pruneSlots({
    cacheRoot: io.cacheRoot,
    currentKey: io.key,
    now: io.now,
  });
  if (evicted.length > 0 || held.length > 0) {
    io.log(
      `[缓存槽] 配额档：淘汰 ${evicted.length} 个（${evicted.map((k) => k.slice(0, 8)).join(", ") || "无"}）` +
        `·超配额但留着 ${held.length} 个（TTL 内 / 读不到邮票 / 删不掉的 ⇒ 不敢动别人可能在用的树）`,
    );
  }
  return { evicted, held };
}

/**
 * 槽的现状 —— 三格分开，尤其不许把「指纹文件在、但这一趟读不动」读成「键变了」。
 *
 * ⚠️ **实现搬到读数那一侧**（`ci-cache-slot.mjs`）—— 理由同上（策略与读数同一份）。
 * 本文件照旧转出同一个名字（旧调用点不必跟着改）。
 */

/**
 * 三档读数的执行版。装与起进程都走注入的 `run`（默认 `runPnpmSync` 那唯一一条出口）。
 *
 * @param {{
 *   cwd?: string,
 *   env?: Record<string, string | undefined>,
 *   run?: (args: string[], opts: object) => {status: number | null},
 *   spawn?: (exe: string, args: string[], opts: object) => {status: number | null},
 *   probe?: (p: string) => number | null,
 *   now?: () => number,
 *   log?: (line: string) => void,
 * }} [io]
 * @returns {{handled: boolean, action: string, why: string}}
 */
export function applySlot(io = {}) {
  const cwd = io.cwd ?? ROOT;
  const env = io.env ?? process.env;
  const log = io.log ?? ((line) => process.stdout.write(`${line}\n`));
  const run = io.run ?? ((args, opts) => runPnpmSync(args, opts));
  const spawn = io.spawn;
  const resolved = resolveCacheRoot({
    cwd,
    env,
    run: (args, opts) => run(args, opts),
  });
  const cacheRoot = resolved.root;
  log(`[缓存槽] 槽根 ${cacheRoot ?? "（未设）"} · 来源：${resolved.from}`);
  const key = pnpmInstallFingerprint(cwd);
  const slot = cacheRoot && key ? slotPath(cacheRoot, key) : null;
  const state = slot
    ? readSlotState(slot)
    : { treePresent: false, fingerprint: null, unreadable: false };
  /* 读不动 ⇒ 既不接也不重装：这一跑没省到时间是小事，把别人正在用的树删了是事故。 */
  if (state.unreadable) {
    log(
      "[缓存槽] 槽里有指纹文件但这一趟读不动 ⇒ 不判「键变了」、不接、不删（退回普通装）",
    );
    return {
      handled: false,
      action: "no-cache",
      why: "指纹读不动（不是读不到）⇒ 没有足够事实动那棵树",
    };
  }
  const plan = planSlot({
    cacheRoot,
    key,
    sameVolume: cacheRoot ? sameVolumeAs(cacheRoot, cwd) : true,
    slotPresent: state.treePresent,
    slotFingerprint: state.fingerprint,
  });
  log(`[缓存槽] ${plan.action} · ${plan.why}`);
  if (!cacheRoot || !slot || plan.action === "no-cache") {
    return { handled: false, action: plan.action, why: plan.why };
  }
  const slotModules = path.join(slot, "node_modules");

  if (plan.action === "reuse") {
    const link = linkDependencies(slot, cwd);
    if (!link) {
      log("[缓存槽] 链没建起来（作业里已有一棵树）⇒ 按不接管处理");
      return { handled: false, action: "reuse", why: "链未建立" };
    }
    const life = runJobLifecycle({ jobRoot: cwd, spawn });
    markSlotUsed(slot, io.now ? io.now() : Date.now());
    /* **命中这一趟也要跑淘汰** —— 淘汰此前只在「装槽」那条路上跑，于是
     * 「不再新建键 ⇒ 旧键永不回收」：依赖面不再变的那段时间里，过了 TTL 的键
     * 会一直躺着（而键数正是配额该管的那个数）。命中是最常走的一条路 ——
     * 它每次都在碰缓存根，所以它是回收旧键的**主要时机**。
     *
     * ⚠️ **跑在接槽之后**：先把自己的树接上，再去动别人的 —— 顺序反过来时，
     * 淘汰有可能把**自己**那个键算进「超配额」（它此刻还没盖上邮票）。 */
    pruneAndReport({
      cacheRoot,
      key,
      now: io.now ? io.now() : Date.now(),
      log,
    });
    log(`[缓存槽] 接槽完成 ${link} · 作业侧：${life.why}`);
    return { handled: true, action: "reuse", why: life.why };
  }

  const room = hasRoomForSlot({ path: cacheRoot, probe: io.probe });
  if (!room.ok) {
    log(`[缓存槽] 不建槽：${room.why} ⇒ 退回作业内普通装`);
    return { handled: false, action: plan.action, why: room.why };
  }
  /* 先占锁、再动槽里的内容：反过来的话，两个作业会同时往同一个键上写输入。
   * 锁文件就在槽根 —— 目录得先有，才谈得上建锁。 */
  fs.mkdirSync(slot, { recursive: true });
  const lock = acquireSlotLock({ slot, now: io.now });
  if (!lock.acquired) {
    log(`[缓存槽] 不建槽：${lock.why} ⇒ 退回作业内普通装`);
    return { handled: false, action: plan.action, why: lock.why };
  }
  try {
    materializeSlotInputs({ jobRoot: cwd, slot, log });
    const res = run(["install", "--frozen-lockfile"], {
      cwd: slot,
      stdio: "inherit",
    });
    const status = res?.status ?? 1;
    /* 「退 0」与「装出来一棵树」是两件事：注入的出口、被截断的日志、pnpm 自己的
     * 空跑都可能给出 0 而没有产物。产物不在就按失败处理 —— 写指纹这一步在没产物的
     * 目录上会 ENOENT，那条抛错不是这一档该给调用方的东西。 */
    if (status !== 0 || !fs.existsSync(slotModules)) {
      log(
        `[缓存槽] ✗ 槽没装出来（退出 ${status}，产物${fs.existsSync(slotModules) ? "在" : "不在"}）` +
          " ⇒ 删掉半套、退回普通装（装到一半留下的那套绝不会被记成已验证）",
      );
      fs.rmSync(slot, { recursive: true, force: true });
      return {
        handled: false,
        action: plan.action,
        why: status !== 0 ? `槽内安装退 ${status}` : "槽内安装退 0 但没有产物",
      };
    }
    fs.writeFileSync(path.join(slot, FINGERPRINT_FILE), `${key}\n`);
    markSlotUsed(slot, io.now ? io.now() : Date.now());
    pruneAndReport({
      cacheRoot,
      key,
      now: io.now ? io.now() : Date.now(),
      log,
    });
    const link = linkDependencies(slot, cwd);
    if (!link) {
      log("[缓存槽] 槽装好了，但作业里已有一棵树 ⇒ 不动它（下一次命中时再接）");
      return {
        handled: false,
        action: plan.action,
        why: "槽已就绪，本次未接管",
      };
    }
    const life = runJobLifecycle({ jobRoot: cwd, spawn });
    markSlotUsed(slot, io.now ? io.now() : Date.now());
    log(`[缓存槽] 装完并接上 ${link} · 作业侧：${life.why}`);
    return { handled: true, action: plan.action, why: life.why };
  } finally {
    lock.release();
  }
}

if (
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  applySlot();
  process.exit(0);
}
