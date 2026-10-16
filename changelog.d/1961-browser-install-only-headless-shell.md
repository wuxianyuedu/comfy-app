## Fixed

- **`浏览器安装` 只装这一档真正要的那一件（`chromium-headless-shell`），不再多下 205 MB**
  （ISSUE #1961）。镜像换对之后这一步仍红，读数是：

      Downloading Chrome for Testing 153.0.8010.12 … from
        …/builds/cft/153.0.8010.12/win64/chrome-win64.zip
      Error: … timed out after 120000ms        （五轮重试，每轮都撞满）

  超时的是 `chrome-win64.zip` —— **205 MB**。而本仓 `playwright.config.ts` 只有**一个**
  project（`chromium` + 设备档 `Desktop Chrome`），CI 上恒 headless，真被启动的是
  `chromium-headless-shell`（**120 MB**，同一镜像上它是好的）。也就是说那一件
  **这一步根本用不到**，而「两件都点名」的写法是刻意加上去的（当时担心「只装前者会看着
  像装过了」—— 那个担心是对的，但反过来的浪费没人量过）。

  实测（本机）：只装 headless shell 时 `chromium.launch()` **起得来**，
  `e2e/support/preflight-browser.mjs` 那一探（真 launch）答 `ready`，
  `browserExecutableExists()` 的复验也答通过 —— 三处判据都不需要那 205 MB。

  所以装的那一串收成 `BROWSER_PACKAGES = ["chromium-headless-shell"]`（**一处定义**：
  装与判都从它取，`ci-toolchain-browser.mjs` 不 import，那份台账留在模块里）。
  ⚠️ **换这一串要跟着看**：`browserExecutableExists()` 判的那一件必须仍在里面，
  否则「装上」与「判过」会指向两件不同的东西（判据一直红，而东西其实装了）——
  这一条有判据（按 `BROWSER_PACKAGES` 逐项核对复验找的形状）。

  判据（`tests/ci-toolchain-selfcheck.test.ts`）**两个方向都钉**：少了 headless shell
  不行（headless 档报 `Executable doesn't exist`），多了 `chromium` 也不行（那正是
  超时的那一件）。反向复算过：把 `chromium` 加回去，判据当场点名。
