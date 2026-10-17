## Fixed

- **`浏览器安装` / `E2E 关键流程` 退回宿主机直跑 —— 节点没开容器能力，平台在起格之前就拒**
  （ISSUE #1993 收口，现场 `cnb-p4g-1k54valf0` 109ms / `cnb-cqk-1k550gpp2` 70ms）。
  两跑两种写法回的是同一句话：

  ```
  失败 Stage: 浏览器安装 (status: error)
  错误信息: Runner does not enable Docker.
  ```

  第一跑 `image:` 在 stage 级、第二跑拆到 Job 级 —— **错误不区分层**。它说的是 Runner
  没有开容器能力（平台文档原文：「自定义 Runner 默认不开启 Docker 能力，构建脚本直接
  运行在宿主机上」），于是「指定 `image` 的脚本任务在独立容器中执行」那句的前提在这台
  机上不成立。所以两格**不写 `image:`**（默认档 = 宿主机直跑），`浏览器安装` 回到它已经
  量过很多次的分片自取 + 落点复验那条链路。

  同批作废三条只在容器里成立的声明：`image:`（起格即拒）、`volumes:`（没有容器就没有
  跨容器）、`PLAYWRIGHT_BROWSERS_PATH: /ms-playwright`（宿主上没有那个路径，留着会让
  落点判据去空目录找东西，「装好了」与「一件都没有」逐字同形）。

  **刻意不用 `allowFailure` 放过这两格**：那会把「浏览器装不上 / E2E 跑不过」变成一条
  永远绿的读数，而这一档要的是「装不上就红」，只是不要在能力不到位的位置红。

## Changed

- **判据跟着改口径，而不是放宽**：`tests/ci-image-identity.test.ts` 的容器格名单
  `CONTAINER_STAGES` 收成空数组（仍是逐格点名，多一格少一格都红），
  `PLAYWRIGHT_BROWSERS_PATH` 那一条改成与「有没有容器格」**同向**；
  `tests/ci-container-plan.test.ts` 的桥判据改用两格容器格的夹具判「挂没挂卷」
  —— 否则配置一旦没有容器格，那条判据会退化成恒绿的空转（现役那条仍判 `bridge: none`）。

- **规范 §13.5.3.4.1.5 新增**：两跑的读数、那句错误为什么不区分层、三条作废声明的理由、
  为什么不走 `allowFailure`，以及「怎样才允许写回去」的四件同批动作。
  §13.5.3.4.1.3 的例外档与 `docs/guides/ci-node-image.md` 一并对齐成「此刻零格」。
