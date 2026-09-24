## Changed

- **P71 全域清零**（85 → 0，接 #955 / #959 / #961 / #963 / #964 / #967 的连
  续收敛）：本批把最后 28 个文件里的 85 处 `dark:palette` 手写档一并折叠。
  其中 23 处是 §3.6.1「字面量本身即语义」的**类型身份例外**（走 `p71-allow`
  块），62 处是真正的**状态色 / 品牌色**——走语义 token。

### §3.6.1 例外块（4 处新增，23 处 baseline 命中被正确归位）

判据：颜色 = 类型身份、无对应语义 token。选 allow 而非硬塞 token 是**语义优
先**——与 ANSI 终端色 (#959 首例) 同族。

- `SettingsPrimitives.ANSI_STYLE_CLASS` **启动日志 ANSI SGR 表**（18 处，
  red/green/yellow/blue/magenta/cyan + bright + bg 变体）——与 log-row-style
  的 TOKEN_CLASS 同一族、同一判据，之前 #959 只对 log-row-style 打了 allow、
  这里漏了一份。
- `LogRow.SEARCH_HIT_CLASS` **搜索命中 `<mark>` 高亮**（1 处）——荧光笔装饰
  色，非状态（`warning-strong` 会把"搜到"误读为"警告"），无匹配 token。
- `ModelTagManager.TAG_ICON_COLOR` **标签图标 fuchsia**（1 处）——"tag 类
  别"的既有 UI 身份色（与 MaterialLibraryPanel 里 KIND_STYLE 同族），非状态、
  不与 primary/warning 对应。
- `WorksGallery.WORKS_CATEGORY_ICON_BG` **视频/作品项目卡图标容器**（2 处，
  网格 + 空态）——cyan 是"这一类内容"的视觉身份（与 `KIND_STYLE.video` 一脉
  相承），不是状态、也不匹配 info（两者会互相消解）。
- `SourceModal.RAW_FORMAT_CHIP` **"RAW 原件"格式标签**（1 处）——是**文件
  格式类型**的身份色（与"这是 ComfyUI 原始 JSON"的事实绑定），不是状态、也
  不是 info。

后三处 cyan（WorksGallery / SourceModal / LogRow）都是从**内联 JSX 属性**
搬到**模块顶层常量**再包 allow 块——JSX 里放不进 `//` 行注释，且把色串抽
到一处便于跨组件复用（如 WorksGallery 两处共用一份）。

### Token 迁移（62 处）

- **`film-studio-config.ts` / `training-studio-config.ts` 两份状态表**（8
  处）——`STATUS_MAP` / `STATUS_META` 与 `history-utils.ts STATUS_STYLE` 完
  全同一族 QUEUED/RUNNING/SUCCEEDED/FAILED/CANCELLED。映射一致：QUEUED→
  `info`、RUNNING→`primary`、SUCCEEDED/DONE→`success`、FAILED→`destructive`、
  CANCELLED→`warning`。三处状态表终于说同一种话。
- **`MessageCenterPanel` / `MessageCenterButton`**（6 处）——`KIND_META`
  update/restart/info 三种消息类型恰好一一映射到 primary/warning/info（是
  语义，不只是装饰）；未读计数 pill / BellRing 图标 / "新"徽标 全部品牌
  violet→primary。
- **`VideoQueueModal`**（10 处）——`STATUS_META` 表（amber 生成中 / emerald
  已完成 / red 失败）→ warning-strong / success-strong / destructive；视频
  序号 `V01` 与下载链接 → primary；错误提示 → destructive。
- **`BrowserStatusBar`**（5 处）——安全 Lock 图标 emerald→success-strong；
  降级提示 amber→warning-strong；错误计数 pill / devServer 状态点
  emerald/rose→success/destructive。
- **`ModelLibrary`**（5 处）——ComfyUI 连接状态 emerald/amber、错误 rose、
  头部图标 violet、checkbox 状态 violet 全部走语义 token。
- **`FilmStudio`**（5 处）——selected pill / BGM 名 / file input 装饰 / 已选
  文本 → primary 系；prompt 示例文字 cyan→info；film 错误面板 rose→
  destructive；ffmpeg 警告面板 amber→warning。
- **`HomePage`**（3 处）——功能卡图标容器 violet→primary；"新建画布项目"
  虚线卡片 cyan→info。
- **`workflow-editor/**` 四文件**（5 处）——error/amber 面板与提示走
  destructive/warning-strong。
- **`ProjectOutputs` / `RequiredSummary` / `SubgraphHeader` /
  `WorkflowCanvasEditor` / `DebugChainFooter` / `WorkflowImportPanel` /
  `WorkflowIOPreviewPanel` / `DynamicWorkflowFormView` / `SourceModal` 错误
  行 / `login/page`**（15 处）——错误红→destructive、警示琥珀→warning、
  品牌紫→primary、workflow IO 面板 sky 描边→info。

## Notes

- **P71 基线 85 → 0**。`scripts/.ui-primitives-baseline.json` 现在 `total: 0,
files: {}`。P71 棘轮**已完成全量治理**——从此任何新增 `dark:palette` 手写
  档都会被 pre-commit 直接阻断（`before=0`，只允许保持 0，除非走 `p71-allow`
  块）。
- 本会话累计：230 → #955 → 215 → #959 → 200 → #961 → 183 → #963 → 146
  → #964 → 115 → #967 → 85 → **本 PR** → **0**。共 7 个 PR、约 130 个文件
  改动、把散在视图层里的所有"手抄一遍 dark: 变体"的老样式一次收干净。
- 有意视觉 delta（明/暗两态核对项）：
  - cyan/sky/indigo 归 info——蓝调统一,原来 cyan/sky/indigo 三种"冷色提示"
    现在都走 `--color-info-strong`,读起来更一致。
  - amber 归 warning-strong——琥珀与警告色相近、不违和。
  - rose/red 归 destructive——shadcn 语义 destructive 是 oklch 红,与 palette
    红有细微差,但与全站 log/status-badge/alert 一致后是**净收益**。
  - violet 归 primary-strong——**浅色精确等值**,深色略亮一档,是 token 内部
    值。
- `--update` 写 `total: 0` 是**首次让基线归零**——脚本 `if (before === 0 &&
after === 0)` 短路保护仍然对新增生效:任何人再往 `src/**/*.tsx` 里塞
  `dark:text-red-400` 之类的,pre-commit 会立刻拦。回归测试
  (`tests/check-ui-primitives.test.ts` 三条 P71)继续守住判据本身。
