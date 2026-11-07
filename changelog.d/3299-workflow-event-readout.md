## Added

- 新增「无效 workflow 会伪造它没声明事件的空 run、别拿 `event` 反推触发面」的可复做判断口径
  （ISSUE #3299）：写进 launch-and-build §7.7.1 与 13 §13.5.34 两处排障口，同批带上生成态镜像。

  现场：镜像仓 `wuxianyuedu/comfy-app` 的 `package-desktop.yml`（`on:` 只有 `schedule` +
  `workflow_dispatch`）在顶层 `env:` 误用 `runner.temp`（#3276）那段时间里，每笔镜像 push 都长出
  一条 `event=push`、`total_count: 0` 个 job 的 failure run（#5–#36，页面带 `Invalid workflow file`）；
  修好后（#37 起）全是 `workflow_dispatch`、各 1 个 job，再无 push run。同期 `master-gate.yml`
  （`on: push`）#36–#47 逐笔 `push success`、`head_sha` 与本仓逐字一致 ⇒ push 事件照常发生，
  空 run 只是无效文件为每个到达事件挂注解的产物。

  口径三条：① 先看 job 数与注解、再看 `event`（0 job + `Invalid workflow file` = 文件坏了的旁证）；
  ② 触发面只认 `on:` 那一份（`git show` + raw 双取），不许从 `event` 反推 —— 本次就是它把
  #3276 的诊断带偏过一次；③ 「修好后同样 push 却不出 run」正是文件从无效变有效的读数，
  验 push 有没有发生去看 `on: push` 的 workflow，别拿坏 workflow 的 run 列表当事件流水。

  三个候选一并裁决：A（无效文件伪造空 run）成立、B（force push 属 push 定义面）只是事件来源、
  C（#5 那批文件有效）排除。§13.5.34 那条「--force 是否必定触发 push」的未验证推断，
  由此拿到实测读数、改成已验证。
