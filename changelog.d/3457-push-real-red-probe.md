## Changed

受控探针：让 push 档「GitHub master 镜像」格在镜像成功推送之后按计划判红一次，
用于端到端验证 `endStages` 的「push 失败立案」格在真红时能否读到逐格读数、
并凭流水线注入的 `CNB_TOKEN` 真正建单（`repo-issue:rw` 那一支）。
取证后随下一笔提交回滚，镜像出口动作本身不改。
