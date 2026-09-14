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
    // ISSUE #489：以下三项是实测确认漏掉、且属于「纯数据/测试，绝不可能是
    // server code 的运行时依赖」的东西。它们出现在 nft 追踪里，正是 §7.2 那条
    // 「Turbopack 放弃静态追踪、退化为全项目追踪」的产物。
    "./changelog.d/**", // 89 个变更碎片、384K，纯文档数据
    "./src/**/*.test.ts", // 143 个测试文件，路由只 import 编译产物，测试是死重量
    "./src/**/*.test.tsx",
    "./log/**", // 运行期输出，经 instrumentation 的 nft 旁路进产物
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

/* ── 产物级探针：真看 .next/standalone 里有没有不该有的东西 ──────────────
 *
 * 上面的用例只锁「配置清单还在」，看不到「清单是否真的起了作用」——而清单
 * 失效正是历史上发生过的事（键位曾挂在 experimental 下，一个字都没被读，
 * 却因为没有任何用例去数产物里的文件而无人察觉）。
 *
 * 这条探针在**构建产物存在时**真去数：standalone 里不得出现测试文件、变更
 * 碎片与文档。没有产物（如只跑单测的检出）时整组跳过 —— 它守的是构建结果，
 * 不是单元逻辑。
 *
 * ⚠️ 两个细节决定这组用例是「守卫」还是「陷阱」：
 *
 * ① **文件顶层不得调用 listFiles**。`describe.skipIf` 的求解发生在收集期，
 *    describe 回调体内的语句**也会在收集期执行**（与 skipIf 的求解同处一个
 *    阶段，且先于任何用例运行）。原实现在回调体首行直接 `listFiles(STANDALONE)`
 *    ——即使 skipIf 已经判定要跳过，那行 scandir 照样跑，于是「产物缺失」从
 *    「应当跳过」变成整份文件 `Failed Suites: ENOENT: scandir .../.next/standalone`
 *    （0 个用例）。实测形态：CI 的 `pnpm run test` 排在 Build 之前，产物必然
 *    不存在，因此每次必挂；而本机因为 `.next` 恰好存在而全绿，呈现成
 *    「本地绿、CI 红」。修法是把调用**放在同一个条件里**（`exists ? list()
 *    : []`），而不是仅靠 describe.skipIf 拦。
 * ② **判据先求值、再传入**（`standaloneExists` 常量），不要在 skipIf 里
 *    现算——收集期与回调体两次求值之间的状态差异会让跳过与否不可预期。
 *
 * 反向验证：构造一个不含 `.next/standalone` 的工作目录，本组必须**全跳过且
 * 0 失败**（而不是 ENOENT）；构造一个含 `src/*.test.ts` 的假产物，必须报出它。
 */
import { existsSync, readdirSync, statSync } from "node:fs";

function standaloneDir(): string {
  return join(process.cwd(), ".next", "standalone");
}

/** 递归列出目录下所有相对路径（只在目录存在时调用）。 */
function listFiles(dir: string, prefix = ""): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = statSync(abs);
    } catch {
      continue;
    }
    if (st.isDirectory()) out.push(...listFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

/** 产物目录是否存在；不存在时整组跳过（守卫守的是构建结果，不是构建本身）。 */
const standaloneExists = existsSync(standaloneDir());

describe.skipIf(!standaloneExists)(
  ".next/standalone 产物里不得有测试 / 文档 / 变更碎片",
  () => {
    const files = standaloneExists ? listFiles(standaloneDir()) : [];

    it("确实数到了产物文件（探针自身不空跑）", () => {
      expect(files.length).toBeGreaterThan(10);
      expect(files.some((f) => f.includes("node_modules"))).toBe(true);
    });

    it.each([
      ["测试文件", /(^|\/)src\/.*\.test\.tsx?$/],
      ["变更碎片", /(^|\/)changelog\.d\/.*\.md$/],
      ["文档目录", /(^|\/)docs\/.*\.md$/],
    ])("不含%s", (_label, re) => {
      const hits = files.filter((f) => re.test(f));
      expect(
        hits.slice(0, 10),
        `这些文件不该进 standalone（outputFileTracingExcludes 失效或漏项）：${hits.length} 个`,
      ).toEqual([]);
    });
  },
);

/* ── 守卫自身的可运行性：产物缺失时不得让整份文件失败 ────────────────────
 *
 * 上面那组探针「有产物才有意义」，但它的**缺失处理**本身必须可靠 —— 这正是
 * 本轮修掉的缺陷：产物不存在时整份文件收集失败，于是 CI 的 `pnpm run test`
 * （排在 Build 之前）每次必挂，而本机因 `.next` 存在而全绿。
 *
 * 判据落在**结构**上而不是「再跑一遍 vitest」：真正要守住的是「listFiles 的
 * 调用挂在判据之下」。用子进程重跑本文件需要完整的最小检出（alias、setup、
 * node_modules 解析），一旦仓库结构变化就先坏在无关处，反而更容易被删掉；
 * 而结构断言直接指向那个会出错的写法，改回去即红。
 */
describe("产物缺失时的跳过逻辑（守卫自身的可运行性）", () => {
  const source = readFileSync(
    join(process.cwd(), "tests", "turbopack-tracing-excludes.test.ts"),
    "utf8",
  );
  // 去掉注释再扫描：反面写法的说明本身会命中下面的正则（自指），
  // 而注释里的示例不构成真实调用
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("listFiles 的调用必须挂在「产物存在」判据之下，不得裸调", () => {
    const bareCalls = code.match(/=\s*listFiles\(/g) ?? [];
    expect(
      bareCalls.length,
      "listFiles 不得在收集期被裸调（必须有 `存在 ? listFiles(...) : []` 之类的条件）",
    ).toBe(0);
  });

  it("跳过判据先求值成常量再传入 describe.skipIf", () => {
    expect(code).toMatch(/const\s+standaloneExists\s*=\s*existsSync\(/);
    expect(code).toMatch(/describe\.skipIf\(!standaloneExists\)/);
  });

  it("存在判据与调用在同一条件表达式里（缺失时整组不执行、不报错）", () => {
    // 用 RegExp 构造避免本断言的字面量自身命中下面的 bareCalls 匹配
    expect(code).toMatch(new RegExp("standaloneExists\\s*\\?\\s*listFiles\\("));
  });
});
