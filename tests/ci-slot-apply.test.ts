/**
 * 缓存槽执行档（`scripts/ci-slot-apply.mjs`）的回归判据（ISSUE #2022 第二步第二增量）。
 *
 * 判的是**决策与出口**，不是真安装：装那一跳全部由注入的 `run` 接管（真跑一次要 50~70s
 * 且要网络），而这一格里最容易出错的地方恰好都在决策上 ——
 * 键从哪儿来、什么时候判定「能接」、接不上时有没有退回普通装、半套会不会被记成已验证。
 *
 * 三条边界与规范 §13.5.3.4.3 对齐，每条都有对应用例：
 * ① 绝不穿过链装（`clearJobLink` 只摘 reparse point，真树一律不碰）；
 * ② 读不到空闲空间按「不够」处理（不猜充足 —— 猜充足是让机制在唯一需要它的地方静默失效）；
 * ③ 槽内安装失败 ⇒ 删掉半套、不写指纹（下一跑必须重装，而不是命中半套）。
 *
 * 另外钉一条量具自证：`statfsFreeBytes` 在**本机真实路径**上必须读出正数。
 * `os.loadavg()` 在 Windows 上恒 0 的先例说明「接口存在」与「接口在这台机器上有读数」
 * 是两件事，而这里读不到数会被判成「不够」—— 一条静默退回普通装、平台日志照样绿的路。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  applySlot,
  acquireSlotLock,
  clearJobLink,
  FREE_SPACE_FLOOR_BYTES,
  hasRoomForSlot,
  materializeSlotInputs,
  MAX_SLOT_KEYS,
  pruneSlots,
  runJobLifecycle,
  slotInputs,
  SLOT_ENABLED_ENV,
  statfsFreeBytes,
} from "../scripts/ci-slot-apply.mjs";
import {
  FINGERPRINT_FILE,
  pnpmInstallFingerprint,
} from "../scripts/ci-deps-face.mjs";

let job: string;
let cache: string;
let slot: string;
let key: string;

/** 造一份「依赖面四件 + node_modules」的最小作业检出。 */
function seedJob(root: string) {
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  for (const rel of [
    "pnpm-lock.yaml",
    "package.json",
    "pnpm-workspace.yaml",
    "next.config.js",
  ]) {
    fs.writeFileSync(path.join(root, rel), `${rel}\n`);
  }
  fs.writeFileSync(
    path.join(root, "package.json"),
    JSON.stringify(
      {
        name: "seed",
        dependencies: { leftpad: "1.0.0" },
        scripts: { postinstall: "node scripts/install-git-hooks.mjs" },
      },
      null,
      2,
    ),
  );
  fs.mkdirSync(path.join(root, "node_modules"), { recursive: true });
  return root;
}

beforeEach(() => {
  job = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-slot-job-"));
  cache = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-slot-cache-"));
  seedJob(job);
  key = pnpmInstallFingerprint(job) ?? "";
  slot = path.join(cache, key);
});

