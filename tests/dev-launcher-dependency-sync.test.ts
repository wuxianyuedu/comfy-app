/**
 * 回归护栏：启动前依赖补装以 lockfile 漂移 + 安装结果复核为判据（ISSUE #636）。现场：`pnpm install` 失败后再次双击报
 * 「依赖已就绪」而应用起不来 —— 旧判据只看 `node_modules` 存在（`.modules.yaml` + `.bin/next`），但「装了 ≠ 装的是当前
 * lockfile」。钉三件：`lockfileDrift()` 四态、`verifyInstall()` 复核成功而非退出码、`syncDependencies` 漂移才装并复核后才放行。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { lockfileDrift, verifyInstall } from "../scripts/launcher-core/worktree.mjs";
import {
  HEARTBEAT_STALE_MS,
  touchHeartbeat,
  writeSession,
} from "../scripts/dev-launcher-session.mjs";
import { syncDependencies } from "../scripts/dev-launcher.mjs";

const ROOT = process.cwd();
const tmpDirs: Array<string> = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 最小可用 lockfile，形态必须与 pnpm 真实产物同形：手写「差不多」的 fixture 会让判据静默失效而看起来全绿。
 * 三处缺一不可（`scripts/lockfile/lock-diff.mjs` 按段/键切）：`settings:` 在 `importers:` 前；`packages:`/`snapshots:` 是裸键
 * + 子块（`packages: {}` 会被吞进上一段）；依赖名比 `dependencies:` 深一层；正确形态用 `pnpm install --lockfile-only` 生成后对照。
 */
function lockText(
  deps: Array<string> = ["      clsx:", "        specifier: ^2.1.1", "        version: 2.1.1"],
): string {
  return [
    "lockfileVersion: '9.0'",
    "",
    "settings:",
    "  autoInstallPeers: true",
    "  excludeLinksFromLockfile: false",
    "",
    "importers:",
    "",
    "  .:",
    "    dependencies:",
    ...deps,
    "",
    "packages:",
    "",
    "snapshots:",
    "",
  ].join("\n");
}

function makeRepo(lock = lockText()): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-sync-"));
  tmpDirs.push(dir);
  fs.writeFileSync(path.join(dir, "pnpm-lock.yaml"), lock, "utf8");
  return dir;
}

/** 往仓库 lockfile 的 importer 依赖块里加一条（模拟「拉了更新引入新依赖」）。 */
function addDepToRepoLock(dir: string, name: string): void {
  const file = path.join(dir, "pnpm-lock.yaml");
  fs.writeFileSync(
    file,
    fs
      .readFileSync(file, "utf8")
      .replace(
        "    dependencies:\n",
        `    dependencies:\n      ${name}:\n        specifier: ^1.0.0\n        version: 1.0.0\n`,
      ),
    "utf8",
  );
}

/** 造一个「装过」的 node_modules：安装时 lockfile + 最小健康标识。 */
function fakeInstall(dir: string, installedLock: string, { healthy = true } = {}): void {
  const nm = path.join(dir, "node_modules");
  fs.mkdirSync(path.join(nm, ".pnpm"), { recursive: true });
  fs.writeFileSync(path.join(nm, ".pnpm", "lock.yaml"), installedLock, "utf8");
  if (!healthy) {
    return;
  }
  fs.writeFileSync(path.join(nm, ".modules.yaml"), "hoistPattern: []\n", "utf8");
  const bin = path.join(nm, ".bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, "next"), "", "utf8");
  for (const rel of ["typescript", "@typescript/native", "next"]) {
    const p = path.join(nm, rel);
    fs.mkdirSync(p, { recursive: true });
    fs.writeFileSync(path.join(p, "index.js"), "// stub\n", "utf8");
  }
}

describe("lockfileDrift：判据是「装的是不是当前 lockfile」", () => {
  it("从没装过 → no-install", () => {
    expect(lockfileDrift(makeRepo()).state).toBe("no-install");
  });

  it("装过且与仓库 lockfile 一致 → fresh", () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"));
    expect(lockfileDrift(dir).state).toBe("fresh");
  });

  it("拉了更新（仓库 lockfile 变了）→ drift（这条此前被漏判出「已就绪」）", () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"));
    // 真·实质漂移：新依赖进了仓库 lockfile（不是注释/空行那类形态差异）
    addDepToRepoLock(dir, "new-dep");
    expect(lockfileDrift(dir).state).toBe("drift");
  });

  it("仓库没有 lockfile → no-lockfile（检出可能不完整，要能区分）", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dep-sync-"));
    tmpDirs.push(dir);
    expect(lockfileDrift(dir).state).toBe("no-lockfile");
  });
});

