/**
 * 回归护栏：**Linux / macOS 首次上手链路的 `.env` 引导**（ISSUE #489）。
 *
 * 背景（实测复现，本机 Linux 干净检出）：
 *
 *   1. 文档 §9.1 与 README 的第一步都是 `cp .env.example .env`，但
 *      `.env.example` 里 `BETTER_AUTH_SECRET` 与两个 `BETTER_AUTH_GITHUB_*`
 *      都是**空串**，而 `src/env.js` 的 createEnv 配了
 *      `emptyStringAsUndefined: true` —— 空串等价于「没给」。于是照文档走的人
 *      拿到的是 `Invalid environment variables`，看不出是「值留空」。
 *      Windows 侧一直有 `scripts/prepare-local-run.ps1` 的第 4 步自动补齐
 *      （随机密钥 + OAuth 占位值），**Linux / macOS 没有任何等价物**。
 *   2. 更误导的是失败**发生的时机**：Next 会先打印
 *      `- Local: http://localhost:<port>` 与 `✓ Ready in 77ms`，之后才抛
 *      `Failed to load next.config.js`。用户读到的是「起来了但报错」，
 *      而真相是端口无人监听；且缺文件那条提示里的小贴士指向
 *      `tools/start/run-local.ps1`（Windows 专属，本模式明确不依赖）。
 *
 * 本用例钉死两条契约（反向验证：分别还原旧实现，对应用例必失败）：
 *   · `.env` 的生成/补齐有跨平台入口 `pnpm env:init`，且它生成的内容**真的**
 *     能让 `checkEnvFile` 通过（不是「脚本跑完了」就算数）；
 *   · `dev.mjs` / `start.mjs` 在**起 Next 之前**做预检并退出，
 *     从而不可能再出现「先 ✓ Ready 再崩」。
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  REQUIRED_ENV_KEYS,
  checkEnvFile,
  parseEnvFile,
} from "../scripts/env-preflight.mjs";

const ROOT = process.cwd();
const EXAMPLE = path.join(ROOT, ".env.example");

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "env-bootstrap-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/** 真跑 `scripts/env-init.mjs`（把项目根换成临时目录的等价形态不成立——
 *  脚本按自身位置定位项目根，所以这里用一个同名的最小检出副本）。 */
function runEnvInitIn(files: Record<string, string>): {
  status: number | null;
  stdout: string;
  stderr: string;
  scriptPath: string;
} {
  const scriptsDir = path.join(tmp, "scripts");
  fs.mkdirSync(scriptsDir, { recursive: true });
  const scriptPath = path.join(scriptsDir, "env-init.mjs");
  fs.copyFileSync(path.join(ROOT, "scripts", "env-init.mjs"), scriptPath);
  for (const [rel, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tmp, rel), content, "utf8");
  }
  const r = spawnSync(process.execPath, [scriptPath], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return {
    status: r.status,
    stdout: r.stdout ?? "",
    stderr: r.stderr ?? "",
    scriptPath,
  };
}

describe("pnpm env:init：跨平台补齐 .env 的必填项", () => {
  it("package.json 提供 env:init 入口（Windows 的 prepare-local-run.ps1 在 Linux 上不可用）", () => {
    const pkg = JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["env:init"]).toBe("node scripts/env-init.mjs");
  });

  it("从 .env.example 生成后，三个必填项都非空且能过预检", () => {
    const r = runEnvInitIn({ ".env.example": fs.readFileSync(EXAMPLE, "utf8") });
    expect(r.status, r.stderr).toBe(0);

    const envPath = path.join(tmp, ".env");
    expect(fs.existsSync(envPath), "必须真的产出 .env").toBe(true);
    const parsed = parseEnvFile(fs.readFileSync(envPath, "utf8"));
    for (const key of REQUIRED_ENV_KEYS) {
      expect(parsed.get(key)?.trim(), `${key} 必须非空`).toBeTruthy();
    }
    // 密钥要满足 src/env.js 的 min(32)（随机 hex 是 64 位）。
    expect(parsed.get("BETTER_AUTH_SECRET")!.length).toBeGreaterThanOrEqual(32);
    // 最关键的一条：生成物必须真的能过**同一套**预检判据。
    // 只断言「脚本没有报错」是不够的——老的 `cp .env.example .env` 也能 exit 0。
    expect(checkEnvFile(tmp, {})).toBeNull();
  });

  it("已存在的 .env 不被覆盖（只补空值）", () => {
    const example = fs.readFileSync(EXAMPLE, "utf8");
    // .env.example 里的 COMFYAPP_PORT 是注释行，这里按「用户已启用固定端口」的
    // 真实形态改成未注释的赋值，验证补齐时不会把它连同空值一起重写掉。
    const custom =
      example.replace(/^# COMFYAPP_PORT=.*$/m, 'COMFYAPP_PORT="3456"');
    const first = runEnvInitIn({ ".env.example": example, ".env": custom });
    expect(first.status).toBe(0);
    const after = fs.readFileSync(path.join(tmp, ".env"), "utf8");
    expect(after).toMatch(/^COMFYAPP_PORT="3456"$/m);
    expect(checkEnvFile(tmp, {})).toBeNull();
  });

  it("已存在且必填项非空时跳过，不动用户内容", () => {
    const example = fs.readFileSync(EXAMPLE, "utf8");
    const filled = example
      .replace(/^BETTER_AUTH_SECRET=.*$/m, 'BETTER_AUTH_SECRET="' + "a".repeat(64) + '"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_ID=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_ID="mine"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_SECRET="mine"');
    const before = filled;
    const r = runEnvInitIn({ ".env.example": example, ".env": filled });
    expect(r.status).toBe(0);
    expect(fs.readFileSync(path.join(tmp, ".env"), "utf8")).toBe(before);
    expect(r.stdout).toContain("跳过");
  });

  it("改写没命中行时非零退出（不留一个仍然起不来的 .env）", () => {
    // .env.example 的键名被改掉 = 真实会发生的漂移；此时必须失败而不是貌似成功。
    const broken = fs
      .readFileSync(EXAMPLE, "utf8")
      .replace(/^BETTER_AUTH_SECRET=.*$/m, "# BETTER_AUTH_SECRET 被改名了");
    const r = runEnvInitIn({ ".env.example": broken });
    expect(r.status, "生成不出必填项时必须非零退出").not.toBe(0);
  });

  it("找不到 .env.example 时非零退出", () => {
    const r = runEnvInitIn({});
    expect(r.status).not.toBe(0);
  });
});

