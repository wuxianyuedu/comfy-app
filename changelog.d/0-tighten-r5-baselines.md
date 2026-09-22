## Changed

- **收紧 R5 / function-length / non-null 三条基线到"当下真实值"**：本轮类型安全
  审查里 6 个 900+ 行文件已陆续拆包（`workflow-detail-raw` PR-14、
  `workflow-subgraph-parse` PR-15、`workflow-param-mapping` PR-16、`LogPanel`
  PR-29、`workflow-io` PR-30、`log-store` PR-28），主文件都远低于 900 行；
  但 `.file-size-baseline.json` / `.function-length-baseline.json` /
  `.non-null-assertions-baseline.json` 的旧记录还停在拆包之前的数字上——棘轮
  只挡**继续变大**、允许下降，不主动 `--update` 就等于"基线虚高"：下一个改同
  一文件的人偷偷加几十行也不会被拦。

  三条基线一次收紧：
  · `check-file-structure.cjs --strict --update`：11 个超限文件基线 → **1 个**
  （剩 `use-settings-page.ts` 1079 行，PR-27 拆到这一步、下一轮 sub-hook
  抽取前不动）；`baselineRev` 更新到当前 HEAD `6e0b79ff`。
  · `check-non-null-assertions.cjs --update`：src 生产 `!` 从 222 → **221**
  （PR-30 拆包时把 8 处 `!` 从 workflow-io.ts 挪到 groups.ts，其中 1 处
  顺带改成了 `??`）。
  · `check-function-length.cjs --update`：>400 行函数从 19 → **18**
  （PR-16 拆包时 workflow-param-mapping 里一个贴阈值的函数降到线下）。

  顺带修一处 PR-27 遗留：`use-settings-page.ts` 的 R5 基线我按 `wc -l` 设的
  1078，但 `check-file-structure` 按 `baselineRev` 同口径重数得 1079（多算
  1 行），`--update` 判定「文件变大、拒绝放宽」。修正基线到 1079，让
  `--update` 通过。**只改数字、判据完全没变**（`RULE_VERSION` 保持），符合
  「棘轮只降不升」的语义——PR-27 那一步真实拆了 253 行、1078 vs 1079 只是
  计数方法的 1 行 off-by-one。
