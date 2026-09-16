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
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SCRIPT = join(process.cwd(), "scripts", "check-reformat-only.cjs");

/* 每条用例都要在临时仓库里真跑 git（init / add / commit / merge）+ 真起 prettier
 * （门禁按「整批一次 prettier」调用，但建库 / 提交 / 判定的固定成本仍在）：默认
 * 5s 的用例超时在全量并行满载时会被击穿（CI 实测过一次 `Test timed out in 5000ms`，
 * 报在 `tests/check-format.test.ts` 的同类用例上）。整文件放宽到 30s——只影响本文件，
 * 不掩盖其它文件的真实挂起。 */
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

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

/** 建一个空的基线提交：只在「判定与门禁现场无关」的用例里用（它们不需要脏文件）。 */
function seedEmpty(): void {
  write("src/lib/keep.ts", "export const KEEP = 1;\n");
  commit("base");
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

    /* 合并提交豁免：一次 merge 会把上游整批（含别处做的格式化）带进来，
     * 「拆成两次提交」在这里物理上不可能 —— 上游形态已定死在历史里。
     * 判据取 `MERGE_HEAD` 是否存在（pre-commit 跑在合并提交对象生成**之前**，
     * 此时该文件由 `git merge` 写入、合并完成后删除）。 */
    it("合并进行中（MERGE_HEAD 存在）→ 跳过判定，不阻断", () => {
      seedDirty(12);
      for (let i = 0; i < 12; i++) formatInPlace(`src/lib/dirty-${i}.ts`);
      git(["add", "-A"]);
      // 模拟 `git merge` 的现场：pre-commit 触发时 MERGE_HEAD 已写好。
      writeFileSync(
        join(workdir, ".git", "MERGE_HEAD"),
        `${git(["rev-parse", "HEAD"]).trim()}\n`,
      );

      const r = run();
      expect(r.code).toBe(0);
      expect(r.output).toContain("合并提交");
    });

    it("合并提交豁免不掩盖 CI 的 --range 盘点（按范围判，不受现场影响）", () => {
      seedDirty(12);
      for (let i = 0; i < 12; i++) formatInPlace(`src/lib/dirty-${i}.ts`);
      commit("format only");
      writeFileSync(
        join(workdir, ".git", "MERGE_HEAD"),
        `${git(["rev-parse", "HEAD"]).trim()}\n`,
      );

      const r = run(["--range", "HEAD~1..HEAD"]);
      expect(r.code).toBe(1);
      expect(r.output).toContain("纯格式化 12 个");
    });
  },
);

describe(
  "判定成本：整批一次 prettier，不按文件各起一次",
  { timeout: 60_000 },
  () => {
    /* 这条用例守的是一条**真实发生过的**失效：早先的实现对每个文件各起一次
     * `prettier --stdin-filepath`，而 prettier 的启动 + 插件加载是主要成本
     * （实测单文件约 400ms，与文件大小几乎无关）—— 12 个文件 ≈ 5s，正好把
     * vitest 默认的 testTimeout 顶穿。现场表现是 `Test timed out in 5000ms`，
     * 报在别的门禁用例上，看起来像「测试写得慢」，实际是门禁自身的调用形态
     * 在文件数上线性叠加（真人「批量格式化」提交改几十个文件时只会更慢）。
     *
     * 判据用**计数**而不是耗时：耗时在负载波动下必然抖动，而「prettier 起了
     * 几次」是确定的。整批口径下 batch 恰好一次（外加退回 stdin 的兜底，正常
     * 路径上为 0），逐文件口径下是「文件数 + 1」。用包装脚本记调用次数，
     * 断言与阈值无关的形态：次数远小于文件数。 */
    it("12 个文件的改动 → prettier 调用次数远小于文件数（整批口径）", () => {
      seedDirty(12);
      for (let i = 0; i < 12; i++) formatInPlace(`src/lib/dirty-${i}.ts`);
      commit("format only");

      const real = require.resolve("prettier/bin/prettier.cjs", {
        paths: [process.cwd()],
      });
      const wrapper = join(configDir, "prettier-count.cjs");
      const counter = join(configDir, "prettier-calls.txt");
      writeFileSync(
        wrapper,
        [
          'const { appendFileSync } = require("node:fs");',
          `appendFileSync(${JSON.stringify(counter)}, "call\\n");`,
          `require(${JSON.stringify(real)});`,
        ].join("\n"),
      );
      // 把 wrapper 放到临时仓库的 node_modules 下：脚本按「向上找 node_modules」
      // 解析 prettier，命中它即等于「prettier 被起了几次」+1。
      rmSync(join(workdir, "node_modules"), { recursive: true, force: true });
      mkdirSync(join(workdir, "node_modules", "prettier", "bin"), {
        recursive: true,
      });
      copyFileSync(
        wrapper,
        join(workdir, "node_modules", "prettier", "bin", "prettier.cjs"),
      );
      symlinkSync(
        join(process.cwd(), "node_modules", "prettier-plugin-tailwindcss"),
        join(workdir, "node_modules", "prettier-plugin-tailwindcss"),
        "dir",
      );
      writeFileSync(
        join(workdir, "node_modules", "prettier", "package.json"),
        '{"name":"prettier","version":"0.0.0"}',
      );
      writeFileSync(join(workdir, ".gitignore"), "node_modules\n");

      const r = run();
      expect(r.code).toBe(1);
      expect(r.output).toContain("纯格式化 12 个");

      const calls = readFileSync(counter, "utf8").trim().split("\n").length;
      // 逐文件口径下这里会是 13；整批口径下是 1（兜底最多再补几次）。
      expect(calls).toBeLessThanOrEqual(3);
    });
  },
);

