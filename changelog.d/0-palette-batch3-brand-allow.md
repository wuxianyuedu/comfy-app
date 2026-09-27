## Fixed

- **视图层 P79 三批 · ProjectOutputs 与 AgentOverlay 里 12 处原色板就地处置**
  （累计 58 → 46）：

  **ProjectOutputs**（6 处 · 全 brand violet/fuchsia · 就地包
  `{/* p71-allow:start … */}` JSX 注释形态声明例外）：
  - Cover banner 整段：`border-violet-500/20` +
    `from-violet-500/10 to-fuchsia-500/10` 装饰底 + `bg-violet-500/90` 项目
    徽章；
  - 视频产出卡：播放按钮 `bg-violet-500/90` + 「视频」类型徽章
    `bg-fuchsia-500/90`。
  两处都是**品牌视觉、非状态色**、迁语义 token 会失去 brand 识别度（§3.6.1
  装饰渐变例外档）。

  **AgentOverlay**（6 处 · 3 状态色 + 1 brand 渐变 + 1 brand 用户气泡 +
  1 未列）：
  - `TOOL_STATUS_COLOR` 三档（running=amber-400 · done=emerald-400 ·
    error=red-400）**走语义 token** → `bg-warning` / `bg-success` /
    `bg-destructive`（对齐 §3.6.2「统一状态映射」）；
  - 智能体头像 `from-violet-500 to-fuchsia-500` **包 `{/* p71-allow */}`
    例外声明**（品牌渐变、单档 token 化会失去渐变识别度）；
  - 用户消息气泡 `bg-violet-500/90` 是单档 brand、**走 `bg-primary/90`**
    （项目主色档、语义化）。

## 依赖

解锁 #1072（`stripP71AllowBlocks` 现在同时认 `//` 与 JSX 注释形态）之后，
JSX 顶层兄弟节点位的 brand 色板终于能就地声明例外、不再需要"永远留在基线
里"或"迁成语义 token 损失品牌识别度"两条都不干净的路。

基线 **62 → 50**（P79 累计 67 → 46）。
