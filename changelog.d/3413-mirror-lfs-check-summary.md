## Fixed

- **LFS 对象核对失败时收尾小结不再误指 git-lfs 原话（ISSUE #3413）**：第四跳 `verifyLfsObjects` 走 batch API / Node `fetch`，耗尽重试以 `exit 2` 交账时，小结仍念 `LFS=败（类别：其他）｜下一步=看上一行 git-lfs 原话` —— 这一跳根本没起 `git lfs push` 子进程，上一行是 `结论：exit 2 —— LFS 核对请求没跑起来（网络层）`，没有 git-lfs 原话可看；CNB 日志 UI 只显示最后几行，这句把排障直接带偏。
- 根因是 `ci-github-mirror-push.mjs` 的 `lfsCheck.code !== CODE.OK` 分支给 `summarize()` 没传 `failure`，`renderMirrorSummary` 便走 `LFS_FAILURE_KINDS.OTHER` / `LFS_FAILURE_SHORT_ACTIONS.OTHER` 两处缺省；`git lfs push` 失败那一支是传了 `classifyLfsPushFailure` 结果的，只有核对这一支缺。#3400 补的重试不会绕过这个缺口 —— 重试耗尽仍会走到它。
- 改法：`ci-mirror-failure-report.mjs` 新增 `describeLfsCheckFailure(note)`，返回核对跳专属的 `label` / `short` / `next`，并把核对自己的回话带进小结最后一行；PR 档 `runMirror` 与 `--master` 档 `runMasterMirror` 同批各接一行，共用同一份读数（两档是同形缺口，不写第二份话术）。补 3 条定向用例：纯函数话术、PR 档端到端、master 档端到端，钉住不再出现「类别：其他」/「看上一行 git-lfs 原话」。
- **边界**：不动三态退码与 `fail-closed`，不动 #3400 已补的第四跳重试面，不动 `classifyLfsPushFailure` 的七族判据与 `LFS_FAILURE_SHORT_ACTIONS` 常量；只换「核对失败」这一支的小结读数。
