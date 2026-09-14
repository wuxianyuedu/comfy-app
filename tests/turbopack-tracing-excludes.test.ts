/**
 * 构建期「全项目追踪」告警的**真正防线**护栏（ISSUE #489）
 * ===========================================================================
 *
 * 背景：`next build`（Turbopack）对无法静态收敛的动态路径访问（`path.resolve` /
 * `path.join` 的参数依赖 `process.cwd()` / `process.env` / 目录项 / HTTP 入参）
 * 会打 `Dynamic filesystem access causes tracing of the whole project`，并把
 * **整个项目**当作 server code 的依赖复制进 `.next/standalone`。本仓库实测
 * standalone 62MB，`standalone/src` 里连 142 个 `*.test.ts` 都在。
 *
 * **为什么不是靠注解**：`/*turbopackIgnore: true*​/` 只作用于动态 `import()` /
 * `require()`，对 `fs.*` 的路径访问一概无效（四种写法逐一实测均无效，见规范
 * `launch-and-build.md` §7.2）。仓库里现有那些注解从未生效，不能当「已修」。
 * 因此真正的防线是 `next.config.js` 的 `outputFileTracingExcludes` —— 它工作在
 * **产物路径**层面，不依赖静态分析。
 *
 * 本用例只锁「防线还在、且没被静默改坏」这三件事：
 *   ① excludes 在**顶层**键位（历史事故：挂在 `experimental` 下完全不生效）；
 *   ② 关键目录清单齐全（删项 = 那些目录重新进产物，且没有任何提示）；
 *   ③ 没有用 `turbopack.ignoreIssue` 遮这条告警（那是关信号而非修问题）。
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CONFIG_PATH = join(process.cwd(), "next.config.js");
const config = readFileSync(CONFIG_PATH, "utf8");

/**
 * 剥掉 JS 注释：块注释用状态机（注释的起止符号分开处理，避免在正则字面量里
 * 自己把自己终结），行注释按行剥掉。
 */
function stripComments(src: string): string {
  let out = "";
  let inBlock = false;
  for (let idx = 0; idx < src.length; idx++) {
    const ch = src[idx];
    const next = src[idx + 1];
    if (inBlock) {
      if (ch === "*" && next === "/") {
        inBlock = false;
        idx++;
      }
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlock = true;
      idx++;
      continue;
    }
    if (ch === "/" && next === "/") {
      while (idx < src.length && src[idx] !== "\n") idx++;
      out += "\n";
      continue;
    }
    out += ch;
  }
  return out;
}

describe("outputFileTracingExcludes：动态路径访问的真正防线", () => {
  it("排除项挂在顶层键（挂 experimental 下等于不生效）", () => {
    expect(config).toMatch(/^\s{2}outputFileTracingExcludes:\s*\{/m);
    /* 只匹配「缩进两个空格的键」还不够：把整块搬进 `experimental: { ... }` 之后，
     * 块内每一行仍是两空格缩进，那个正则**照样匹配**（本文件早期版本就是这么
     * 放过了一次回归）。判据必须落在结构上——「键出现在 experimental 与下一个
     * 顶层键之间」即等于写在 experimental 里。 */

    /* 注释里会提到「此前键位写在 experimental 下」这段历史，必须先剥离注释再判。
     * 注意不能用 `/* ... *\/` 的正则：正则字面量里的 `\/` 会提前终结匹配，
     * 剩下的注释文本反而被当成代码（本文件早期版本就是这么自欺的）。
     * 这里按行剥 `//`、用状态机剥块注释，判据才真的落在代码上。 */
    const code = stripComments(config);
    /* 取「键定义」的位置要用**行首的两个空格缩进**匹配，不能裸 `indexOf`：
     * 注释里也会出现这个词（历史上就写过一句「已把 outputFileTracingExcludes
     * 移为顶层键」），裸查会切到注释处、把整段判据变成恒真。 */
    const keyDef = /^\s{2}outputFileTracingExcludes:/m.exec(code);
    expect(keyDef, "顶层缺少 outputFileTracingExcludes 键").not.toBeNull();
    const keyIndex = keyDef?.index ?? -1;
    /* 判据用「块结束括号的位置」而不是「下一个键的位置」比较：键名在注释里也
     * 出现过（历史上就写过「已把 outputFileTracingExcludes 移为顶层键」），
     * 而注释剥掉后仍可能让 `includes` 因为切片端点而误判（端点正好落在键上时
     * `includes` 为真）。这里取 experimental 块的右花括号，比较「键定义」与
     * 「块结束」的先后 —— 键在块内即键在前，键在顶层即块在前，没有歧义。 */
    const experimentalEnd = code.indexOf("\n  },", code.indexOf("experimental: {"));
    expect(experimentalEnd, "找不到 experimental 块结束位置").toBeGreaterThan(-1);
    expect(
      keyIndex < experimentalEnd,
      "outputFileTracingExcludes 不得放在 experimental 下（Next 16 已升为顶层键，写在旧位置一个字都不会被读）",
    ).toBe(false);
    // 反向锚点：块内必须真的有 useTypeScriptCli（否则「块结束」定位错了、白测）
    expect(code.slice(code.indexOf("experimental: {"), experimentalEnd)).toContain(
      "useTypeScriptCli",
    );
  });

  it.each([
    "./src-tauri/**",
    "./python-venv/**",
    "./docs/**",
    "./tests/**",
    "./e2e/**",
    "./tools/**",
    "./log/**",
  ])("关键目录 %s 仍在排除清单里", (entry) => {
    expect(
      config.includes(entry),
      `${entry} 从 outputFileTracingExcludes 移除后，该目录会被当作 server code ` +
        `依赖复制进 .next/standalone（构建不报错、体积静默膨胀）`,
    ).toBe(true);
  });

  it("没有用 turbopack.ignoreIssue 遮「全项目追踪」告警", () => {
    // 该选项只过滤 CLI 输出与 overlay、不改行为：配了它，产物照旧被放大
    // （实测：把哨兵目录从 excludes 摘掉后仍会进 standalone）。用它 = 关信号
    // 而非修问题，违反反模式 E9「降级不得静默」。
    expect(
      config.includes("ignoreIssue"),
      "turbopack.ignoreIssue 不得用于压制 'Dynamic filesystem access causes " +
        "tracing of the whole project'：它只关消息、不改行为，真正的防线是 outputFileTracingExcludes",
    ).toBe(false);
  });
});
