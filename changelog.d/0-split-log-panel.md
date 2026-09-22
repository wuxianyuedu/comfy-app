## Changed

- **`src/components/studio/logs/LogPanel.tsx` 拆包**：993 行超过 §12.6 文件
  长度棘轮的阈值。把「来源筛选下拉」这一整块子树（`OriginSelect` 组件 + 它
  私有的 `CountColumn` / `asOriginFilter` / `ORIGIN_COLUMNS` / `ORIGIN_LABELS`，
  以及被主组件与页脚共用的 `ORIGIN_TEXT` 与两个摘要函数 `levelSummary` /
  `optionCountsText`）沉到 `./LogPanelOriginSelect.tsx`。主文件从 993 降到 742
  行、进入阈值以内；`scripts/.file-size-baseline.json` 里 `LogPanel.tsx` 的
  基线跟着从 993 降到 742（棘轮只降不升）。

  拆点选得很直：这块 UI **只吃** `value` 与 `countsByOrigin` 两个 prop、与主组件
  的虚拟滚动 / 事件处理**没有共享 state**，天然适合下沉；`OriginSelect` 依赖的
  `Select` 系列 primitives、`LOG_PANEL_POPUP_Z_CLASS`、`displayValue`、
  `CONSOLE_ORIGIN` 与 `LogLevel` / `LogLevelCounts` 类型也一起搬走，主文件
  相应 6 个 import 变无消费方，一并删（否则 tsc 报 6133 unused）。消费者
  `from "~/components/studio/logs/LogPanel"` 的路径**完全不变**（§12.18 复用
  优先——拆包只挪文件、不动契约）。

  `pnpm exec tsc --noEmit` 绿；`src/components/studio/logs/**` 下 **7 个测试文件、
  241 用例**全过（含虚拟滚动的「量不到视口退全渲染」兜底、翻页 / 贴底 / 每行
  显式高等判据）；`check-file-structure --strict` 里 `LogPanel.tsx` 已从
  「违规（阻断提交）」列表移出。类型安全审查 · 技术债盘点 #5 拆分线的第一
  个（5 个 900+ 行文件里 UI 结构最清晰、耦合最轻的那个）。
