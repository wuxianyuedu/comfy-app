/**
 * 脚本档类型检查棘轮的自证（ISSUE #2524 / 规范 §13.5.14.1）。
 *
 * 这一档要钉住的不是「tsc 会不会报错」（那是 tsc 自己的事），而是**判据自己的三件事**：
 *
 *   ① **判决面是全量**：`tsconfig.scripts.json` 展开的 `.mjs` 必须覆盖盘上每一份
 *      （非点目录、非 exclude）—— 本案的病正是「面比它自称的小」，所以这一条要拿
 *      **两套独立算法**对账（用例自己走盘 ⇄ 判据用 TS 的 glob 引擎展开）；
 *   ② **存量只降不升**：新增格子红、`--update` 拒涨且**不改写基线**、下降只提示；
 *   ③ **被截断的一跑不许冒充结论**：tsc 报完语法层的错就不做语义检查（实测），
 *      那一跑必须红，且**不许**照它重写基线（那等于把棘轮清空）。
 *
 * 现场全部落在**临时夹具仓库**里（口径同 `tests/check-doc-references.test.ts` 的
 * `DOC_RENDER_ROOT`，ISSUE #2415：**判据的用例不写真仓库** —— 本文件一次也不动
 * `scripts/.scripts-typecheck-baseline.json`，也不动任何入库文件）。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdtempSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { expectActionableRefusal } from "./helpers/ratchet-refusal";
import { gitSandboxEnv } from "./helpers/git-sandbox-env";

const REPO_ROOT = resolve(process.cwd());
const CHECK = join(REPO_ROOT, "scripts", "check-scripts-typecheck.cjs");

/**
 * 在临时夹具里起一次 git（`git ls-files` / `git commit` 那一半的取数要靠真仓库）。
 *
 * 为什么**必须**经 `gitSandboxEnv()`（`tests/helpers/git-sandbox-env.ts`，本仓测试夹具
 * 的隔离核心，§12.18「写之前先查」）：这个环境里 `commit.gpgsign = true`，于是「在临时
 * 仓库里造一个提交」会直接死在 `error: gpg failed to sign the data` —— 本地实测同一句
 * 补上签名开关就过、不补就炸。那是一层「夹具依赖宿主配置」：CI 上绿、配了签名的开发机
 * 上红，而红的原因与本用例判的东西毫无关系（ISSUE #2756 的现场）。
 * 同理它还剥掉继承来的 `GIT_DIR` 一族（钩子里跑时会把临时仓库的操作**打到真仓库**上）
 * 与 `core.autocrlf` 那一串 warning。
 */
function gitInTempRepo(args: Array<string>, cwd: string): string {
  const argv = args[0] === "commit" ? ["-c", "core.hooksPath=", ...args] : args;
  return execFileSync("git", argv, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: gitSandboxEnv(),
  });
}

/** 夹具的 tsconfig：与主配置同一把尺（`strict` + `checkJs` + `noUnusedLocals`）。 */
const FIXTURE_CONFIG = {
  compilerOptions: {
    target: "es2022",
    module: "ESNext",
    moduleResolution: "Bundler",
    allowJs: true,
    checkJs: true,
    strict: true,
    noUnusedLocals: true,
    noUncheckedIndexedAccess: true,
    noEmit: true,
    incremental: false,
    skipLibCheck: true,
    lib: ["ES2022"],
  },
  include: ["**/*.mjs"],
  exclude: ["node_modules"],
};

const created: Array<string> = [];
let fixture = "";

/** 起真脚本（与 `runCheck` 同一条口径：子进程 + 原样退出码 + 两端输出都收回来）。 */
function runCheck(args: Array<string>, root = fixture): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [CHECK, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, COMFY_SCRIPTS_TYPECHECK_ROOT: root },
    });
    return { code: 0, output };
  } catch (error) {
    const e = /* SAFETY: 类型断言已复核 */ error as {
      status?: number;
      stderr?: string;
      stdout?: string;
    };
    return {
      code: typeof e.status === "number" ? e.status : 1,
      output: `${e.stdout ?? ""}${e.stderr ?? ""}`,
    };
  }
}

function write(rel: string, body: string): string {
  const abs = join(fixture, rel);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
}

/** 账本的形状（判据写出去的那一份，读侧只认这三格）。 */
type Ledger = {
  face: number;
  files: Record<string, Record<string, number>>;
  total: number;
};

