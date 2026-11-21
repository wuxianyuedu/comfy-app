## Fixed

- **修 `pnpm ship` 复用开放 PR 的分页遗漏**（ISSUE #4768）：`scanPullPages` 旧判据只看
  「这一页不满页大小 ⇒ 清单到顶」，在 `list-pulls` 按更新时间排序、目标开放 PR 被新条目
  挤到后面页、而第一页恰好不满时提前 break，把「有开放 PR」读成「没有」⇒ 新建重复 PR。
  现场是同分支同标题同 head.sha 的 #4762（一直 open、CI 全绿）被判成没有，长出了 #4767
  并把 #4762 晾成悬空 PR。现在终止判据优先信平台明确给出的规模读数（`totalPages` / `total`
  / `header.x-cnb-total`）：给了总页数就翻到那一页，缺键才回落旧判据。判据在
  `tests/ship.test.ts`（复现用例先红后绿 + `readListTotalPages` 三种形状与缺键回落），
  规范 §13.6 同步记录口径。
