/**
 * standalone 运行时完整性护栏（ISSUE #489）
 * ===========================================================================
 *
 * 背景：`next build`（Turbopack）对 `require("next/dist/compiled/next-server/
 * <name>.runtime.prod.js")` 这类**动态 require 字符串**的追踪是**不完整的**。
 * 实测：只有被 middleware 图命中的那一份（`app-page-turbo`）出现在 nft 清单里，
 * `app-route-turbo` 一份都不在 —— 而所有 App Route（`route.js`）都在 require 它。
 *
 * 后果不是「少了个文件」，而是**所有 API 路由 500**：
 *
 * 报错形如：Failed to load external module
 *   缺的件形如 next/dist/compiled/next-server/app-route-turbo.runtime.prod.js
 *   跟一句 Cannot find module 报错
 *
 * 页面（RSC 渲染走 app-page-turbo）与 middleware 都还正常，于是呈现成
 * 「首页 200、接口全 500」—— 看起来像业务 bug，实际是产物缺口。
 *
 * **为什么单测拦不住、必须锁配置 + 数产物**：
 *   · 本仓库 `next start` 与 `output: standalone` 不兼容（Next 会打
 *     `"next start" does not work with "output: standalone"` 警告），也就是说
 *     **没有任何常规门禁会去启动 standalone 服务**；CI 只跑 `pnpm build`，
 *     构建期不会报错（缺口是运行时才暴露的）；
 *   · 所以这里做两件事：① 锁 `outputFileTracingIncludes` 条目还在（改坏了先红）；
 *     ② 产物存在时真去数那份文件在不在。
 *
 * 反向验证：把 `outputFileTracingIncludes` 从 next.config.js 摘掉重新 build，
 * `.next/standalone` 里 `app-route-turbo.runtime.prod.js` 消失，本文件的产物用例
 * 失败、`check-standalone-contents.cjs` 也报缺件（见 tests 注释末尾的判据）。
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const config = readFileSync(join(process.cwd(), "next.config.js"), "utf8");

/** Next 自带的运行时脚本目录（相对产物根）。 */
const RUNTIME_DIR = "node_modules/next/dist/compiled/next-server";

/** 必须出现在产物里的运行时脚本（**逐个点名**，不用通配）。 */
const REQUIRED_RUNTIME_FILES = [
  // App Route（所有 route.ts）—— 缺口就是这一份
  "app-route-turbo.runtime.prod.js",
  // 页面（RSC）—— 被 middleware 图意外带上，但同样必须显式保证
  "app-page-turbo.runtime.prod.js",
  // middleware 自身
  "pages-turbo.runtime.prod.js",
];

describe("outputFileTracingIncludes：Next 自带运行时脚本必须显式包含", () => {
  it("键挂在顶层（挂 experimental 下等于不生效）", () => {
    expect(config).toMatch(/^\s{2}outputFileTracingIncludes:\s*\{/m);
  });

  it("包含 next/dist/compiled/next-server 的运行时脚本", () => {
    expect(
      config.includes(
        "./node_modules/next/dist/compiled/next-server/*runtime.prod.js",
      ),
      "缺口就在这里：Turbopack 对动态 require 字符串只追踪到被 middleware 命中的" +
        "那一份，app-route-turbo 不在 nft 里 —— 漏掉后所有 API 路由运行时 500",
    ).toBe(true);
  });

  it("不是用 excludes 反着写（excludes 只做减法，补不回缺失的文件）", () => {
    // 这条是方向性判据：曾经「修」这条的思路是往 excludes 里加东西，
    // 而 excludes 只会让产物更小。缺件只能靠 includes。
    expect(config).not.toMatch(
      /outputFileTracingExcludes:\s*\{[^}]*next-server[^}]*\}/,
    );
  });
});

/* ── 产物级探针：真去数那份运行时脚本在不在 ────────────────────────────
 *
 * 与 tests/turbopack-tracing-excludes.test.ts 同款写法（那里详细写了为什么
 * listFiles 的调用必须挂在判据之下、判据必须先求值再传进 skipIf —— 否则
 * 「产物缺失」会从「应当跳过」变成整份文件收不到用例）。
 */
const standaloneDir = join(process.cwd(), ".next", "standalone");

