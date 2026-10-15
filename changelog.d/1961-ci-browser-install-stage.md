## Fixed

- **自托管节点上没有 Playwright 的浏览器 —— `E2E 关键流程` 第一次真跑到就红在缺件上**
  （ISSUE #1961）。

  读数（`cnb-0rd-1k50unpnn`，前 30 个 stage 全绿之后）：

  ```
  [e2e-run] Python 预检：用 python → D:\Program Files\Python312\python.exe   ✅
  [e2e] ✗ Playwright 要用的浏览器二进制不在（headless 档走的是 chromium_headless_shell，
        它与完整 chromium 是**两个**下载物）
  [e2e]   期望的路径：…\ms-playwright\chromium_headless_shell-1243\…\chrome-headless-shell.exe
  ```

  **成因不是配置写错，是这条件路径与旧版的一处形态差异**：旧版 `docker.image: node:24`
  那条路里浏览器是**镜像白拿的**；换成自托管裸宿主机之后那层兜底没了，而
  `pnpm install` 不会拉 Playwright 的浏览器二进制（那是 `playwright install` 的事）。

  修法：新增 `浏览器安装` stage（`scripts/ci-toolchain-selfcheck.mjs --playwright-only`），
  排在 `E2E 关键流程` 之前，并登记进 `COMFYAPP_CI_GATES`。

  与 Python 那一步**刻意不同**的处置，差别的来源是「这一格有没有第二条路」：

  - 解释器：机器上可能装了、只是执行账号的 PATH 看不见（那要人改 PATH，不是代装）
    ⇒ 这一步**探**（`--python-only`）；
  - 浏览器：二进制**只可能来自 `playwright install` 这一条命令** ⇒ 这一步**装**
    （`--playwright-only`，装完退码即判据）。

  同批两条约束：顺序（排在 E2E 之前，要下 ~100+ MiB 而判「装没装成」零成本）、
  预算（`20m`，挡的是真卡死而不是「机器慢」）。两条都在
  `tests/no-platform-ci-config.test.ts` 里带反向复算。
