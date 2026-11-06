## Changed

- **B4 子批 3：55 份 / 181 处 `eslint/prefer-named-capture-group` 清零**（判决面删掉这 55 份路径行）。
  其中命名组 144 处（含消费点同步：`m[1]` → `m.groups.<name>`、`"$1"` → `"$<name>"`、
  `\1` → `\k<name>`），非捕获组 37 处（组值本就没人读，改 `(?:...)` 即可）。
- 改动集中在 `scripts/`（ship / premerge / tw4 / ui-primitives 系列）与
  `src/components/studio/`（日志解析、workflow-io、CSS 颜色 token）及其用例；
  正则匹配语义未变，只把「按下标取值」换成「按名取值」。
- 台账：B4 行改「清账中（子批1–3：165 份 / 554 处已清）」。
- **顺带修红**：`tests/check-reformat-only.test.ts` 的「汇总分母取 landed」那条把
  `CNB_COMMIT` 写进 `process.env`，而门禁夹具的沙箱**先剥 `CNB_*`、后落 `extra`**，
  判据读不到 ⇒ 该用例在 Linux 上必红（本文件在 Windows 整组跳过，本地看不出）。
  改为经 `repo.run(..., { env })` 显式注入，与同文件另两条平台形态用例同形。
- 清账总账：#3181（本批挂 `Refs`）。
