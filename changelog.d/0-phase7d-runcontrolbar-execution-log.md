## Added

- **RunControlBar 显示执行日志**（Phase 7）：画布 / 工坊的控制条现在把引擎 `run.log` 渲染成一条**最新在上**的执行轨迹（每步 `✓/✗ 时间 摘要`，失败标红），与 CLI（#929）同源。`run.log` 空时不显示该块。让「AI 跑到哪、产出了什么」在应用界面内直接可见，不必开终端。

## 验证

`RunControlBar.test.tsx` 新增 1 例：注入带 `run.log` 的 controller，断言成功/失败两行都渲染、有「执行日志」标签区；共 7 例通过。`tsc`/eslint 干净。