describe("预检判据与 src/env.js 同口径", () => {
  it("空串等于没给（emptyStringAsUndefined）", () => {
    const content = [
      'BETTER_AUTH_SECRET=""',
      'BETTER_AUTH_GITHUB_CLIENT_ID=""',
      'BETTER_AUTH_GITHUB_CLIENT_SECRET=""',
    ].join("\n");
    fs.writeFileSync(path.join(tmp, ".env"), content, "utf8");
    const problem = checkEnvFile(tmp, {});
    expect(problem, "空串必须被判为未就绪").not.toBeNull();
    for (const key of REQUIRED_ENV_KEYS) expect(problem!.message).toContain(key);
  });

  it("缺文件时报的是「找不到 .env」，并且不夹带任何 Windows 专属入口", () => {
    const problem = checkEnvFile(tmp, {});
    expect(problem).not.toBeNull();
    expect(problem!.message).toContain(".env");
    // 旧实现的提示里写着「双击 tools/start/run-local.ps1」——本模式零 .ps1 依赖。
    expect(problem!.message).not.toContain("run-local.ps1");
    expect(problem!.message).toContain("env:init");
  });

  it("三平台同一条提示：不出现 Windows 专属入口", () => {
    fs.writeFileSync(path.join(tmp, ".env"), "", "utf8");
    const problem = checkEnvFile(tmp, {});
    // 旧实现的小贴士指向 `tools/start/run-local.ps1`（Windows 专属）。
    expect(problem!.message).not.toContain("run-local.ps1");
    expect(problem!.message).not.toMatch(/tools\\|tools\//);
    expect(problem!.message).toContain("env:init");
  });

  it("SKIP_ENV_VALIDATION 时整体跳过（与 src/env.js 一致）", () => {
    // 连「缺文件」都跳过：CI / Playwright 正是靠这一个开关跑在无 .env 的检出上。
    expect(checkEnvFile(tmp, { SKIP_ENV_VALIDATION: "1" })).toBeNull();
    // 环境变量已显式给出时不算缺失（与 createEnv 的取值顺序一致）。
    fs.writeFileSync(path.join(tmp, ".env"), "", "utf8");
    expect(
      checkEnvFile(tmp, {
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_GITHUB_CLIENT_ID: "id",
        BETTER_AUTH_GITHUB_CLIENT_SECRET: "secret",
      }),
      "环境变量已显式给出时不算缺失（与 createEnv 的取值顺序一致）",
    ).toBeNull();
    // 只给一部分仍算缺失——避免判据退化成「任一非空即通过」。
    expect(
      checkEnvFile(tmp, {
        BETTER_AUTH_SECRET: "x".repeat(32),
        BETTER_AUTH_GITHUB_CLIENT_ID: "id",
        BETTER_AUTH_GITHUB_CLIENT_SECRET: "secret",
      }),
    ).toBeNull();
  });

  it("解析器忽略注释行、支持带引号与不带引号两种写法", () => {
    const parsed = parseEnvFile(
      [
        "# BETTER_AUTH_SECRET=\"注释里的不算\"",
        'BETTER_AUTH_SECRET="abc"',
        "BETTER_AUTH_GITHUB_CLIENT_ID=plain",
      ].join("\n"),
    );
    expect(parsed.get("BETTER_AUTH_SECRET")).toBe("abc");
    expect(parsed.get("BETTER_AUTH_GITHUB_CLIENT_ID")).toBe("plain");
  });
});

describe("dev/start 在起 Next 之前预检", () => {
  const entries = ["scripts/dev.mjs", "scripts/start.mjs"];

  it.each(entries)("%s 调用 exitIfEnvNotReady 且发生在 spawn 之前", (rel) => {
    const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
    expect(src).toContain('import { exitIfEnvNotReady } from "./env-preflight.mjs"');
    const gate = src.indexOf("exitIfEnvNotReady(root)");
    const spawn = src.search(/spawnSync\(/);
    expect(gate, "必须调用预检").toBeGreaterThan(-1);
    expect(spawn, "必须起子进程").toBeGreaterThan(-1);
    // 顺序才是关键：预检在 spawn 之前，Next 才没机会先打印「✓ Ready」。
    expect(gate, `${rel}: 预检必须在 spawn 之前`).toBeLessThan(spawn);
  });

  it("预检失败时真跑非零退出，且**不**打印 Next 的 Ready 行", () => {
    // 真跑入口脚本，指向一个没有 .env 的目录（脚本按自身位置定位项目根，
    // 所以把入口与预检模块复制到一个最小检出副本里）。
    const scriptsDir = path.join(tmp, "scripts");
    fs.mkdirSync(scriptsDir, { recursive: true });
    // `dev.mjs` 的模块图里还有 `db-schema-state.mjs` 与它自己的依赖
    // （`db-push-core.mjs` / `lockfile/*` / `standalone-private-inputs.mjs`…）：
    // 少拷一份，spawn 出来的就是「模块找不到」而不是预检结论 —— 那正是本条
    // 断言曾经抓不住的东西（输出里只有 ERR_MODULE_NOT_FOUND 的调用栈）。
    const needed = [
      "dev.mjs",
      "env-preflight.mjs",
      "app-port.mjs",
      "db-schema-state.mjs",
      "db-push-core.mjs",
      "standalone-private-inputs.mjs",
    ];
    for (const name of needed) {
      const src = path.join(ROOT, "scripts", name);
      if (fs.existsSync(src)) fs.copyFileSync(src, path.join(scriptsDir, name));
    }
    for (const dir of ["lockfile"]) {
      const from = path.join(ROOT, "scripts", dir);
      if (!fs.existsSync(from)) continue;
      const to = path.join(scriptsDir, dir);
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        fs.copyFileSync(path.join(from, name), path.join(to, name));
      }
    }
    // `dev.mjs` 依赖 `launcher-core/shell.mjs`（pnpm 可执行形态的单一判据，
    // 见规范 §2.1.1）与它 import 的 `command-echo.mjs`（命令行回显的唯一出口，
    // 见规范 §4.4）：副本里少一份，import 就失败、测的就不是预检了。
    for (const name of ["shell.mjs", "command-echo.mjs"]) {
      fs.mkdirSync(path.join(scriptsDir, "launcher-core"), { recursive: true });
      fs.copyFileSync(
        path.join(ROOT, "scripts", "launcher-core", name),
        path.join(scriptsDir, "launcher-core", name),
      );
    }
    const r = spawnSync(process.execPath, [path.join(scriptsDir, "dev.mjs")], {
      encoding: "utf8",
      cwd: tmp,
      env: { ...process.env, SKIP_ENV_VALIDATION: "" },
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 60_000,
    });
    expect(r.status, "缺 .env 时必须非零退出").not.toBe(0);
    const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
    expect(out).toContain("env-preflight");
    expect(out).toContain("env:init");
    // 这条正是缺陷的形态：旧实现会先打印这两行。
    expect(out, "不得再出现先 ✓ Ready 再崩").not.toContain("Ready in");
    expect(out).not.toContain("run-local.ps1");
  }, 90_000);
});

describe("文档不再把「cp 一下就够」写成唯一动作", () => {
  it("README 与规范 §9.1 都给出 env:init", () => {
    for (const rel of ["README.md", "docs/standards/launch-and-build.md"]) {
      const src = fs.readFileSync(path.join(ROOT, rel), "utf8");
      expect(src, `${rel} 必须提到 pnpm env:init`).toContain("pnpm env:init");
    }
  });

  it(".env.example 的空值旁边写清了「空串会被判为缺失」", () => {
    const src = fs.readFileSync(EXAMPLE, "utf8");
    expect(src).toMatch(/空串|会被判|env:init/);
  });
});
