/**
 * `scripts/check-docs-api.cjs` 的判据（ISSUE #1329 收尾 → **ISSUE #2231 改判据对象**）。
 *
 * 这一步现在要拦的东西换了。上一版拦的是「`docs/api/**` 生成物静默过期」——
 * 它进 git、被 AGENTS 与主规范 §9 承诺「随构建链更新」，而构建链里没有任何一处调用
 * `pnpm docs`，于是产物停在最初那两次提交上（收尾时实测 2627 个文件差异，还留着指向
 * 已删模块的 `lib_comfyui_markdown.html`）。
 *
 * ISSUE #2231 把那份产物**从 git 里搬走**了（`.gitignore` 的 `docs/api/`），于是
 * 「提交进 git 的那份与源同不同步」这个问题**没有对象**了 —— 判据改成三件能答的事：
 *
 *   1. **触发面**：窄了 = 改了会改产物的东西却没触发（判据白挂）；宽了 = 每个前端提交
 *      付 31s（然后没人愿意用）。它是 typedoc `entryPoints` 的**直接映射** ∪ 闭包叶子集，
 *      不是启发式，所以这里逐条钉住边界（含 `.test.ts` 也在入口 glob 里这件事）。
 *   2. **骨架齐全 + 可移植**：产物缺了默认主题每一页都引用的那几份 = 读者打开就是坏的；
 *      产物里烤进本机绝对路径 = 这份副本换台机器就不成立。
 *   3. **`--autofix` 不再被接受**：产物不进 git ⇒ 没有「自动修完再提交」的对象；而
 *      「自动修 + 再判」这个形状正是让「产物陈旧」在 CI 上隐形的那一格（#2231 的现场）。
 *
 * 用一次性目录做夹具，不碰仓库里的 `docs/api`。
 */
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import {
  INPUT_RES,
  SKELETON,
  judgeProduct,
  judgeTypedocTail,
  matchedInputs,
  walk,
} from "../scripts/check-docs-api.cjs";

const temps: Array<string> = [];

function tempDir(prefix: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
}

/**
 * 建一份「骨架齐全」的产物夹具 —— 默认主题每一页都引用的那几份 + 一个模块页。
 * @param {Record<string, string>} extra 额外的文件（相对产物目录）
 */
