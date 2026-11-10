## Changed

- **PR 主列迁平台池，自托管节点退出 PR 路径（ISSUE #3478，#3474 评估结论）**：
  「质量门禁」流水线（`pull_request`）只剩站内回读一格 + `PR 失败立案`
  endStages，两件纯 API 动作 —— 整条迁平台池 Linux（`cnb:arch:amd64` +
  `cpus: 1` + `.cnb/ci-image` Dockerfile 预装 `cnb`，与两条镜像出口同族）。
  PR 期间开发机零打扰，代价 1 核 × 分钟级（#3429 四档实测）。这是对 #1993
  「门禁主列永远自托管」的显式推翻（判据走光后顾虑消失；§13.5.36 记账，
  §13.5.3.4.1.4 加射程修订注）。fail-closed 承重锚一字未动：GA 回调没终态
  ⇒ 判红。`*pr_fail_stage` 锚点退役、立案格收 Linux 原生 script（PowerShell
  前缀 / cp936 不许进平台池格 —— #3453 的教训写成契约断言）；`no-platform-ci-config`
  例外清单纳入质量门禁并新增专用形态段；`.common` 锚点继续守着每日 / 单跑 /
  打包 / GA 判决回调四条手动口。
