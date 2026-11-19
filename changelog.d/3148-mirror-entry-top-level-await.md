## Fixed

- `ci-github-mirror-push.mjs` 的 `--master` 档不再挂在 ESM 循环顶层 await 上：入口改成
  `.then()` 收口，装载 `ci-github-mirror-master.mjs` 那一跳另挂 30s 显式上限（
  `MIRROR_ENTRY_TIMEOUT_MS`）。此前该格在 push 流水线上以
  `Warning: Detected unsettled top-level await … ci-github-mirror-push.mjs:765` +
  exit 13 收场，日志里没有一句三态读数；现在装载悬挂会快速退 2 并打印
  「在等什么 / 等了多久 / 最后读数 / 为什么退非零」。
