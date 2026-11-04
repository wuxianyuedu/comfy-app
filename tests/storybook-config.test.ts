/**
 * Storybook 基建的**契约判据**（ISSUE #1381）。配置错法全不报错：`stories` glob 写错 ⇒ 侧栏空着但构建退 0；
 * 漏 `globals.css` ⇒ 无样式裸 DOM；漏主题装饰器 ⇒ 只走 dark；启动脚本漏 `SKIP_ENV_VALIDATION` ⇒ 缺 `.env`
 * 的检出崩在 `next.config.js` 的 `import "./src/env.js"`。自动判据不红就会被改回去，所以把文本/AST 能判的契约机器化。
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { relative, resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Storybook 自己的「补后缀」尺子（Node ESM loader 加载 `.storybook/main.ts` 用的同一个函数）。直接用它而非
 * 抄正则：判据量的就是「Storybook 会不会为这次加载打 deprecation」，规则由它实现定义，抄一份会规则变了还绿（§12.18）。
 * 带 `@ts-expect-error`：`exports` 只有 `default` 条件、无随包类型 ⇒ 直接 import 会 TS7016；补类型后该指令自报未使用。
 */
// @ts-expect-error -- storybook 未随包提供该子路径的类型声明（exports 只有 default 条件）
import * as storybookLoader from "storybook/internal/bin/loader";

/* SAFETY: 类型断言已复核 */
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
function storybookSources(): Array<string> {
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
  /* SAFETY: 类型断言已复核 */
  const pkg = JSON.parse(readFileSync(resolve(REPO_ROOT, "package.json"), "utf8")) as {
    devDependencies: Record<string, string>;
    scripts: Record<string, string>;
  };

  it("主配置扫的就是 src/ 下的 stories（glob 写错 = 侧栏空着但构建成功）", () => {
    expect(main).toContain(STORY_GLOB);
  });

  it("预览真的引入应用全局样式（漏了不会报错，只会渲染成无样式裸 DOM）", () => {
    expect(preview).toContain('import "../src/app/globals.css"');
  });

  it("主题装饰器按 class 切换，且默认 dark（与 ThemeProvider 同口径）", () => {
    expect(preview).toContain("withThemeByClassName");
    expect(preview).toContain('defaultTheme: "dark"');
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
    expect(pkg.scripts["storybook:build"]).toBe("node scripts/storybook.mjs build");
  });

  it("依赖钉在同一版本（Storybook 各包版本错配的报错指向完全无关的内部 API）", () => {
    const storybookDeps = Object.entries(pkg.devDependencies).filter(
      ([name]) => name === "storybook" || name.startsWith("@storybook/"),
    );
    expect(storybookDeps.length).toBeGreaterThanOrEqual(3);
    const versions = new Set(storybookDeps.map(([, version]) => version));
    expect(versions.size, `版本不一致：${JSON.stringify(storybookDeps)}`).toBe(1);
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
    /* 判的是**加载链路**：Storybook 10 的 Node ESM loader 会为无后缀相对 import 补后缀，能跑但每补一次打
     * 一条 deprecation（"One or more extensionless imports detected…"），它遮蔽真启动错误，且下个 Storybook
     * 大版本会变硬错误。判据直接用 `storybook/internal/bin/loader` 的 `addExtensionsToRelativeImports`（「要
     * 改写源码」⇔「启动会打告警」），另抄正则就成了第二个事实来源。边界：loader 只在无后缀且目标真实存在时
     * 补写；不存在的 import 由 tsc TS2307 抓（A 组），两条门禁各管一头。 */
    const files = storybookSources();
    // 扫描面非空：目录读空了，下面那条相等断言会在空集上假绿。
    expect(files.length).toBeGreaterThan(0);

    const offenders: Array<string> = [];
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
    /* 同源形状：先证明「被测规则真的会红」，再把它当门禁。两条说明符都必须指向 `.storybook/` 下真实存在
     * 的模块 —— loader 只在目标存在时才补写，否则原样放行（那类由 tsc TS2307 负责）。断言分两半：
     * `./app-origin-defaults` 被补成 `.ts`（规则真会红），而写全的 `./app-origin-reader.ts` 原样不动
     * （判据量的不是「源码被改动」，否则整体重排版也会红）。 */
    const patched = addExtensionsToRelativeImports(
      `import { APP_ORIGIN_DEFAULTS } from "./app-origin-defaults";\n` +
        `import { APP_ORIGIN_ENV_KEYS } from "./app-origin-reader.ts";\n`,
      MAIN,
    );
    expect(patched).toContain('from "./app-origin-defaults.ts"');
    expect(patched).toContain('from "./app-origin-reader.ts"');
  });
});