/** 夹具里那份账本（判「`--update` 到底写没写」的唯一证据来源）。 */
function baselinePath(): string {
  return join(fixture, "scripts", ".scripts-typecheck-baseline.json");
}
function readFixtureBaseline(): Ledger {
  return /* SAFETY: 类型断言已复核 */ JSON.parse(readFileSync(baselinePath(), "utf8")) as Ledger;
}

beforeAll(() => {
  fixture = mkdtempSync(join(tmpdir(), "2524-fixture-"));
  rmSync(fixture, { recursive: true, force: true });
  created.push(fixture);
  mkdirSync(join(fixture, "scripts"), { recursive: true });
  writeFileSync(
    join(fixture, "tsconfig.scripts.json"),
    JSON.stringify(FIXTURE_CONFIG, null, 2),
    "utf8",
  );
  /* 一份干净的、一份带**死声明**的（`const dead = 1;` 就是立案那一格里 `const HERE` 的形态）。 */
  write(join("scripts", "clean.mjs"), "export const a = 1;\n");
  write(join("scripts", "dirty.mjs"), "const dead = 1;\nexport const b = 2;\n");
});

afterAll(() => {
  for (const dir of created) {
    rmSync(dir, { recursive: true, force: true });
  }
});

describe("脚本档判决面 —— 面必须是全量", () => {
  it("夹具里每一份 .mjs 都在面上（读数直接来自判据自己）", () => {
    const { code, output } = runCheck(["--no-run"]);
    expect(output, output).toContain("展开 2 份 .mjs");
    expect(code, output).toBe(0);
    /* ⚠️ 这一句只证**夹具**。真仓库那一份由下面「真仓的账本 ⇄ 真仓的面」那一格钉，
     * 因为「面被改窄」这件事在真实仓库里才会发生（有人编辑 `tsconfig.scripts.json`）。 */
  });

  it("面被改窄 ⇒ 红，并逐份点名漏了谁（本案的病根）", () => {
    /* 落一根级 `.mjs`：include 只收 `scripts/**` 时它就不在面上了 —— 而根级文件在真仓里
     * 是真实存在的形态（`next.config.js` 那一层），漏掉它就是「覆盖面自己缩」。 */
    write("root-orphan.mjs", "export const orphan = 1;\n");
    writeFileSync(
      join(fixture, "tsconfig.scripts.json"),
      JSON.stringify({ ...FIXTURE_CONFIG, include: ["scripts/**/*.mjs"] }, null, 2),
      "utf8",
    );
    const { code, output } = runCheck(["--no-run"]);
    expect(code, output).toBe(1);
    expect(output).toContain("判决面漏了这些 .mjs");
    expect(output).toContain("root-orphan.mjs");
    rmSync(join(fixture, "root-orphan.mjs"), { force: true });
    /* 复原：这一格的结论必须是「窄了才红」，而不是夹具坏了。 */
    writeFileSync(
      join(fixture, "tsconfig.scripts.json"),
      JSON.stringify(FIXTURE_CONFIG, null, 2),
      "utf8",
    );
    expect(runCheck(["--no-run"]).code).toBe(0);
  });

  it("面为空 ⇒ 退 2（没结论），不许被读成「0 处 ⇒ 绿」", () => {
    writeFileSync(
      join(fixture, "tsconfig.scripts.json"),
      JSON.stringify({ ...FIXTURE_CONFIG, include: ["does-not-exist/**/*.mjs"] }, null, 2),
      "utf8",
    );
    const { code, output } = runCheck([]);
    expect(code, output).toBe(2);
    expect(output).toContain("一份 .mjs 都没有");
    writeFileSync(
      join(fixture, "tsconfig.scripts.json"),
      JSON.stringify(FIXTURE_CONFIG, null, 2),
      "utf8",
    );
  });
});

