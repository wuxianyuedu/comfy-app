/**
 * 提交门槛自检：格式化提交必须与行为改动分离（ISSUE #575 第 9 项 / 规范 §13.5）。
 *
 * 这条门禁的判据是「把改动前的**整份文件**交给 prettier 重排，看是否逐字等于
 * 改动后」—— 踩过两个坑，用例把两坑都钉住：
 *   ① 判据若用「抹掉空白后逐行比对」，prettier 的**重新断行**与
 *      `prettier-plugin-tailwindcss` 的**类名重排**都看不见（实测漏报）；
 *   ② 若把 `git diff` 的 **hunk 片段**单独交给 prettier，会 `SyntaxError`
 *      （片段不是完整的语法单元）—— 那样每个文件都「无法判定」，门禁静默失效。
 * 所以这里必须真跑 git + prettier（临时仓库 + 真提交），不能靠桩。
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
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-reformat-only.cjs");

/**
 * prettier 的 **JS 入口**（不是 `node_modules/.bin/prettier`）。
 *
 * `.bin/` 下那个是启动 shell 包装（Windows 上是 .cmd），`node <它>` 会
 * `SyntaxError: Invalid or unexpected token`；而临时目录里没有 node_modules，
 * 也不能直接执行它。走 `require.resolve` 拿真实脚本路径，`node <它>` 才成立。
 */
const PRETTIER = require.resolve("prettier/bin/prettier.cjs");
const TAILWIND_PLUGIN = require.resolve("prettier-plugin-tailwindcss");

let workdir = "";
/** 探针 prettier 配置的落点（在 workdir 之外，避免被提交）。 */
let configDir = "";

