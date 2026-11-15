## Added

- 模型适配器支持「保存为项目默认（跟代码走）」（#3951）：「模型适配」页新增按钮，把当前草稿写进入库的 `src/lib/workshop/model-adapter-defaults.json`（仅开发检出可写、原子落盘，正式包里大声失败）；生效档 = 项目默认与 DB 存档逐模式合并（DB 同名模式压过、端点路径 DB 非空优先），编辑器播种、概览「已配」与工坊生成链路统一读生效档。配套抽出共享的配置文件原子写出口 `src/lib/atomic-write.server.ts`。
