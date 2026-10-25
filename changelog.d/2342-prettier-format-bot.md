## Added

`prettier 格式` 一格红时，CI 现在会**自动修复并推一个 format-only 提交回 PR 源分支**
（ISSUE #2342；口径变更由业主拍板，§13.5.19「CI 回写分支」留白在本档受控解除）：

- 执行者换成 `scripts/ci-format-fixup.mjs --check --autofix`：先原样跑
  `check-format.cjs`（判据本体一字未改；绿时一个字节不多写）→ 红 ⇒ 就地
  `prettier --write` **门禁判出的那几个文件** → 复判必须全绿 → commit + push。
- bot 身份固定可辨（`comfy-format-bot`），提交**不带** `[ci skip]`（新提交必须重跑
  完整流水线，PR 跑绿才合并）。
- 四道护栏（用例 8 条逐条钉住）：本地形态只修工作区不提交不推送；永不回写
  master；防连环（HEAD 已是 bot 修复提交而仍红/或背靠背 bot 提交 ⇒ 停）；只 add
  本轮写过的文件（`git add -A` 禁止）。
- push 被拒（PR 事件令牌常见只有 `repo-code:r`）时**可读地红**并点名业主动作
  （给流水线配可回写的 bot 凭据），失败不许静默。
- `AUTOFIX_DUTIES` 登记本档（`--check`/`--autofix` 双旗标，登记表双向核对继续成立）；
  §13.5.19 补记这次受控解除与边界。
