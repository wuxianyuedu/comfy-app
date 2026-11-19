## Fixed

**镜像格不再「探活空转」、推完按远端事实自证；读数档的红也进立案**（ISSUE #3252）：

- 现场（`cnb-ft3-1k6qfer4u`，sha `ae77db8a5`）：`GitHub master 镜像` 带 `--readout`，
  探活 `git ls-remote` 重试 6 次耗 201s、`Failed to connect to github.com port 443`，
  一次内容推送都没发起；脚本退 2 被 `--readout` 折成 0 ⇒ 平台那格绿、`push 失败立案`
  只数红格（`红格 0 个`）⇒ 镜像悄悄停在 `b85e6483e`，整跑却判绿。
- **去掉「先探活再推」双跳**：网络不通时 `git push` 自己的报错与 `ls-remote` 同一形，
  探活只是把同一次出网试两遍。现在第一刀就是 `HEAD:refs/heads/master` 推送，egress
  类才有界重试（4 分钟墙钟 / 至多 10 次 / 5→50s 退避，从第一刀起算）；实测
  `git push --force` 对不可达目标 21.6s 返回 `CONNECT tunnel failed`，不会比探活更久。
- **推成功后回读**：`scripts/ci-mirror-push-verify.mjs` 用 `git ls-remote` 读回
  `refs/heads/master`，要求逐字等于本次 HEAD；LFS 用 batch API 的 `download` 操作逐对象
  核对（`0/0` 也要念出来），不再只看命令退出码。
- **读数档的 `exit 2` 进立案**：`ci-pr-failure-issue.mjs` 在 push 档读回
  `[mirror-master] 结论：exit 1|2`，按事实立案 —— 平台那格仍绿（折位不折记账）。
- **每日漂移兜底**：`scripts/ci-mirror-drift.mjs` 在 daily 末尾匿名 `ls-remote` 对比
  CNB 与 GitHub 的 `refs/heads/master`，不等即建/追加 `[镜像漂移]` 单；读不到只退 2
  （带 `--allow-no-fact` 不判红），不把「没连上」当漂移。
- **两种出网形态的实测**：连接被拒型单次约 21.6s 返回 `CONNECT tunnel failed`
  （上一条那个数）；而黑洞型（`cnb-0bk-1k6qmljcs`，HEAD `b209aa05`）第一刀 `git push`
  一直挂到单次上限 240s 才被掐断、预算随这一刀耗尽（剩余 239.864s < 10s 下限），**没有
  进到第二次** —— 读数照实记 `推送重试预算用尽：已试 1 次、耗 240s` → `exit 2`，
  `push 失败立案` 随即按读数建单 #3316。有界（整档 ≤240s + 退避）但不保证一定发出第二次；
  要更多次，得把单次上限压到预算的几分之一。
- 读数：本机 151 用例通过，`tsc --noEmit` 与 `pnpm lint` 均 0。
