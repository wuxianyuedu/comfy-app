## Fixed

- **订正那句「自托管节点上没有 docker daemon」**（ISSUE #1993 的因果，新增规范
  §13.5.3.4.1.6）：那半句是**推论**而不是读数，而探针把它否掉了 —— 节点侧 stream-log 里
  runner 自己执行了 `docker info -f json`（退 0）、`docker pull node:24`（退 0），
  然后死在 `docker run` 的**命令行形态**上：

  ```
  docker run -d --rm … -w c:\workspace --entrypoint= --init node:24 cmd /c "ping …"
  docker: Error response from daemon: the working directory 'c:\workspace' is invalid,
  it needs to be an absolute path
  ```

  也就是说「平台不给这台 runner 起容器」（`Runner does not enable Docker`，70ms 那三次红）
  与「这台机器跑不了容器」是两件事。本条**不改任何操作性结论**：`.cnb.yml` 依旧一格都不写
  `image:`，`CONTAINER_STAGES` 依旧是空的 —— 变的是「要谁做什么才能写回去」：那是平台的两个
  动作（能力位 + runner 构造容器的形态），而不是「换一台开了容器的机器」。

- **顺手否掉三条会把人带到弯路上去的说法**（读数同样在 §13.5.3.4.1.6）：自建镜像那道门是
  镜像代理的**白名单**（daemon 直接回 `this image is not in the allowlist`），而 runner 用来
  确认「本地有没有这张镜像」的那句 `docker inspect … > /dev/null` 在宿主 PowerShell 形态下
  **恒退 1**（`Could not find a part of the path 'F:\dev\null'`）—— 所以「runner 看不见自建
  镜像」这句**没有证据**，不能拿它当结论；`mcr.microsoft.com` 那个镜像也不是被白名单挡的，
  它开始逐层拉了、13.5 分钟没拉完、重试拿到 `TLS handshake timeout`，与 §13.5.3.10「第七跑」
  那条「这台节点一次取不完一个大响应」是同一件事。

- **补上「换容器到底值多少」的三档实测**（同一台机、同一棵检出、计时与
  `--extendedDiagnostics` 来自同一次运行）：`tsc` 冷 **11.0s**（容器原生 ext4）/ **40.1s**
  （宿主 NTFS）/ **386.5s**（把 Windows 目录经 9p 挂进容器），而 `Check` 在三档里一致
  （7.654s / 7.726s）—— 差的全在 `Parse`，所以**「容器慢」的方向取决于挂载方式，不取决于
  容器**。`install` 两档基本持平（63.8s / 59.8s）⇒ 容器不替装依赖省钱；`tmpfs` 相对 ext4 没有
  可判的增益，且 `--tmpfs` 默认 `noexec` 会让冷装直接 `exit=1`；用 junction 把 `node_modules`
  挂在检出外面是**净亏**（`tsc` 39.5s→78.0s、`eslint` 冷档 318.5s→812.9s）。
