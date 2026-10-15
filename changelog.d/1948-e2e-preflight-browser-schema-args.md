## Fixed

- **`pnpm test:e2e` 在全新检出 / 干净容器里会踩的三件事，都从「红得看不出真因」变成
  开跑前的可执行出口**（ISSUE #1948）。三件都收在 `scripts/e2e-run.mjs` 起 Playwright
  **之前**，因为它们的共同形态是「81 条用例各报一遍同一件事」：

  - **浏览器缺一半** ⇒ 全档每条都报 `browserType.launch: Executable doesn't exist at
    …/chromium_headless_shell-1243/…`。根因是 Playwright 1.63 里 `chromium` 与
    `chromium-headless-shell` 是 `browsers.json` 的**两个**条目，而 headless 档用的是
    后者 —— 装过完整 chromium 不等于这一档跑得起来。判据是**真起一次**（不是按路径猜：
    实测 `chromium.executablePath()` 在 headless 档判错方向），红的时候把 Playwright
    自己给的那条路径转成 `pnpm exec playwright install chromium chromium-headless-shell`
    （新增 `e2e/support/preflight-browser.mjs`）。
  - **库里没有表** ⇒ 冒烟档的健康检查断言 `db: "up"` 必红（`db: "empty"` ⇒ 503）。
    此前这一档被判「放行、交给启动链路」，而启动链路的同步是 **detached 后台**的
    （`spawnSchemaSync`），Playwright 等的又只是 webServer 的 URL 可访问 —— 于是健康
    检查一定赶在建表完成之前。现在空库那一档由本档**等它建齐**
    （`ensureSchemaBeforeRun` → `ensureSchemaCurrent`，与 `pnpm db:push` 同一份实现），
    建不成才阻断并给 `pnpm db:push`。非空库零成本。
  - **`--` 吃掉位置参数** ⇒ `pnpm test:e2e -- e2e/smoke.spec.ts` 实际跑**全档 81 条**
    （实测 `--list`：带 `--` 列 81 条、不带列 3 条），而退出码与输出里没有一处说这件事。
    `planRun` 现在先剥掉第一个 `--`（`stripArgvSeparator`）——「想跑冒烟跑的就是冒烟」。

  回归用例见 `tests/e2e-run.test.ts` 的「开跑前的三档前置（ISSUE #1948）」，
  口径见 `docs/standards/11-测试与可观测性.md` §11.8。
