/**
 * 缓存槽的**执行档**（ISSUE #2022 第二步的第二增量）：把 `planSlot` 那三档读数变成动作 ——
 * 装进槽、把整棵 `node_modules` 接进作业、并补上接不过去的那一笔。
 *
 * ## 四条实测（机制是照着这四个数写的，不是反过来；规范 §13.5.3.4.3）
 *
 * 1. **接过去是干净的**：`node_modules` 整体接成 junction 的作业检出上，`tsc --noEmit`
 *    退 0、零诊断（干净检出没有 `.next/`，这一条不依赖它），`vitest` 三份 29 条全绿 ——
 *    其中 `check-allow-builds` 那条判据是**真去走 `node_modules/.pnpm` 的事实**的，
 *    `db-schema-ready` 那条要 `require` 到原生 `.node`。建链的实测代价 **12 KB**。
 * 2. **冷装那一跳才是被省的东西**：本机全量检出装 69s、只放依赖面输入装 52.6s，
 *    节点上 `Install dependencies` 那格实测 76.9s —— 三个数是同一件事的三台机器读数，
 *    所以「命中省 76.9s」这句话要等开关真的拨一次才成立（本文件不替节点说话）。
 * 3. **槽的净成本不是 GB 级**：一份装出来的 `node_modules` 表观 982 MiB / 83,664 个文件，
 *    其中只有 2,599 个（3.1%）是 `nlink==1` 的独占数据、合计 1.7 MiB；删掉之后磁盘实测
 *    **回收 52 MiB**（其余是目录项）。所以配额按「个」定，不按「GB」定。
 * 4. **槽里只需要依赖面那几份输入**：拿 `DEP_FILES` + `patches/` 装出来的闭包与拿整棵
 *    检出装的**逐条相同**（虚拟 store 1379 vs 1379，两侧差集均为 0），前提是把
 *    `package.json` 自己的 `scripts` 摘掉。摘它不是省事：本仓那条 postinstall 写的是
 *    **检出的 `.git/config`**（`core.hooksPath` + `git lfs install --local --manual`），
 *    那不在 `node_modules` 里、接槽接不过来 —— 于是由作业自己补（`runJobLifecycle`）。
 *
 * ## 开关：已拨（两条流水线同值）
 *
 * `Install dependencies` 每一次构建都过，它红了后面就没有任何一步。把「机制」与
 * 「换执行者」同批推上去的形态是一次键算错就让所有 PR 装不上 —— 与本仓在档位那一刀上
 * 立的纪律相反，所以机制先落地、开关后拨（#2045 与本次之间就是这一隔）。
 * 今天的状态（2026-10-20）：`.cnb.yml` 的 PR 与每日两格安装依赖都置了 `COMFY_CI_SLOT=1`。
 * 两格必须同值是既有判据（`tests/no-platform-ci-config.test.ts` 比「命令行 + env 赋值」
 * 逐字相同）说了算；回退 = 摘掉那两行 env。
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
  pnpmInstallFingerprint,
} from "./ci-deps-face.mjs";
import { linkDependencies, unlinkDependencies } from "./base-check.mjs";
import { CACHE_ROOT_ENV, planSlot, slotPath } from "./ci-cache-slot.mjs";
import { runPnpmSync } from "./launcher-core/shell.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

/** 开关：不打开时本模块一次都不该被调用（见文件头「为什么带开关」）。 */
export const SLOT_ENABLED_ENV = "COMFY_CI_SLOT";

/** 空闲下限（字节）。低于它就不建槽 —— 槽省的是时间，不该拿能写盘的空间去换。 */
export const FREE_SPACE_FLOOR_BYTES = 20 * 1024 ** 3;

/** 槽根下最多留几个键（实测每槽净占约 52 MiB，四个不到 0.3 GiB）。 */
export const MAX_SLOT_KEYS = 4;

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
 * 把输入落进槽目录；`package.json` 去掉 `scripts`（理由见文件头第三条实测）。
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
    const pkg = JSON.parse(fs.readFileSync(path.join(jobRoot, rel), "utf8"));
    delete pkg.scripts;
    fs.writeFileSync(to, `${JSON.stringify(pkg, null, 2)}\n`);
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
  const spawn = io.spawn ?? ((exe, args, opts) => ({ status: spawnSync(exe, args, opts).status }));
  const res = spawn(process.execPath, [JOB_HOOK_SCRIPT], {
    cwd: jobRoot,
    stdio: "inherit",
  });
  const status = res.status ?? 1;
  if (status !== 0) {
    return { ok: false, why: `补跑 install-git-hooks 退 ${status}` };
  }
  return { ok: true, why: "作业侧 `.git/config` 那笔已补（hooksPath + lfs 过滤器）" };
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
 * 一个路径所在卷的空闲字节。
 *
 * @param {string} target @returns {number | null} 卷读不到时给 `null`，不猜
 */