function git(args: string[]): string {
  return execFileSync("git", args, {
    cwd: workdir,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

/** 跑门禁，返回退出码与合并输出。 */
function run(args: string[] = []): { code: number; output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [join(workdir, "scripts", "check-reformat-only.cjs"), ...args],
      { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
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

/**
 * 在临时仓库里对文件跑 prettier —— 用**仓库真实的那套插件行为**。
 *
 * 临时目录没有 node_modules，而仓库的 `prettier.config.js` 按**包名**加载
 * `prettier-plugin-tailwindcss`（从配置文件所在目录向上找）—— 直接指过去会
 * `Cannot find package`。这里写一份**只把插件换成绝对路径**的等价配置，
 * 于是「尾随类名重排」这一档覆盖不会丢。
 */
function formatInPlace(rel: string): void {
  // 探针配置写在临时目录**之外**：写在仓库里会被 `git add -A` 一并提交，
  // 把用例变成「格式化 + 新增一个配置文件」的混合提交（判据就不再是纯格式化了）。
  const config = join(configDir, "prettier.probe.config.mjs");
  writeFileSync(
    config,
    `export default {\n  plugins: [${JSON.stringify(TAILWIND_PLUGIN)}],\n};\n`,
  );
  execFileSync("node", [PRETTIER, "--config", config, "--write", rel], {
    cwd: workdir,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function write(rel: string, content: string): void {
  const full = join(workdir, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content);
}

function commit(label: string): void {
  git(["add", "-A"]);
  git([
    "-c",
    "commit.gpgsign=false",
    "-c",
    "user.email=t@local",
    "-c",
    "user.name=t",
    "commit",
    "-qm",
    label,
  ]);
}

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "reformat-gate-"));
  configDir = mkdtempSync(join(tmpdir(), "reformat-cfg-"));
  mkdirSync(join(workdir, "scripts"), { recursive: true });
  copyFileSync(SCRIPT, join(workdir, "scripts", "check-reformat-only.cjs"));
  mkdirSync(join(workdir, "src", "lib"), { recursive: true });
  // 临时仓库也要能解析 prettier：真实场景里门禁在**源码仓库**里跑（node_modules
  // 就在旁边），临时仓库没有 —— 软链过来最贴近真实的解析路径，也让脚本的
  // 「向上找 prettier」这一档被真正走到（而不是悄悄退回 pnpm 兜底）。
  symlinkSync(
    join(process.cwd(), "node_modules"),
    join(workdir, "node_modules"),
    "dir",
  );
  git(["init", "-q"]);
  git(["config", "user.email", "t@local"]);
  git(["config", "user.name", "t"]);
  // 本机 / CI 可能全局开着 commit.gpgsign，临时仓库里没有可用密钥。
  git(["config", "commit.gpgsign", "false"]);
  git(["config", "tag.gpgsign", "false"]);
  writeFileSync(join(workdir, ".gitignore"), "node_modules\n");
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
  rmSync(configDir, { recursive: true, force: true });
});

/** 生成 n 个未过 prettier 的源文件并提交成基线。 */
function seedDirty(n: number): string[] {
  const files: string[] = [];
  for (let i = 0; i < n; i++) {
    const rel = `src/lib/dirty-${i}.ts`;
    write(rel, `export const PROBE_${i}={a:${i},b:"x"};\n`);
    files.push(rel);
  }
  commit("base");
  return files;
}

describe("格式化提交与行为改动分离", { timeout: 60_000 }, () => {
  it("一次提交格式化 12 个文件 → 阻断（远超阈值）", () => {
    const files = seedDirty(12);
    for (const f of files) formatInPlace(f);
    commit("format only");
    const r = run();
    expect(r.code).toBe(1);
    expect(r.output).toContain("只改格式");
    expect(r.output).toContain("git reset --soft HEAD~1");
  });

  it("只格式化 1 个文件（未达阈值）→ 放行，但明确报出来", () => {
    const files = seedDirty(1);
    formatInPlace(files[0]!);
    commit("tiny format");
    const r = run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("未达阈值");
  });

  it("真实行为改动 → 放行（不把功能提交误判成格式化）", () => {
    seedDirty(1);
    write("src/lib/dirty-0.ts", 'export const PROBE_0={a:99,b:"changed"};\n');
    commit("behaviour change");
    const r = run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("纯格式化 0 个");
  });

  it("prettier 的重新断行也算纯格式化（逐行比对会漏报的那一档）", () => {
    seedDirty(1);
    const rel = "src/lib/dirty-0.ts";
    // 超宽对象 → prettier 一定把它拆成多行：断行变了，内容没变。
    write(
      rel,
      'export const PROBE_0={aLongFieldName:"x",anotherLongFieldName:"y",third:"z"};\n',
    );
    commit("wide");
    formatInPlace(rel);
    commit("reflow");
    const r = run(["--strict"]);
    expect(r.code).toBe(1);
    expect(r.output).toContain("只改格式");
  });

  it("没有父提交（首次提交 / 浅克隆）→ 跳过，不阻断", () => {
    write("src/lib/a.ts", "export const A = 1;\n");
    commit("root");
    // --range 指向空 diff：应当以「没有文件改动」放行，而不是崩掉。
    const r = run(["--range", "HEAD..HEAD"]);
    expect(r.code).toBe(0);
  });

  it("纯新增文件的提交不算格式化（没有旧内容可比）", () => {
    seedDirty(1);
    for (let i = 0; i < 12; i++)
      write(`src/lib/added-${i}.ts`, "export const X={a:1};\n");
    commit("add files");
    const r = run();
    expect(r.code).toBe(0);
    expect(r.output).toContain("纯格式化 0 个");
  });
});

describe(
  "pre-commit 现场：必须判「暂存区」而不是上一次提交",
  { timeout: 60_000 },
  () => {
    /* 这组用例守的是一条**真实发生过的**失效：脚本接在 pre-commit 里，而
     * pre-commit 在提交对象生成**之前**运行，此时 `HEAD` 仍是上一次提交。
     * 早先实现无条件取 `HEAD~1..HEAD`，于是：
     *   · 本次暂存内容一个都没参与判定；
     *   · 只要上一次提交恰好是格式化提交（master 上的存量治理就是这样），
     *     门禁就把那次**已合并**的提交当成「本次」拦下，后续每个提交都过不去。
     * 现场表现是「我什么都没格式化，门禁却报 563 个纯格式化文件」。 */

    it("上一次提交是格式化提交、本次暂存是真实改动 → 放行（不被上一次污染）", () => {
      seedDirty(12);
      for (let i = 0; i < 12; i++) formatInPlace(`src/lib/dirty-${i}.ts`);
      commit("format only"); // 上一次提交：12 个纯格式化（会被判为阻断）

      // 本次只暂存一个真实行为改动，还没提交（正是 pre-commit 的现场）。
      write("src/lib/feature.ts", "export const answer = 42;\n");
      git(["add", "src/lib/feature.ts"]);

      const r = run();
      expect(r.code).toBe(0);
      // 判的是暂存区：只有 1 个改动文件，且它不是「重排既有文件」。
      expect(r.output).toContain("改动 1 个源文件");
      expect(r.output).toContain("纯格式化 0 个");
    });

    it("暂存区里一次格式化 12 个既有文件 → 仍然阻断（该拦的照样拦）", () => {
      // `seedDirty` 自己就提交了基线，这里不能再 commit 一次（会因无改动而失败）。
      seedDirty(12);

      for (let i = 0; i < 12; i++) formatInPlace(`src/lib/dirty-${i}.ts`);
      git(["add", "-A"]); // 暂存但**不提交**

      const r = run();
      expect(r.code).toBe(1);
      expect(r.output).toContain("纯格式化 12 个");
    });

    it("暂存区只有纯新增文件 → 放行（新增不是「重排既有文件」）", () => {
      seedDirty(1);
      for (let i = 0; i < 12; i++)
        write(`src/lib/new-${i}.ts`, "export const X = { a: 1 };\n");
      git(["add", "-A"]);

      const r = run();
      expect(r.code).toBe(0);
      expect(r.output).toContain("纯格式化 0 个");
    });

    it("无暂存改动时回落到「判 HEAD 这一次提交」（本地事后复盘口径不变）", () => {
      seedDirty(12);
      for (let i = 0; i < 12; i++) formatInPlace(`src/lib/dirty-${i}.ts`);
      commit("format only"); // 已提交，暂存区是空的

      const r = run();
      expect(r.code).toBe(1);
      expect(r.output).toContain("纯格式化 12 个");
    });
  },
);

describe("补丁解析（纯函数，不跑 git）", () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const mod = require("../scripts/check-reformat-only.cjs") as {
    collectChangedFiles: (
      patch: string,
    ) => Array<{ before: string; after: string }>;
    LIMIT: number;
  };

  it("只收源码扩展名，忽略图片", () => {
    const patch = [
      "diff --git a/src/lib/a.ts b/src/lib/a.ts",
      "--- a/src/lib/a.ts",
      "+++ b/src/lib/a.ts",
      "diff --git a/docs/x.png b/docs/x.png",
      "diff --git a/README.md b/README.md",
    ].join("\n");
    expect(mod.collectChangedFiles(patch).map((f) => f.after)).toEqual([
      "src/lib/a.ts",
      "README.md",
    ]);
  });

  it("阈值是 10：低于它的顺手格式化不该阻断", () => {
    expect(mod.LIMIT).toBe(10);
  });
});