describe("verifyInstall：复核「目标状态达成了」，不看退出码", () => {
  it("健康安装且 lockfile 一致 → ok", () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"));
    expect(verifyInstall(dir).ok).toBe(true);
  });

  it("安装残缺（缺 .modules.yaml）→ 不通过，并说明缺什么", () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"), { healthy: false });
    const verdict = verifyInstall(dir);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain(".modules.yaml");
  });

  it("lockfile 仍漂移 → 不通过（退出码为 0 也不放行）", () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"));
    addDepToRepoLock(dir, "new-dep");
    const verdict = verifyInstall(dir);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("lock");
  });
});

describe("syncDependencies：漂移才装，装完必须复核", () => {
  it("lockfile 一致时不跑 pnpm install（不再无条件重装一遍）", async () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"));
    // 项目根由脚本自身位置决定，这里用一个**不存在的 cwd** 做哨兵：
    // 若真去跑 pnpm install（它按 root 走）就会失败 —— 不失败即证明没跑。
    const verdict = await syncDependencies(dir, { status: () => undefined });
    expect(verdict).toBeNull();
  });

  it("源头里判据齐全：漂移触发补装 + verifyInstall 复核 + 非零出口", () => {
    /* 实现随编排器拆分搬到 `launcher-core/downstream.mjs`（ISSUE #1811）：
     * 主文件只剩同名薄包装，拿它断言等于什么都没测。 */
    const src = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "downstream.mjs"),
      "utf8",
    );
    expect(src).toContain("export async function syncDependencies");
    expect(src).toMatch(/lockfileDrift\(root\)/);
    expect(src).toMatch(/verifyInstall\(root\)/);
    // 形态判据的唯一出口（不许自己拼可执行名，见 §2.1.6）
    expect(src).toContain("pnpmInvocation(");
    expect(src).not.toMatch(/["']pnpm\.cmd["']/);
    /* 「探不到 pnpm」那一格的出口**必须带上这一份进程读到的 PATH**（ISSUE #2281）：
     * 只有一句「pnpm 不在 PATH 上」时，真没装 / 键名不是 `PATH` / 分隔符读错
     * 三种成因在日志里逐字同形，而它们的下一动作完全不同。 */
    expect(src, "探不到 pnpm 的分支没有给出 PATH 读数").toContain("describePnpmMiss()");
  });

  it("编排主流程真的会调用它，失败即非零退出", () => {
    /* 调用点随预检桥段搬进 `launcher-core/startup-gates.mjs`（ISSUE #1811 拆 R5）：
     * 那一段**内部**判 `if (syncProblem)` 并以 `error` 出口交回，编排器那层把任何
     * `gated.error` 转成 `return 1`。契约是「依赖对齐全在链路里、失败即非零退出」，
     * 所以两处都要断：产出那侧有失败分支、编排那侧把它变成非零。 */
    const gates = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "startup-gates.mjs"),
      "utf8",
    );
    const call = gates.indexOf("await ctx.syncDependencies(");
    expect(call, "预检桥段没有调用依赖对齐").toBeGreaterThan(-1);
    expect(gates.slice(call, call + 400)).toMatch(/if \(syncProblem\)/);
    const launcher = fs.readFileSync(path.join(ROOT, "scripts", "dev-launcher.mjs"), "utf8");
    /* 编排器接住的那一句是 `if (!gated.ok) {`（拆刀后桥段以 `ok` 出口交回，
     * `gated.error` 只是它的一个字段）—— 断言按**实际形态**写，不按旧形态。 */
    const gated = launcher.indexOf("if (!gated.ok) {");
    expect(gated, "编排器没有接住预检失败").toBeGreaterThan(-1);
    expect(launcher.slice(gated, gated + 400)).toContain("return 1");
  });
});

