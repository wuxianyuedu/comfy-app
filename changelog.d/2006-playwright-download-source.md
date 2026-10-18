## Changed

- **Playwright 浏览器下载：候选根把境内镜像排到前面，「很慢」的两层成因写清（ISSUE #2006）**：用户那句「`pnpm exec playwright install --with-deps chromium-headless-shell` 很慢，需要换下载源」把注意力指向了下载源，而这一格此前已经换过一次源。所以先把「慢」拆成两件：**从哪儿取**（`PLAYWRIGHT_DOWNLOAD_HOST` / 候选表）与**怎么取**（一次请求拉完 120 MiB、失败从第 0 字节重来）。换源只治第一层，第二层由分片自取治（无续传是上游 `browserFetcher.ts` 的行为）。
  - `PLAYWRIGHT_HOST_CANDIDATES` 顺序改成「npmmirror 两段路径打头、`cdn.playwright.dev` 垫底」。行为后果只在「没配根」那一档，`playwrightDownloadRoots()` 的「配了根就只用它」一个字没动；分片自取的缺省根跟着变。
  - `httpDownloadProbe()` 的探测载荷加了**总闸** `timeoutMs ×(重定向次数+1)`：此前每跳各给一份超时，卡在重定向之后那一跳的链路会被读成「第一跳超时」或把这一步拖成 `超时 × 跳数`。镜像根回 302 是常态（`registry.npmmirror.com/-/binary/playwright` 实测就是）。
  - 失败读数**没有**改：想加的那一句没加进去 —— `ci-toolchain-browser.mjs` 改动后正好 900 行，加一行就撞 `check-infra-file-size.cjs` 的硬闸。「换源治哪一层、不治哪一层」写进了规范 §13.5.3.5「第十六处」与 `ci-toolchain-browser-reach.mjs` 的头注。

## 验证

- `tests/ci-toolchain-selfcheck.test.ts` 新增「首跳重定向后面那一段卡住 ⇒ 仍判「连上了但 0 字节」，且不拖过总时限」一条（夹具 `redirectStall`，`timeoutMs: 400` ⇒ 总闸 1600ms）。
- 候选表顺序**刻意不加判据**：它是「先试哪个」的运维偏好，判它等于把一次选择钉进代码；真正承重的那一半（配了根就只用它）已有判据守着。
