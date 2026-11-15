## Fixed

- **scripts 工程链的低危幂等缺口**（ISSUE #3858）：
  - GA 日志 relay：GA 收尾 job 被 re-run 时，同一 `runId+sha` 不再重复上传附件 /
    重复发 PR 评论（写入侧补 marker 查重，读取侧判据复用 `parseRelayComment`）。
  - 数据库备份的临时文件名带进程号：两进程同秒备份不再共用同一个 `.partial`
    （原先一方会删掉另一方 VACUUM INTO 的半成品）。
  - freshness 账本写入改 tmp + rename 原子替换：不再因中断留截断 JSON（读取侧
    会把坏 JSON 折成空账）。
  - `check-known-failed-stale --self-test` 的探针改落 `tests/__tmp-*`（约定落点，
    `.gitignore` 已收）：自证被强杀后残留的必然失败探针不再混进全量单测。
  - `ci-ga-verdict-callback` 维持现状（平台按 `(event, sha)` 的去重行为未知，
    后果仅一条多余短构建，结论经 commit-status 收敛）。
