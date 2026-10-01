/**
 * `quality-gate.ps1` 的依赖预检（ISSUE #1338）。
 *
 * 这里判的是一件**双重的**事：
 *
 * 1. **判决必须走 Node 侧那份语义比较器**，不许自己比文件哈希。pnpm 复制到
 *    `node_modules\.pnpm\lock.yaml` 的那份与仓库根 `pnpm-lock.yaml` **本就不同形**
 *    （本机实测 12910 行 vs 13068 行：顶层键顺序不同、根文件里含 `---` 分隔的第二段，
 *    而两者由同一次 install 写下、mtime 只差 1 秒）⇒ 哈希比对恒为「不一致」，于是
 *    Windows 那一侧的一键门禁**不论依赖新不新鲜都停在预检**，一条门禁都跑不到。
 *    而它下面打印的差异明细走的就是语义比较器，结论恰好是「实质一致」—— 同一段里
 *    两个结论互相矛盾，本条把它钉成一次真跑。
 * 2. **「判不了」不等于「不一致」**。判据自己跑不起来（缺文件、node 起不来）时，
 *    Node 的默认退出码是 1，而 1 在这份契约里是「判出了实质差异」—— 不分开的话，
 *    机器会指着人说「去重装」，而真实原因是判据没了（这正是本条实测到的形态）。
 *
 * 无 PowerShell 的环境（Linux CI）只做静态断言：真实执行在 Windows 侧。
 * 断言一律打在 ASCII 标签（`[DEP-DRIFT]` / `[DEP-JUDGE]`）与 ASCII 的差异明细上 ——
 * `Write-Host` 的中文经 `powershell.exe` 管道出来是 GBK 乱码，认中文子串的用例会
 * 随宿主与代码页变红（同一条坑在 §8.1 记过）。
 */
import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

const ROOT = process.cwd();
const GATE_PS1 = path.join(ROOT, "scripts", "quality-gate.ps1");
const LOCK_CLI = path.join(ROOT, "scripts", "lockfile", "diff-cli.mjs");
const gateSrc = fs.readFileSync(GATE_PS1, "utf8");

/** 可用时真跑的 PowerShell 宿主（优先 pwsh 7，它按 UTF-8 输出）。 */
const psExe = (() => {
  for (const candidate of ["pwsh", "powershell"]) {
    try {
      execFileSync(candidate, ["-NoProfile", "-Command", "exit 0"], {
        stdio: "ignore",
      });
      return candidate;
    } catch {
      // 试下一个候选
    }
  }
  return "";
})();
const hasPs = psExe !== "";

