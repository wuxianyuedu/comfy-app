## Fixed

- **model-adapter 的「保存为项目默认」恢复直改 src 出厂默认**（跟代码走）：撤回
  #4171 / #4178 的本机化改道，与 #4179 恢复的三族（侧栏页签 / 工坊模式契约 /
  尺寸配置表）对齐——四族同一语义：开发检出里点按钮直接写
  `src/lib/workshop/model-adapter-defaults.json`，提交后随包分发；读取侧现读
  src 文件、读不到回落编译快照。`defaults-legacy-migration.server` 随之失去
  全部消费者，按零消费导出硬闸删除（#4184）。
