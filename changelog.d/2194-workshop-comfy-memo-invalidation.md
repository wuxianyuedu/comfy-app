## Fixed

工坊 ComfyUI 通道（`src/server/workshop/comfyui.ts`）两份「首读即定终身」的进程内 memo
补上失效出口，语义与 `client.ts` 那一侧对齐（ISSUE #2194，audit §C.5 S14 剩下的那一半）：

- **`settingsCache` 改 size+mtime 指纹比对**：本模块的失败话术**指名让用户手改**
  `data/workshop-comfy-settings.json`，而旧缓存只在同进程写路径里更新 —— 手改不重启
  就不生效，提示语与缓存语义互相推翻。指纹让「手改这个动作本身」成为失效的执行者
  （形状与 custom-nodes manifest 摘要 / lockfile 漂移同一族；一次 statSync）。
- **`resolvedBase`**：网络层失败（连接被拒 —— fetch 的 `TypeError`）时复位，
  下一次调用重新探测；**HTTP 状态失败不复位**（GPU OOM 的 500 也是活实例，#685）；
  探测全落空**不再缓存**缺省地址（此前探空也首读即定终身，通道会被钉死在死端口上）。
- 抽出 `createSettingsFileMemo`（可注入 io，用例不碰真盘）与
  `resetWorkshopComfyBase()`（与 `client.ts` 的 `resetComfyBase()` 同名同语义的出口）；
  用例 6 条钉住三条语义（手改可见 / 网络失败复位而 500 不复位 / 探空不缓存）。
