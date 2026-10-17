## Added

- **平台侧加了第二台执行机：`linux:` 链路跑**同一批**门禁**（ISSUE #1993）。
  用户问的是「能否一个机器跑 2 套 CI，一个处理 Linux 的（利用 WSL2 的高速），
  一个处理 Windows 独有的内容」—— 这个问法里有一个必须是「否」的分岔：**「两套 CI」如果
  落成两份判据清单**，各自跑一部分、合起来才全，那缺的那几档不会红，绿了确实不算证据。
  所以落地的是**同一条流水线的两台执行机**：`win:`（标签 `win`）与 `linux:`（标签 `linux`）
  共用同一个 `&gates` 锚点，判据一字不差；差异只有宿主那三件（stage shell、外壳脚本、
  宿主自证），全部登记在 `scripts/ci-lane-duties.mjs` 的 `LANE_DUTIES` / `LANE_ONLY_STEPS`。
- **POSIX 侧的外壳 `scripts/ci-sh-exit.mjs`**：起命令、**边到边转发**输出、把退出码原样转出去。
  ⚠️ 它**不转码**（CP936 那一跳只在中文 Windows 上有意义，POSIX 上转码是把 UTF-8 变乱码），
  而退出码那一格是新的：被信号打死时 `close` 给的 `code` 是 `null`，折成 `128 + 信号号`
  （`SIGTERM` → 143）；**拿不到信号号时退 1，不是 0** —— 把 `null` 当 0 就是「没跑完」
  被报成「通过了」，而没有任何东西会说。
- **Linux 宿主自证 `scripts/ci-toolchain-posix.mjs`**：补 Windows 那两条
  （`工具链自证` + `Install dependencies`）在 POSIX 上答不出来的三格 —— `bash`
  （**唯一会红的一格**：stage shell 本身就是它）、coreutils、`python3`
  （只留读数，处置归 `Python 可用性`：它认得 apt / dnf / apk，会就地装）。

## Changed

- **`.cnb.yml` 的分支键从 `master:` 改成 `win:`，并新增 `linux:`**：两条链路各挂
  `pull_request`、`runner.tags` 各自声明（它从 `.common` 锚点里挪出来 —— 留在锚点里会让
  Linux 那条也去要一台 `win` 节点，而标签失配的表现是**排队**、不是红）。
- `tests/no-platform-ci-config.test.ts` 的两条形态判据跟着调整：顶层「分支: {事件}」那一格
  从「必须有 `master:`」放宽成「至少一个分支键、且紧跟事件键」，`runner.tags` 那一格从
  「锚点里有非空 tags」改成「锚点里**不许**有它」（每条链路自己声明，由新增的
  `tests/ci-lanes.test.ts` 逐条判）。**判据要拦的东西一个没少**：`#1229` 那种顶层直接写
  `stages:` / `jobs:` 的坏形态，用「紧跟事件键」这一条钉得比原来更紧。

## 还没装的东西

- `linux:` 这一支要真跑起来，根组织里得有一台**标签带 `linux`** 的自托管节点
  （WSL2 那条路径接进来即可）。没有那台节点时平台的表现**不是红**：要么等，要么按官方
  文档「自动尝试重新分配到其他可用节点」落到计费平台池（最坏情况是悄悄花回核时且不报错）。
  第一次真跑要看哪三个读数写在规范 §13.5.21.4。