function productFixture(extra: Record<string, string> = {}): string {
  const dir = tempDir("docs-api-prod-");
  for (const rel of SKELETON) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), `stub:${rel}`);
  }
  mkdirSync(path.join(dir, "modules"), { recursive: true });
  writeFileSync(path.join(dir, "modules", "lib_demo.html"), "<html>demo</html>");
  for (const [rel, body] of Object.entries(extra)) {
    mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

afterEach(() => {
  // `temps.pop()` 在 `while (temps.length)` 下必然有值，用 `!` 比 `as` 更短且不撒谎
  while (temps.length) {
    rmSync(temps.pop()!, { recursive: true, force: true });
  }
});

describe("触发面 = typedoc 的输入面（不是启发式收窄）", () => {
  it("入口 glob 覆盖的三个目录里的源码都触发", () => {
    for (const f of [
      "src/lib/markdown/render.ts",
      "src/lib/core/config.ts",
      "src/server/workshop/comfyui.ts",
      "src/trpc/routers/workflow.ts",
    ]) {
      expect(matchedInputs([f]), `${f} 应触发`).toEqual([f]);
    }
  });

  it("typedoc 配置与依赖声明也触发（它们会改变产物形态）", () => {
    for (const f of ["typedoc.json", "package.json", "pnpm-lock.yaml"]) {
      expect(matchedInputs([f]), `${f} 应触发`).toEqual([f]);
    }
  });

  it("与产物无关的改动不触发（不给普通提交加那 31s）", () => {
    for (const f of [
      "src/components/workshop/WorkshopStageBody.tsx",
      "src/app/page.tsx",
      "docs/standards/13-提交与-code-review.md",
      "tests/check-docs-api.test.ts",
      "scripts/check-file-structure.cjs",
      "README.md",
    ]) {
      expect(matchedInputs([f]), `${f} 不该触发`).toEqual([]);
    }
  });

  it("判据自身与它共用的跑法也算输入面（ISSUE #1981）", () => {
    /* 此前改这份脚本**不触发它自己** —— 于是「改了判据 → 推上去 → 它没跑」是这类
     * 改动的默认形状，而这恰恰是「产物与源同不同步」这件事被改动的那一刻。 */
    for (const f of ["scripts/check-docs-api.cjs", "scripts/typedoc-run.mjs"]) {
      expect(matchedInputs([f]), `${f} 应触发`).toEqual([f]);
    }
  });

  it("入口 glob 是 `!(*.test).ts`，所以 src/lib 下的 .test.ts 也在面内", () => {
    // 这条看着反直觉，但它是「直接映射」的证据：typedoc 的入口写的是
    // `src/lib/**/!(*.test).ts`，`*` 不跨目录，所以嵌套测试文件本来就在展开集合里。
    // 收窄成「排除 *.test.ts」是**多写的启发式**，与配置脱钩（配置改了它不会跟）。
    expect(matchedInputs(["src/lib/endpoints.test.ts"])).toEqual(["src/lib/endpoints.test.ts"]);
    expect(INPUT_RES.some((re) => re.test("src/lib/x.ts"))).toBe(true);
  });

  it("src/trpc 的 .tsx 也在面内（typedoc 入口含 .tsx —— 它的导出被产物引用，#2444）", () => {
    // react.tsx 的 RouterInputs 被 workflow-mutations 引用；入口 glob 此前不收 .tsx
    // ⇒ 符号页不存在、typedoc 报 warning。入口扩了，输入面必须同批扩（#2223 的对账纪律）。
    expect(matchedInputs(["src/trpc/react.tsx"])).toEqual(["src/trpc/react.tsx"]);
  });

  it("多文件清单只回命中项，顺序保持", () => {
    expect(matchedInputs(["README.md", "src/lib/a.ts", "pnpm-lock.yaml", "src/app/x.tsx"])).toEqual(
      ["src/lib/a.ts", "pnpm-lock.yaml"],
    );
  });

  it("产物面 `docs/api/**` 不在面内（产物不再进 git，ISSUE #2231）", () => {
    /* 产物面曾经是面的一部分（产物被手改过也要看得见）。产物出库之后它既不在变更
     * 文件清单里、也不会被谁改坏 ⇒ 留在面里只是白占一行。 */
    expect(matchedInputs(["docs/api/index.html"])).toEqual([]);
    expect(INPUT_RES.some((re) => re.test("docs/api/index.html"))).toBe(false);
  });
});

describe("walk：不穿符号链接", () => {
  it("目录链接不跟着走（产物里混进链接不该被算成产物）", () => {
    const root = tempDir("docs-api-walk-");
    mkdirSync(path.join(root, "sub"));
    writeFileSync(path.join(root, "a.html"), "a");
    writeFileSync(path.join(root, "sub", "b.html"), "b");
    const outside = tempDir("docs-api-outside-");
    writeFileSync(path.join(outside, "secret.html"), "s");
    /* Windows 上普通 symlink 需要特权（实测 EPERM：没开开发者模式的机器上这条
       判据根本跑不起来）。junction 不需要，且实测 Node 24 的 `Dirent.isSymbolicLink()`
       对 junction 返回 true、`isDirectory()` 返回 false —— 也就是说「遍历器不许穿过
       链接」这条性质照旧被检验，不必为了平台降级成 skip。 */
    symlinkSync(
      outside,
      path.join(root, "link"),
      process.platform === "win32" ? "junction" : "dir",
    );

    const files = [...walk(root).keys()].sort();
    expect(files).toEqual(["a.html", "sub/b.html"]);
  });

  it("目录不存在给空表（而不是抛）", () => {
    expect(walk(path.join(tempDir("docs-api-missing-"), "nope")).size).toBe(0);
  });
});

describe("judgeProduct：骨架齐全 + 可移植（ISSUE #2231 的新判据）", () => {
  it("骨架齐全、至少一个模块页、路径可移植 ⇒ 一条都不报", () => {
    const dir = productFixture();
    const got = judgeProduct(dir, "/nonexistent/repo", {});
    expect(got.problems).toEqual([]);
    expect(got.modulePages).toBe(1);
    expect(got.files).toBeGreaterThan(0);
  });

  it("缺骨架文件 ⇒ 点名哪一个缺（读者打开就是坏的）", () => {
    const dir = productFixture();
    rmSync(path.join(dir, "assets", "search.js"), { force: true });
    const got = judgeProduct(dir, "/nonexistent/repo", {});
    expect(got.problems.join("\n")).toContain("缺少骨架文件：assets/search.js");
  });

  it("一个模块页都没有 ⇒ 报「这份 API 文档没有内容」", () => {
    const dir = productFixture();
    rmSync(path.join(dir, "modules"), { recursive: true, force: true });
    const got = judgeProduct(dir, "/nonexistent/repo", {});
    expect(got.problems.join("\n")).toContain("没有任何模块页");
  });

  it("产物里烤进本机绝对路径 ⇒ 报出来（两种分隔符形态都查）", () => {
    /* 这条不是洁癖：这份副本是要给人读的，而 typedoc 的源码链接 / 搜索索引 /
     * 面包屑里只要有一处烤进了本机路径，读者点开的就不是同一个东西。 */
    const win = productFixture({ "modules/leak.html": "<p>C:\\repo\\src\\lib\\x.ts</p>" });
    expect(judgeProduct(win, "C:\\repo", {}).problems.join("\n")).toContain("本机绝对路径");
    const posix = productFixture({ "modules/leak.html": "<p>/repo/src/lib/x.ts</p>" });
    expect(judgeProduct(posix, "/repo", {}).problems.join("\n")).toContain("本机绝对路径");
  });

  it("typedoc.json 把 cleanOutputDir 关了 ⇒ 报出来（孤儿页面会留在这一轮里）", () => {
    const dir = productFixture();
    const got = judgeProduct(dir, "/nonexistent/repo", { cleanOutputDir: false });
    expect(got.problems.join("\n")).toContain("cleanOutputDir");
  });
});

describe("--autofix 这一档已经不存在了（ISSUE #2231）", () => {
  it("撞上 --autofix 直接退 1 并说明为什么（不是静默忽略）", () => {
    /* 静默忽略一个旗标正是本仓最恨的那族（脚自称与实际不一致）：产物不进 git ⇒
     * 没有「自动修完再提交」的对象，而「自动修 + 再判」这个形状正是让「产物陈旧」
     * 在 CI 上隐形的那一格（#2231 的现场：master 上差 9 处而平台报绿）。 */
    const script = path.resolve(__dirname, "..", "scripts", "check-docs-api.cjs");
    let code = 0;
    let out;
    try {
      out = execFileSync(process.execPath, [script, "--autofix"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (err) {
      const e = /* SAFETY: 类型断言已复核 */ err as { status?: number; stderr?: string };
      code = e.status ?? -1;
      out = `${e.stderr ?? ""}`;
    }
    expect(code).toBe(1);
    expect(out).toContain("--autofix");
  });
});

/**
 * typedoc 收尾日志的结论判读（ISSUE #2444）—— 四种形态各一条：
 * 总结行在场有账（红）、总结行 0/0（绿）、总结行缺席但有 html generated（绿，
 * 0 warning 时 typedoc 不打总结行 —— 本地实测过）、两者都缺（红）。
 * ANSI 色码是平台日志的原生形态，夹具里带上它，判读必须先剥色。
 */
describe("judgeTypedocTail：typedoc 收尾日志的结论判读（#2444）", () => {
  it("总结行报了 errors / warnings ⇒ 红，且红话里带数", () => {
    const log =
      "\x1b[93m[warning]\x1b[0m 某个死链\n" + "[warning] Found 0 errors and 61 warnings\n";
    const got = judgeTypedocTail(log);
    expect(got.problems).toHaveLength(1);
    expect(got.problems[0]).toContain("0 errors / 61 warnings");
  });

  it("总结行 0 errors / 0 warnings ⇒ 绿", () => {
    expect(judgeTypedocTail("[warning] Found 0 errors and 0 warnings\n").problems).toEqual([]);
  });

  it("总结行缺席但 html generated 在场 ⇒ 绿（0 warning 时不打总结行）", () => {
    const log = "\x1b[96m[info]\x1b[0m html generated at ./docs/api\n";
    expect(judgeTypedocTail(log).problems).toEqual([]);
  });

  it("总结行与 html generated 都缺 ⇒ 红（读不到结论与全是 warning 同罪）", () => {
    const got = judgeTypedocTail("typedoc: some unrelated line\n");
    expect(got.problems).toHaveLength(1);
    expect(got.problems[0]).toContain("读不到这一格结论");
  });
});