afterEach(() => {
  for (const dir of [job, cache]) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("槽的输入面与落位", () => {
  it("复制面 == 键算的那一份，且只收真实存在的文件", () => {
    const got = slotInputs(job);
    expect(got).toEqual([
      "pnpm-lock.yaml",
      "package.json",
      "pnpm-workspace.yaml",
      "next.config.js",
    ]);
    // 依赖面里声明了但仓库没有的那一项不该被当成输入（判宽只是少省，判窄是拿旧树跑门禁）。
    fs.rmSync(path.join(job, "next.config.js"));
    expect(slotInputs(job)).not.toContain("next.config.js");
  });

  it("patches/ 在时进复制面（它在指纹里，漏了就是「键相同、产物不同」）", () => {
    fs.mkdirSync(path.join(job, "patches"), { recursive: true });
    fs.writeFileSync(path.join(job, "patches", "a.patch"), "x\n");
    expect(slotInputs(job).some((rel) => rel.includes("a.patch"))).toBe(true);
    // 加一个补丁必须动键：否则两个不同产物共用一个槽目录。
    expect(pnpmInstallFingerprint(job)).not.toBe(key);
  });

  it("落位时摘掉本仓自己的 scripts，其余逐字节照搬", () => {
    const written = materializeSlotInputs({ jobRoot: job, slot });
    const pkg = JSON.parse(
      fs.readFileSync(path.join(slot, "package.json"), "utf8"),
    ) as { scripts?: unknown; dependencies?: Record<string, string> };
    expect(pkg.scripts).toBeUndefined();
    expect(pkg.dependencies).toEqual({ leftpad: "1.0.0" });
    expect(fs.readFileSync(path.join(slot, "pnpm-lock.yaml"), "utf8")).toBe(
      "pnpm-lock.yaml\n",
    );
    expect(written.some((line) => line.includes("已摘 scripts"))).toBe(true);
  });
});

describe("空闲与锁：两条「不够就不做」的闸", () => {
  it("statfsFreeBytes 在真实路径上读得出正数（量具不是恒 0）", () => {
    const free = statfsFreeBytes(job);
    // 读不到就当场把「量具没量到」说清楚：这一格失败意味着机制会在唯一需要它的地方
    // 静默退回普通装，而平台日志照样绿 —— 那不是「测试红」，那是「这次什么都没证明」。
    if (free === null) throw new Error(`statfsFreeBytes 在 ${job} 上读不到数`);
    expect(Number.isFinite(free)).toBe(true);
    expect(free).toBeGreaterThan(0);
  });

  it("路径不存在时给 null，而不是给一个「看起来够用」的数", () => {
    expect(statfsFreeBytes(path.join(job, "没有这个路径"))).toBeNull();
  });

  it("低于下限 ⇒ 不建槽，且原因里带两个数（读数要能自查）", () => {
    const out = hasRoomForSlot({
      path: job,
      floorBytes: 20 * 1024 ** 3,
      probe: () => 10 * 1024 ** 3,
    });
    expect(out.ok).toBe(false);
    expect(out.why).toContain("10.0");
    expect(out.why).toContain("20");
  });

  it("读不到空闲 ⇒ 按不够处理（不许猜充足）", () => {
    expect(hasRoomForSlot({ path: job, probe: () => null }).ok).toBe(false);
    expect(
      hasRoomForSlot({
        path: job,
        probe: () => {
          throw new Error("boom");
        },
      }).ok,
    ).toBe(false);
  });

  it("锁：第一次拿到、第二次抢不到；过期的那把可被接管", () => {
    fs.mkdirSync(slot, { recursive: true });
    let now = 1_000_000;
    const first = acquireSlotLock({ slot, now: () => now });
    expect(first.acquired).toBe(true);
    const second = acquireSlotLock({ slot, now: () => now });
    expect(second.acquired).toBe(false);
    expect(second.why).toContain("持锁");
    now += 21 * 60 * 1000;
    const third = acquireSlotLock({ slot, now: () => now });
    expect(third.acquired).toBe(true);
    expect(third.why).toContain("接管");
    third.release();
    expect(fs.existsSync(path.join(slot, ".ci-slot.lock"))).toBe(false);
  });

  it("锁文件读不出时刻 ⇒ 当成过期处理，而不是永久卡住", () => {
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, ".ci-slot.lock"), "读不出\n");
    const out = acquireSlotLock({ slot, now: () => 5_000_000 });
    expect(out.acquired).toBe(true);
  });
});

