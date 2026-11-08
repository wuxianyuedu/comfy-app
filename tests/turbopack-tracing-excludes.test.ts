/**
 * 构建期「全项目追踪」告警的清单护栏 + 产物级探针（ISSUE #489）：动态路径访问会让整个项目被复制进
 * `.next/standalone`（实测 62MB，连 142 个 `*.test.ts` 都在）；`turbopackIgnore` 注解必须写在被高亮的
 * 表达式上才生效，跨模块展开无效（Next 16.4.3 实测，见 §7.2）。
 * 清单不做减法（真删靠 `standalone-private-inputs.mjs`），故产物探针才是判据；清单只守 ① 顶层键位 ② 目录齐全 ③ 不用 ignoreIssue。
 */
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
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
      while (idx < src.length && src[idx] !== "\n") {
        idx++;
      }
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

  it.for([
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
 * 产物存在时才数（守的是构建结果），没有则整组跳过。① 文件顶层不得调用 listFiles：describe 回调体在收集期
 * 执行，跳过判定救不了那行 scandir ⇒ 产物缺失时整份文件 ENOENT（CI test 排在 Build 前必挂，本机有 .next 全绿）。
 * ② 判据先求值再传入 `standaloneExists` 常量，不在 skipIf 里现算（两次求值差异会让跳过不可预期）。 */
function standaloneDir(): string {
  return join(process.cwd(), ".next", "standalone");
}

/**
 * 递归列出目录下所有相对路径（只在目录存在时调用）。不穿符号链接（`lstatSync` 判类型）：standalone 的
 * `node_modules/<pkg>` 指向 pnpm store，顺链接会把开发机依赖记成产物（实测 456 个 `next/dist/docs/*.md`），
 * 而产物层不能顺链接删（会损坏开发机依赖）；真文件在 `build-desktop.mjs` `dereference: true` 拷进后才有。
 */
function listFiles(dir: string, prefix = ""): Array<string> {
  const out: Array<string> = [];
  for (const name of readdirSync(dir)) {
    const abs = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    let st;
    try {
      st = lstatSync(abs);
    } catch {
      continue;
    }
    if (st.isSymbolicLink()) {
      out.push(rel);
      continue;
    }
    if (st.isDirectory()) {
      out.push(...listFiles(abs, rel));
    } else {
      out.push(rel);
    }
  }
  return out;
}

/** 产物目录是否存在；不存在时整组跳过（守卫守的是构建结果，不是构建本身）。 */
const standaloneExists = existsSync(standaloneDir());

describe.skipIf(!standaloneExists)(".next/standalone 产物里不得有测试 / 文档 / 变更碎片", () => {
  const files = standaloneExists ? listFiles(standaloneDir()) : [];

  it("确实数到了产物文件（探针自身不空跑）", () => {
    expect(files.length).toBeGreaterThan(10);
    expect(files.some((f) => f.includes("node_modules"))).toBe(true);
  });

  /* SAFETY: 类型断言已复核 */
  it.for([
    ["测试文件", /(?:^|\/)src\/.*\.test\.tsx?$/],
    ["变更碎片", /(?:^|\/)changelog\.d\/.*\.md$/],
    ["文档目录", /(?:^|\/)docs\/.*\.md$/],
  ] as const)("不含%s", ([, re]) => {
    const hits = files.filter((f) => re.test(f));
    expect(
      hits.slice(0, 10),
      `这些文件不该进 standalone（outputFileTracingExcludes 失效或漏项）：${hits.length} 个`,
    ).toEqual([]);
  });
});

/* ── 守卫自身的可运行性：产物缺失时不得让整份文件失败 ────────────────────
 *
 * 缺陷原形：产物不存在时整份文件收集失败，CI 的 `pnpm run test`（排在 Build 之前）每次必挂。
 * 判据落在结构上而非「再跑一遍 vitest」：只守「listFiles 调用挂在判据之下」，不依赖最小检出。
 */
describe("产物缺失时的跳过逻辑（守卫自身的可运行性）", () => {
  const source = readFileSync(
    join(process.cwd(), "tests", "turbopack-tracing-excludes.test.ts"),
    "utf8",
  );
  // 去掉注释再扫描：反面写法的说明本身会命中下面的正则（自指），
  // 而注释里的示例不构成真实调用
  const code = source.replaceAll(/\/\*[\s\S]*?\*\//g, "").replaceAll(/\/\/.*$/gm, "");

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
    expect(code).toMatch(new RegExp(String.raw`standaloneExists\s*\?\s*listFiles\(`));
  });
});

/* ── 构建期配置配对不变式：`useTypeScriptCli: false` ⇔ 解析到的必须是 TS6 ────
 *
 * 官方文档：关掉它回退到 JS 编译器 API 后，若 Next 解析到 TypeScript 7，`next build` 直接退出；
 * 本仓库 `typescript` 别名到 `@typescript/typescript6`（其 `bin/` 只有 `tsc6`，AGENTS 硬规则 2）。
 * 该 opt-out 的安全性寄生在「主版本 < 7」上；这里把它变成点名两侧出口的断言（留 TS6 或切 TS7 时去掉它）。 */
import { createRequire } from "node:module";

describe("useTypeScriptCli 与解析到的 TypeScript 版本必须配对", () => {
  const code = stripComments(config);
  const flag = /useTypeScriptCli:\s*(?<flag>true|false)/.exec(code);
  const optedOut = flag?.groups?.flag === "false";

  /** 从仓库根解析 `typescript` 那份包（本仓的 `typescript` 是 pnpm 别名，指向谁由安装态决定）。 */
  function resolvedTsVersion(): string {
    const requireFromRoot = createRequire(join(process.cwd(), "noop.js"));
    /* SAFETY: 类型断言已复核 */
    const pkg = JSON.parse(
      readFileSync(requireFromRoot.resolve("typescript/package.json"), "utf8"),
    ) as { version?: string };
    return pkg.version ?? "";
  }

  it("配置里显式写了 useTypeScriptCli 的布尔字面量（缺值等于两侧都判不了）", () => {
    expect(
      flag,
      "next.config.js 里找不到 useTypeScriptCli 的布尔字面量 —— 本判据的前提没了",
    ).not.toBeNull();
  });

  it("opt-out 在场时不得同时解析到 TypeScript 7（否则 next build 直接退出）", () => {
    const version = resolvedTsVersion();
    // 先卡形状再取主版本：`Number("")` 是 **0** 而不是 NaN，只判 `Number.isInteger`
    // 会让「版本号读不出来」伪装成合法的 TS0 静默通过。
    expect(
      /^\d+\./.test(version),
      `解析到的 typescript 版本号形状不对（拿到 "${version}"）—— 先跑 pnpm check:toolchain`,
    ).toBe(true);
    const major = Number(version.split(".")[0]);
    expect(
      optedOut && major >= 7,
      `useTypeScriptCli:false 与 typescript@${version} 不配对：官方口径下这会让 next build 直接退出` +
        "（TS7 必须走 CLI 模式）。两条出口选一：把 typescript 留在 TS6（现状），" +
        "或在切到 TS7 时删掉这颗 opt-out 并按 AGENTS 硬规则 2 说明理由。",
    ).toBe(false);
  });
});
