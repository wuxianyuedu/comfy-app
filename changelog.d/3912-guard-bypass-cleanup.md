## Fixed

- 守卫旁路写点治理（#3912）：`taskRepository.updateStatusForUser` 补终态守卫
  （终态行幂等返回原行，不再绕过执行链 writeGuard）；画布就地生成的发起路径
  把 `watchWorkflowRun` 返回的 closer 登记进 ref 并在卸载时调用——生成中切走
  页签后 EventSource 不再存活到任务终态。`cancelFilm` 保留（含撤任务逻辑，
  测试在册）。
