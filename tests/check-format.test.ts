/**
 * 提交门槛自检：prettier 格式棘轮（ISSUE #575 第 9 项 / 规范 §13.5）。
 *
 * 这条门禁的价值全在「棘轮的方向」上：既要真的拦住新增的脏文件，也要在
 * 存量被治理后**要求收紧基线**（否则基线会长期停在一个宽松的数字上，
 * 「存量只减不增」就变成了「存量不再变化也没人管」）。用「临时工作区 + 只放
 * 被测文件」跑真脚本，断言两个方向都成立。
 *
 * 为什么用子进程而不是 import：脚本被 pre-commit 以 `node scripts/xxx.cjs`
 * 调用，且用 `process.cwd()` 定位扫描根 —— 复用同一调用方式才等价于真实门禁。
 *
 * 规范：docs/standards/13-提交与-code-review.md §13.5
 */
import { execFileSync } from "node:child_process";
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* 每条用例都要在临时工作区里真跑 git（init / add / commit）并**真起 prettier**
 * —— 门禁按 glob 各调一次 `prettier --list-different`，实测单次约 300~550ms。
 * 默认 5s 的用例超时在本机是「刚好够用」，CI 全量并行满载时会直接被击穿：现场
 * 是 `Test timed out in 5000ms`，且报错会落在**调度顺序**排在后面的任意一条用例
 * 上（看起来像「某条用例写得慢」，实际是整条固定成本顶着上限跑）。
 *
 * 这一点与 `check-reformat-only.test.ts` 是同一根因、同一处方：那条门禁早先把
 * 「每条用例起十几个 prettier」收敛成「整批一次」，这里没有可收敛的调用数（每个
 * 用例都要建一个独立的仓库 + 基线），所以只能把整文件的超时放宽。放宽只影响本
 * 文件，不掩盖本文件内真实的挂起（30s 仍远小于任何真实死锁的暴露时间）。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

const SCRIPT = join(process.cwd(), "scripts", "check-format.cjs");

let workdir = "";

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

/**
 * 跑门禁。`--report` / `--update` 之外的分支都要 `git ls-files` 认得基线，
 * 因此临时工作区必须是一个真的 git 仓库（否则三条用例都会以「基线未被跟踪」
 * 失败 —— 那验的是 git 而不是本脚本的判定）。
 */
