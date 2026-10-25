## Fixed

**`PR 失败立案` 那一格在 PR 上从来没跑过 —— 两次合并键与一次非法 YAML 都在同一个落点上**
（ISSUE #2332 的收尾，PR #2335）。

- 症状：`cnb-dbu-1k5ohq6p4` / `cnb-2mc-1k5oi9uvh` 两次构建的阶段详情里，这一格都是
  `{"status": "skipped", "name": "PR 失败立案", "id": "stage-32"}` —— 它判的正是「前面那一格
  红了」，而它自己排在 `stages` 的最后一格；`stages` 里任一格非零 ⇒ 链停，后面每一格连读都
  没读过。`run: always()` 不是平台的配置键（是个普通脚本字段），`if: ${{ always() }}` 也不是
  `if` 的用法（那是一个 shell 脚本、退出码 0 才执行）—— 两种都没救回来。
- 修法：改用平台原生的 Pipeline 级 `endStages`（「无论 stages 是否成功都将执行」，
  `zh/build/grammar.md` §endStages），挂成独立锚点 `.pr-fail-stage` 由 `pull_request` 引用。
  不用 `failStages`：那一档只在红时跑，「这一格自己挂了」会一起消失 —— 而后者恰恰最该被看见。
- 同批修掉两处会让它**静默失效**的形态问题：**同一层写两个 `<<:` 是非法 YAML**
  （`Map keys must be unique`，两个键只有一个生效、配置看上去完全正常）⇒ 收成一个
  `- <<: [*common, *pr_fail_stage]`；形态判据的锚点引用正则跟着认流式写法（它问的是
  「有没有哪条流水线漏接 `*common`」，不是「这一行长什么样」）。
- 判据跟着改向、不是放宽：`tests/ci-pr-failure-issue.test.ts` 那两条从「它在 `.gates` 的
  最后一格 / 带 `run: always()`」改成「它在 `pull_request` 的 `endStages` 里、`*gates` 里没有它、
  锚点缩进在流水线项那一层」—— 缩进错一格在文本断言下是绿的，而它会变成一个谁也不认识的字段。
