## Changed

**`typescript/no-unnecessary-condition` 我方保留面清账（#2919，口径并入 #2941）**：
`scripts/**` + `src/lib/**` 实测 **538 处 / 190 份 → 0 处 / 0 份**。

- 直接改 59 处：`??` 左值类型与运行期都必非空、字面量比较、多余可选链（删兜底／删多余判断，行为不变）。
- 其余全部落账禁用：`// oxlint-disable-next-line typescript/no-unnecessary-condition -- 理由`
  （同一行多处时用 `disable-line`；与既有指令同行时逗号合并），不做文件级／块级禁用。
  恒真／恒假默认不删分支，只有拿到运行时证据才删。
- 新增 424 行禁用注释，净 `+576 / −214`（190 份）。
- 逐处取证台账：`log/tools/nuc-2919-ledger.md`（含 #2941 结论作前置说明）。
- 未触碰移交包目录（`src/components/**`、`src/app/**`、`tests/**`、`src/server/**`、`e2e/**`），
  也未改动 `scripts/**` 里 #2783 的 `canaryScratchPrefix()` 逻辑。
