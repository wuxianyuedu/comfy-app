## Changed

- **oxlint `typescript/strict-boolean-expressions` 批 11：
  `src/components/studio/logs` 清零（28 处 / 12 份）**（ISSUE #2776 /
  #2917）：日志面板一族 —— 视图与按钮（DiagnosticsButton /
  SaveExportButton 的 `savedPath: string | null` 显式判、LogPanel 的
  `expansionMap[key] === true`（noUncheckedIndexedAccess 下的
  `Record<string, boolean>` 索引）、LogPanelFooter 的 `bootId`、LogRow 的
  `location?: string` 显式判、TaskLogTimeline 的 `log.src`）、数据层
  （LogProvider 的 `data.mismatch === true`）、纯逻辑（log-analysis：
  `Error.stack` 显式判、`match?.[1]` 三态判、命名空间 `ns` 显式判、恒真
  对象防御 `Boolean(bucket)`；log-callsite：`loc` / `segs[1]` / `pkg` /
  `fn` / `clean` / `stack` / `described` 七处显式判；log-format：
  `opts?.alwaysDate === true` 与 `entry.location` / `entry.origin` 显式判；
  log-virtual：`id?: string` 三重判 + `expandedIds?.has(id) === true`
  两条链）、测试（LogPanel.test 的 find 谓词 `?.startsWith(...) === true`）。
  - 口径与前几批一致：可空布尔 → `=== true`；可空字符串按声明域显式比较；
    恒真对象防御 → `Boolean(x)`。
  - 实测口径说明：清单记 28 处，实测 28 处 / 12 份，处数一致，份数以实测
    为准。
  - 验证：`src/components/studio/logs` 该规则复测 0 残留（改完后重拉复核）；
    该目录 10 份测试 291 用例全绿。eqeqeq 台账 0 新增、oxlint 禁用台账
    0 处。
  - 剩余总量见 `log/tools/sbe-remaining-2026-11-02.md`（批 12 收尾时统一
    核账为 550 处 / 219 份）。