describe("脚本档棘轮 —— 只降不升", () => {
  it("seed：基线写出实测那一格，判定档随即绿", () => {
    const seeded = runCheck(["--update"]);
    expect(seeded.code, seeded.output).toBe(0);
    const base = readFixtureBaseline();
    /* 死声明必须真的被量到 —— 否则下面每一条「涨/降」的读数都建立在 0 上，
     * 整张表就只是在演「空账也能过」。 */
    expect(base.files["scripts/dirty.mjs"]?.TS6133).toBe(1);
    expect(base.total).toBe(1);
    const { code, output } = runCheck([]);
    expect(code, output).toBe(0);
    expect(output).toContain("✓ 判决面");
  });

  it("新增一份带错误的脚本 ⇒ 红（新脚本零容忍，基线里没有的格子就是新增）", () => {
    write(join("scripts", "newborn.mjs"), "const alsoDead = 1;\nexport const c = 3;\n");
    const { code, output } = runCheck([]);
    expect(code, output).toBe(1);
    expect(output).toContain("scripts/newborn.mjs TS6133");
    expect(output).toContain("新写的脚本零容忍");
    rmSync(join(fixture, "scripts", "newborn.mjs"), { force: true });
  });

  it("已有格子上涨 ⇒ 红；`--update` 同样拒，且**一个字节都不写回基线**", () => {
    const before = readFileSync(baselinePath(), "utf8");
    /* 在**已入账**的那份文件里再加一处死声明：基线里这一格从 1 变 2。 */
    write(join("scripts", "dirty.mjs"), "const dead = 1;\nconst dead2 = 2;\nexport const b = 2;\n");
    const judged = runCheck([]);
    expect(judged.code, judged.output).toBe(1);
    expect(judged.output).toContain("基线 1 → 当前 2");
    const updated = runCheck(["--update"]);
    expect(updated.code, updated.output).toBe(1);
    expect(updated.output).toContain("拒绝 --update");
    /* 拒涨那句话必须给出**上涨态里可执行的下一步**（四种自洽写法见
     * `tests/helpers/ratchet-refusal.ts`）—— 这一条由 `tests/ratchet-update-guards.test.ts`
     * 的「COVERED_LOCALLY 点名的那份用例必须真判过」那一格要求：本账本被归进
     * 「本地已覆盖」，所以「出路是不是死路」必须在这里被真判过一次，
     * 否则「表里点名了 = 判过了」又是一句没有执行者的声明（§11.2.1 那一族）。 */
    expectActionableRefusal(updated.output, "check-scripts-typecheck.cjs");
    /* 这条是关键：拒涨如果只「拒判」不「拒写」，账本会被上涨那一跑悄悄改掉。 */
    expect(readFileSync(baselinePath(), "utf8")).toBe(before);
    write(join("scripts", "dirty.mjs"), "const dead = 1;\nexport const b = 2;\n");
  });

  it("下降只提示、不拦（别把「修好了」判成红），且提示指路 `--update`", () => {
    write(join("scripts", "dirty.mjs"), "export const b = 2;\n");
    const { code, output } = runCheck([]);
    expect(code, output).toBe(0);
    expect(output).toContain("请收紧基线");
    expect(output).toContain("--update");
    write(join("scripts", "dirty.mjs"), "const dead = 1;\nexport const b = 2;\n");
  });
});

describe("脚本档 —— 被截断的一跑不许冒充结论", () => {
  it("语法层报错把语义检查整跑吃掉 ⇒ 红，且说清「没判」而不是「已修」", () => {
    /* 夹具里写一行 TS 类型注解：tsc 报 `TS8010` 之后就**不做语义检查**（实测），
     * 于是基线里那一格「消失」—— 这正是「320 → 1 被念成你修好了 319 处」的形态。 */
    write(join("scripts", "syntax.mjs"), "const n: number = 1;\nexport { n };\n");
    const judged = runCheck([]);
    expect(judged.code, judged.output).toBe(1);
    expect(judged.output).toContain("不做语义检查");
    expect(judged.output).toContain("没判");
    const updated = runCheck(["--update"]);
    expect(updated.code, updated.output).toBe(1);
    expect(updated.output).toContain("截断");
    rmSync(join(fixture, "scripts", "syntax.mjs"), { force: true });
    expect(runCheck([]).code).toBe(0);
  });
});

