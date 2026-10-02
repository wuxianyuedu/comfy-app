## Added

- **接入 Storybook 10（组件工作台 + a11y 自动化）**，补上 `docs/guides/PRODUCTION-GAPS.md` 里挂了很久的 **F6「无 Storybook / 可视回归」** 的前半段。
  - **框架用 `@storybook/nextjs@10.6.1`**，不是 `@storybook/react-vite`：本仓库的 UI 基元依赖 Next 运行期（`next/link`、`next/font`）与 `~` 别名，该框架自带 Next 的解析与 `next.config.js` 的 webpack 别名，不用在 `.storybook` 里再抄一份 alias。
  - **addons 三件**：`addon-a11y`（违规报告，补 F6 的 a11y 缺口）、`addon-themes`（深浅色切换）、`addon-docs`（自动文档页）。三者与 `storybook` 主包**钉在同一版本** —— 跨版本混装报的错指向完全无关的内部 API。
  - **主题与 `ThemeProvider` 同口径**：`.storybook/preview.tsx` 用 `withThemeByClassName`，给 `<html>` 加/去 `dark` class（正是 `globals.css` 的 `@custom-variant dark` 依赖的那条链路），默认 `dark`。**刻意不**叠一层 `next-themes`：它的职责是持久化偏好并在首帧前写 class，而工具栏切换已覆盖「看两态」，再叠一个会多出一条不同的写入路径。
  - **`pnpm storybook` 经 `scripts/storybook.mjs` 起，不直连 CLI**：`@storybook/nextjs` 会加载仓库根的 `next.config.js`，而它第一行就是 `import "./src/env.js"` —— 缺 `.env` 时抛 `MissingEnvFileError`。也就是说「只想看一眼按钮长什么样」会被应用启动期的环境校验拦住，而组件预览根本不需要 `BETTER_AUTH_SECRET` / `DATABASE_URL`。注入 `SKIP_ENV_VALIDATION=1` 绕开，口径与 `playwright.config.ts` 的 webServer、CI 的 `pnpm build` 一致（`src/env.js` 自己文档化的开关）。**不改 `next.config.js`** —— 那份导入是应用启动期的真实约束，不是它写错了。
  - **为什么需要一个 `.mjs` 而不是一行 `SKIP_ENV_VALIDATION=1 storybook …`**：npm 脚本在 Windows 上由 cmd.exe 语义执行，`VAR=value cmd` 前缀赋值不是环境变量语法（§9.5 记录的 `sh x || true` 事故是同一族）。跨平台动作只写 Node（AGENTS 硬规则 12），已登记进 §9.5 对照表。

## Tests

- `tests/storybook-config.test.ts`（9 条，进 `FIXED_STRUCTURAL_TESTS`）：Storybook 的配置错法**全都构建成功**——`stories` glob 写错是侧栏空着、漏引 `globals.css` 是无样式裸 DOM、漏主题装饰器是只剩 dark 一态、启动器漏 `SKIP_ENV_VALIDATION` 是崩在 `env.js` 却看不出与配置有关。这里把契约机器化：glob 形状 / 全局样式 import / 主题档位与默认值 / 框架名 / 注入的环境变量与跨平台起法 / `package.json` 两条脚本逐字 / 依赖版本单一只 / `storybook-static` 已忽略 / 示例故事文件真实存在。
- 示例故事三份（`ui/button` / `ui/badge` / `ui/empty-state`，14 个 story）既当「怎么写 story」的样板，也当配置的可执行验证：三个组件的枚举都从 props 派生、不是二写一份字面量数组。
  - **踩过并记在文件注释里的坑**：`buttonVariants.variants.variant` 取不到 —— `cva()` 的返回值是一个 `(props?) => string` 的**函数**，运行时并没有 `.variants`（只在 TS 泛型里存在）。那样写 tsc 会红、Storybook 则在**加载期**抛 `Cannot read properties of undefined`，表现是「侧栏列着故事、画布上一片空白」（已跑 `storybook:build` + 无头浏览器逐 story 截图核对：14 个 story 全部渲染出内容、0 条 console/page 错误，明暗两态 token 都生效）。

## Docs

- `docs/standards/11-测试与可观测性.md` §11.8 的「方案选择」补一条：Storybook 已接入，但**它不替代 Playwright 像素基线**——两者判的东西不同（story 是单组件在受控 props 下的形态，`e2e/visual` 是真实页面的布局/配色），§11.8 那句「不引入第二套截图工具」的口径不变。
- `docs/standards/launch-and-build.md` §9.5 对照表新增一行（Windows 无对应双击入口，Storybook 是开发者命令不是应用入口）。