function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-format.cjs"), ...args],
      {
        cwd: workdir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

function git(...args: string[]): void {
  execFileSync("git", args, { cwd: workdir, stdio: "ignore" });
}

// 脏内容：多余空格 + 多余空行，prettier 一定会改它。
const DIRTY = "export const PROBE={a:1,\n\n\n  b:2};\n";
const CLEAN = "export const PROBE = { a: 1, b: 2 };\n";

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "format-gate-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  mkdirSync(join(workdir, "src", "lib"), { recursive: true });
  // 脚本与基线同目录（脚本按 __dirname 找基线），与真实布局 scripts/ 一致。
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-format.cjs"));
  // pnpm 形态判据模块按**相对脚本的路径**动态导入（scripts/launcher-core/shell.mjs）：
  // 临时工作区里没有它，缺了就会以 exit 2 结束 —— 那验的是「脚本能不能加载」，
  // 而不是本脚本的棘轮判定。软链一份，与真实布局一致。
  mkdirSync(join(workdir, "scripts", "launcher-core"), { recursive: true });
  symlinkSync(
    join(process.cwd(), "scripts", "launcher-core", "shell.mjs"),
    join(workdir, "scripts", "launcher-core", "shell.mjs"),
  );
  git("init", "-q");
  git("config", "user.email", "t@local");
  git("config", "user.name", "t");
  // 本机 / CI 可能全局开着 commit.gpgsign，临时仓库里没有可用密钥；
  // 测试只关心「基线是否被跟踪」，不需要真的签名。
  git("config", "commit.gpgsign", "false");
  git("config", "tag.gpgsign", "false");
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

/** 生成一份基线并让 git 跟踪它（棘轮文件必须入库）。 */
function seedBaseline(files: string[]): void {
  writeFileSync(
    join(workdir, "scripts", ".format-baseline.json"),
    JSON.stringify(
      { files: Object.fromEntries(files.map((f) => [f, true])) },
      null,
      2,
    ),
  );
  git("add", "-A");
  git("commit", "-qm", "baseline");
}

describe("prettier 格式棘轮", () => {
  it("存量脏文件在基线内 → 通过（不要求全库已格式化）", () => {
    write("src/lib/dirty.ts", DIRTY);
    write("src/lib/keep.ts", CLEAN);
    seedBaseline(["src/lib/dirty.ts"]);
    const r = run();
    expect(r.code).toBe(0);
  });

  it("新增未过格式的文件 → 阻断，并指出是哪个文件", () => {
    write("src/lib/keep.ts", CLEAN);
    seedBaseline([]);
    write("src/lib/fresh.ts", DIRTY);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/fresh.ts");
    expect(r.output).toContain("新增未过 prettier");
  });

  it("把基线内的干净文件弄脏 → 阻断（文件级记账拦得住，计数口径拦不住）", () => {
    write("src/lib/keep.ts", CLEAN);
    seedBaseline([]);
    write("src/lib/keep.ts", DIRTY);
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("src/lib/keep.ts");
  });

  it("存量被格式化（基线未收紧）→ 提示；--strict 下阻断", () => {
    write("src/lib/dirty.ts", CLEAN);
    seedBaseline(["src/lib/dirty.ts"]);
    const lenient = run();
    expect(lenient.code).toBe(0);
    expect(lenient.output).toContain("已格式化");

    const strict = run(["--strict"]);
    expect(strict.code).toBe(1);
    expect(strict.output).toContain("未收紧基线");
  });

  it("--update 只许收紧：新出现的脏文件会被拒绝", () => {
    write("src/lib/keep.ts", CLEAN);
    seedBaseline([]);
    write("src/lib/fresh.ts", DIRTY);
    const r = run(["--update"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("棘轮只许收紧");
    expect(r.output).toContain("src/lib/fresh.ts");
  });

  it("--update 在基线内文件被修干净时收紧基线", () => {
    write("src/lib/dirty.ts", CLEAN);
    seedBaseline(["src/lib/dirty.ts"]);
    const r = run(["--update"]);
    expect(r.code).toBe(0);
    expect(r.output).toContain("基线已更新");
    // 收紧后同一状态不再提示「治理有进展」。
    expect(run().output).not.toContain("已格式化");
  });

  it("基线未被 git 跟踪 → 阻断（棘轮文件必须入库，否则 CI 上会缺失）", () => {
    write("src/lib/keep.ts", CLEAN);
    writeFileSync(
      join(workdir, "scripts", ".format-baseline.json"),
      JSON.stringify({ files: {} }),
    );
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("未被 git 跟踪");
  });

  it("测试 / 脚本 / 根级配置 / 非源码产物落在白名单里 → 不误报", () => {
    seedBaseline([]);
    // 白名单是「形态」而不是文件列表：新增的这类文件自动豁免。
    write("tests/fresh.test.ts", DIRTY);
    write("scripts/fresh.mjs", DIRTY);
    write("e2e/fresh.spec.ts", DIRTY);
    /* Rust 壳的构建输出：它被**嵌套的** src-tauri/.gitignore 忽略，而 prettier 只
     * 按仓库根读 .gitignore —— 不进白名单就会拿它阻断每一次提交（ISSUE #638 修好
     * pnpm 启动形态后本门禁第一次真正扫到全库时暴露的现象）。 */
    write(
      "src-tauri/target/debug/build/app-1/out/__global-api-script.js",
      DIRTY,
    );
    const r = run();
    expect(r.code).toBe(0);
  });
});

describe("glob 白名单判定（纯函数，不跑 prettier）", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../scripts/check-format.cjs") as {
    isIgnored: (rel: string) => boolean;
    globToRegExp: (glob: string) => RegExp;
  };

  it.each([
    ["scripts/check-format.cjs", true],
    ["tests/anything.test.ts", true],
    ["e2e/smoke.spec.ts", true],
    ["docs/api/assets/main.js", true],
    ["next.config.js", true],
    ["vitest.config.ts", true],
    // 非源码产物（Rust 壳构建输出）豁免；glob 锚在 src-tauri 下，不是「任何 target 目录」
    ["src-tauri/target/release/build/app-x/out/__global-api-script.js", true],
    ["src-tauri/src/main.rs", false],
    ["src/lib/target/keep.ts", false],
    ["src/lib/endpoints.ts", false],
    ["src/components/ui/button.tsx", false],
    ["src/app/api/health/route.ts", false],
  ])("%s → ignored=%s", (rel, expected) => {
    expect(mod.isIgnored(rel)).toBe(expected);
  });

  it("`*.config.{ts,js}` 这一类花括号展开只匹配一层目录", () => {
    expect(mod.isIgnored("prettier.config.js")).toBe(true);
    expect(mod.isIgnored("src/lib/next.config.js")).toBe(false);
  });
});
