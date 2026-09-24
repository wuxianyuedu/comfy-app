## Changed

- **`src/components/studio/history/` 域 P71 清零**（17 → 0，接 #955 / #959 的
  log-level 语义化）：状态与类型色全部改走项目语义 token，`dark:` 手写档一并消
  失。语义映射与 log/status-badge/alert 同源，改主题一处生效全站。
  - `history-utils.ts` `STATUS_STYLE`（**状态语义表**）：
    `QUEUED → info`（原 cyan 系）、`RUNNING → primary`（原 violet 系）、
    `SUCCEEDED → success`（原 emerald 系）、`FAILED → destructive`（原 red 系）。
    `pillCls` / `accentCls` / `cardBorderCls` 三处一起换，保证 pill 与卡左侧
    accent 边框、卡外框同源。
  - `HistoryTaskCard.tsx`：RUNNING 进度百分比文字 `violet-700/400` →
    `text-primary-strong`（**精确等值**），FAILED 错误卡（错误文字 / 建议 /
    校验面板）red / amber 系 → `destructive` / `warning-strong`；QUEUED
    虚线覆盖层 `border-cyan-500/40` → `border-info/40`（与 pill 一致）。
  - `HistoryDetailModal.tsx`：helper 缺失警示面板 `amber-*` → `warning-*`；
    打开成功提示面板 / 路径 code 块 `emerald-*` → `success-*`；错误面板
    `red-*` → `destructive`；工作流参数 KeyValueRows key 列
    `violet-700/300` → `text-primary-strong`（品牌紫 → primary）。

## Notes

- P71 基线 **200 → 183**。
- 视觉 delta（有意正常化）：`QUEUED` 由青(cyan) 转蓝(info)——"等待中"属**信息**
  语义，与 log/status-badge 的 info 一致；`RUNNING`/工作流参数 key 由深紫
  (violet) 转 `--color-primary-strong`，浅色**精确等值**、深色略亮一档
  (violet-300 → violet-400)，是 token 内部两态值、非视觉退化；FAILED 卡由
  rose/red 混用统一到 `destructive`，与 log 徽标 / status-badge 一致。
- 剩余 183 处分布：`workflow-library`(37) / `workshop`(31) /
  `project-canvas`(30) / `app/(main)`(18) 等。下一批候选 `workflow-library`
  （最大簇，含 ComfyUI 节点/工作流分类装饰色，需要 §3.6.1 例外块与状态色
  分开处理，比 history 这批更琐碎）。
