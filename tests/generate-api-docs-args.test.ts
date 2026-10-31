/**
 * `scripts/generate-api-docs.mjs` 的旗标契约（ISSUE #2740）。
 *
 * 这份入口的危险不在「跑挂了」，在「**接了一个用不了的值，然后照常往下跑**」：
 * `--out` 后面没人时 `out` 成了空串，而 `path.resolve(ROOT, "")` 就是仓库根，
 * 下一步 typedoc 会把整站产物（本机实测 2844 份）写进根上 —— 而根上那一份**不被
 * `.gitignore` 忽略**（名单里只有 `docs/api/`）。
 *
 * 所以这组用例的重心是「坏输入必须当场被拒，且**产物没动**」，而不是「默认值对不对」。
 *
 * ⚠️ 为什么本文件可以 `import` 那份脚本而从前不行：#2740 的第 2 案给它加了
 * 「被直接执行才跑」的守卫。原来一 import 就付一次真全量生成（本单的现场就是这么撞出来的），
 * 那样写用例的人必须先等 31s 再往盘上写两千多份文件 —— 代价劝退，于是那一格一直没有执行者。
 * 「import 不再跑」这一格由下面那条哨兵用例钉住（它起子进程，不复用本文件的 import）。
 */
import { execFileSync } from "node:child_process";
import path from "node:path";
import { expect, test } from "vitest";

import { parseArgs } from "../scripts/generate-api-docs.mjs";

const REAL_ROOT = path.resolve(__dirname, "..");
const SCRIPT = path.join(REAL_ROOT, "scripts", "generate-api-docs.mjs");

/** `execFileSync` 非零退出时抛的那件（node 的类型里没有具名导出的形状，就地声明）。 */
interface SpawnedFailure {
  message?: string;
  status?: number | null;
  stderr?: string;
  stdout?: string;
}

/** 跑一次入口并交出三件原值（非零退出时 `execFileSync` 会抛，那里带着 stdout/stderr）。 */
function runBin(args: string[]) {
  try {
    const out = execFileSync(process.execPath, [SCRIPT, ...args], {
      encoding: "utf8",
      cwd: REAL_ROOT,
    });
    return { status: 0, stdout: out, stderr: "" };
  } catch (e) {
    /* SAFETY: `execFileSync` 非零退出抛的就是「子进程结果 + Error」那一件，
     * node 的公开类型里没有具名形状（`ExecFileSyncException` 不存在），
     * 所以这里按实测字段声明：status / stdout / stderr / message 四个都在抛件上，
     * 读法只有 `?? 空值` 的兜底，没有别的假设。 */
    const err = e as SpawnedFailure;
    return {
      status: err.status ?? -1,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? String(err.message),
    };
  }
}

