## Fixed

- e2e 的假 ComfyUI 不再复用真件（ISSUE #1756）：替身此前钉在 8188 —— 那正是产品
  拉起真 ComfyUI 的固定默认端口，而 `reuseExistingServer` 只问「有没有人应答」、
  不区分谁在应答。本机一开着真件（另一个检出、桌面端、手工起的），Playwright 就
  **静默复用真件**，替身一行没跑，依赖它脚本化收口的用例全红且**报告读起来像功能红**
  （`main-journey` 的话术在说「执行器收口失败」，真因是下游替身没应答）。
  - 替身端口收进 `e2e/support/fake-comfyui-endpoint.mjs` 单一落点，默认 **18188**
    （刻意落在 ComfyUI 探测窗口 `8188..8193` 之外，由
    `assertFakePortOffComfyWindow()` 断言、与 `client.ts` 的 `PROBE_RANGE` 交叉核对）；
  - 应用侧经 `COMFYUI_BASE` 连替身（`comfyui/client.ts` 的最高优先级，且
    `baseForLocalPort()` 见到它就不做进程表反查），三个环境变量由
    `fakeComfyuiEnv()` 一次喂全；
  - 跑前正面探测落在 `e2e/global-setup.ts`：替身端口上是真件 / 陌生服务即 fail fast，
    话术给可执行出口——**不要求任何人停掉 8188 上的真 ComfyUI**；
  - 判据见 `tests/e2e-fake-comfyui-endpoint.test.ts`，口径补进
    `docs/standards/11-测试与可观测性.md` §11.3.1。
