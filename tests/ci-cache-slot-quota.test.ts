/**
 * 「缓存槽的配额与淘汰」那件事的**契约**。槽按依赖面指纹键控（依赖变=新键=新槽），于是「键有无上限」必然要答。
 * **配额**（`MAX_SLOT_KEYS`）管盘、超了淘汰；**TTL**（`SLOT_TTL_MS`）管「有没有人还在用」，闸门内的键一律留；两者不能由
 * 同一个数字管（混成一个就是「删掉别人正在用的树」，见 §13.5.3.4.3），代价是闸门内键让盘暂时超额（空间换正确性）。
 * 用例钉：①策略只一处（执行档从读数侧取数）；②淘汰在「命中」路上也跑；③空壳三条件缺一不可；④读数面缺策略则日志读不出超额去向。 */
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  listSlots,
  MAX_SLOT_KEYS,
  SLOT_TTL_MS,
  SLOT_USED_FILE,
} from "../scripts/ci-cache-slot.mjs";
import { applySlot, pruneSlots, SLOT_ENABLED_ENV } from "../scripts/ci-slot-apply.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");

/**
 * 造一个槽目录（可带产物、指纹、邮票、锁）。
 * ⚠️ 指纹文件住在 **`node_modules/` 里面**（`FINGERPRINT_FILE` = `node_modules/.ci-deps-fingerprint`）——
 * 「有指纹」必然意味着「有产物树」，这不是两件独立的事；而「空壳」= 既无 `node_modules` 也无指纹。
 */
function makeSlot(
  cacheRoot: string,
  key: string,
  opts: {
    fingerprint?: string | null;
    lock?: boolean;
    mtime?: number;
    stamp?: number | null;
    tree?: boolean;
  } = {},
): string {
  const dir = path.join(cacheRoot, key);
  mkdirSync(dir, { recursive: true });
  if (opts.tree === true) {
    mkdirSync(path.join(dir, "node_modules"), { recursive: true });
  }
  if (opts.fingerprint !== undefined && opts.fingerprint !== "") {
    const modules = path.join(dir, "node_modules");
    mkdirSync(modules, { recursive: true });
    writeFileSync(path.join(modules, ".ci-deps-fingerprint"), `${opts.fingerprint}\n`);
  }
  if (typeof opts.stamp === "number") {
    writeFileSync(path.join(dir, SLOT_USED_FILE), `${opts.stamp}\n`);
  }
  if (opts.lock === true) {
    writeFileSync(path.join(dir, ".ci-slot.lock"), "");
  }
  if (typeof opts.mtime === "number") {
    const at = new Date(opts.mtime);
    utimesSync(dir, at, at);
  }
  return dir;
}

