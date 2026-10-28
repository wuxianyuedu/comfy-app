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
import {
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { mkdtempSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const REPO_ROOT = resolve(process.cwd());
const CHECK = join(REPO_ROOT, "scripts", "check-scripts-typecheck.cjs");

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

const created: string[] = [];
let fixture = "";

/** 起真脚本（与 `runCheck` 同一条口径：子进程 + 原样退出码 + 两端输出都收回来）。 */
function runCheck(
  args: string[],
  root = fixture,
): { code: number; output: string } {
  try {
    const output = execFileSync(process.execPath, [CHECK, ...args], {
      cwd: REPO_ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, COMFY_SCRIPTS_TYPECHECK_ROOT: root },
    });
    return { code: 0, output };
  } catch (err) {
    const e = err as { status?: number; stdout?: string; stderr?: string };
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

/** 夹具里那份账本（判「`--update` 到底写没写」的唯一证据来源）。 */
function baselinePath(): string {
  return join(fixture, "scripts", ".scripts-typecheck-baseline.json");
}
function readFixtureBaseline(): { total: number; files: Record<string, Record<string, number>> } {
  return JSON.parse(readFileSync(baselinePath(), "utf8"));
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
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
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
  function walkMjs(dir: string, out: string[]): string[] {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, e.name);
      const rel = abs.slice(REPO_ROOT.length + 1).replace(/\\/g, "/");
      if (e.isDirectory()) {
        if (e.name.startsWith(".")) continue;
        walkMjs(abs, out);
      } else if (e.isFile() && e.name.endsWith(".mjs")) {
        out.push(rel);
      }
    }
    return out;
  }

  it("账本里的 `face` 与 `total` 与配置展开同数（面与账不许两份口径）", () => {
    const judge = createRequire(import.meta.url)(
      "../scripts/check-scripts-typecheck.cjs",
    ) as {
      configFace: (ts: unknown) => {
        ok: boolean;
        mjs?: string[];
        excludes?: string[];
        reason?: string;
      };
      diskFace: (list: string[], excludes: string[]) => { all: string[]; missed: string[] };
    };
    const ts = createRequire(import.meta.url)("typescript");
    const cfg = judge.configFace(ts);
    expect(cfg.ok, "reason" in cfg ? cfg.reason : "").toBe(true);
    const face = cfg.mjs ?? [];
    const baseline = JSON.parse(
      readFileSync(join(REPO_ROOT, "scripts", ".scripts-typecheck-baseline.json"), "utf8"),
    ) as { face: number; total: number; files: Record<string, Record<string, number>> };
    /* 面收了、账没跟着记（或反过来）都会在这一格现形 —— 那两种形态在账面读数上
     * 长得一模一样，只有拿配置原值对才分得开。 */
    expect(baseline.face, `配置展开 ${face.length} 份，账上写 ${baseline.face}`).toBe(
      face.length,
    );
    const summed = Object.values(baseline.files).reduce(
      (acc, codes) => acc + Object.values(codes).reduce((a, b) => a + b, 0),
      0,
    );
    expect(summed).toBe(baseline.total);
    /* 独立枚举：盘上每一份非点目录的 `.mjs` 都必须在面里（exclude 那些由配置自己说）。 */
    const disk = walkMjs(REPO_ROOT, []);
    const missed = judge.diskFace(face, cfg.excludes ?? []);
    expect(missed.missed, `这些 .mjs 不在判决面上：${missed.missed.join(", ")}`).toEqual([]);
    expect(disk.length).toBeGreaterThanOrEqual(face.length);
  });
});
