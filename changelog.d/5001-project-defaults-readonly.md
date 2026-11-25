## Changed

- **「保存为项目默认（跟代码走）」入口全部撤除，入库 defaults JSON 运行期只读**（#5001）：
  模式契约 / 侧栏页签 / 尺寸配置表 / 模型适配四族的设置页按钮与对应服务端写入口
  （`modeContractsSaveProjectDefaults`、`tabConfigSaveProjectDefaults`、
  `PUT /api/size-presets/project-default`、`workshopAdaptersSaveAsDefaults`）一并移除。
  此前这条运行期写路径会把「本该落本机覆盖的编辑」整份写进入库的 defaults 文件
  （`mode-contract-defaults.json` / `sidebar-tab-defaults.json` 等），工作树因此常挂
  与 master 不一致的基线，契约层的「JSON 基线 == 推导契约」判据当场红。
  现层序收口为：**入库 defaults = 编译期基线**（改它走改代码 / 提 PR）；**用户改动
  只落本机覆盖**（`data/workshop-mode-contracts.json`、`data/sidebar-tab-behavior.json`、
  `data/size-presets.json`，模型适配落 DB 存档），既有「改一格即存 / 自动保存」链路不变。
  `isDevCheckout` 判据随之失去全部生产消费方，`dev-checkout.server.ts` 连同其用例删除。
