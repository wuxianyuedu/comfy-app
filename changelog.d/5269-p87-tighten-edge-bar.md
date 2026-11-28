## Fixed

- **P87「整块容器自带 backdrop-blur」收紧，堵两类贴边条漏检**（ISSUE #5269，规范 03 §3.13）：
  - `fixed` 单独出现不再放行：贴边条必须「两条对边贴齐」（`inset-x-0` / `inset-y-0` /
    `inset-0`，或 `top-0`+`bottom-0` / `left-0`+`right-0`）。此前 `AgentOverlay`
    的 `bg-panel-deep/95 ... fixed ... backdrop-blur-xl` 与 `GlobalStepLogPanel`
    的 `fixed top-16 right-3 ... backdrop-blur-sm` 凭一个 `fixed` 漏过（都由 PR #5242
    撤模糊修复）。
  - 贴边条放行还要求底色不带 `/85~95` 高不透明半透档 —— 模糊 + 半透是同一笔
    合成税的两半，§3.13 表格要求贴边条「留模糊、去半透」。`BrowserStatusBar`
    曾以 `bg-panel/95 + backdrop-blur-sm` 漏过。
  - `ui/dialog-overlay.ts` 的 `bg-scrim + inset-0` 遮罩继续豁免（§3.13 明确）。
  - 用例（`tests/check-ui-primitives.test.ts` 的 P87）补「纯 fixed 浮层判红」
    「贴边 + /95 半透判红」两条，并保留原三条与 dialog-overlay 豁免回归；
    规范 03 §3.13 / DESIGN.md / scope 注释的执行者描述同步为收紧后的两道闸。