export function statfsFreeBytes(target) {
  let info;
  try {
    info = fs.statfsSync(target);
  } catch {
    return null;
  }
  const bytes = info.bsize * info.bavail;
  return Number.isFinite(bytes) ? bytes : null;
}

/**
 * 按键控的 LRU 淘汰：只留最近用过的 `keep` 个键，**当前键永不淘汰**。
 *
 * 「最近用过」取目录 mtime —— 接槽那次会碰到它，所以命中即续期，不需要另记一本账。
 *
 * @param {{cacheRoot: string, keep?: number, currentKey?: string | null}} io
 * @returns {string[]} 被删掉的键（目录名）
 */
export function pruneSlots(io) {
  const { cacheRoot, keep = MAX_SLOT_KEYS, currentKey = null } = io;
  let entries;
  try {
    entries = fs.readdirSync(cacheRoot, { withFileTypes: true });
  } catch {
    return [];
  }
  const keyed = entries
    .filter((e) => e.isDirectory() && e.name !== currentKey)
    .map((e) => {
      const abs = path.join(cacheRoot, e.name);
      let mtimeMs = 0;
      try {
        mtimeMs = fs.statSync(abs).mtimeMs;
      } catch {
        /* 读不到时间的排最后：先淘汰来历不明的那一个。 */
      }
      return { key: e.name, abs, mtimeMs };
    })
    .sort((a, b) => b.mtimeMs - a.mtimeMs);
  const budget = Math.max(0, keep - (currentKey ? 1 : 0));
  const evicted = [];
  for (const item of keyed.slice(budget)) {
    try {
      fs.rmSync(item.abs, { recursive: true, force: true });
      evicted.push(item.key);
    } catch {
      /* 删不掉就留在账上：多留一个槽不坏正确性，报一次红才坏。 */
    }
  }
  return evicted;
}

/**
 * 槽的现状 —— 三格分开，尤其不许把「指纹文件在、但这一趟读不动」读成「键变了」。
 *
 * 这条区分是**打开开关的前提**：判成「键变了」会走重装，而重装在失败时把那棵树删掉。
 * 并发作业时那棵树可能正被另一个作业**接在上面**（它读到了匹配的指纹才接的），
 * 于是一次 `EBUSY`（Windows 上另一进程正在写那个文件时的既定形态）的代价是
 * 把别人正在用的依赖树删了 —— 那比「这一跑没省到时间」重得多。
 *
 * @param {string} slot
 * @returns {{treePresent: boolean, fingerprint: string | null, unreadable: boolean}}
 */
export function readSlotState(slot) {
  const treePresent = fs.existsSync(path.join(slot, "node_modules"));
  const file = path.join(slot, FINGERPRINT_FILE);
  let exists = false;
  try {
    exists = fs.existsSync(file);
  } catch {
    /* `existsSync` 自己不抛；留着是为了形状一致，读不动照样落到下面那一格。 */
  }
  if (!exists) return { treePresent, fingerprint: null, unreadable: false };
  try {
    return { treePresent, fingerprint: fs.readFileSync(file, "utf8").trim(), unreadable: false };
  } catch {
    return { treePresent, fingerprint: null, unreadable: true };
  }
}

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
  const cacheRoot = (env[CACHE_ROOT_ENV] ?? "").trim();
  const key = pnpmInstallFingerprint(cwd);
  const slot = cacheRoot && key ? slotPath(cacheRoot, key) : null;
  const state = slot
    ? readSlotState(slot)
    : { treePresent: false, fingerprint: null, unreadable: false };
  /* 读不动 ⇒ 既不接也不重装：这一跑没省到时间是小事，把别人正在用的树删了是事故。 */
  if (state.unreadable) {
    log("[缓存槽] 槽里有指纹文件但这一趟读不动 ⇒ 不判「键变了」、不接、不删（退回普通装）");
    return {
      handled: false,
      action: "no-cache",
      why: "指纹读不动（不是读不到）⇒ 没有足够事实动那棵树",
    };
  }
  const plan = planSlot({
    cacheRoot,
    key,
    slotPresent: state.treePresent,
    slotFingerprint: state.fingerprint,
  });
  log(`[缓存槽] ${plan.action} · ${plan.why}`);
  if (!slot || plan.action === "no-cache") {
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
    const evicted = pruneSlots({ cacheRoot, currentKey: key });
    if (evicted.length > 0) {
      log(`[缓存槽] LRU 淘汰 ${evicted.length} 个键：${evicted.map((k) => k.slice(0, 8)).join(", ")}`);
    }
    const link = linkDependencies(slot, cwd);
    if (!link) {
      log("[缓存槽] 槽装好了，但作业里已有一棵树 ⇒ 不动它（下一次命中时再接）");
      return { handled: false, action: plan.action, why: "槽已就绪，本次未接管" };
    }
    const life = runJobLifecycle({ jobRoot: cwd, spawn });
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
