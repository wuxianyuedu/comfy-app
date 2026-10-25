## Fixed

`prettier 格式` 的自动修复在 `pull_request` 事件上永远推不出去（ISSUE #2362 / #2365）：
PR 类事件的 `CNB_TOKEN` 恒只有 `repo-code:r`（平台按「事件 + ref」给权限，整族在
「不可信事件」名单里，没有 YAML 开关可翻；OIDC 也不给 PR 事件签发 `id_token`）。
红路径实测走到最后一格才撞上：判红 → 就地修 → 复判全绿 → 源分支反查正确 →
plumbing 建好修复提交 → **push 被拒**。

出路是换执行口而不是要权限：`api_trigger` 是可信事件、令牌 `rw`。三处同批：

- `.cnb.yml` 新增 `api_trigger_formatfix` 事件键（独占一把 `*lock_formatfix`，
  `stages` 是一份新清单 ⇒ 按 R3 不许与单跑三档共用锁）；
- `ci-format-fixup.mjs` 加 `--delegate` / `--ref` / `--sha`：PR 事件那一格只判不推、
  把「哪条分支 / 哪个 sha」交给 `cnb build start-build`，被委托那一格直推；
- 幂等闸是传进来的 `--sha` 与 `git ls-remote` 实时头相等（不是 `CNB_COMMIT`——
  它是触发那一刻的快照，会一直对得上），push 带 `--force-with-lease` 钉住期望头。

四道护栏（master 恒拒 / bot 身份可辨 / 复判全绿才推 / 防连环）一条未动；
「这一格看见的绿不代表已修好」写死在话术里，别把「委托发出去了」读成结论。
