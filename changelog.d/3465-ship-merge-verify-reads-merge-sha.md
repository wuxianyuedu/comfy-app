## Fixed

- **合并验真不再拿刷新前的远端跟踪引用当「主干顶端」（ISSUE #3465）**：`pnpm ship --merge` 在 squash 合并成功后读到 `is_merged=true`、`碎片在主干顶端=false` 却退 1，屏幕上像「没合上」。现场是 PR #3464 合并那一跳：`git ls-remote origin master` 已是 `b7663a9b`，而本地 `origin/master` 在合并回执与 git 服务端 ref 传播之间那个窗口里仍指向上一笔，拿它 `cat-file -e` 查本轮净新增的碎片必然得 false。旧码确实先跑过 `git fetch <远端> <主干>`，但验真随后读的是 `origin/master` 这条引用而非合并回执给出的那笔提交，两处读数取自不同时刻的对象。
- **验真的对象改成合并回执的 sha**：`mergeAndVerify` 现在先 `git fetch <远端> <主干>` 把合并对象取回本检出，再用平台回执里的 `mergeData.sha` 查 `cat-file -e <sha>^{commit}`（合并提交在不在本地）与 `cat-file -e <sha>:<碎片>`（碎片在不在合并提交里）。「合并后的主干顶端」只认这一个权威原值，不再受本地引用刷新时机影响；`tests/ship.test.ts` 新增一组用例逐条断言 `cat-file` 查的是 mergeSha、一次也没问 `origin/master`。
- **「没刷新」与「没合上」分开**：合并提交对象没同步到本地（或回执没给 sha）时，这一格没有测量对象 ⇒ 落 `READOUT_MISSING`（退 5，与 `is_merged` 缺键同口径：拿不到测量 ≠ 测量结果是红的），不落红、不重复合并，合并事实以平台 `is_merged=true` 为准。对象在、碎片确实不在，或平台明确 `is_merged=false`，仍按事实退红——新口径不变成绕过口。
- 边界：不动 `merge-pull` 调用、不动退码分型表、不动关单/清分支那两跳；`landed.sha` 与进度行仍取同一笔回执 sha。碎片段落 `## Fixed`，诉求单 #3465 是问题报告本体（症状 / 当场读数 / 根因），动手前已在账。
