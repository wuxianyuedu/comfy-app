## Fixed

- **`--strict` 棘轮在 CI 首跑即红：三处基线漂移逐条对账**。门禁从 GitHub Actions 迁到
  `.cnb.yml`（`623-cnb-pipeline`）后，`check-file-structure` / `check-function-length` /
  `check-theme-colors` 的 `--strict` 第一次真的在流水线上跑起来，而这三份基线此前从没有
  任何自动检查在维护（旧工作流从未被触发过）。干净 `master` 上同样失败，与具体 PR 无关。
    - **`src/components/studio/logs/LogPanel.tsx` 回到 R5 棘轮之内（1236 → 988 行）**：
      文件在合并进来的虚拟滚动改动里长了 162 行，而基线没跟着动（`--update` 会拒绝把
      变大写进基线，这是棘轮的本意）。这里按棘轮的做法**真拆**：把「怎么画一行」整块
      ——行内分片缓存、关键词高亮、行级复制按钮、`LogRow` 本体——移到同目录新增的
      `LogRow.tsx`。这一块本来就与面板状态无耦合（只被 `LogRow` 使用），拆开后
      `LogPanel.tsx` 只剩筛选 / 分页 / 虚拟滚动 / 锚定。契约不变：入参、`data-log-*`
      标记、换行与行高口径都与 `log-virtual` 的常量一致；`LogPanel.test.tsx` 32 条用例
      逐条通过。
    - **`check-function-length` 与 `check-theme-colors` 收紧基线**：两者都是「治理有进展、
      基线没跟着收」——巨型函数 22 → 21 个（`use-generate.ts` 的 1 个已拆掉）、未豁免写死
      色值 169 → 167 处（`WorkflowEditorCanvas.tsx` / `WorkflowParamCard.tsx` 各 1 处已
      token 化）。按门禁自己的提示执行 `--update`，两处都是**下降**。
    - R5 基线同步收紧到实测值（`LogPanel.tsx` 1102 → 988，另有 4 个文件在此前治理里
      早已变小但没记账）。棘轮数字只降不升。