/**
 * 补装前的现场拦截（AGENTS 硬规则 9）。立案现场：`reconcilePort` 排在补装之后几十行，更早的 `reapStaleSession`
 * 在「上一位 launcher 还活着」时刻意什么都不做 ⇒「实例活着 → 直接 install」真实存在；原生模块被活进程锁住时
 * install 以 EPERM 失败并拖垮后续每条 pnpm。判据按归属判，不按端口：隔壁检出占同端口不锁本检出的 `node_modules`。
 */
describe("syncDependencies：本检出实例在跑时先拦下来（AGENTS 硬规则 9）", () => {
  it("会话锚点新鲜且 launcher 存活 → 不装，原因给出 EPERM 与出口", async () => {
    const dir = makeRepo();
    fakeInstall(dir, "lockfileVersion: '9.0'\n\ndrift: true\n");
    // 现场用现成的写入口造，不手抄文件格式（格式漂了这里会静默变成「没在跑」）。
    writeSession(dir, {
      launcher_pid: process.pid,
      child_pids: [],
      app_port: 3123,
      mode: "dev",
      started_at: new Date().toISOString(),
    });
    touchHeartbeat(dir);
    const verdict = await syncDependencies(dir, { status: () => undefined });
    expect(verdict, "本检出有活实例时不该直接去装依赖").not.toBeNull();
    expect(verdict).toContain("正在运行");
    expect(verdict).toContain("EPERM");
    // 出口必须可执行：说清「先关窗口，下次启动自动接着装」，而不是只报失败。
    expect(verdict).toContain("重新");
  });

  it("心跳陈旧（上一位已死）→ 不拦，正常走补装判据", async () => {
    const dir = makeRepo();
    fakeInstall(dir, fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"));
    writeSession(dir, {
      launcher_pid: process.pid,
      child_pids: [],
      app_port: 3123,
      mode: "dev",
      started_at: new Date().toISOString(),
    });
    touchHeartbeat(dir, Date.now() - HEARTBEAT_STALE_MS - 1000);
    // lockfile 一致 → 判据本就返回 null（既不装也不该被拦截分支挡住）。
    expect(await syncDependencies(dir, { status: () => undefined })).toBeNull();
  });

  it('拦截排在 pnpmInvocation(["install"]) 之前（放在之后就等于没拦）', () => {
    const src = fs.readFileSync(
      path.join(ROOT, "scripts", "launcher-core", "downstream.mjs"),
      "utf8",
    );
    const guard = src.indexOf("runningAppInstances(root)");
    const install = src.indexOf('pnpmInvocation(["install"])');
    expect(guard, "补装路径里没有归属探测").toBeGreaterThan(-1);
    expect(install).toBeGreaterThan(-1);
    expect(guard, "探测排在 install 之后 —— 那一步已经锁上了").toBeLessThan(install);
  });

  it("命令行出口复用同一个判据（不在 .ps1 里再写一份端口探测）", () => {
    const cli = fs.readFileSync(path.join(ROOT, "scripts", "deps-install-guard.mjs"), "utf8");
    expect(cli).toContain("runningAppInstances");
    const ps1 = fs.readFileSync(path.join(ROOT, "scripts", "sync-lint.ps1"), "utf8");
    expect(ps1).toContain("deps-install-guard.mjs");
    expect(ps1, "又回到 .ps1 自己探端口那一族").not.toMatch(/Get-NetTCPConnection/);
  });
});
