/**
 * 槽锁与盘面**原语**（#3479 裁剪后：依赖面那套槽的执行档已退役，留下的是仍被
 * 构建缓存槽 / 发布 Bundle 共用的三件）。
 *
 * ## 这份文件现在是什么
 *
 * 它曾经是**依赖面缓存槽**的执行档（#2022：把 `planSlot` 那三档读数变成动作 ——
 * 装进槽、把整棵 `node_modules` 接进作业、淘汰旧键）。执行面随 #3378 薄化消失
 * （`COMFY_CI_SLOT` 无任何置点），#3479 按退役把那半边剪掉 —— `applySlot` /
 * `clearJobLink` / `runJobLifecycle` / `slotInputs` / 依赖槽配额与 TTL 淘汰器
 * 都不在了，机制与四条实测记录在规范 §13.5.3.4.3 与 §13.5.37。
 *
 * 留下来的是**三件仍被共用的原语**（加一枚它们自己的锁文件名）：
 *   · `acquireSlotLock` —— 槽的单写锁（`ci-build-cache-slot.mjs` 建槽前互斥）；
 *   · `hasRoomForSlot` / `statfsFreeBytes` —— 盘面量具（`ci-build-cache-slot.mjs` 与
 *     `publish-desktop-bundle.mjs` 都用它答「够不够」）。
 *
 * ## 锁为什么必要（实测出来的那一格）
 *
 * 接槽（历史形态）之后作业的**运行期写入落在槽里** —— 一次 `vitest` 就在
 * `<槽>/node_modules/.vite` 里留东西（mtime 对得起跑时刻），而 `.pnpm` 一个条目都没多。
 * 也就是说依赖树只读、缓存可写 —— 会撞的正是那份可写缓存。今天锁的消费者是
 * 构建缓存槽：两个作业同时往同一个键上写 Turbopack 缓存时，它保证只有一个在写。
 *
 * ## 盘面量具的两条纪律
 *
 * - **读不到就答「不够」** —— 不在没有证据的时候断言空间充足。把它放宽成「按够处理」，
 *   机制就在唯一需要它的地方静默失效。
 * - **路径还不存在时向上找到最近存在的祖先** —— `fs.statfsSync` 对不存在的目标抛
 *   `ENOENT`（本机实测），而**槽根在第一次被建出来之前必然不存在**。按「读不到」处理
 *   会把第一次那一跑永久判成不建槽（节点上实测到了：#2049 合并后槽根仍没被创建、
 *   CI 全绿而槽一次都没生效）。自由空间是**卷级**事实，沿同一卷向上取任意一个存在的
 *   目录读到的就是同一个数 —— 这不是放宽判据，是把量具指对量具。
 */
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

/** 槽锁的文件名 —— 「有人正在往里装」的唯一出处（`acquireSlotLock` 写它）。 */
export const SLOT_LOCK_FILE = ".ci-slot.lock";

/**
 * 空闲下限（字节）。低于它就不建槽 —— 槽省的是时间，不该拿能写盘的空间去换。
 *
 * 10 GiB 而不是更高：这道门要挡的是「盘已经快满了还去建 52 MiB 的槽」，不是「盘不宽裕
 * 就别用缓存」。它挡得过头时的形态**不报错、只是静默不建槽**（`[缓存槽] 不建槽：空闲
 * 16.0 GiB 低于下限 20.0 GiB ⇒ 退回作业内普通装`，ISSUE #3113）—— 槽自己就在占盘，
 * 常驻缓存盘落到 20 GiB 以下之后机制就永久退化成普通装，而日志里那句读起来像「盘满了」。
 * （那条话术属于已退役的依赖槽执行档；今天这道门守的是构建缓存槽与发布 Bundle。）
 */
export const FREE_SPACE_FLOOR_BYTES = 10 * 1024 ** 3;

/** 锁的失效时刻（毫秒）：拿着一把没主的锁比没有锁更坏，所以给一个明确的过期。 */
export const LOCK_STALE_MS = 20 * 60 * 1000;

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
 * @param {{slot: string, staleMs?: number, now?: () => number}} io
 * @returns {{acquired: boolean, why: string, release: () => void}}
 */
export function acquireSlotLock(io) {
  const { slot, staleMs = LOCK_STALE_MS } = io;
  const now = io.now ? io.now() : Date.now();
  const file = path.join(slot, SLOT_LOCK_FILE);
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
  } catch (error) {
    if (errCode(error) !== "EEXIST") {
      return { acquired: false, why: `锁建不起来（${errCode(error)}）`, release };
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
  } catch (error) {
    return { acquired: false, why: `接管失败（${errCode(error)}）`, release };
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
  let free;
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
 * @param {string} target @returns {number | null}
 */
export function statfsFreeBytes(target) {
  let dir = path.resolve(target);
  for (;;) {
    try {
      const info = fs.statfsSync(dir);
      const bytes = info.bsize * info.bavail;
      return Number.isFinite(bytes) ? bytes : null;
    } catch (error) {
      const code = errCode(error);
      if (code !== "ENOENT" && code !== "ENOTDIR") {
        return null;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  }
}
