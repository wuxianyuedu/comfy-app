## Fixed

- **日志面板改为非模态，修复「打开日志面板后应用页签从无障碍树消失」（ISSUE #310）**：
  `src/components/studio/logs/LogPanel.tsx` 的面板走 base-ui `Dialog`，默认 `modal=true`
  会把 portal 以外的整页设成 `inert`/`aria-hidden`。此前的让位修复只靠 z-index 把标题行
  页签抬到遮罩之上，**保住了鼠标命中、没保住无障碍可见** —— `e2e/critical-flows:367`
  （`expectTopHitsTabStrip`：`getByRole('tablist','应用页签')` 需可见且顶部命中）因此在
  「打开设置」通过、「打开日志面板」失败（页签 `element(s) not found`）。日志面板本就是
  「开着还能继续用页签」的非阻塞工具窗，故给该 `<Dialog>` 传 `modal={false}`，让页签在
  面板打开时仍在无障碍树里；关闭路径不变（Esc + `onOpenChange` + Ctrl+Shift+L + 关闭按钮）。
  仅改日志面板这一处，`ui/dialog` 全局仍模态（确认框该拦）。验证：生产构建下
  `pnpm exec playwright test e2e/critical-flows.spec.ts e2e/smoke.spec.ts` → **29 passed**
  （`:367` 复绿，其余日志面板/设置/内嵌用例全绿，无回归）。
