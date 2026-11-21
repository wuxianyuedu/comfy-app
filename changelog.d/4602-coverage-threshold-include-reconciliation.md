## Fixed

- 覆盖率对账缺一格（#4602）：`coverage.thresholds` 的键此前只判「指向的磁盘文件
  存在」，不判「被 `coverage.include` 命中」——只加门槛忘加 include 时，门槛在
  报告里没有对象、静默失效，全仓照样绿（ui/file-picker.tsx、custom-nodes、
  DraftIntegrityHint 同族事故）。`tests/coverage-targets-exist.test.ts` 补上
  「每个门槛键的匹配文件至少一个落在 include 收集面里」的硬断言，并附
  「判据真的有牙」反向自证（拿真实存在但不被 include 收集的文件当探针）。
