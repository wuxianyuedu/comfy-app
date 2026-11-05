## Fixed

- `pnpm ship` 的栈式 PR 区间补齐自证：新增用例钉住建 PR 与复用正文两路都取
  `git diff --stat <平台 base.ref>...HEAD`（不出现 master 区间的数字），并覆盖
  「平台 `base.ref` 在本地解析不到 ⇒ 退回 upstream 且明念没有跟随」那一格（#3021）。
- `fetch` 没跑起来但远端跟踪引用仍可用时，话术补上后果：这份引用可能过期
  （别人 force-push / 本地久未 fetch）⇒ 标题与 diffstat 可能跨到别人的提交，建议重跑。
  仍是**念但不阻断**（取不到最新引用不必然错，一次网络抖动不该停掉 ship）（#3021）。
