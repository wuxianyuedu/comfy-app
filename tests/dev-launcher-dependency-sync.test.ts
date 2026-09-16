/**
 * 回归护栏：**启动前的依赖补装，判据是 lockfile 漂移 + 安装结果复核**（ISSUE #636）。
 *
 * 用户现场的后续：`pnpm install` 失败后，用户「再次双击就显示已经没有可安装的了」
 * —— 入口报「依赖已就绪，跳过安装」而应用仍然起不来。原因是判据只看
 * 「`node_modules` 在不在」（`.modules.yaml` + `.bin/next`），而
 * **装了 ≠ 装的是当前 lockfile**：拉了更新（新依赖进 lockfile）后没重装时，
 * 前者照样为真，真正缺席的新依赖会在业务模块解析时才炸出来，报错与「依赖没装」
 * 这句结论完全不像。
 *
 * 本用例钉死三条：
 *   1. `lockfileDrift()` 四态判据（fresh / drift / no-install / no-lockfile）；
 *   2. `verifyInstall()` 是「安装真的成功了」的**复核**入口，不看退出码；
 *   3. 编排器里补装的动作与复核都在（`syncDependencies`：漂移才装、装完复核，
 *      复核不通过即非零退出），且**不许**再退回「每次都无条件 install」。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  lockfileDrift,
  verifyInstall,
} from "../scripts/launcher-core/worktree.mjs";
import { syncDependencies } from "../scripts/dev-launcher.mjs";

const ROOT = process.cwd();
const tmpDirs: string[] = [];
afterEach(() => {
  for (const dir of tmpDirs.splice(0))
    fs.rmSync(dir, { recursive: true, force: true });
});

/** 最小可用 lockfile —— 形态必须**与 pnpm 真实产物同形**。
 *
 *  这一条踩过坑：手写一个「差不多」的 fixture 会让判据**静默失效**，而且看起来
 *  全绿。三处缺一不可（`scripts/lockfile/lock-diff.mjs` 按段/键切分）：
 *    · `settings:` 段要在 `importers:` 之前（否则 `packages:` 会被算进 importer）；
 *    · `packages:` / `snapshots:` 必须是**裸键 + 子块**（`packages: {}` 是行内值，
 *      不匹配顶层段落正则，整段会被吞进上一个段落）；
 *    · 依赖名要比 `dependencies:` 更深一层（`splitTopKeys` 按最小缩进取一级键）。
 *  正确形态可用 `pnpm install --lockfile-only` 在一个空包里生成后对照。 */
function lockText(
  deps: string[] = [
    "      clsx:",
    "        specifier: ^2.1.1",
    "        version: 2.1.1",
  ],
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
function fakeInstall(
  dir: string,
  installedLock: string,
  { healthy = true } = {},
): void {
  const nm = path.join(dir, "node_modules");
  fs.mkdirSync(path.join(nm, ".pnpm"), { recursive: true });
  fs.writeFileSync(path.join(nm, ".pnpm", "lock.yaml"), installedLock, "utf8");
  if (!healthy) return;
  fs.writeFileSync(
    path.join(nm, ".modules.yaml"),
    "hoistPattern: []\n",
    "utf8",
  );
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
    fakeInstall(
      dir,
      fs.readFileSync(path.join(dir, "pnpm-lock.yaml"), "utf8"),
      { healthy: false },
    );
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
    const src = fs.readFileSync(
      path.join(ROOT, "scripts", "dev-launcher.mjs"),
      "utf8",
    );
    expect(src).toContain("export async function syncDependencies");
    expect(src).toMatch(/lockfileDrift\(root\)/);
    expect(src).toMatch(/verifyInstall\(root\)/);
    // 形态判据的唯一出口（不许自己拼可执行名，见 §2.1.6）
    expect(src).toContain("pnpmInvocation(");
    expect(src).not.toMatch(/["']pnpm\.cmd["']/);
  });

  it("编排主流程真的会调用它，失败即非零退出", () => {
    const src = fs.readFileSync(
      path.join(ROOT, "scripts", "dev-launcher.mjs"),
      "utf8",
    );
    const call = src.indexOf("await syncDependencies(");
    expect(call, "启动主流程没有调用依赖对齐").toBeGreaterThan(-1);
    const after = src.slice(call, call + 500);
    expect(after).toContain("return 1");
  });
});