/**
 * 产物根在，**且**里面那份 `next` 够得着 —— 守卫必须判两件事。
 *
 * 为什么要加后半截：standalone 的 `node_modules/<pkg>` 是指向 pnpm store 的符号链接
 * （硬规则 17 的减法正是靠「不穿链接」保住它们），而**任何一次 `pnpm install` 都会
 * 换掉 store 里那条路径的哈希段** —— 上一次构建留下的壳于是整体悬空：产物根仍然在，
 * `RUNTIME_DIR` 却数出 0 份。只判「根在」时，这 0 会被断言成
 * 「缺 `app-route-turbo.runtime.prod.js`，所有接口会 500」—— 那是把「这台机器很久没
 * 重新构建」说成「产物有缺陷」，而照着那句话去动 `outputFileTracingIncludes`
 * 只会把本来正确的配置改坏。本机实测就是这个形态（根在、`node_modules/next` 是悬链）。
 *
 * 与既有口径一致：产物档在没有产物的检出上**自行跳过**，而「有没有真的构建过」
 * 由 `scripts/.artifact-freshness.json` 那一档每日自证判（§11.8 / §13.5.4）——
 * 把「这台机器没构建」变成这里的红，只会让人去改判据而不是去跑构建。
 */
const nextReachable = existsSync(
  join(standaloneDir, "node_modules", "next", "package.json"),
);
const artifactUsable = existsSync(standaloneDir) && nextReachable;

/** 列出运行时脚本目录（不存在时返回空数组，绝不裸调）。 */
function runtimeFiles(): string[] {
  const dir = join(standaloneDir, RUNTIME_DIR);
  return existsSync(dir) ? readdirSync(dir) : [];
}

describe.skipIf(!artifactUsable)(
  ".next/standalone 里的 Next 运行时脚本不得缺件",
  () => {
    const files = artifactUsable ? runtimeFiles() : [];

    it("探针自身不空跑（确实数到了运行时脚本目录）", () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.for(REQUIRED_RUNTIME_FILES)("%s 在产物里", (name) => {
      expect(
        files,
        `缺少 ${name}：所有 App Route 运行时都会 ` +
          `Failed to load external module 并返回 500（页面正常，接口全挂）`,
      ).toContain(name);
    });
  },
);

/* ── 守卫自身的可运行性 ────────────────────────────────────────────────
 * 与上面那组同源：runtimeFiles() 不得在收集期被裸调。这里用结构断言而不是
 * 「再跑一遍 vitest」—— 后者需要完整最小检出，仓库结构一变就先坏在无关处。
 */
describe("产物缺失时的跳过逻辑（守卫自身的可运行性）", () => {
  const source = readFileSync(
    join(process.cwd(), "tests", "standalone-runtime-completeness.test.ts"),
    "utf8",
  );
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");

  it("runtimeFiles 的调用必须挂在「产物存在」判据之下，不得裸调", () => {
    expect(code.match(/=\s*runtimeFiles\(\)/g) ?? []).toHaveLength(0);
  });

  it("跳过判据先求值成常量再传入 describe.skipIf", () => {
    expect(code).toMatch(/const\s+artifactUsable\s*=/);
    expect(code).toMatch(/describe\.skipIf\(!artifactUsable\)/);
  });

  it("守卫要同时判「产物根在」与「那份 next 够得着」（悬壳不许被读成缺件）", () => {
    /* 这条判的是**守卫自己的形状**，所以在任何机器上都该跑（不随产物在不在 skip）：
     * 少了 `nextReachable` 那一半时，一份 store 链接已悬掉的旧壳会走进断言、
     * 数出 0 份运行时脚本，然后报「缺 `app-route-turbo`，所有接口会 500」——
     * 一个把「没重新构建」冒充成「产物有缺陷」的判据，下一次会被当成真红去查，
     * 或者被人整个绕开（§11.18.4「会误报的判据活不过一次评审」）。 */
    expect(code).toMatch(
      /const\s+nextReachable\s*=\s*existsSync\(\s*join\(\s*standaloneDir,\s*"node_modules",\s*"next",\s*"package\.json"/,
    );
    expect(code).toMatch(
      /const\s+artifactUsable\s*=\s*existsSync\(standaloneDir\)\s*&&\s*nextReachable/,
    );
  });
});
