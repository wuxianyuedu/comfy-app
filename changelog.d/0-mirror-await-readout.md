## Changed

- **镜像同步「等托管机」前置的读数与短路（ISSUE #3346）**：`scripts/ci-mirror-hosted-await.mjs` 只动读数与一次多余往返，判据 / 重试 / 等待预算 / 退出码语义一字不动。
  - 远端 ref 的 sha 与本跑 HEAD 逐字相等 ⇒ 同一个提交对象、树必然一致，直接判「已落」、**不再浅取**（浅取正是弱网下最先断的一跳，实测 `exit 128`）。读数明写「ref 已等于目标 sha，跳过浅取」，不再让人以为没验；sha 不等时仍走浅取 + 比树，「内容等价但提交不同」的识别能力保留。
  - 浅取 / `ls-remote` 失败时把退出码之外的原文也落进日志：令牌原值、URL 里的 userinfo、本机绝对路径（盘符 / UNC / POSIX 家目录与临时目录根）全部换占位；头尾各 6 行、每行 200 字符封顶并标注截断（单 stage 日志有 102400 字节上限）。这样 `connect/timeout`、`not our ref` / `couldn't find remote ref`、`RPC failed` / `early EOF` 三类只看日志就能分。
