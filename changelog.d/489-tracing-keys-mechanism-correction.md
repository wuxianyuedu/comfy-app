## Fixed

- 订正上一批（#1713）留下的**机制错判**：`outputFileTracingIncludes` / `Excludes` 并不是
  「Turbopack 不读这份键」——两个键在上游 Rust 侧按**路由**实现
  （`crates/next-api/src/nft.rs` 用 route glob 匹配 `page_name`，命中后由 `nft_json.rs`
  写进每路由的 `.nft.json`），JS 那边被跳过的只是 webpack 用的 `collect-build-traces`。
  两侧**实测结论都不变**（摘掉 includes 产物逐字节同构；同一份 excludes 清单 webpack 砍到
  10 个顶层条目、Turbopack 一条不减），改的是那句会误导决策的机制话术：
  includes 不承重的真实原因是**重叠**（每路由清单已自带整份 `next-server/`，
  证据是连着那颗 glob 给不出的 `*.runtime.prod.js.map` 一起进来了），
  而 excludes 为什么在本仓一条不减**尚未量清**（`.env` 那一路已查实是
  `writeStandaloneDirectory()` 的显式复制，与路由 trace 无关）。
  同步改 `AGENTS.md` 硬规则 17/18、`next.config.js` 注释、
  `launch-and-build.md` §7.2 第三件事之二 / §7.4 / §5 排障表一行。
