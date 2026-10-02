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
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const REPO_ROOT = resolve(".");
const MAIN = resolve(REPO_ROOT, ".storybook/main.ts");
const PREVIEW = resolve(REPO_ROOT, ".storybook/preview.tsx");
const LAUNCHER = resolve(REPO_ROOT, "scripts/storybook.mjs");

/** 故事文件是组件目录下的 `*.stories.tsx`（与组件同目录，见 §12.1 的组织口径）。 */
const STORY_GLOB = "../src/**/*.stories.@(ts|tsx)";

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
});
