## Fixed

- **`pnpm check:premerge` 不再静默吞掉拼错的旗标**（ISSUE #2764）：`AGENTS.md` 与 ship Skill
  三处把 `pnpm check:premerge --full` 写成「全套那一档」，而 `scripts/premerge-check.mjs`
  的 `parseArgs` 没有 else 分支——那一枚旗标既不生效也不报错，于是「我跑的是全套」这句话
  没有任何依据（同一档恰恰是被当作「本地全套凭证」用的）。现在：① 认不出的旗标**退 2 并点名**
  （与 `quality-gate.mjs` 的「未知门禁」同形，2 = 这一跳没有结论，不是「跑过了且绿」）；
  ② `--full` 落地为**默认档的显式写法**（行为与不给它逐字相同），`--full` 与 `--light`
  同时给也退 2；③ 顺手订正 `AGENTS.md` 那句「推送那一跳默认只复算本地档」——实测
  `.githooks/pre-push → premerge-proof.mjs` 跑的是不带 `--light` 的全套（同一句话在
  `scripts/base-check/hook-steps.mjs` 的头注里也错着，一并改成「默认全套、`--light` 才减档」）。
  回归在 `tests/premerge-check.test.ts` 的「旗标解析」一组三条。
