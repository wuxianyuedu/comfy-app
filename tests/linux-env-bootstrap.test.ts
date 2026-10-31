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
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  REQUIRED_ENV_KEYS,
  checkEnvFile,
  envInitHint,
  exitIfEnvNotReady,
  missingEnvKeys,
  parseEnvFile,
} from "../scripts/env-preflight.mjs";
import { runStartupGates } from "../scripts/launcher-core/startup-gates.mjs";

const ROOT = process.cwd();
const EXAMPLE = path.join(ROOT, ".env.example");

let tmp: string;

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "env-bootstrap-"));
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * 取一个脚本里的**相对** import 说明符（`./x` / `../x`）。
 *
 * 后缀面要比 `\.mjs` 宽（ISSUE #2562 的现场）：`scripts/launcher-core/shell.mjs` 早就
 * `import … from "../../src/lib/process/executable-resolve.ts"`（Node 的类型擦除让它能
 * 静态 import `.ts`），而那份 `.ts` 自己又 import 同目录的兄弟模块。只收 `.mjs` 的话，
 * 拷进临时检出的那一份会在**加载阶段**报 `ERR_MODULE_NOT_FOUND` —— 于是这条用例看到的
 * 是一段 ESM 解析栈，而不是它要判的「预检结论」。收 `.ts` / `.tsx` 之后闭包按事实走。
 */
function relativeImportsOf(entryFile: string): Array<string> {
  const src = fs.readFileSync(entryFile, "utf8");
  const found = new Set<string>();
  for (const match of src.matchAll(/from\s+"(\.{1,2}\/[^"]+\.(?:mjs|cjs|ts|tsx))"/g)) {
    const spec = match[1];
    if (spec !== undefined) {
      found.add(spec);
    }
  }
  return [...found];
}

/**
 * 把 `scripts/<entryRel>` 连同**逐层的相对依赖**一起复制进临时检出（保持相对路径形状）。
 *
 * 为什么不只拷入口：入口的依赖闭包会长。曾经只拷 `env-init.mjs` 就够，后来它
 * import 了 `launcher-core/standalone-runtime-env.mjs`，于是子进程报的是
 * `ERR_MODULE_NOT_FOUND` 的调用栈 —— 既不是预检结论也指不到业务原因，而用例只是
 * 「exit 1」。按闭包复制之后，这类漂移不会再以同一种令人误解的方式红。
 */
function copyScriptWithRelativeClosure(entryRel: string): string {
  /* 落点按**仓库根**相对计算，不是按 `scripts/` 相对（ISSUE #2562 的现场）：这条闭包
   * 从 `scripts/**` 走进了 `src/lib/process/**`（`shell.mjs` 静态 import 那份 `.ts`），
   * 而按 `scripts/` 算相对会得到 `../src/…` —— 拷到的是 `tmp/src/…` 没问题，但
   * 再往下一层 `src/lib/process/platform.ts` 这样的兄弟依赖就按**它自己那份**相对名
   * 解析，落进一个没被建出来的目录里。按仓库根算，临时检出与真检出同形。 */
  const entrySrc = path.join(ROOT, "scripts", entryRel);
  const pending = [entrySrc];
  const seen = new Set<string>();
  while (pending.length > 0) {
    const file = pending.shift();
    if (file === undefined || seen.has(file)) {
      continue;
    }
    seen.add(file);
    if (!fs.existsSync(file)) {
      continue;
    }
    const rel = path.relative(ROOT, file);
    if (rel.startsWith("..")) {
      continue;
    } // 仓外依赖（node_modules 之类）不拷
    const dest = path.join(tmp, rel);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    for (const spec of relativeImportsOf(file)) {
      pending.push(path.resolve(path.dirname(file), spec));
    }
  }
  return path.join(tmp, "scripts", entryRel);
}

