## Fixed

- 系列/季/集/角色的 18 个 tRPC mutation 全部无 onError，用户操作失败完全静默——删除系列/创建季/整季批量生成失败时界面毫无反应（#4233）：统一补 `onError`，文案走 `errorText`（动作前缀 + 网络层原因翻译），通道与 use-queue-monitor 同款走 ToastProvider。用例：失败落 toast 且带动作前缀与原因、整季生成入口失败必报、成功路径不说话。
