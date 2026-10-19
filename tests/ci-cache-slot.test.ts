/**
 * 缓存槽读数档的判据（ISSUE #2022 第二步 · 第一增量）。
 *
 * 这一档今天要被钉住的是三件事，都不是「装得快不快」：
 *  ① 四档关系分得开 —— 「没配槽」「键算不出」「槽不在」「槽在但键变了」是四件不同的事，
 *     合成一档的话，日志上那条 `install-into-slot` 就说不清是第一次还是被人改过依赖面；
 *  ② 键与 `ci-install-deps` **同源**（同一条判决链，不另算一份 sha）；
 *  ③ 它**不判红**（恒退 0），且不冒充开关已开。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  FINGERPRINT_FILE,
  pnpmInstallFingerprint,
} from "../scripts/ci-install-deps.mjs";
import {
  CACHE_ROOT_ENV,
  main,
  planSlot,
  SLOT_ACTIONS,
  slotPath,
} from "../scripts/ci-cache-slot.mjs";

const ROOT = path.resolve(__dirname, "..");
const KEY = "a".repeat(64);

/** 临时槽根（用真实文件系统跑 `readSlot` 那一侧，夹具造不出「目录在但没指纹」这一档）。 */
const made: string[] = [];
function tmpRoot(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-slot-"));
  made.push(dir);
  return dir;
}
afterEach(() => {
  for (const dir of made.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("planSlot 的四档关系", () => {
  it("没配槽 / 键算不出 ⇒ no-cache，且两句话不相同（合成一档就分不出「没环境」与「算不出」）", () => {
    const noRoot = planSlot({ cacheRoot: null, key: KEY });
    const noKey = planSlot({ cacheRoot: "C:/slots", key: null });
    expect(noRoot.action).toBe("no-cache");
    expect(noKey.action).toBe("no-cache");
    expect(noRoot.why).toContain(CACHE_ROOT_ENV);
    expect(noKey.why).toContain("算不出来");
    expect(noRoot.why).not.toBe(noKey.why);
    expect(noRoot.path).toBeNull();
  });

  it("槽不在 ⇒ install-into-slot 并给出槽路径；槽在但指纹不合 ⇒ 同样重装（宁可重装，不接来历不明的产物）", () => {
    const missing = planSlot({
      cacheRoot: "C:/slots",
      key: KEY,
      slotPresent: false,
    });
    expect(missing.action).toBe("install-into-slot");
    expect(missing.path).toBe(slotPath("C:/slots", KEY));
    const stale = planSlot({
      cacheRoot: "C:/slots",
      key: KEY,
      slotPresent: true,
      slotFingerprint: "b".repeat(64),
    });
    expect(stale.action).toBe("install-into-slot");
    expect(stale.why).toContain("键变");
  });

  it("键与槽内指纹逐字相同 ⇒ reuse；三档之外的任何返回都是计划函数自己漂了", () => {
    const hit = planSlot({
      cacheRoot: "C:/slots",
      key: KEY,
      slotPresent: true,
      slotFingerprint: KEY,
    });
    expect(hit.action).toBe("reuse");
    for (const plan of [
      planSlot({}),
      planSlot({ cacheRoot: "C:/slots", key: KEY }),
      hit,
    ]) {
      expect(SLOT_ACTIONS).toContain(plan.action);
    }
  });
});

describe("键的来源与读数形态", () => {
  it("槽目录 = `<槽根>/<键>`（跨作业比较只需「同键同目录」）", () => {
    expect(slotPath("C:/slots", KEY)).toBe(path.join("C:/slots", KEY));
  });

  it("打印出来的键就是 `pnpmInstallFingerprint` 那一份（同源，不是第二份 sha）", () => {
    const lines: string[] = [];
    const code = main({
      cwd: ROOT,
      env: { [CACHE_ROOT_ENV]: "" },
      log: (l) => lines.push(l),
    });
    expect(code).toBe(0);
    const expected = pnpmInstallFingerprint(ROOT)?.slice(0, 12);
    expect(
      expected,
      "真仓库的依赖面指纹取不到 ⇒ 这条断言在守的东西本身没了",
    ).toBeTruthy();
    expect(lines.join("\n")).toContain(`键 ${expected}`);
  });

  it("恒不退非零，且明说「今天不复制、不链接、不装」—— 开关没拨过去这件事必须读得出来", () => {
    const lines: string[] = [];
    const root = tmpRoot();
    // 配一个真的槽根 + 里面摆一份合不上的指纹：仍只出读数、仍退 0。
    const key = pnpmInstallFingerprint(ROOT) ?? KEY;
    const slot = path.join(root, key);
    fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
    fs.writeFileSync(
      path.join(slot, FINGERPRINT_FILE),
      "ffffffffffffffffffffffffffffffffffffffff\n",
    );
    const code = main({
      cwd: ROOT,
      env: { [CACHE_ROOT_ENV]: root },
      log: (l) => lines.push(l),
    });
    const text = lines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("install-into-slot");
    expect(text).toContain("不复制、不链接、不装");
    expect(fs.readdirSync(slot).length).toBeGreaterThan(0);
  });

  it("槽里已经有本次指纹 ⇒ 读数走 reuse 那一句话（第二增量的开关就靠这句验证它接对了）", () => {
    const lines: string[] = [];
    const root = tmpRoot();
    const key = pnpmInstallFingerprint(ROOT);
    expect(key).toBeTruthy();
    const slot = path.join(root, key ?? KEY);
    fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(slot, FINGERPRINT_FILE), `${key}\n`);
    main({
      cwd: ROOT,
      env: { [CACHE_ROOT_ENV]: root },
      log: (l) => lines.push(l),
    });
    expect(lines.join("\n")).toContain("结论 reuse");
  });
});
