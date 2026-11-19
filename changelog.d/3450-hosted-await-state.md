## Fixed

- **给休眠的「等托管机」回退档写明当前状态，不再看起来像在跑（ISSUE #3450）**：#3418 / #3426 把镜像推送挪到平台池后，`--await-hosted` 旗标、`scripts/ci-mirror-hosted-await.mjs` 与 `HOSTED_AWAIT_*` 常量仍在树里，而 `ci-mirror-hosted-await.mjs` 的文件头从头到尾用现在时写「本模块让自托管主列那一格在推送之前先问一句」，没有一句说明它当前不在跑 —— 读这条链的人会误判 CI 里还有一条托管机影子流水线。
- **零活调用点读数**：剥掉整行注释后，`.cnb.yml` 的活 `script:` 行零命中 `--await-hosted`；含该旗标的只有 `1693` / `1696` 两行**停用注释**；PR / push 两条正式出口（`2363` / `2423`）都不带它；脚本侧只有 CLI 解析到旗标时才把 `awaitHosted` 置真；测试侧仍有 10 处消费（`tests/ci-github-mirror-push.test.ts` 的「等托管机」组与 `excerptFailureText` 用例）。
- **裁决为保留（§12.15 第二条「已有明确落地时机」）**：`docs/standards/13-提交与-code-review.md` §13.5.33.2 的回退三步明写「完整留在盘上，就是为这一跳准备的」，`changelog.d/3418-selfhosted-mirror-retire.md` 同口径，`.cnb.yml:1645-1704` 的停用注释块还逐字留着恢复要用的 `script:` 原文。删掉会把回退路径连同可复制的接线图一起拿走，所以按 #3450 期望 3 走保留档，不按期望 2 删除。
- 改法：`ci-mirror-hosted-await.mjs` 文件头新增「当前状态：回退档，没有活调用点」一段（零活调用点、保留理由、重新接线位置、下面各节描述的是接线后的形态）；`ci-github-mirror-push.mjs` 的用法示例在 `--await-hosted` 那行点明状态并指向模块头；§13.5.33.2 回退段补一句「没有活调用点、是休眠实现」，同批重生成 `docs/generated/13-提交与-code-review.md` 镜像。
- **边界**：纯注释 / 文档口径，零行为变化 —— 不删旗标、模块、预算常量、`.cnb.yml` 停用原文与对应用例，不动平台池出口、`renderMirrorSummary`、三态退码与 egress 判据；不与 #3397 的选型口径混在一起。
