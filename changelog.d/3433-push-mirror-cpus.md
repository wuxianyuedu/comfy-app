## Changed

- CI：`push` 档的平台池镜像出口「GitHub master 镜像（平台池）」显式取 `runner.cpus: 1`（此前吃平台池缺省 8 核）。它与 PR 出口是同一脚本（`ci-github-mirror-push.mjs --master`）、同一份网络 IO 动作，#3429 的四档实测（1 / 2 / 4 / 8 核格耗时全部重叠、egress 主导、无核数敏感度）直接适用 ⇒ 核时计费（核数 × 时长）省 7/8，墙钟不变。验收只认合并后下一次 push 派发的逐格原值（push 档不在 PR 上跑）。