describe("applySlot 的三档", () => {
  const env = (root: string | null) => ({
    [SLOT_ENABLED_ENV]: "1",
    COMFY_CI_CACHE_ROOT: root ?? undefined,
  });

  /** 造一个「已装好且键一致」的槽。 */
  function seedInstalledSlot() {
    fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(slot, FINGERPRINT_FILE), `${key}\n`);
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
  }

  it("没配槽根 ⇒ no-cache，且盘上什么都不动", () => {
    const before = fs.readdirSync(cache).length;
    const out = applySlot({
      cwd: job,
      env: env(null),
      run: () => ({ status: 0 }),
      log: () => undefined,
    });
    expect(out).toMatchObject({ handled: false, action: "no-cache" });
    expect(fs.readdirSync(cache).length).toBe(before);
  });

  it("命中 ⇒ 接槽、补作业侧那一笔，且不跑任何 install", () => {
    seedInstalledSlot();
    let installs = 0;
    let lifecycle = 0;
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => {
        installs += 1;
        return { status: 0 };
      },
      spawn: () => {
        lifecycle += 1;
        return { status: 0 };
      },
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(true);
    expect(out.action).toBe("reuse");
    expect(installs).toBe(0);
    // 复用路径整个跳过了 install ⇒ 不补这一笔，作业就少一次 `.git/config` 写入。
    expect(lifecycle).toBe(1);
    expect(fs.lstatSync(path.join(job, "node_modules")).isSymbolicLink()).toBe(
      true,
    );
  });

  it("作业里已有一棵真树 ⇒ 不冒充接管（链建不起来就是 handled=false）", () => {
    fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(slot, FINGERPRINT_FILE), `${key}\n`);
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => ({ status: 0 }),
      spawn: () => ({ status: 0 }),
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(false);
    expect(out.why).toBe("链未建立");
  });

  it("键变了 ⇒ 宁可重装，也不把来历不明的产物接进来", () => {
    fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(slot, FINGERPRINT_FILE), "另一个键\n");
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
    let installs = 0;
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => {
        installs += 1;
        return { status: 1 }; // 让安装失败，只看它有没有去装
      },
      spawn: () => ({ status: 0 }),
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.action).toBe("install-into-slot");
    expect(out.handled).toBe(false);
    expect(installs).toBe(1);
  });

  it("盘不够 ⇒ 不装、不建槽、退回普通装", () => {
    let installs = 0;
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => {
        installs += 1;
        return { status: 0 };
      },
      probe: () => 1 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(false);
    expect(installs).toBe(0);
    expect(fs.existsSync(slot)).toBe(false);
  });

  it("抢不到锁 ⇒ 不在别人的键上装", () => {
    fs.mkdirSync(slot, { recursive: true });
    fs.writeFileSync(path.join(slot, ".ci-slot.lock"), `999 ${Date.now()}\n`);
    let installs = 0;
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => {
        installs += 1;
        return { status: 0 };
      },
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(false);
    expect(installs).toBe(0);
  });

  it("槽内安装退非零 ⇒ 删掉半套、不写指纹（下一跑必须重装）", () => {
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => ({ status: 3 }),
      spawn: () => ({ status: 0 }),
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(false);
    expect(out.why).toContain("退 3");
    expect(fs.existsSync(slot)).toBe(false);
    // 半套被删掉 ⇒ 作业里绝不能留下一条指向它的链（那会让下一次解析到一个不存在的根）。
    expect(fs.existsSync(path.join(job, "node_modules"))).toBe(false);
  });

  it("装成功 ⇒ 写指纹、接槽、补作业侧那一笔", () => {
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
    let installs = 0;
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: (args) => {
        installs += 1;
        expect(args).toEqual(["install", "--frozen-lockfile"]);
        fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
        return { status: 0 };
      },
      spawn: () => ({ status: 0 }),
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(true);
    expect(installs).toBe(1);
    expect(
      fs.readFileSync(path.join(slot, FINGERPRINT_FILE), "utf8").trim(),
    ).toBe(key);
    expect(fs.lstatSync(path.join(job, "node_modules")).isSymbolicLink()).toBe(
      true,
    );
  });

  it("退 0 但没有产物 ⇒ 判成没装上（不把没证据的槽写进指纹）", () => {
    // 「退出码 0 + 说生成了 + 产物一个没更新」这一型在本仓的 typedoc 那格实测过，
    // 槽这一格同样不许拿退出码当唯一证据。
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
    const out = applySlot({
      cwd: job,
      env: env(cache),
      run: () => ({ status: 0 }), // 什么都没装出来
      spawn: () => ({ status: 0 }),
      probe: () => 100 * 1024 ** 3,
      log: () => undefined,
    });
    expect(out.handled).toBe(false);
    expect(out.why).toContain("没有产物");
    expect(fs.existsSync(slot)).toBe(false);
  });
});