/** 真跑 `scripts/env-init.mjs`（把项目根换成临时目录的等价形态不成立——
 *  脚本按自身位置定位项目根，所以这里用一个同名的最小检出副本）。 */
function runEnvInitIn(files: Record<string, string>): {
  scriptPath: string;
  status: number | null;
  stderr: string;
  stdout: string;
} {
  const scriptPath = copyScriptWithRelativeClosure("env-init.mjs");
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
    const pkg = /* SAFETY: 类型断言已复核 */ JSON.parse(
      fs.readFileSync(path.join(ROOT, "package.json"), "utf8"),
    ) as { scripts: Record<string, string> };
    expect(pkg.scripts["env:init"]).toBe("node scripts/env-init.mjs");
  });

  it("从 .env.example 生成后，三个必填项都非空且能过预检", () => {
    const r = runEnvInitIn({
      ".env.example": fs.readFileSync(EXAMPLE, "utf8"),
    });
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);

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
    const custom = example.replace(/^# COMFYAPP_PORT=.*$/m, 'COMFYAPP_PORT="3456"');
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

  it("必填项本来就齐时也只补缺失的键 —— #2175 那格留痕这才传得到已有检出（#2186）", () => {
    const example = fs.readFileSync(EXAMPLE, "utf8");
    // 模拟「早在 #2175 之前生成的 .env」：必填齐、改过日志级别、没有后来新增的那个可选键。
    const mine = example
      .replace(/^BETTER_AUTH_SECRET=.*$/m, 'BETTER_AUTH_SECRET="' + "b".repeat(64) + '"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_ID=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_ID="mine"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_SECRET="mine"')
      .replace(/^COMFYAPP_DEV_HANDLE=.*$/m, "")
      .replace(/^LOG_LEVEL=.*$/m, 'LOG_LEVEL="debug"');
    const r = runEnvInitIn({ ".env.example": example, ".env": mine });
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    const after = fs.readFileSync(path.join(tmp, ".env"), "utf8");
    const parsed = parseEnvFile(after);
    expect(parsed.has("COMFYAPP_DEV_HANDLE"), "缺的可选键要被补上").toBe(true);
    // 不再照 example 补一个空值（ISSUE #2355）：补成空串等于「照提示做过一遍仍然没有名字」。
    // 值来自取值链（本机 `git config user.name` / 兜底 `cnb`），非空且不是密钥。
    expect(
      (parsed.get("COMFYAPP_DEV_HANDLE") ?? "").trim(),
      "留痕短名必须是取到的一个确定名字，不是空值",
    ).not.toBe("");
    // 「只补缺、绝不覆盖」是这一档唯一的安全前提：用户自己改过的值必须一字不动。
    expect(parsed.get("LOG_LEVEL")).toBe("debug");
    expect(after).toMatch(/^BETTER_AUTH_SECRET="b{64}"$/m);
    expect(r.stdout).toContain("COMFYAPP_DEV_HANDLE");
    // 名字不是密钥 ⇒ 念出来才可核对（`ship` 念的是同一个值）。
    expect(r.stdout).toContain(parsed.get("COMFYAPP_DEV_HANDLE")!);
    expect(checkEnvFile(tmp, {})).toBeNull();
  });

  it("负控制：注释形态的可选键不被提升成真值（端口钉回 3100 会打散并行检出）", () => {
    const example = fs.readFileSync(EXAMPLE, "utf8");
    const mine = example
      .replace(/^BETTER_AUTH_SECRET=.*$/m, 'BETTER_AUTH_SECRET="' + "d".repeat(64) + '"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_ID=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_ID="mine"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_SECRET="mine"')
      .replace(/^COMFYAPP_DEV_HANDLE=.*$/m, "");
    const r = runEnvInitIn({ ".env.example": example, ".env": mine });
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    const after = fs.readFileSync(path.join(tmp, ".env"), "utf8");
    const parsed = parseEnvFile(after);
    expect(
      parsed.has("COMFYAPP_PORT"),
      "example 里那一行是注释 ⇒ 补齐面不收它（收了就是替所有人钉死端口）",
    ).toBe(false);
    expect(after).toMatch(/^# COMFYAPP_PORT=.*$/m);
  });

  it("必填项整行都不在时也补得出来（旧 `fill()` 只做行内替换 ⇒ 念「已补齐」而其实没补）", () => {
    const example = fs.readFileSync(EXAMPLE, "utf8");
    const stripped = example
      .replace(/^BETTER_AUTH_SECRET=.*$/m, "")
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_ID=.*$/m, "")
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$/m, "")
      .replace(/^COMFYAPP_DEV_HANDLE=.*$/m, "");
    const r = runEnvInitIn({ ".env.example": example, ".env": stripped });
    expect(r.status, `${r.stdout ?? ""}${r.stderr ?? ""}`).toBe(0);
    const parsed = parseEnvFile(fs.readFileSync(path.join(tmp, ".env"), "utf8"));
    for (const key of REQUIRED_ENV_KEYS) {
      expect((parsed.get(key) ?? "").trim(), `${key} 必须被补出来`).not.toBe("");
    }
    // 话术只点名补了哪个键，密钥值不进日志。
    expect(r.stdout).not.toContain(parsed.get("BETTER_AUTH_SECRET")!);
    expect(checkEnvFile(tmp, {})).toBeNull();
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
    for (const key of REQUIRED_ENV_KEYS) {
      expect(problem!.message).toContain(key);
    }
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
        '# BETTER_AUTH_SECRET="注释里的不算"',
        'BETTER_AUTH_SECRET="abc"',
        "BETTER_AUTH_GITHUB_CLIENT_ID=plain",
      ].join("\n"),
    );
    expect(parsed.get("BETTER_AUTH_SECRET")).toBe("abc");
    expect(parsed.get("BETTER_AUTH_GITHUB_CLIENT_ID")).toBe("plain");
  });
});

