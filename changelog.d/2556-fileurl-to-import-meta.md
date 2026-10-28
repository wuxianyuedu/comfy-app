## Changed

**`fileURLToPath(import.meta.url)` 样板整体换成 `import.meta.dirname` / `import.meta.filename`**（ISSUE #2556）。

- 引擎钉 `>=26.12.1`（#2531）之后，`import.meta.dirname` / `import.meta.filename`（Node
  20.11 / 21.2 起稳定，本机 v26.12.1 实测在场）可直接取当前模块的目录/文件名，不再需要
  `fileURLToPath(import.meta.url)` 这一段推导 —— 每处省一个 `fileURLToPath` import + 一行推导，
  可读性直给。
- 机械替换（**不含任何行为改动**，等价）：`path.dirname(fileURLToPath(import.meta.url))` →
  `import.meta.dirname`、`path.resolve(fileURLToPath(import.meta.url))` →
  `path.resolve(import.meta.filename)`、读自身源码等裸用法 → `import.meta.filename`。
  `fileURLToPath(new URL("../x", import.meta.url))` 这类「构造 URL」用法**不在本次范围**
  （另有 4 处在用 `pathToFileURL`，其 `node:url` 导入保留）。
- 换完后清理无用导入：`fileURLToPath` 的 import 若无其它消费者一并删除（整行空了删整行）；
  `path` / 命名 `dirname` 等只为此样板存在的导入一并移除。`src/env.js` 的动态
  `await import("node:url")` 同样清掉。
- 用例面：两处把旧样板当正则/锚点断言的判据同步改到新标记
  （`tests/script-main-guard.test.ts`、`tests/ci-toolchain-selfcheck.test.ts` 的
  `src.indexOf("...")` 锚点）；`tests/build-fresh-checkout.test.ts` 等结构判据照旧绿。

### 验收

`tsc --noEmit` 零错误；`eslint` 全量改动文件（`scripts` / `src` / `tools` / `tests` /
`e2e` / `.storybook`，共 108 个文件）零问题；`script-main-guard` / `hook-affected-launch` /
`ci-toolchain-selfcheck` / `build-fresh-checkout` 四个相关套件全绿。门禁自证照旧：
`pnpm check:premerge --full`。
