## Fixed

- **依赖审计「有最小可达修复版」的那批 moderate 全部升掉，并把口径更新一版（ISSUE #1623，阶段二 2-4）。** 此前 `pnpm audit` 的口径是「只拦 high/critical」，`moderate` / `low` 那 15 条一律不纳入判据 —— 理由是「台账噪声会淹没真新增」。实测把它们分开之后，这条理由站不住：**9 条 moderate 全部有最小可达修复版**，也就是说那条口径此前挡住的不是「修不了的噪声」，是「还没人去修的那批」。修完 `pnpm audit` 的 moderate 命中 **9 → 0**（剩 `1 low` + `1 high`，两条都无修复版、已在台账里各写了 reason）。
  - **五条新 override**（`pnpm-workspace.yaml`）：`markdown-it@14` `14.3.0 → 14.3.1`、`ip-address@10` `10.7.0 → 10.7.1`、`hono@4` `4.13.5 → 4.13.7`、`postcss-selector-parser@7` `7.1.5 → 7.1.6`、`fast-copy@4` `4.0.4 → 4.1.0`。全部是**传递依赖**（没有一处是我们直接 import 的 API），全部是**同 major 补丁版**，各取 registry 给的 `patched_versions` 最小值 —— 不写成 `^x`，range 会让下一次 install 悄悄跳到没人复核过的新版本。
  - **三条既有 override 被新 advisory 追上，一并提到新 patched**：`fast-uri@3` `3.1.7 → 3.1.8`、`brace-expansion@1` `1.1.20 → 1.1.21`、`brace-expansion@5` `5.0.11 → 5.0.12`。这三条**本来就是 #1331 那一轮填掉的**，而 advisory 库后来把同一个库的**另一条** advisory 的 patched 提到更高 ⇒「已修过」的 override 反而落回受影响区间。**修完不是终点**：`pnpm audit` 每次跑都会重新问一遍 —— 这正是它不进钩子（网络请求）却必须在 `pnpm check:all` 里跑的现实理由。
  - **口径更新落在 §13.5.9**（#1623 验收第 6 条：别只把包升掉、口径一字不动）。那句「15 条不纳入判据」现在写明管的是**真的修不了的那一类**，并记下那条更普遍的教训：**`overrides` 的版本号会被新 advisory 追上**，以及「噪声的来源不是严重级，是『登记了却没人写为什么修不了』」。
  - 登记面：不需要动 `scripts/.dependency-audit-baseline.json`（那批 moderate 此前根本没进台账，`RULE_VERSION` / `BLOCKED_SEVERITIES` 口径一字未变 —— 本笔升级的是**存量依赖**，不是判据的拦截面）。