describe("缓存槽的配额与淘汰（契约）", () => {
  it("配额与 TTL 只有一处（读数侧与执行侧是同一份）", () => {
    /* 执行档**不许**自己写这两个数字：它是「会删盘」那一刀的执行者，而读数那一格
     * 要把「配额是几个」说出来 —— 两处各写一份时，漂了之后没人能回答「哪一份是真的」。 */
    const src = readFileSync(path.join(ROOT, "scripts", "ci-slot-apply.mjs"), "utf8");
    expect(
      /export const MAX_SLOT_KEYS\s*=/.test(src),
      "`ci-slot-apply.mjs` 里又定义了一份配额 —— 它该从读数那一侧取（`ci-cache-slot.mjs`）",
    ).toBe(false);
    expect(/export const SLOT_TTL_MS\s*=/.test(src)).toBe(false);
    expect(/export const SLOT_USED_FILE\s*=/.test(src)).toBe(false);
    /* 空壳谓词同理：两处各写一份的表现是「读数说这几个被 TTL 挡着、执行却无条件回收」
     * （ISSUE #2494）—— 所以它也只能住在读数侧，执行档按名字 import。 */
    expect(
      /function isUselessShell\s*\(/.test(src),
      "`ci-slot-apply.mjs` 里又写了一份空壳谓词 —— 它该从读数那一侧取（`ci-cache-slot.mjs`）",
    ).toBe(false);
    expect(src).toContain('from "./ci-cache-slot.mjs"');
    /* 数字本身也钉住：改它是**改策略**，得走人，不许悄悄改。 */
    expect(MAX_SLOT_KEYS).toBe(4);
    expect(SLOT_TTL_MS).toBe(26 * 60 * 60 * 1000);
    expect(SLOT_TTL_MS).toBeGreaterThan(24 * 60 * 60 * 1000);
  });

  it("淘汰在「命中」那条路上也跑（不再新建键 ⇒ 旧键也得被回收）", () => {
    /* 行为级的断言代价太大（接槽要真建一条 junction），所以这里钉**源码形态** ——
     * 与 `tests/ci-toolchain-selfcheck.test.ts` 的「复验真的排在装之后」同一处置：
     * 那一组也是靠源码切片来钉顺序的。 */
    const src = readFileSync(path.join(ROOT, "scripts", "ci-slot-apply.mjs"), "utf8");
    const reuseAt = src.indexOf('plan.action === "reuse"');
    expect(reuseAt, "执行档里找不到「命中」那一支").toBeGreaterThan(-1);
    const installAt = src.indexOf("install-into-slot");
    const reuseBranch = src.slice(reuseAt, installAt > reuseAt ? installAt : reuseAt + 4000);
    expect(
      reuseBranch,
      "命中那一支没有跑淘汰 —— 于是「依赖面不再变」的那段时间里，过了 TTL 的键会一直躺着",
    ).toContain("pruneAndReport");
  });

  it("空壳那一档：三个条件缺一不可", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-shell-"));
    try {
      const now = 10 * 24 * 60 * 60 * 1000;
      const old = now - SLOT_TTL_MS - 60_000;
      /* 三个条件都满足 ⇒ 回收（哪怕它还在配额之内 —— 空壳不是「一个槽」）。 */
      makeSlot(cache, "空壳", { mtime: old });
      /* 有锁 ⇒ 有人在往里装 ⇒ 不动。 */
      makeSlot(cache, "有锁的空壳", { mtime: old, lock: true });
      /* mtime 还很新 ⇒ 可能是刚建出来的（建目录与拿锁之间有窗口）⇒ 不动。 */
      makeSlot(cache, "新的空壳", { mtime: now });
      /* 有产物 ⇒ 不是空壳 ⇒ 按配额与 TTL 那一档走（这里它在配额内 ⇒ 不动）。 */
      makeSlot(cache, "有产物的", { tree: true, stamp: now, mtime: old });

      const out = pruneSlots({ cacheRoot: cache, keep: 10, now });
      expect(out.evicted).toContain("空壳");
      expect(out.evicted).not.toContain("有锁的空壳");
      expect(out.evicted).not.toContain("新的空壳");
      expect(out.evicted).not.toContain("有产物的");
      expect(existsSync(path.join(cache, "空壳"))).toBe(false);
      expect(existsSync(path.join(cache, "有锁的空壳"))).toBe(true);
      expect(existsSync(path.join(cache, "新的空壳"))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("超额切片里的空壳不算「被 TTL 挡着」（执行档对它无条件回收，ISSUE #2494）", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-shell-held-"));
    try {
      const now = 10 * 24 * 60 * 60 * 1000;
      /* 四个可用键都在闸门内；空壳没有邮票（`expired=false`），旧读数把它也念成
       * 「被 TTL 挡着」。当前键不在盘上 ⇒ 预算 = 配额 - 1 = 3 ⇒ 超额切片是 [d, 空壳]。 */
      for (const [i, k] of ["a", "b", "c", "d"].entries()) {
        makeSlot(cache, k, {
          tree: true,
          fingerprint: k,
          stamp: now - (i + 1) * 60_000,
        });
      }
      makeSlot(cache, "空壳", { mtime: now - SLOT_TTL_MS - 60_000 });

      const slots = listSlots({
        cacheRoot: cache,
        now,
        currentKey: "还没建的键",
      });
      const out = pruneSlots({
        cacheRoot: cache,
        currentKey: "还没建的键",
        now,
      });

      expect(slots.count).toBe(5);
      expect(slots.emptyCount).toBe(1);
      expect(slots.keys.find((k) => k.key === "空壳")?.uselessShell).toBe(true);
      expect(slots.overQuota).toBe(2);
      /* 两份读数说的是同一件事：执行档只留下 d（还在闸门内），空壳当场回收。 */
      expect(slots.heldByTtl).toBe(1);
      expect(out.held).toEqual(["d"]);
      expect(out.evicted).toEqual(["空壳"]);
      expect(slots.heldByTtl).toBe(out.held.length);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("配额那一档仍旧是「超配额且过了 TTL 才淘汰」（闸门内的键一律留着）", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-quota-"));
    try {
      const now = 8 * 60 * 60 * 1000 * 1000;
      const keys = Array.from({ length: MAX_SLOT_KEYS + 2 }, (_, i) => `k${i}`);
      /* 名字越靠前越旧；落在配额之外的那两个必须**超出 TTL** 才可淘汰。 */
      for (const [i, k] of keys.entries()) {
        makeSlot(cache, k, {
          tree: true,
          fingerprint: k,
          stamp: now - (keys.length - i) * 10 * 60 * 60 * 1000,
        });
      }
      const current = keys.at(-1)!;
      const out = pruneSlots({ cacheRoot: cache, currentKey: current, now });
      expect(out.evicted.length).toBe(2);
      expect(out.evicted).not.toContain(current);
      expect(out.held).toEqual([]);
      expect(existsSync(path.join(cache, current))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("闸门内的键一个都不删（用空间换正确性，方向只许这么换）", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-ttl-"));
    try {
      const now = 8 * 60 * 60 * 1000 * 1000;
      const names = ["a", "b", "c", "d", "e"];
      for (const [i, k] of names.entries()) {
        makeSlot(cache, k, {
          tree: true,
          fingerprint: k,
          stamp: now - (names.length - i) * 60_000,
        });
      }
      const out = pruneSlots({ cacheRoot: cache, currentKey: "e", now });
      expect(out.evicted).toEqual([]);
      expect(out.held).toEqual(["a"]);
      expect(existsSync(path.join(cache, "a"))).toBe(true);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("当前键已经在盘上时不再重复占一格（读数与执行同口径，ISSUE #2490）", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-read-"));
    try {
      const now = 10 * 24 * 60 * 60 * 1000;
      /* 三个可用的键 + 一个空壳；当前键 `c` 就在盘上。 */
      for (const [i, k] of ["a", "b", "c"].entries()) {
        makeSlot(cache, k, {
          tree: true,
          fingerprint: k,
          stamp: now - (i + 1) * 60_000,
        });
      }
      makeSlot(cache, "空壳", { mtime: now - SLOT_TTL_MS - 60_000 });
      const slots = listSlots({ cacheRoot: cache, now, currentKey: "c" });
      expect(slots.currentOnDisk).toBe(true);
      expect(slots.count).toBe(4);
      expect(slots.quota).toBe(MAX_SLOT_KEYS);
      /* 4 个键里含当前键 ⇒ 配额之内；`pruneSlots` 对同一份盘一个都不删。
       * 早先这里扣了两次（keys 里数一次、预算里再扣一次）⇒ 报「超配额 1 个」。 */
      expect(slots.overQuota).toBe(0);
      expect(slots.heldByTtl).toBe(0);
      expect(slots.emptyCount).toBe(1);
      expect(slots.keys.map((k) => k.key)).toContain("空壳");
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("当前键还没落盘时它要占一格（键数 = 配额 ⇒ 超配额 1 个）", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-read-"));
    try {
      const now = 10 * 24 * 60 * 60 * 1000;
      const names = ["a", "b", "c", "d"];
      for (const [i, k] of names.entries()) {
        makeSlot(cache, k, {
          tree: true,
          fingerprint: k,
          stamp: now - (i + 1) * 60_000,
        });
      }
      const slots = listSlots({
        cacheRoot: cache,
        now,
        currentKey: "还没建的键",
      });
      expect(slots.currentOnDisk).toBe(false);
      expect(slots.count).toBe(MAX_SLOT_KEYS);
      /* 盘上 4 个 + 当前键还要占一格 ⇒ 预算 3 ⇒ 最旧的那个落在配额之外。 */
      expect(slots.overQuota).toBe(1);
      expect(slots.heldByTtl).toBe(1);
      expect(slots.emptyCount).toBe(0);
      expect(slots.keys.at(-1)?.key).toBe("d");
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("当前键最旧也不许把它算成超额（执行档永远不删它）", () => {
    const cache = mkdtempSync(path.join(tmpdir(), "slot-read-"));
    try {
      const now = 10 * 24 * 60 * 60 * 1000;
      /* a~d 都新鲜；当前键 e 最旧且过了 TTL —— 超额的那一个必须是 d（候选里最旧的），
       * 不是 e。只扣预算、不剔候选时，`keys.slice(quota)` 会正好落在 e 上。 */
      for (const [i, k] of ["a", "b", "c", "d"].entries()) {
        makeSlot(cache, k, {
          tree: true,
          fingerprint: k,
          stamp: now - (i + 1) * 60_000,
        });
      }
      makeSlot(cache, "e", {
        tree: true,
        fingerprint: "e",
        stamp: now - SLOT_TTL_MS - 60_000,
      });
      const slots = listSlots({ cacheRoot: cache, now, currentKey: "e" });
      expect(slots.currentOnDisk).toBe(true);
      expect(slots.count).toBe(MAX_SLOT_KEYS + 1);
      expect(slots.overQuota).toBe(1);
      /* d 还在闸门内 ⇒ 被留着；若把 e 当成超额，它已过 TTL ⇒ 这一格会变成 0。 */
      expect(slots.heldByTtl).toBe(1);
    } finally {
      rmSync(cache, { recursive: true, force: true });
    }
  });

  it("读数那一格的打印里带着那几项（读数落在日志里读不出来，与没有读数等价）", () => {
    const src = readFileSync(path.join(ROOT, "scripts", "ci-cache-slot.mjs"), "utf8");
    for (const word of ["键数", "配额", "超配额", "空槽"]) {
      expect(src, `读数的打印里应当有「${word}」`).toContain(word);
    }
  });

  it("开关没打开时执行档一次都不该被调用（这一条不许被顺手改掉）", () => {
    expect(SLOT_ENABLED_ENV).toBe("COMFY_CI_SLOT");
    /* `applySlot` 是执行者，而调用方（`ci-install-deps.mjs`）按开关决定要不要调它 ——
     * 判据在这里钉住「开关名不许变」，因为回退 = 摘掉那两行 env。 */
    const src = readFileSync(path.join(ROOT, "scripts", "ci-install-deps.mjs"), "utf8");
    expect(src).toContain(SLOT_ENABLED_ENV);
    expect(typeof applySlot).toBe("function");
  });
});
