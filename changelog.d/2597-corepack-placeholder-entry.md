## Fixed

- **`pnpmInvocation()` 不再把 Corepack 的占位文件当成「包真身 JS 入口」（ISSUE #2597）**：
  规则收紧一处 —— 文件头是 `#` 起头而**不是** `#!` 的，判「不能被 node 起」；两处同形态的
  实现同批改（`src/lib/process/executable-resolve.ts` 的 `isPnpmEntryScript()` 与
  `scripts/ci-toolchain-pnpm.mjs` 的 `looksLikeScript()` —— 这两份是 ISSUE #2562 里
  **刻意各留**的，自证那一格不许 import 仓库内模块，所以「同一条规则必须同批落地」
  本身就是这条修复的一部分）。改完之后这一形自然回落到既有的 `bin/pnpm.mjs` 那一条，
  不新增第三种形态，也不动 `executableKind()` 的种类表。

  治的形状（本机当场读数）：`%LOCALAPPDATA%\node\corepack\v1\pnpm\12.4.1\pnpm` 在
  `install.js` 跑过之前只是**占位文本**，第一行就写着「原生二进制会在安装时替换掉我；
  在那之前请走 ./bin/pnpm.mjs」。它的 `package.json` 的 `bin.pnpm` 正指向这个文件，
  而 `executableKind()` 只分「shebang / 批处理 / 可打印 ASCII ⇒ script / 其余 ⇒ binary」——
  占位文件两个字节都可打印 ⇒ 被判成 `script` ⇒ 选中它 ⇒

  ```
  $ node C:/Users/…/corepack/v1/pnpm/12.4.1/pnpm -v
  SyntaxError: Invalid or unexpected token          （退 1）
  $ node C:/Users/…/corepack/v1/pnpm/12.4.1/bin/pnpm.mjs -v
  12.4.1                                            （退 0）
  ```

  连锁后果才是本单的靶子：`.githooks/pre-push` 的合并前复算里 `tsc --noEmit` 与 `eslint`
  两条被判成 **`baseline-red`（本检出 1 / 基线 1）** —— 而它们**一条都没真的跑过**，
  那个 1 是 `SyntaxError` 的 1；同时 `pnpm check:toolchain` 照旧报 `[OK]`，并把这一形
  **打印成结论**（`[INFO] 经 JS 入口执行：… <占位文件> -v`）。这就是 §13.6.2 那句
  「没跑起来不构成证据」在本机最贵的一次落地：判据的红与没跑，在退出码上同形，
  而工具链那一格还把没跑的形态念成能。

  **这条不是本次批次引入的**：「优先跑包真身 JS 入口」那一条由 `231ac84f`（ISSUE #2565）
  今天才落主干，而它挑中占位文件的前提是「corepack 缓存里只有占位、`install.js` 没跑过」——
  本机今天下午一次 `pnpm install --frozen-lockfile` 之后那个目录才出现。复算证据：
  `node scripts/base-check.mjs "pnpm exec tsc --noEmit"` 两侧同为 1 且输出即上面那屏。

  同批补两份回归（此前这两形**一条都没有**：只覆盖了「`bin` 指向 MZ 二进制 ⇒ 回退」和
  「`bin` 指向真脚本 ⇒ 直接用」）：`src/lib/process/executable-resolve.test.ts` 与
  `tests/ci-toolchain-selfcheck.test.ts` 各造一份 corepack 形状的落点，断言选中的是
  `bin/pnpm.mjs` 而不是那个占位文件；src 那份还另钉一格「只有占位、没有回退目标 ⇒
  `pnpmJsEntry` 返回 `null`」（不许凭空造入口）。
