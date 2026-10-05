/**
 * Storybook 基建的**契约判据**（ISSUE #1381）。
 *
 * 为什么需要它：Storybook 的配置错法全都**不报错**——
 *  · `stories` glob 写错 → 侧栏空着，但构建成功（`build:storybook` 退出 0）；
 *  · 漏引 `globals.css` → 组件渲染成无样式裸 DOM，画布上看着像「设计就是这样」；
 *  · 漏掉主题装饰器 → 只有 dark 一态，`light` 的 token 分支无人走过；
 *  · 启动脚本忘了注入 `SKIP_ENV_VALIDATION` → 每个缺 `.env` 的检出上直接崩在
 *    `next.config.js` 的 `import "./src/env.js"`，而这是别人克隆后的第一印象。
 *
 * 上面四条都能被一次「跑起来看一眼」发现，但没有任何 *自动* 判据会红——于是修好
 * 之后又会被下一个人改回去。这里把「配置契约」机器化：只读文本与 AST 能判的判据
 * 放在这里，真渲染由 `storybook:build` + 人工/截图负责。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Storybook 自己的那把「补后缀」尺子（Node ESM loader 在加载 `.storybook/main.ts`
 * 时用的同一个函数）。
 *
 * 为什么直接用它、而不是在本文件里抄一份正则：判据要量的就是「**Storybook 会不会
 * 为这次加载打 deprecation**」，而那条规则由它实现定义。抄一份的结果是规则变了 ours
 * 还在绿 —— 那是第二个事实来源（§12.18 的反面）。
 *
 * 为什么带 `@ts-expect-error`：storybook 的 package.json `exports` 对这条子路径只给了
 * `default` 条件（产物是 esbuild 打的 JS，没有随包类型），直接 import 会 TS7016。
 * 这里把用到的那**一个**函数按签名声明一次，调用点仍受类型检查；哪天 Storybook 补上
 * 类型，这条指令会自己变成「未被使用」而报错 —— 那正是该改判据的信号。
 */
// @ts-expect-error -- storybook 未随包提供该子路径的类型声明（exports 只有 default 条件）
import * as storybookLoader from "storybook/internal/bin/loader";

const { addExtensionsToRelativeImports } = storybookLoader as {
  addExtensionsToRelativeImports: (source: string, filePath: string) => string;
};

const REPO_ROOT = resolve(".");
const STORYBOOK_DIR = resolve(REPO_ROOT, ".storybook");
const MAIN = resolve(REPO_ROOT, ".storybook/main.ts");
const PREVIEW = resolve(REPO_ROOT, ".storybook/preview.tsx");
const LAUNCHER = resolve(REPO_ROOT, "scripts/storybook.mjs");

/** 故事文件是组件目录下的 `*.stories.tsx`（与组件同目录，见 §12.1 的组织口径）。 */
const STORY_GLOB = "../src/**/*.stories.@(ts|tsx)";

/** 现生成、不入库的两个目录（`assets/` 的图、`generated/` 的 app-origin.json）。 */
const GENERATED_DIRS = [`${sep}assets${sep}`, `${sep}generated${sep}`];

/**
 * `.storybook/` 下入库的 TS 源。跳过那两个现生成目录，是为了让「扫描面」只由**入库
 * 文件**决定 —— 否则本机跑过一次 `pnpm storybook` 之后的判据覆盖面就与别人的检出
 * 不一样了（那正是生成件不进类型程序的理由在判据这一侧的回声）。
 */
function storybookSources(): string[] {
  return readdirSync(STORYBOOK_DIR, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        /\.tsx?$/.test(entry.name) &&
        !GENERATED_DIRS.some((dir) => entry.parentPath.includes(dir)),
    )
    .map((entry) => resolve(entry.parentPath, entry.name))
    .sort();
}

