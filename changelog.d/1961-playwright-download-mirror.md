## Fixed

- **自托管节点到不了 `cdn.playwright.dev` —— 换镜像，而不是继续放宽超时**
  （ISSUE #1961）。

  读数（`cnb-gt1-1k513ill4`，`浏览器安装` stage）：

  ```
  Downloading Chrome for Testing 153.0.8010.12 (playwright chromium v1243)
  Error: Request to https://cdn.playwright.dev/builds/cft/…/win64/chrome-win64.zip
        timed out after 120000ms          ← 上几笔已把 30s 放宽到 120s
  ```

  **120s 也超时 ⇒ 结论变了**：不再是「这一次没量完」，而是这台节点**真的到不了**
  那个地址 —— 180 MiB 的包在这样一条链路上等多久都不会到。继续调那个超时数字
  对这件事一点用都没有。

  修法：给 `浏览器安装` 那一步加
  `PLAYWRIGHT_DOWNLOAD_HOST=https://cdn.npmmirror.com/binaries/playwright`
  （Playwright 自己的键，不引第二套机制）。

  选这个镜像有读数撑着，不是「换个镜像试试」：按**同一段路径**实测它回 HTTP 200，
  且 15s 内收到了 99 MiB。

  判据：`tests/no-platform-ci-config.test.ts` 要求那一步的块里**同时**有
  `PLAYWRIGHT_DOWNLOAD_HOST` 与 `PLAYWRIGHT_DOWNLOAD_CONNECTION_TIMEOUT` ——
  少了镜像那一行会以「超时」的形态一直红，而人只会去调那个数字。
  反向复算：把镜像那一行删掉，判据当场点名。