describe("启动器念出 env:init 缺的键（ISSUE #2205）", () => {
  /** 一份「必填齐、example 里的键全在」的 `.env`。 */
  function completeEnv(): string {
    return fs
      .readFileSync(EXAMPLE, "utf8")
      .replace(/^BETTER_AUTH_SECRET=.*$/m, `BETTER_AUTH_SECRET="${"e".repeat(64)}"`)
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_ID=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_ID="mine"')
      .replace(/^BETTER_AUTH_GITHUB_CLIENT_SECRET=.*$/m, 'BETTER_AUTH_GITHUB_CLIENT_SECRET="mine"');
  }

  it("missingEnvKeys：按 example 顺序报缺，整行缺失的必填项排在末尾", () => {
    const example = [
      'ALPHA="1"',
      'BETA="2"',
      '# GAMMA="注释键不进补齐面"',
      'DELTA="4"',
      'BETTER_AUTH_SECRET=""',
    ].join("\n");
    const current = ['ALPHA="mine"', 'DELTA="mine"'].join("\n");
    expect(missingEnvKeys({ example, current })).toEqual([
      "BETA",
      "BETTER_AUTH_SECRET",
      "BETTER_AUTH_GITHUB_CLIENT_ID",
      "BETTER_AUTH_GITHUB_CLIENT_SECRET",
    ]);
    // 已在文件里的键（哪怕值留空）不算「缺」：这一类由 `env:init` 的 fill 负责。
    expect(
      missingEnvKeys({
        example: 'A=""\nB=""',
        current: [
          "A=",
          "B=",
          "BETTER_AUTH_SECRET=",
          "BETTER_AUTH_GITHUB_CLIENT_ID=",
          "BETTER_AUTH_GITHUB_CLIENT_SECRET=",
        ].join("\n"),
      }),
      "值空但行在 ⇒ 不归这一格",
    ).toEqual([]);
  });

  it("envInitHint：只读，缺文件或 SKIP_ENV_VALIDATION 时静默", () => {
    expect(envInitHint(tmp, {}), "没有 .env 时由阻断那条给出口").toBeNull();
    const whole = completeEnv();
    fs.writeFileSync(path.join(tmp, ".env.example"), whole, "utf8");
    fs.writeFileSync(path.join(tmp, ".env"), whole, "utf8");
    expect(envInitHint(tmp, {}), "键齐时不念").toBeNull();
    expect(
      envInitHint(tmp, { SKIP_ENV_VALIDATION: "1" }),
      "跳过校验时不念（与 src/env.js 同口径）",
    ).toBeNull();
  });

  /** 跑预检桥段：除了 `.env` 的两个读数，其余门禁全部空转（这条判的只是提醒）。 */
  async function runGates() {
    const lines: Array<string> = [];
    const gated = await runStartupGates(
      {
        log: (message: string) => lines.push(message),
        root: tmp,
        status: () => undefined,
        reapStaleSession: async () => null,
        checkEnvFile: (root: string) => checkEnvFile(root, {}),
        envInitHint: (root: string) => envInitHint(root, {}),
        runToolchainGate: () => null,
        syncDependencies: async () => null,
        applyPendingRestoreAtBoot: () => ({ status: "nothing-to-do" }),
        resolveAppPort: () => 3100,
      },
      { portOrNull: null, mode: "dev" },
    );
    return { gated, lines };
  }

  it("runStartupGates：缺可选键时念一行 WARN，且不阻断启动", async () => {
    const example = completeEnv();
    fs.writeFileSync(path.join(tmp, ".env.example"), example, "utf8");
    fs.writeFileSync(
      path.join(tmp, ".env"),
      example.replace(/^COMFYAPP_DEV_HANDLE=.*$/m, ""),
      "utf8",
    );
    const { gated, lines } = await runGates();
    expect(gated.ok, "提醒不是闸：启动照常继续").toBe(true);
    const hint = lines.find((line) => line.includes("环境配置提醒"));
    expect(hint, "缺键时要有人念出来").toBeDefined();
    expect(hint).toContain("COMFYAPP_DEV_HANDLE");
    expect(hint).toContain("pnpm env:init");
  });

  it("pnpm dev / start 的共用预检也念（不只编排器那条路）", () => {
    const example = completeEnv();
    fs.writeFileSync(path.join(tmp, ".env.example"), example, "utf8");
    fs.writeFileSync(
      path.join(tmp, ".env"),
      example.replace(/^COMFYAPP_DEV_HANDLE=.*$/m, ""),
      "utf8",
    );
    const writes: Array<string> = [];
    const spy = vi
      .spyOn(process.stderr, "write")
      .mockImplementation((chunk: string | Uint8Array) => {
        writes.push(String(chunk));
        return true;
      });
    try {
      exitIfEnvNotReady(tmp, {});
    } finally {
      spy.mockRestore();
    }
    expect(writes.join("")).toContain("COMFYAPP_DEV_HANDLE");
    expect(writes.join("")).toContain("pnpm env:init");
  });

  it("runStartupGates：必填齐且键全时不念，必填缺失时不重复念", async () => {
    const example = completeEnv();
    fs.writeFileSync(path.join(tmp, ".env.example"), example, "utf8");
    fs.writeFileSync(path.join(tmp, ".env"), example, "utf8");
    const complete = await runGates();
    expect(complete.lines.some((line) => line.includes("环境配置提醒"))).toBe(false);

    // 必填缺失时阻断那条已经给了 `pnpm env:init` 的完整出口，这一格不再重复念。
    fs.writeFileSync(
      path.join(tmp, ".env"),
      example.replace(/^BETTER_AUTH_SECRET=.*$/m, ""),
      "utf8",
    );
    const blocked = await runGates();
    expect(blocked.gated.ok).toBe(false);
    expect(blocked.lines.some((line) => line.includes("环境配置提醒"))).toBe(false);
  });
});