describe("Storybook 配置契约（ISSUE #1381）", () => {
  const main = readFileSync(MAIN, "utf8");
  const preview = readFileSync(PREVIEW, "utf8");
  const launcher = readFileSync(LAUNCHER, "utf8");
  const pkg = JSON.parse(
    readFileSync(resolve(REPO_ROOT, "package.json"), "utf8"),
  ) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };

  it("主配置扫的就是 src/ 下的 stories（glob 写错 = 侧栏空着但构建成功）", () => {
    expect(main).toContain(STORY_GLOB);
  });

  it("预览真的引入应用全局样式（漏了不会报错，只会渲染成无样式裸 DOM）", () => {
    expect(preview).toContain('import "../src/app/globals.css"');
  });

  it("主题装饰器按 class 切换，且默认 dark（与 ThemeProvider 同口径）", () => {
    expect(preview).toContain("withThemeByClassName");
    expect(preview).toContain("defaultTheme: \"dark\"");
    // `dark` 档在 html 上加的 class 名必须是 globals.css 认的那个
    expect(preview).toMatch(/dark:\s*"dark"/);
  });

  it("框架是 @storybook/nextjs（组件依赖 Next 运行期与 `~` 别名解析）", () => {
    expect(main).toContain('"@storybook/nextjs"');
  });

  it("启动器注入 SKIP_ENV_VALIDATION（否则缺 .env 的检出直接崩在 env.js）", () => {
    expect(launcher).toContain("SKIP_ENV_VALIDATION");
    // 跨平台：命令与参数都得经 Node 起，不能是 `VAR=x cmd` 那种 cmd.exe 接不住的写法
    expect(launcher).toContain("spawnSync");
    expect(launcher).not.toMatch(/^\s*(storybook|pnpm)\s/m);
  });

  it("package.json 的 Storybook 脚本走 Node 启动器，且不写死 pnpm 包名", () => {
    expect(pkg.scripts.storybook).toBe("node scripts/storybook.mjs dev");
    expect(pkg.scripts["storybook:build"]).toBe(
      "node scripts/storybook.mjs build",
    );
  });

  it("依赖钉在同一版本（Storybook 各包版本错配的报错指向完全无关的内部 API）", () => {
    const storybookDeps = Object.entries(pkg.devDependencies).filter(([name]) =>
      name === "storybook" || name.startsWith("@storybook/"),
    );
    expect(storybookDeps.length).toBeGreaterThanOrEqual(3);
    const versions = new Set(storybookDeps.map(([, version]) => version));
    expect(versions.size, `版本不一致：${JSON.stringify(storybookDeps)}`).toBe(
      1,
    );
  });

  it("静态产物路径已被忽略（`pnpm storybook:build` 的产物不入库）", () => {
    const gitignore = readFileSync(resolve(REPO_ROOT, ".gitignore"), "utf8");
    expect(gitignore).toContain("/storybook-static/");
  });

  it("已提交的示例故事文件真实存在（`stories` glob 与磁盘对得上）", () => {
    for (const story of [
      "src/components/ui/button.stories.tsx",
      "src/components/ui/badge.stories.tsx",
      "src/components/ui/empty-state.stories.tsx",
    ]) {
      expect(existsSync(resolve(REPO_ROOT, story)), story).toBe(true);
    }
  });

  it("配置与注入层的相对 import 一律带后缀（否则每次启动都刷一串 deprecation）", () => {
    /* 这条判的是**加载链路**，不是风格偏好。
     *
     * Storybook 10 用一个 Node ESM loader 加载 `.storybook/main.ts`（ESM 的解析
     * 规则要求完整说明符），loader 会在 esbuild 转译后把无后缀的相对 import 补上
     * 后缀 —— 能跑，但**每补一次打一条 deprecation**：
     *   "One or more extensionless imports detected: "./x" in file "...main.ts""。
     * 它的坏处是遮蔽：真正的启动报错混在一串告警里，而这条 deprecation 本身在下一个
     * Storybook 大版本里会变成硬错误（届时是「工作台起不来」，不是「一条告警」）。
     *
     * 判据**直接用 Storybook 自己的那个函数**（`storybook/internal/bin/loader` 的
     * `addExtensionsToRelativeImports`，走 package.json 的 exports 声明）：它「要改写
     * 源码」就等价于「启动时会打那条 deprecation」。另抄一份正则看着更轻，实际是第二
     * 个事实来源 —— Storybook 改了补写规则 ours 会继续绿。
     *
     * 这条判据的**边界**：loader 只在「无后缀 **且** 目标文件真实存在」时才补写（它要
     * 按候选后缀列目录）。所以「无后缀 + 文件根本不存在」那种 import 本条抓不到 ——
     * 那由 tsc 的 TS2307 抓（提交门槛 A 组），两条门禁各管一头，不重不漏。 */
    const files = storybookSources();
    // 扫描面非空：目录读空了，下面那条相等断言会在空集上假绿。
    expect(files.length).toBeGreaterThan(0);

    const offenders: string[] = [];
    for (const abs of files) {
      const source = readFileSync(abs, "utf8");
      if (addExtensionsToRelativeImports(source, abs) !== source) {
        offenders.push(relative(REPO_ROOT, abs).split(sep).join("/"));
      }
    }
    expect(
      offenders,
      "这些文件里有无后缀的相对 import —— `pnpm storybook` 每次启动都会为它打一条 " +
        "deprecation。补成 `./x.ts` / `./x.tsx` 即可（Node loader 原样放行，webpack 两种写法都解析得到）",
    ).toEqual([]);
  });

  it("判据自身可反证：无后缀说明符确实会被 loader 改写（否则上面那条是空转）", () => {
    /* 与本文件其余判据同源的形状：先证明「被测的那条规则真的会红」，再把它当成门禁。
     *
     * 两条说明符都必须指向 `.storybook/` 下**真实存在**的模块 —— loader 是按候选后缀
     * 列目录才决定补不补的，指向一个不存在的文件时它原样放行（那类 import 由 tsc 的
     * TS2307 负责，见上面那条判据的边界说明）。
     *
     * 断言分两半，缺一不可：`./app-origin-defaults` 被补成 `.ts`（规则真的会红），
     * 而已经写全的 `./app-origin-reader.ts` 原样不动（判据量的不是「源码被改动」这件
     * 无关的事 —— 否则把文件整体重排版也会红）。 */
    const patched = addExtensionsToRelativeImports(
      `import { APP_ORIGIN_DEFAULTS } from "./app-origin-defaults";\n` +
        `import { APP_ORIGIN_ENV_KEYS } from "./app-origin-reader.ts";\n`,
      MAIN,
    );
    expect(patched).toContain('from "./app-origin-defaults.ts"');
    expect(patched).toContain('from "./app-origin-reader.ts"');
  });
});
