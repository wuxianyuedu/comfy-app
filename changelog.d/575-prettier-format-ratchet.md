## Changed

- 代码格式纳入提交门禁：新增/修改的文件必须通过 prettier，存量 576 个文件走**只减不增**的棘轮
  （`scripts/check-format.cjs`）。新增脏文件会阻断提交；治理有进展后必须收紧基线，CI 会核对。
- 格式化改动必须与行为改动**分开提交**：一次提交里「过一遍 prettier 就变成另一种写法」的文件
  达到 10 个即阻断（`scripts/check-reformat-only.cjs`），避免全文件重排把真实改动埋掉、
  让 `git blame` 失效。
- 一键质量门禁（`pnpm check:all` / 双击 `tools/start/verify-quality.ps1`）新增 `format` 一项。

> 升级方需要做的是：新增或改动文件后跑一次 `pnpm exec prettier --write <文件>`
> （或 `pnpm format:ratchet` 自查）。白名单内的路径（`scripts/`、`tests/`、`e2e/`、
> 根级配置等高频变更文件）暂不纳入。详见 `docs/standards/13-提交与-code-review.md` §13.5.1 / §13.5.2。