describe("真仓的账本 ⇄ 真仓的面（这一档唯一会随全仓漂移的两件事）", () => {
  /**
   * 用例自己走一遍盘（与判据的「TS glob 引擎展开」是两套独立实现）——
   * 只在一套上对账等于让被测件自己给自己打分。
   */
  function walkMjs(dir: string, out: Array<string>): Array<string> {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = abs.slice(REPO_ROOT.length + 1).replaceAll("\\", "/");
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) {
          continue;
        }
        walkMjs(abs, out);
      } else if (e.isFile() && e.name.endsWith(".mjs")) {
        out.push(rel);
      }
    }
    return out;
  }

  /**
   * 「面里有、git 清单里没有」的那几份 —— 只在数不上时才算（正常绿跑不付这次 git 调用）。
   *
   * 为什么需要它：只给「账上 210 / 展开 212」两个数时，读的人分不出这是
   * 「谁新加了一份没记账」还是「磁盘上多了一份没入库的产物」—— 而这两者的修法相反
   * （前者记账、后者归到 exclude 或删掉）。ISSUE #2572 撞的就是第二种形态。
   */
  function driftReading(face: Array<string>): string {
    let tracked: Set<string>;
    try {
      tracked = new Set(
        execFileSync("git", ["ls-files", "-z", "--", "*.mjs"], {
          cwd: REPO_ROOT,
          encoding: "utf8",
          env: gitSandboxEnv(),
        })
          .split("\0")
          .filter(Boolean),
      );
    } catch (error) {
      return `；git 清单取不到，定位不了是哪几份：${/* SAFETY: 类型断言已复核 */ (error as Error).message}`;
    }
    const stray = face.map((p) => String(p).replaceAll("\\", "/")).filter((p) => !tracked.has(p));
    return (
      `；面里有 ${stray.length} 份**不在 git 清单**（磁盘态、不入库）` +
      (stray.length > 0
        ? `：${stray.slice(0, 10).join(", ")} —— 修法是把它归进 exclude 或删掉，不是往账上记`
        : ` —— 差的全是入库文件 ⇒ 有人新加了脚本没记账，修法是把账记上`)
    );
  }

  /**
   * `scripts/eslint-gate-canary.mjs` 落临时样本用的目录前缀 —— **从它的源码里对账取回来**。
   *
   * 为什么这一格必须认得它：eslint@10 的 project service 要求样本**落在 tsconfig 项目里**
   * （`--stdin --stdin-filename` 会报 was not found by the project service），所以 canary
   * 只能在 `scripts/` 下落一份 `eslint-canary-<pid>-<时间戳>/` 的真目录、跑完 `finally` 删；
   * 而「受影响用例」那一格是**并发**跑的（`--maxWorkers=2`），下面那条「盘上没有未入库的
   * `.mjs`」于是会撞上同一次运行里另一份用例正在用的样本 —— 2026-10-30 PR #2783 的实测
   * 现场就是 `scripts/eslint-canary-151192-1793363720066/` 下那两份。
   *
   * 前缀不在这里写死（与 `tests/ci-daily-failure-issue.test.ts` 拿 `check-bundle-budget.cjs`
   * 源码对账判决行同一条口径 —— 两处各写一遍必然漂）：canary 改了命名 ⇒ 这里取不到 ⇒
   * 调用那侧把这一格判成「没判」，而不是当成「没有残留」。
   */
  function canaryScratchPrefix(): string | null {
    const src = readFileSync(join(REPO_ROOT, "scripts", "eslint-gate-canary.mjs"), "utf8");
    return /([A-Za-z0-9_-]*canary-)/.exec(src)?.[1] ?? null;
  }

  it("同跑兄弟件那一格：canary 的临时样本认得出，别的残留不认进去", () => {
    const prefix = canaryScratchPrefix();
    expect(
      prefix,
      "认不出 canary 的临时样本目录前缀 ⇒ 这一格的豁免口径与它漂了，两边要一起改",
    ).not.toBeNull();
    if (prefix === null) {return;}
    const scratch = new RegExp(`^scripts/${prefix}[^/]*/`);
    expect(scratch.test(`scripts/${prefix}151192-1793363720066/node-global.mjs`)).toBe(true);
    /* 反向的两条：同名的入库脚本目录、与 canary 落在 `tests/` 那一半，都不许被豁免掉。 */
    expect(scratch.test("scripts/stray-scratch/node-global.mjs")).toBe(false);
    expect(scratch.test(`tests/${prefix}151192-1793363720066/x.mjs`)).toBe(false);
  });

  it("账本里的 `face` 与 `total` 与配置展开同数（面与账不许两份口径）", () => {
    const judge = /* SAFETY: 类型断言已复核 */ createRequire(import.meta.url)(
      "../scripts/check-scripts-typecheck.cjs",
    ) as {
      configFace: (ts: unknown) => {
        excludes?: Array<string>;
        mjs?: Array<string>;
        ok: boolean;
        reason?: string;
      };
      diskFace: (
        list: Array<string>,
        excludes: Array<string>,
      ) => { all: Array<string>; missed: Array<string> };
      splitTrackedFace: (
        mjs: Array<string>,
        tracked: Set<string> | null,
      ) => { face: Array<string>; filtered: boolean; untracked: Array<string>; };
      trackedMjs: (root: string) => Set<string> | null;
    };
    /* `require("typescript")` 的返回是 `any` —— 这里只把它当**不透明句柄**交给判据
     * （判据那边只调 `readConfigFile` / `parseJsonConfigFileContent` 两件事），
     * 所以落成 `unknown`，不在用例这一侧再抄一份 TS 的类型面。 */
    const ts = /* SAFETY: 类型断言已复核 */ createRequire(import.meta.url)("typescript") as unknown;
    const cfg = judge.configFace(ts);
    expect(cfg.ok, "reason" in cfg ? cfg.reason : "").toBe(true);
    /* 面取**判据自己那一份求交结果**（ISSUE #2681）：账上记的是「这份提交里有多少脚本」，
     * 用例若拿未筛的磁盘展开去比，就把刚修掉的那条耦合又请回来了 ——
     * 平台上任何一份落在工作区的未入库产物都会让它红一次，而且指不出是谁。 */
    const { face, untracked } = judge.splitTrackedFace(cfg.mjs ?? [], judge.trackedMjs(REPO_ROOT));
    /* 面外那几份里的「同跑兄弟件」要先认出来：canary 与这一格**同一次运行里并发**，
     * 它的临时样本此刻正合法地躺在 `scripts/` 下（清理归它自己 `finally`），
     * 落进这一条断言就会变成「谁都没改、但红了」—— 而指不出是谁的绿与红都不能算结论。 */
    const prefix = canaryScratchPrefix();
    expect(
      prefix,
      "认不出 canary 的临时样本目录前缀 ⇒ 这一格的豁免口径与它漂了，两边要一起改",
    ).not.toBeNull();
    if (prefix === null) {return;}
    const scratch = new RegExp(`^scripts/${prefix}[^/]*/`);
    const strays = untracked.filter((p) => !scratch.test(String(p)));
    if (strays.length !== untracked.length) {
      console.log(
        `[scripts-typecheck-ratchet] 面外 ${untracked.length} 份里 ${untracked.length - strays.length} 份是同跑的 eslint canary 临时样本（由它自己 finally 清理）⇒ 不计入下面那条`,
      );
    }
    expect(
      strays,
      `磁盘上有、git 清单里没有的这几份不该出现在真仓库的工作区里：${strays.join("、")}`,
    ).toEqual([]);
    const baseline = /* SAFETY: 类型断言已复核 */ JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts", ".scripts-typecheck-baseline.json"), "utf8"),
    ) as { face: number; files: Record<string, Record<string, number>>; total: number; };
    /* 面收了、账没跟着记（或反过来）都会在这一格现形 —— 那两种形态在账面读数上
     * 长得一模一样，只有拿配置原值对才分得开。 */
    expect(
      baseline.face,
      `配置展开 ${face.length} 份，账上写 ${baseline.face}` +
        /* 只给两个数不够用（ISSUE #2572 的现场：本地面 211 = 入库的 `.mjs` 全量，
         * 平台同一份代码展开成 212）。**差一份**读不出是「谁新加了一份没记账」还是
         * 「磁盘上多了一份没入库的产物」，而这两者的修法相反 —— 所以红了要当场把
         * 「面里有、git 清单里没有」的那几份点名（判据一个字不变，只补指路）。 */
        (baseline.face === face.length ? "" : driftReading(face)),
    ).toBe(face.length);
    const summed = Object.values(baseline.files).reduce(
      (acc, codes) => acc + Object.values(codes).reduce((a, b) => a + b, 0),
      0,
    );
    expect(summed).toBe(baseline.total);
    /* 独立枚举：盘上每一份非点目录的 `.mjs` 都必须在面里（exclude 那些由配置自己说）。
     * 这里**刻意用未筛的 `cfg.mjs`** —— 这一问判的是「include 有没有被改窄」，
     * 是配置的事；未入库的产物由上面那条 `untracked` 单独点名，两问不混。 */
    const disk = walkMjs(REPO_ROOT, []);
    const missed = judge.diskFace(cfg.mjs ?? [], cfg.excludes ?? []);
    expect(missed.missed, `这些 .mjs 不在判决面上：${missed.missed.join(", ")}`).toEqual([]);
    expect(disk.length).toBeGreaterThanOrEqual(face.length);
  });
});

