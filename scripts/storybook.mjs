#!/usr/bin/env node
// Storybook 启动入口（`pnpm storybook` / `pnpm build:storybook`）。
//
// 为什么不能直接在 package.json 里写 `storybook dev`：
// `@storybook/nextjs` 会加载仓库根的 `next.config.js`，而它的**第一行**就是
// `import "./src/env.js"` —— 后者在缺 `.env` 时抛 `MissingEnvFileError`。
// 也就是说「只是想看一眼按钮长什么样」会被应用启动期的环境校验拦住，而组件
// 预览根本不需要 `BETTER_AUTH_SECRET` / `DATABASE_URL` 这些值。
//
// 绕开的方式与仓库既有口径一致（`playwright.config.ts` 的 webServer、
// CI 的 `pnpm build` 都这么做）：注入 `SKIP_ENV_VALIDATION=1`。**不**为了这条
// 去改 `next.config.js` —— 那份配置里的 env 导入是应用启动期的真实约束，
// 不是它写错了。（`SKIP_ENV_VALIDATION` 的语义见 `src/env.js` 顶部。）
//
// 为什么需要一个 .mjs 而不是一行 `SKIP_ENV_VALIDATION=1 storybook …`：
// npm 脚本在 Windows 上由 cmd.exe 语义执行，`VAR=value cmd` 那套前缀赋值不是
// 环境变量语法（§9.5 记录的 `sh x || true` 事故就是同一族）。跨平台动作只写
// Node，`.ps1` 只能是它的调用入口（AGENTS 硬规则 12）。
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  ensureStorybookAssets,
  writeStorybookAppOrigin,
} from "./storybook-assets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const binName = process.platform === "win32" ? "storybook.cmd" : "storybook";
const bin = path.join(root, "node_modules", ".bin", binName);

/* 开发期资源（注入层 `media` 值源要指向的真图）在这里现生成。
 *
 * 跟着启动走而不是单独的 npm 脚本：那会是**跨平台动作**，要同批登记
 * `package.json` 与规范 §9.5 的对照表（AGENTS 硬规则 12）；而这件事没有独立的
 * 入口诉求 —— 它只是启动前的准备步骤，漏掉它的后果是 workbench 里几张图裂开，
 * 而「资源不在」这件事由 story 自己如实画出来（不静默）。 */
ensureStorybookAssets(path.join(root, ".storybook", "assets"));

/* 解析链端口同样现算一次：注入层要用它把真 tRPC 客户端指向跑着的应用
 *（`data-sources.tsx` 的 `DEFAULT_APP_ORIGIN`）—— 端口按检出路径推导，
 * 写死的值在别人的 checkout 上必然错。口径见 `storybook-assets.mjs` 里
 * `writeStorybookAppOrigin()` 的注释。 */
writeStorybookAppOrigin(
  root,
  path.join(root, ".storybook", "generated", "app-origin.ts"),
);

/* 子命令与参数透传：`pnpm storybook` → dev，`pnpm build:storybook` → build。
 * 额外的位置参数原样转交给 storybook（例如 `pnpm build:storybook --quiet`）。 */
const [subcommand = "dev", ...rest] = process.argv.slice(2);

const args =
  subcommand === "dev" ? ["dev", "-p", "6006", "--no-open"] : [subcommand];

const result = spawnSync(bin, [...args, ...rest], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SKIP_ENV_VALIDATION: process.env.SKIP_ENV_VALIDATION ?? "1",
  },
  shell: process.platform === "win32",
});

if (result.error) {
  process.stderr.write(
    `[ERROR] failed to spawn storybook: ${result.error.message}\n`,
  );
  process.exit(1);
}

process.exit(result.status ?? 1);