const tmpDirs: string[] = [];
afterAll(() => {
  for (const dir of tmpDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * 造一份**假检出**：只放预检要看的那几样。
 *
 * 不在真仓库里改 `pnpm-lock.yaml` 来验反向：本仓允许并行会话共用同一台机器，
 * 一瞬间的锁文件改动会喂给别人的门禁（同族纪律见 §13.6.2「别线的红不许为它放宽」）。
 */
function makeFakeRepo(
  opts: {
    lockfileText?: string;
    dropFiles?: string[];
  } = {},
): { root: string; installedLock: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dep-precheck-"));
  tmpDirs.push(root);
  fs.mkdirSync(path.join(root, "scripts", "lockfile"), { recursive: true });
  fs.mkdirSync(path.join(root, "node_modules", ".pnpm"), { recursive: true });
  fs.copyFileSync(GATE_PS1, path.join(root, "scripts", "quality-gate.ps1"));
  fs.copyFileSync(
    path.join(ROOT, "scripts", "quality-gate-shared.mjs"),
    path.join(root, "scripts", "quality-gate-shared.mjs"),
  );
  for (const name of [
    "diff-cli.mjs",
    "lock-diff.mjs",
    "render-lock-diff.mjs",
  ]) {
    fs.copyFileSync(
      path.join(ROOT, "scripts", "lockfile", name),
      path.join(root, "scripts", "lockfile", name),
    );
  }
  const installedLock = path.join(root, "node_modules", ".pnpm", "lock.yaml");
  fs.copyFileSync(
    path.join(ROOT, "node_modules", ".pnpm", "lock.yaml"),
    installedLock,
  );
  fs.writeFileSync(
    path.join(root, "pnpm-lock.yaml"),
    opts.lockfileText ??
      fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8"),
    "utf8",
  );
  for (const rel of opts.dropFiles ?? []) {
    fs.rmSync(path.join(root, rel), { force: true });
  }
  return { root, installedLock };
}

/** 跑假检出的预检：拿退出码 + 合并后的输出。 */
function runGate(root: string): { status: number; out: string } {
  const r = spawnSync(
    psExe,
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      path.join(root, "scripts", "quality-gate.ps1"),
      "-Mode",
      "dependencyAudit",
    ],
    { cwd: root, encoding: "utf8", timeout: 180_000 },
  );
  return { status: r.status ?? -1, out: `${r.stdout ?? ""}${r.stderr ?? ""}` };
}

describe("预检的两种失败形态（静态）", () => {
  /**
   * 「不许再自己比哈希」这条**已有归属**：`tests/lockfile-diff.test.ts` 的「漂移分支接线」
   * 那组，与 `prepare-local-run.ps1` 的同一判据放在一起。这里不再写第二份
   * （§13.5「先查有没有更强的一条」），只钉本刀新增的那格：两种失败形态必须分开说。
   */
  it("「不一致」与「判不了」各有自己的 ASCII 标签（乱码环境里也能断言）", () => {
    expect(gateSrc).toContain("[DEP-DRIFT]");
    expect(gateSrc).toContain("[DEP-JUDGE]");
  });
});

describe("diff-cli 的退出码契约（纯 Node，跨平台）", () => {
  it("0 = 一致；1 = 判出实质差异（只改 overrides 一行也算）", () => {
    const { root } = makeFakeRepo();
    const same = spawnSync(
      process.execPath,
      [
        LOCK_CLI,
        "--installed",
        path.join(ROOT, "node_modules", ".pnpm", "lock.yaml"),
        "--root",
        root,
      ],
      { encoding: "utf8" },
    );
    expect(same.status).toBe(0);

    const real = fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
    // 只动 overrides 里的一行版本号 —— importer 表、packages/snapshots 全部原样。
    // 这条正是 #1338 要求补的反向验证：语义比较器读的是哪一份 document、
    // 会不会把「改了 overrides 却没重装」漏掉。
    const mutated = real.replace("  undici@7: 7.29.1", "  undici@7: 7.99.9");
    expect(mutated).not.toBe(real);
    fs.writeFileSync(path.join(root, "pnpm-lock.yaml"), mutated, "utf8");
    const diff = spawnSync(
      process.execPath,
      [
        LOCK_CLI,
        "--installed",
        path.join(ROOT, "node_modules", ".pnpm", "lock.yaml"),
        "--root",
        root,
      ],
      { encoding: "utf8" },
    );
    expect(diff.status).toBe(1);
    expect(diff.stdout).toContain("undici@7");
  });

  it("判据内部意外 → 2（不许顶着一律退 1 被读成「依赖陈旧」）", () => {
    const r = spawnSync(
      process.execPath,
      [
        LOCK_CLI,
        "--installed",
        path.join(ROOT, "node_modules", ".pnpm"),
        "--root",
        ROOT,
      ],
      { encoding: "utf8" },
    );
    expect(r.status).toBe(2);
    expect(`${r.stdout}${r.stderr}`).toContain("[lock-diff]");
  });
});

describe.skipIf(!hasPs)("依赖预检真跑（Windows / 有 PowerShell 时）", () => {
  it("当前真状态：不许停在预检，必须跑到门禁本体", () => {
    const { root } = makeFakeRepo();
    const r = runGate(root);
    expect(r.out).not.toContain("[DEP-DRIFT]");
    expect(r.out).not.toContain("[DEP-JUDGE]");
    // 跑到 $Blocks 的证据：门禁 label 出现在输出里（旧形状在这里永远只有预检那四行）
    expect(r.out).toContain("Dependency audit ratchet");
  });

  it("实质差异：判红，且明细点名到具体哪一行变了", () => {
    const real = fs.readFileSync(path.join(ROOT, "pnpm-lock.yaml"), "utf8");
    const { root } = makeFakeRepo({
      lockfileText: real.replace(
        "  brace-expansion@1: 1.1.20",
        "  brace-expansion@1: 1.0.0",
      ),
    });
    const r = runGate(root);
    expect(r.status).not.toBe(0);
    expect(r.out).toContain("[DEP-DRIFT]");
    expect(r.out).toContain("brace-expansion@1");
  });

  it("判据本身没了：要说「判不了」，不许让人去重装", () => {
    const { root } = makeFakeRepo({
      dropFiles: ["scripts/lockfile/lock-diff.mjs"],
    });
    const r = runGate(root);
    expect(r.out).toContain("[DEP-JUDGE]");
    expect(r.out).not.toContain("[DEP-DRIFT]");
  });
});

describe.skipIf(!hasPs)(
  "所有 .ps1 必须可解析（补上「没人解析 PowerShell」那一格）",
  () => {
    it("scripts/ 与 tools/ 下的每份 .ps1 都是 0 个 ParserError", () => {
      const files: string[] = [];
      for (const base of ["scripts", "tools"]) {
        const walk = (dir: string): void => {
          for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) walk(p);
            else if (e.name.endsWith(".ps1")) files.push(p);
          }
        };
        walk(path.join(ROOT, base));
      }
      expect(files.length).toBeGreaterThan(0);
      // 一次进程内跑完所有解析：逐份 spawn 在这个仓的机器上比解析本身贵两个数量级。
      // 路径**不转义反斜杠**：PS 的单引号串里 `\` 就是字面量，而翻倍后开头那两个 `\`
      // 会被 .NET 当成 UNC 前缀看（同一条「PS 里 \ 不是转义符」的坑见 quality-gate.ps1）。
      const script = files
        .map(
          (f) =>
            `$e=$null;[System.Management.Automation.Language.Parser]::ParseFile(` +
            `'${f}',[ref]$null,[ref]$e)|Out-Null;` +
            `if($e.Count -gt 0){"BROKEN: ${f} " + $e.Count}`,
        )
        .join("\n");
      const out = execFileSync(psExe, ["-NoProfile", "-Command", script], {
        encoding: "utf8",
      });
      expect(out).not.toContain("BROKEN");
    });
  },
);
