## Fixed

- **§7.7 里「nsis 打包段没有读数」那句已被本次实测推翻，改成读数本身（ISSUE #2525）**。
  把两份 GitHub release 资产按 tauri 自己的布局预置进 `%LOCALAPPDATA%\tauri\NSIS` 之后，
  `pnpm exec tauri bundle` 一次跑完两个目标、退 0，**日志里没有 `Downloading` / `Recreating it`
  任何一行**：

  | 段 | 读数 |
  | --- | --- |
  | 打包段（nsis） | **250.5s** ⇒ `ComfyAPP_0.1.0_x64-setup.exe` **62.31 MiB** |
  | 打包段（msi，同一跑内） | **308.0s** ⇒ `ComfyAPP_0.1.0_x64_en-US.msi` **84.86 MiB** |
  | 该跑总墙钟 | **577.8s** |

  同批把「为什么这一格会红」的三条事实写进规范，因为它们都不是推演：
  ① 直连取 `nsis-3.13.zip`（2,363,925 B）实测 **48.4s**，而 bundler 的下载预算在 **22–23s**
  量级（两次失败分别停在 21.8s / 22.5s）—— 同一 URL 的 HEAD 只要 2.0s，所以缺的是正文吞吐，
  不是连接；② `gh-proxy.com` 前缀镜像实测 dll **0.96s** / zip **29.5s**，两份 sha256 与直连
  **逐字同值**（`ba63dffc…` / `5ba143b5…`）⇒ 官方键 `TAURI_BUNDLER_TOOLS_GITHUB_MIRROR` 值得配，
  但 29.5s 仍在那条预算之上，**不许把它当结案**；③ 节点侧 `orange-runner` 是
  **LocalSystem** 服务，作业眼里的 `%LOCALAPPDATA%` 是 systemprofile 那个目录，普通会话
  `ls` / `touch` 都 `Permission denied`，而 bundler 走 `SHGetKnownFolderPath`（不读
  `LOCALAPPDATA` 环境变量）⇒ **「把这台的缓存种好」救不了那条流水线**，
  处置形状（人工预置 vs 仓库侧按 sha256 钉死的预置入口）留在 #2525 上由业主选。
