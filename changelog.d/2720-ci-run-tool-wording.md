## Fixed

- **`ci-run-tool` 的「解析不到」话术分两档**（ISSUE #2720）：本入口的搜索面是仓内
  `node_modules/.bin`（#2572 设计面）。解析不到时现在按 package.json 的依赖声明分档：
  名字在仓内声明里 ⇒「仓内声明了这个依赖但 .bin 里没有垫片：要么没装（先 pnpm install）…」；
  名字不在仓内（全局 CLI，如 `cnb`）⇒ 明说「本入口只管仓内垫片，全局件走
  `ship-exec.mjs` 的 `pnpmInvocation(args, { name })`」，**不再出现「先 pnpm install」**
  ——那句话对面外永远治不了，只会引出「本机跑不了平台」的误判。