/**
 * 「批量结果里没被 prettier 改过」不是一个结论，而是**两件事**叠在一起：
 * 文件本来就规范，或 prettier 自己的 ignore 规则把它跳过了。只有前者能推出
 * 「这次提交不是纯格式化」。这组用例锁的就是「后者必须回落到 stdin 口径」——
 * 判据漏掉它，纯格式化提交会被放行（`git blame` 永久失真，正是本门禁存在的理由）。
 *
 * 真起 prettier 而不打桩：被锁的正是「谁来给答案」，桩一打就锁不住了。
 */
describe("批量口径的缺项退回逐文件 stdin 判定", { timeout: 60_000 }, () => {
  /* 「批量结果里没被 prettier 改过」不是一个结论，而是**两件事**叠在一起：
   * 文件本来就规范，或 prettier 自己的忽略规则把它跳过了。只有前者能推出
   * 「这次提交不是纯格式化」—— 判据漏掉后者，纯格式化提交会被放行，
   * `git blame` 永久失真（正是本门禁存在的理由）。
   *
   * 忽略规则的判据必须取 prettier 自己的那一套（它以 cwd 为根读 `.gitignore`），
   * 不能用 `git check-ignore` 代判 —— 实测两者不一致：目录名被 `.gitignore`
   * 命中时，prettier 连**显式点名**的路径也一并跳过（`--write <file>` 静默返回
   * 空输出），而 `git check-ignore` 对**已跟踪**的路径报「未被忽略」。真实历史
   * 里的形态正是这样（`.workbuddy/skills/build-guard/guard.js` 被格式化后，
   * 在 #619 的合并提交里落成了「纯格式化」）。
   *
   * 判据本体是「谁来给答案」：`classifyReformatOnly` 会真起 prettier，用桩就锁不住。
   */
  it("落在 prettier 忽略路径下的源码被跳过 → 仍按 stdin 口径判为纯格式化", () => {
    seedEmpty();
    write(".gitignore", "node_modules\n.workbuddy\n");
    commit("ignore the dir");

    // 这一批全部落在被忽略的目录下：批量口径一个都不会回读（`--write <dir>`
    // 整目录跳过它），于是每个文件都只剩「本来就规范」这一种解释 —— 而 stdin
    // 口径明明白白给出「prettier 会把它改成下面那样」。真结论是后者。
    const before = "export const P={a:1,\n\n\n  b:2};\n";
    const after = "export const P = {\n  a: 1,\n\n  b: 2,\n};\n";
    write(".workbuddy/probe.ts", before);

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../scripts/check-reformat-only.cjs") as {
      classifyReformatOnly: (
        entries: Array<{ file: string; before: string; after: string }>,
      ) => Set<string>;
    };
    const verdict = mod.classifyReformatOnly([
      { file: ".workbuddy/probe.ts", before, after },
    ]);
    expect(
      [...verdict],
      "文件没出现在批量结果里 —— 那不代表「它本来就规范」，仍要按 stdin 口径判",
    ).toEqual([".workbuddy/probe.ts"]);
  });

  it("批量口径判为「本来就规范」的文件不再起 stdin（常见路径不为兜底付账）", () => {
    seedEmpty();

    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("../scripts/check-reformat-only.cjs") as {
      classifyReformatOnly: (
        entries: Array<{ file: string; before: string; after: string }>,
      ) => Set<string>;
    };
    // 改动前的内容**已经规范**：prettier 不会改写它，批量结果里没有这项，
    // 但它本来就没有「被跳过」的可能（不在忽略路径下），兜底不该被触发 ——
    // 判定为「不是纯格式化」靠的是 stdin 给的回文与改动后不同。
    const clean = "export const P = { a: 1, b: 2 };\n";
    const changed = "export const P = { a: 1, b: 3 };\n";
    expect([...mod.classifyReformatOnly([{ file: "src/lib/p.ts", before: clean, after: changed }])]).toEqual([]);
    // 同一个文件若是「改动前就不规范、改动后是它的规范形态」→ 纯格式化。
    const messy = "export const P={a:1,\n\n\n  b:2};\n";
    const tidy = "export const P = {\n  a: 1,\n\n  b: 2,\n};\n";
    expect([...mod.classifyReformatOnly([{ file: "src/lib/p.ts", before: messy, after: tidy }])]).toEqual([
      "src/lib/p.ts",
    ]);
  });
});

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
