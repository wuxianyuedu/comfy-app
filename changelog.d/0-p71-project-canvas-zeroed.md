## Changed

- **`src/components/studio/project-canvas/**` 域 P71 清零**（30 → 0，接
  #955 / #959 / #961 / #963 / #964 的语义 token 收敛）：11 个文件里的 30 处
  `dark:palette` 手写档一次折叠。与前几批同源——error→`destructive`、
  品牌 violet→`primary`、状态色→语义 token。

## Added

- **两处「字面量本身即语义」的 §3.6.1 例外块**（P71 例外块语法的**第一次实
  战使用**——之前 #959 建了机制但只用在 ANSI 终端色一处）：
  - `MaterialLibraryPanel.tsx` **`KIND_STYLE` 媒体分类识别色表**
    (image=violet / video=blue / audio=emerald)——颜色是"素材类型"的视觉
    语言（与历史面板同源），"绿" 在这里是 **audio 类型、不是 success 状态**；
    三种若归一 token 就丢信息、若塞 status-* 就是分类装饰错当状态色。整表
    用 `// p71-allow:start … :end` 圈出。
  - **`FOLDER_ICON_TINT` 文件夹黄橙渐变**——是"目录容器"的通用装饰（与
    macOS / 资源管理器的文件夹色一脉相承），与状态无关。原两处使用（列表 /
    网格）内联重抄同一串（§12.12 孪生），**本批顺手抽成 `FOLDER_ICON_TINT`
    常量**，两处引用同一份 + 一起进 allow 块。
  - `WorkflowNode.tsx` **`NODE_SEQ_CHIP_TEXT` 节点序号 chip 装饰色**——
    `bg-overlay-accent-surface`（语义底）上的**高对比冷色 ID 标签**、非状态
    语义、也不匹配 info（会与其他"提示"混淆），无对应 identifier token →
    同 `// p71-allow` 例外。

## Changed（token 化 24 处）

- **`CanvasContextMenu` / `CanvasToolbar` / `EmptyCanvasHint` /
  `GlobalStepLogPanel` FileText icon / `HistoryPanel` 进行中 pill /
  `CanvasPanelToolbar` 激活态**：品牌 violet 全部走 `--color-primary-*`
  系（bg / text / ring / shadow 一起换）。激活态原本是"深紫底 + 深紫字 +
  深紫投影 + 深紫描边"四段 violet-500 硬凑——现在 `bg-primary/20 +
text-primary-strong + ring-primary/25 + shadow-primary/10`，token 内部
  自动两态。
- **`CanvasNode` / `SelectedToolbar` / `ImageGenerationPanel` /
  `HistoryPanel` 错误横幅 / `GlobalStepLogPanel` 4 处错误面板 /
  `MaterialLibraryPanel` 6 处错误/删除**：rose / red 全部走 `destructive`
  token（与 log 徽标 / status-badge / alert 一致）。
- **顺手清理**：源里有几处「in dark always 红 / 紫」的 quirk（作者过去为了
  让某个元素在深色下"看起来更明显"，手写 `dark:text-red-600` +
  `dark:text-violet-300`）——本批统一到"base = ink-muted、hover = token
  色"的清爽模式。这类"light 与 dark 各写各的"本就是 P71 存在的原因，改到
  token 后自然消解。

## Notes

- **P71 基线 115 → 85**（本会话累计 230 → 215 → 200 → 183 → 146 → 115 → 85）。
- 有意视觉 delta：
  - 品牌 violet 系在**深色下略亮一档**（token 内部值、精确等值 light 侧）。
  - CanvasNode 删除按钮 & MaterialLibraryPanel 网格删除按钮在**深色下不再是
    "一直红"**（原作者用 `dark:text-red-600` 硬 tinted），改成"hover 才红"，
    与 light 模式对称。这类"dark 特殊处理"本就是过去 light/dark 各写各的
    遗留——正是 P71 想让代码不再长出来的形态。
- **allow 块使用纪律**：这三处的**共同判据**是「颜色 = 类型身份、没有对应
  语义 token」。不像 `bg-emerald-100 → bg-success` 那类有明确状态语义、
  token 化零信息损失。选 allow 而非"硬塞 token"是**语义优先**。
- 剩余 85 处分布：`app/(main)`(18) / `VideoQueueModal.tsx`(10) /
  `BrowserStatusBar.tsx`(5) / `FilmStudio.tsx`(5) / `ModelLibrary.tsx`(5) /
  `workflow-editor`(5) / `film-studio-config.ts`(4) / `training-studio-config.ts`(4)
  等。下一批把剩余**零散**站一起处理。
