## Fixed

- **视图层 `HistoryTaskCard.tsx` 走语义 token + brand 渐变声明例外**（P79 二
  批 · 累计 64 → 58）：
  - **状态点色**（左缘 4px 高亮条）四档 → 语义 token：SUCCEEDED→`bg-success` ·
    RUNNING→`bg-primary` · FAILED→`bg-destructive` · QUEUED→`bg-info`
    （对齐 §3.6.2 与「统一状态映射」：MEMORY `QUEUED→info · RUNNING→primary ·
    SUCCEEDED/DONE→success · FAILED→destructive`）；未落入以上四档的兜底
    仍留 `bg-gray-500`（灰 → 琥珀跨色系跳、留下一批统一）；
  - **底部进度条 brand 渐变**（`from-violet-500 to-fuchsia-500`）**保留
    原色、包一层 `p71-allow` 就地声明**：violet→fuchsia 是项目品牌视觉、
    不是状态色，不能被 token 化（`§3.6.1 装饰渐变例外`）。P71 与 P79 共享
    同一份 `p71-allow` 例外块（`stripP71AllowBlocks` 在 count 前剥掉整块、
    一次标记管两条判据）。

  基线 **68 → 62**（P79 累计 67 → 58：本批 -6 · 首批 -3）。