test("缺值的 `--out` 不再折成空串：交出问题，且 `out` 停在默认那份", () => {
  /* 这一条钉的是本单的真病灶。旧实现返回 `out: ""`，而 `""` 在下游不是「无效」而是
   * 「当前目录」—— 类型上没毛病、屏幕上没一句话，代价是整站写进仓库根。 */
  const { opts, problems } = parseArgs(["--out"]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("--out");
  expect(opts.out).toBe("docs/api");
});

test("等号形式的空值（`--out=`）同样被拒 —— 它和「没给」不是同一件事但同样不可用", () => {
  const { opts, problems } = parseArgs(["--out="]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("空的");
  expect(opts.out).toBe("docs/api");
});

test("`--out` 后面跟的是另一个旗标：不许把旗标当目录名吃掉", () => {
  /* 旧实现把 `--attempts` 当成目录名（`out: "--attempts"`），后面的 `2` 没人读 ——
   * 于是「我写了两个旗标」变成「写了一个叫 --attempts 的目录」。 */
  const { opts, problems } = parseArgs(["--out", "--attempts", "2"]);
  expect(problems.length).toBeGreaterThan(0);
  expect(opts.out).not.toBe("--attempts");
});

test("`--attempts` 的坏值各交一条问题（等号形式，值不会被误认成旗标）", () => {
  /* `2.9` 那一型是「屏幕上没说过的改写」：parseInt 给 2，跑的人以为要 2.9 次。 */
  for (const bad of ["abc", "0", "2.9", "-1", "1.0", "+2"]) {
    const { opts, problems } = parseArgs([`--attempts=${bad}`]);
    expect(problems, `--attempts=${bad} 应当被拒`).toHaveLength(1);
    expect(problems[0]).toContain("--attempts");
    expect(opts.attempts).toBe(3);
  }
});

test("空格形式的 `--attempts -1`：交两条真话，而不是假装能收负数", () => {
  /* 「以 `-` 开头的下一格不算值」是这条契约的骨架（`--out --attempts 2` 那种「把旗标
   * 当目录名吃掉」是本单修掉的原始病灶，见上一条用例）。代价就是这里：`-1` 既是
   * 「`--attempts` 没拿到值」也是「一个不认的参数」—— **两句话都成立**，
   * 所以这里断言的是「≥2 且两句都在」，而不是把它压成一条更好看的数。
   * 想给负数或奇怪的值就写 `--attempts=-1`，那里只有一条（上一条已断言）。 */
  const { opts, problems } = parseArgs(["--attempts", "-1"]);
  expect(problems.length).toBeGreaterThanOrEqual(2);
  expect(problems[0]).toContain("后面没有值");
  expect(problems.join(" ")).toContain("-1");
  expect(opts.attempts).toBe(3);
});

test("未知参数不再静默：走那份既有的可行动话术（里面点名它认哪两个旗标）", () => {
  const { problems } = parseArgs(["--nope"]);
  expect(problems).toHaveLength(1);
  expect(problems[0]).toContain("--nope");
  expect(problems[0]).toContain("--out");
  expect(problems[0]).toContain("typedoc");
});

test("合法形状照旧收：两种形式都认，重复给同一个旗标按后者（写在注释里，不是偶然）", () => {
  expect(parseArgs(["--out", "tmp/a"]).opts.out).toBe("tmp/a");
  expect(parseArgs(["--out=tmp/b"]).opts.out).toBe("tmp/b");
  expect(parseArgs(["--attempts", "1"]).opts.attempts).toBe(1);
  expect(parseArgs(["--attempts=2"]).opts.attempts).toBe(2);
  expect(parseArgs(["--out", "x", "--out", "y"]).opts.out).toBe("y");
  expect(parseArgs([]).problems).toEqual([]);
});

test("哨兵：`import` 这份模块不跑生成（这一格是「为什么现在写得动用例」的钉子）", () => {
  /* 起子进程而不是在本文件里 dynamic import：本文件顶部那句静态 import 早就把模块求值完了，
   * 在这里装 spy 只能证明「之后没跑」。子进程有它自己的模块图，才量得出「import 那一刻」
   * 有没有副作用（同族的成本口径见 `tests/check-a11y-rules.test.ts` 文件头那条「子进程买不到
   * 本进程暖机的便宜」—— 这里要的正是一台干净的机器）。 */
  const code = [
    `const { pathToFileURL } = await import("node:url");`,
    `const m = await import(pathToFileURL(${JSON.stringify(SCRIPT)}).href);`,
    `process.stdout.write("SENTINEL:" + typeof m.parseArgs + "\\n");`,
  ].join("\n");
  const out = execFileSync(process.execPath, ["--input-type=module", "-e", code], {
    encoding: "utf8",
    cwd: REAL_ROOT,
  });
  expect(out).toContain("SENTINEL:function");
  /* 旧形状下这里会是 `[INFO] typedoc out: …` + 一次真生成（几十秒、两千多份写盘）。 */
  expect(out).not.toContain("typedoc out");
});

test("bin：`--out` 缺值 ⇒ 退 2，且**产物一步都没跑**（不许出现那句 out: 打点）", () => {
  const r = runBin(["--out"]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("用法错");
  /* 这一句才是本单要的结论：`[INFO] typedoc out:` 打在真正调 typedoc 之前，
   * 它没出现 = 那条路径上一次 typedoc 都没被起过。 */
  expect(r.stdout).not.toContain("typedoc out");
});

test("bin：显式 `--out .` ⇒ 退 2 并说清「解析出来是仓库根」", () => {
  /* 旗标语法上没毛病（值给了、非空），所以 parseArgs 那层不该拦 ——
   * 拦它的是 `main` 里那道边界：后果与兜底那一条完全相同，来路不同。 */
  const { problems } = parseArgs(["--out", "."]);
  expect(problems).toEqual([]);
  const r = runBin(["--out", "."]);
  expect(r.status).toBe(2);
  expect(r.stderr).toContain("仓库根");
  expect(r.stdout).not.toContain("typedoc out");
});
