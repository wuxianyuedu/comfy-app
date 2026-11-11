## Changed

- **GA 判决回调流水线迁平台池（ISSUE #3529，#3528 现场）**：`api_trigger_ga_verdict`
  的「GA 判决回调（骨架·休眠）」是每条 PR 判决的必经链（fail-closed），此前钉在
  自托管节点上 —— 节点离线（睡眠 / runner 连接掉）时 build 死在 prepare，
  **所有 PR 的判决变红**且与代码无关。整条迁平台池 Linux（与质量门禁 / 镜像出口
  同族），判定逻辑保持内联（`git.enable: false` 不检出）、PowerShell 换 sh，
  三态退码与身份日志逐字同语义。至此 `.cnb.yml` 的 PowerShell / cp936 调用归零，
  自托管节点退出全部活流水线；cp936 外壳族从 CI 面退出（判据与用例留盘，
  本地场景另评）。
