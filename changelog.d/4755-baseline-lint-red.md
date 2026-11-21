## Fixed

- 清掉 #4747 落地的 3 处 lint 违例（#4755）：`tests/dev-shell-update.test.ts` 的 `as unknown as typeof fetch` 断言 ×3 改为真实 `Response` + 显式签名（免断言、免 async），`dev-shell-update.mjs` 的 `io.out` 断言改为先取原始值再判绝对路径。同批把「本地壳未过期」用例改封闭（自己的临时目录造状态）——它原先跑在 `process.cwd()` 上，结果取决于本机壳标记 / 源码 mtime / 环境令牌，且会真发网络请求。
