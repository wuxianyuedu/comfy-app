## Fixed

- `pnpm ship` 在「分支内容已随**已合并**的 PR 落地」时不再派生重复 PR（#3642）。#3642 的
  现场：PR #3640 在代理工作期间被 squash 合并，分支上补一笔再跑 ship —— `head.sha` 已是
  新 sha、按 sha 认落地的那一档失明（主干那笔是 squash 出来的新 sha），开放清单里又没有
  这条分支的 PR ⇒ 旧形状直接建出重复 PR #3641（内容与主干逐字一致、CI 判红、还得人工关）。
  修法：建 PR 前的落地判定补上**按 `head.ref` 认分支形**（`ship-scan.mjs` 的
  `findMergedPullForBranch`，与 sha 形同一份判据 —— closed 清单逐条认 `is_merged === true`，
  匹配键从 sha 换成 ref；`findLandedPull` 一并搬进 ship-scan 并把两档命中分开报 `kind`）。
  命中同样停、退 `6`（守卫类），话术念「这条分支已随 PR #N 落地 ⇒ 要接着改请开新分支」；
  `is_merged` 缺键的分支形按**弱证据**不拦、照常建 PR —— 与 sha 形「缺键退 5」刻意不同档，
  两种在读数上分得开（sha 相同是「这一笔已在主干」的强证据，ref 相同只是「这条分支的历史
  PR 合过」，缺读数拦下等于让一次平台键抖动静默挡住正常工作）。
  取数/判断的落点：两份文件（ship-core / ship-platform）当时都顶着 900 行硬闸，落地判定
  本就是「closed 清单怎么被读」的读者面 ⇒ 匹配器与判定一起归 `ship-scan.mjs`（其文件头
  那句「复用路径要命中号 + 三种未命中读数，落地判定只要命中号」的两半在同一份里了）。