describe("dev/start 在起 Next 之前预检", () => {
  const entries = ["scripts/dev.mjs", "scripts/start.mjs"];

  it.for(entries)("%s 调用 exitIfEnvNotReady 且发生在 spawn 之前", (rel) => {
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
      // D6（ISSUE #1611）：`dev.mjs` 在预检之后、起 Next 之前调
      // `applyPendingRestoreAtBoot`，它静态 import 这份唯一实现 —— 少拷一份，
      // 红出来的就是 ERR_MODULE_NOT_FOUND 而不是预检结论（同下一条注释）。
      "db-backup-core.mjs",
      "standalone-private-inputs.mjs",
    ];
    for (const name of needed) {
      const src = path.join(ROOT, "scripts", name);
      if (fs.existsSync(src)) {
        fs.copyFileSync(src, path.join(scriptsDir, name));
      }
    }
    for (const dir of ["lockfile"]) {
      const from = path.join(ROOT, "scripts", dir);
      if (!fs.existsSync(from)) {
        continue;
      }
      const to = path.join(scriptsDir, dir);
      fs.mkdirSync(to, { recursive: true });
      for (const name of fs.readdirSync(from)) {
        fs.copyFileSync(path.join(from, name), path.join(to, name));
      }
    }
    // `dev.mjs` 依赖 `launcher-core/shell.mjs`（pnpm 可执行形态的单一判据，
    // 见规范 §2.1.1）与它 import 的 `command-echo.mjs`（命令行回显的唯一出口，
    // 见规范 §4.4）、`log.mjs`（runStamp 的唯一出口）与 `executor-host-spawn.mjs`
    // （按开关拉起执行器宿主的唯一一份实现，ISSUE #1767）：副本里少一份，
    // import 就失败、测的就不是预检了。
    for (const name of [
      "shell.mjs",
      "command-echo.mjs",
      "log.mjs",
      "executor-host-spawn.mjs",
      "executor-mode.mjs",
      "worktree.mjs",
    ]) {
      fs.mkdirSync(path.join(scriptsDir, "launcher-core"), { recursive: true });
      fs.copyFileSync(
        path.join(ROOT, "scripts", "launcher-core", name),
        path.join(scriptsDir, "launcher-core", name),
      );
    }
    // `shell.mjs` 静态 import `src/lib/process/executable-resolve.ts`（ISSUE #1327：
    // 可执行形态判据的唯一实现）。副本里少这份，`dev.mjs` 在**加载阶段**就
    // ERR_MODULE_NOT_FOUND，红出来的样子与本门禁无关（同上面那条注释）。
    //
    // **按链抄，不按一份文件抄**（ISSUE #1961）：那一份自己的依赖（现在有个叶子
    // `platform.ts`）少一份同样在加载阶段就断 —— 而报错会指向与本门禁无关的地方
    // （实测：`Cannot find module '…/src/lib/process/platform.ts'`）。
    // 与 `tests/standalone-runtime.test.ts` 的判据同一条教训：逐份手抄必然漂。
    const processDir = path.join(ROOT, "src", "lib", "process");
    const resolveTo = path.join(tmp, "src", "lib", "process");
    fs.mkdirSync(resolveTo, { recursive: true });
    /* `pnpm-resolve.ts` / `version-compare.ts` 是 `executable-resolve.ts` 按职责
     * 拆出来的两块（它越过文件长度硬闸时切的），静态 import 关系把它们串成一条链 ——
     * 「按链抄」这条教训对**链条变长**同样成立。 */
    for (const name of [
      "executable-resolve.ts",
      "platform.ts",
      "pnpm-resolve.ts",
      "version-compare.ts",
    ]) {
      fs.copyFileSync(path.join(processDir, name), path.join(resolveTo, name));
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
