// ── 「这台机器是不是 Windows」的唯一判据（Node 侧，**纯叶子**，零 import）──────
//
// 三行实现，为什么值得单独一个文件：因为**引用它的两种宿主写法不同**。
//
// 本仓 TS 侧的 import 惯例是**省略扩展名**（`./executable-resolve`），而一个 `.mjs`
// 静态 import 一份 `.ts` 时，说明符**必须**带 `.ts` 扩展名 —— Node 的 ESM 解析器
// 不会替你补。两者同时 import 同一个模块时，同一份文件就会在运行时被两种形态引用，
// 而只有一种是对的（ISSUE #1961 实测：`preflight-python.mjs` → `python-candidates.ts`
// → `./executable-resolve` 这条链在平台侧 E2E 上 1 秒就退，
// `ERR_MODULE_NOT_FOUND: Cannot find module '…/executable-resolve'`）。
//
// 判据躲进一个不 import 任何东西的叶子，链上就没有那条跨惯例的边了：
//   · `executable-resolve.ts` / `python-candidates.ts` / `python-resolve.ts` —— TS 侧，
//     照旧省略扩展名；
//   · `e2e/support/*.mjs` —— `.mjs` 侧，说明符带 `.ts`。
//
// ⚠️ **别把别的东西搬进本文件**：它一旦长出自己的依赖，那条链就又把「谁能被 `.mjs`
// 直接加载」这个性质丢掉了。这条不是审美 —— `tests/executable-resolve-esm-imports.test.ts`
// 按源码形状判它（叶子性 + 跨宿主 import 的扩展名形态）。

/** 是否是 Windows（`src/lib/process/kill-process-tree.ts` 等处的同一判据）。 */
export function isWindows(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === "win32";
}
