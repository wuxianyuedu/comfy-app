## Fixed

- **新版 Comfy Desktop 的共享模型 / 输入 / 输出目录识别不到（#4843）**：新版 Desktop 把
  共享目录登记搬进了应用数据目录（`%APPDATA%\Comfy Desktop\` 的 `settings.json` 与
  `instance-model-paths/<实例ID>.yaml`），实例目录里只剩 `extra_model_paths.yaml.example`
  模板、launchArgs 也不带目录参数，于是设置页三组共享目录全部显示「未配置共享目录」，
  且本应用 spawn 的 headless 实例真的不带共享目录（共享模型扫不到、输入输出落在实例
  本地）。现在：桌面实例按实例 ID 关联读 appdata 声明，spawn 时追加与 Desktop 同形的
  `--extra-model-paths-config` / `--input-directory` / `--output-directory`（launchArgs
  手填过的同名 flag 以手填为准，不重复追加）；`extra_model_paths.yaml` 解析器补上
  Comfy Desktop 写入端的带引号字段名（`'checkpoints': 'checkpoints/'`）与块标量类型清单；
  同一共享根下几十个类型子目录在设置页收成共享根一行，不再铺成路径墙。
