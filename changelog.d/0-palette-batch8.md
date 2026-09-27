## Fixed

- **视图层 P79 八批 · 3 文件 5 处原色板收尾**（累计 5 → 4）：
  - **HistoryList 1 处（brand 渐变 · 包 `{/* p71-allow:start */}` JSX 形态）**：
    日期分组标题左侧 4×1 竖条 `bg-linear-to-b from-violet-500 to-fuchsia-500`
    · 与工坊 brand 双色渐变同族、单档 token 化会失去渐变识别度；
  - **WorkflowIOPreviewPanel 2 处（sky identity · 包 JSX 形态 p71-allow）**：
    IO 预览面板外框 `border-sky-400/30` + 标题旁 `bg-sky-400` 圆点 · sky 是
    这套 UI 里"IO 预览"的既有装饰身份、非状态色、无匹配 token（与 workshop
    域 fuchsia tag、workshop 域 amber 同性质）；
  - **ModelTagManager 1 处（brand fuchsia 编辑态描边 · 迁 primary）**：
    重命名 input 的 `border-fuchsia-500/50` 与 `focus:border-fuchsia-400`
    → `border-primary/50` 与 `focus:border-primary` · 这是"编辑态描边"
    （表示"这个 tag 正在被改名"），不是 line 15 的"tag identity 色"
    （那是图标色 · 由既有 `// p71-allow` 保留）。

  基线 **9 → 4**（P79 累计 67 → 4 · 八批覆盖 38 文件 63 处）。

## 剩余 4 处分布

（未列 · 需下一次 `--report-only` 定位）—— 大概率是散在 workshop / studio 各
文件里的 brand 渐变或装饰档 · 按同批节奏分片处理 · 目标 P79 → 0 · 升硬闸。