describe("作业里那条链的摘除（绝不穿链装）", () => {
  it("指进槽的链：只摘 reparse point，槽那边毫发无损", () => {
    fs.mkdirSync(path.join(slot, "node_modules"), { recursive: true });
    fs.writeFileSync(path.join(slot, "node_modules", ".modules.yaml"), "x\n");
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
    fs.symlinkSync(
      path.join(slot, "node_modules"),
      path.join(job, "node_modules"),
      "junction",
    );
    expect(clearJobLink(job)).toBe(true);
    expect(fs.existsSync(path.join(job, "node_modules"))).toBe(false);
    expect(
      fs.existsSync(path.join(slot, "node_modules", ".modules.yaml")),
    ).toBe(true);
  });

  it("作业里是一棵真树 ⇒ 返回 false 且不碰它", () => {
    const marker = path.join(job, "node_modules", "keep.txt");
    fs.writeFileSync(marker, "mine\n");
    expect(clearJobLink(job)).toBe(false);
    expect(fs.existsSync(marker)).toBe(true);
  });

  it("node_modules 根本不在 ⇒ 判成「没有链」而不是抛", () => {
    fs.rmSync(path.join(job, "node_modules"), { recursive: true, force: true });
    expect(clearJobLink(job)).toBe(false);
  });
});

describe("LRU 与作业侧补写", () => {
  it("超出配额先淘汰最久没用的，当前键永不淘汰", () => {
    const keys = Array.from({ length: MAX_SLOT_KEYS + 2 }, (_, i) => `k${i}`);
    for (const k of keys) {
      const dir = path.join(cache, k);
      fs.mkdirSync(dir, { recursive: true });
      // 名字越靠前越旧：用未来时间戳排最新的那几个。
      const when = new Date(
        Date.now() - (keys.length - Number(k.slice(1))) * 60_000,
      );
      fs.utimesSync(dir, when, when);
    }
    const current = keys[keys.length - 1] ?? "";
    const evicted = pruneSlots({ cacheRoot: cache, currentKey: current });
    expect(evicted.length).toBe(2);
    expect(evicted).not.toContain(current);
    expect(fs.existsSync(path.join(cache, current))).toBe(true);
  });

  it("槽根不在 ⇒ 不抛，返回空淘汰清单（没得淘汰就是没得淘汰）", () => {
    expect(pruneSlots({ cacheRoot: path.join(cache, "没有这个目录") })).toEqual(
      [],
    );
  });

  it("作业侧补写退非零 ⇒ 如实报 ok=false 并带上退出码", () => {
    const out = runJobLifecycle({
      jobRoot: job,
      spawn: () => ({ status: 2 }),
    });
    expect(out.ok).toBe(false);
    expect(out.why).toContain("2");
  });

  it("默认出口真起得来：按 <作业根>/scripts/install-git-hooks.mjs 那条路径起 node", () => {
    // 注入的 spawn 永远测不到默认那一段（`spawnSync(process.execPath, …)` 的 argv 拼法
    // 与 cwd 归属）。这里在临时作业根里放一个只写一个标记文件的桩 —— 它证明的是
    // 「被起的是那一份」，而不是「本仓那份钩子脚本能用」（后者早有它自己的用例）。
    fs.mkdirSync(path.join(job, "scripts"), { recursive: true });
    const marker = path.join(job, "spawned.txt");
    fs.writeFileSync(
      path.join(job, "scripts", "install-git-hooks.mjs"),
      `import fs from "node:fs";\nfs.writeFileSync(${JSON.stringify(marker)}, "ok");\n`,
    );
    const out = runJobLifecycle({ jobRoot: job });
    expect(out.ok).toBe(true);
    expect(fs.existsSync(marker)).toBe(true);
    expect(fs.readFileSync(marker, "utf8")).toBe("ok");
  });
});

describe("常量与判据的配对", () => {
  it("空闲下限是 20 GiB（配额按「个」而不按「GB」的前提）", () => {
    expect(FREE_SPACE_FLOOR_BYTES).toBe(20 * 1024 ** 3);
    expect(MAX_SLOT_KEYS).toBe(4);
  });

  it("开关的名字不许被改名改掉（`.cnb.yml` 与用例都按这个名字拨）", () => {
    expect(SLOT_ENABLED_ENV).toBe("COMFY_CI_SLOT");
  });
});
