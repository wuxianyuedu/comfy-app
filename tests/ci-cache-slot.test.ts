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
  resolveCacheRoot,
  sameVolumeAs,
  SLOT_ACTIONS,
  slotPath,
} from "../scripts/ci-cache-slot.mjs";

const ROOT = path.resolve(__dirname, "..");
const KEY = "a".repeat(64);

/**
 * 临时槽根（用真实文件系统跑 `readSlot` 那一侧，夹具造不出「目录在但没指纹」这一档）。
 *
 * ⚠️ 它必须与 `ROOT` **同卷**：执行档现在会拦跨卷的槽根（那条守卫是 #2049 之后一次
 * `EXDEV` 真红换来的），而 `os.tmpdir()` 在 C:、本仓在 F: —— 拿 tmp 当槽根会让
 * 「槽不在 ⇒ install-into-slot」这一档永远测不到，看起来像判据坏了。
 * 落点取卷根下的临时目录，正是生产里推导出来的那个位置同一层。
 */
const made: string[] = [];
function tmpRoot(): string {
  const onRepoVolume = path.join(path.parse(ROOT).root, "comfy-slot-test");
  let dir: string;
  try {
    dir = fs.mkdtempSync(onRepoVolume);
  } catch {
    // POSIX 上卷根不可写 ⇒ 退回 tmp（此时同卷守卫在该平台上恒真，不影响这些用例）。
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "ci-slot-"));
  }
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
      // 不注入就会真去起一次 pnpm 问 store（用例不许依赖宿主的 pnpm 与网络）。
      run: () => ({ status: 1 }),
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
    /* 读数里要明说当前键就在盘上 —— 否则「键数 = 配额却报超额」看不出成因（ISSUE #2490）。 */
    expect(lines.join("\n")).toContain("当前键已在盘上");
  });
});

describe("槽根的推导（不写死盘符）", () => {
  /** 与真仓库同卷的一个假 store 路径（`pnpm store path` 会答成这个形态）。 */
  const storeOnThisVolume = () =>
    path.join(path.parse(ROOT).root, ".pnpm-store", "v11");

  it("显式 `COMFY_CI_CACHE_ROOT` 优先，且来源被点名（那是「这台机器要放另一块盘」的出口）", () => {
    const out = resolveCacheRoot({
      cwd: ROOT,
      env: { [CACHE_ROOT_ENV]: "D:/somewhere/else" },
      run: () => {
        throw new Error("显式配了就不该再起 pnpm");
      },
    });
    expect(out.root).toBe("D:/somewhere/else");
    expect(out.from).toContain(CACHE_ROOT_ENV);
  });

  it("没配时由 store 推导，并且**与 store 同卷**（跨卷 ⇒ 硬链接退化成整树复制）", () => {
    const store = storeOnThisVolume();
    const out = resolveCacheRoot({
      cwd: ROOT,
      env: {},
      run: () => ({ status: 0, stdout: `${store}\n` }),
    });
    expect(out.root).not.toBeNull();
    expect(path.parse(out.root!).root).toBe(path.parse(store).root);
    expect(out.root!.endsWith(path.join("ci-cache", "comfy-app-t3"))).toBe(
      true,
    );
    expect(out.from).toContain(store);
  });

  it("runner 换盘 ⇒ 推导跟着换，配置一个字都不用改（这一条就是那次搬家要防的事）", () => {
    const answerFor = (driveRoot: string) =>
      path.join(driveRoot, ".pnpm-store", "v11");
    const rootOf = (driveRoot: string) =>
      resolveCacheRoot({
        cwd: ROOT,
        env: {},
        run: () => ({ status: 0, stdout: answerFor(driveRoot) }),
      }).root;
    const a = rootOf("F:\\")!;
    const b = rootOf("G:\\")!;
    expect(path.parse(a).root).not.toBe(path.parse(b).root);
    expect(a).toContain("ci-cache");
    expect(b).toContain("ci-cache");
  });

  it("问不出 store ⇒ 不设槽（宁可不省，也不猜一个卷）", () => {
    expect(
      resolveCacheRoot({ cwd: ROOT, env: {}, run: () => ({ status: 1 }) }).root,
    ).toBeNull();
    expect(
      resolveCacheRoot({
        cwd: ROOT,
        env: {},
        run: () => ({ status: 0, stdout: "   \n" }),
      }).root,
    ).toBeNull();
    expect(resolveCacheRoot({ cwd: ROOT, env: {} }).root).toBeNull();
  });

  it("读数里必须连着来源一起出现（一个路径孤零零摆在那儿，读的人不知道它是哪来的）", () => {
    const lines: string[] = [];
    main({
      cwd: ROOT,
      env: {},
      run: () => ({ status: 0, stdout: `${storeOnThisVolume()}\n` }),
      log: (l: string) => lines.push(l),
    });
    const text = lines.join("\n");
    expect(text).toContain("槽根来源");
    expect(text).toContain(".pnpm-store");
  });
});

describe("第二条同卷义务：槽与作业必须同卷", () => {
  it("同卷判真、跨卷判假（Windows 上就是盘符；POSIX 上根恒 `/` ⇒ 恒真）", () => {
    expect(sameVolumeAs(ROOT, path.join(ROOT, "node_modules"))).toBe(true);
    if (process.platform === "win32") {
      expect(sameVolumeAs("D:/ci-cache/repo", ROOT)).toBe(false);
      // 空串**不是**「读不到」：`path.resolve("")` 落在 cwd ⇒ 判同卷。
      // 「没有槽根」这件事由上一格（`planSlot` 的 `!cacheRoot`）去说，别指望这里拦。
      expect(sameVolumeAs("", ROOT)).toBe(true);
    }
  });

  it("跨卷 ⇒ no-cache，且那句话把后果说清（红会落在别人一条用例里）", () => {
    const out = planSlot({
      cacheRoot: "D:/ci-cache/repo",
      key: KEY,
      sameVolume: false,
    });
    expect(out.action).toBe("no-cache");
    expect(out.why).toContain("同一卷");
    expect(out.why).toContain("EXDEV");
  });

  it("没给这条事实时不拦（默认同卷 ⇒ 既有四档的形状不变）", () => {
    expect(planSlot({ cacheRoot: "D:/ci-cache/repo", key: KEY }).action).toBe(
      "install-into-slot",
    );
  });
});