/**
 * 面 ⇄ 入库清单：未入库的产物不进账（ISSUE #2681）。
 *
 * 立案读数：平台那一跑展开 212 份而账上 210、本地是 211 = `git ls-files '*.mjs'` 的数，
 * 红只给两个数 —— 「差一份」有两种相反的修法（该记账 vs 该把它归进 exclude）。
 * 现在的口径：账记的是**这份提交**里有多少脚本，所以求交在判据里做、判据自己点名，
 * 用例这一侧读的是**同一份实现**（`trackedMjs` + `splitTrackedFace`），不抄第二遍。
 */
describe("未入库的产物不算进判决面（ISSUE #2681）", () => {
  const judge = createRequire(import.meta.url)("../scripts/check-scripts-typecheck.cjs") as {
    splitTrackedFace: (
      mjs: Array<string>,
      tracked: Set<string> | null,
    ) => { face: Array<string>; filtered: boolean; untracked: Array<string>; };
    trackedMjs: (root: string) => Set<string> | null;
  };

  it("求交给出两侧；取不到 git 清单时明写「没筛」而不是「都不算」", () => {
    const list = ["scripts/a.mjs", "scripts/stray.mjs"];
    const both = judge.splitTrackedFace(list, new Set(["scripts/a.mjs"]));
    expect(both.face).toEqual(["scripts/a.mjs"]);
    expect(both.untracked).toEqual(["scripts/stray.mjs"]);
    expect(both.filtered).toBe(true);
    /* `null` 那一支是夹具的形状：拿不到清单 ⇒ 面 = 磁盘展开原值。
       判它，是因为「筛成空集」长得像「面缩了」，而那是本次要修的反方向。 */
    const noGit = judge.splitTrackedFace(list, null);
    expect(noGit).toEqual({ face: list, untracked: [], filtered: false });
  });

  it("真 git 夹具：未入库那份被点名、不进面、它的红也不记账；提交之后就进账", () => {
    const git = (args: Array<string>, cwd: string) => gitInTempRepo(args, cwd);
    const repo = mkdtempSync(join(tmpdir(), "2681-repo-"));
    rmSync(repo, { recursive: true, force: true });
    mkdirSync(repo, { recursive: true });
    created.push(repo);
    writeFileSync(
      join(repo, "tsconfig.scripts.json"),
      JSON.stringify(FIXTURE_CONFIG, null, 2),
      "utf8",
    );
    mkdirSync(join(repo, "scripts"), { recursive: true });
    writeFileSync(join(repo, "scripts", "clean.mjs"), "export const a = 1;\n", "utf8");
    git(["init", "-q"], repo);
    git(["add", "-A"], repo);
    git(["commit", "-q", "-m", "seed"], repo);

    /* 先让它自己写一份基线（否则「不记账」那一支会被「没有基线」那一步盖住，读不出因果）。 */
    const seed = runCheck(["--update"], repo);
    expect(seed.code, seed.output).toBe(0);

    /* 未入库的一份**带错**（`const dead` 是本案那类死声明）：它必须被点名、且不进账。 */
    writeFileSync(
      join(repo, "scripts", "stray.mjs"),
      "const dead = 1;\nexport const z = 1;\n",
      "utf8",
    );
    const stray = runCheck([], repo);
    expect(stray.code, stray.output).toBe(0);
    expect(stray.output).toContain("展开 2 份 .mjs（入库的 1 份");
    expect(stray.output).toContain("面外未入库 1 份");
    expect(stray.output).toContain("scripts/stray.mjs");
    expect(stray.output).toContain("面外读数（未入库，不记账）");

    /* 反向：同一份一旦入库，它就该被算 —— 否则上面那支只是「永远不看新文件」。 */
    git(["add", "scripts/stray.mjs"], repo);
    git(["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "add stray"], repo);
    const trackedNow = runCheck([], repo);
    expect(trackedNow.code, trackedNow.output).toBe(1);
    expect(trackedNow.output).toContain("展开 2 份 .mjs（入库的 2 份");
    expect(trackedNow.output).toContain("scripts/stray.mjs TS6133");
    expect(trackedNow.output).not.toContain("面外未入库");
  });
});
