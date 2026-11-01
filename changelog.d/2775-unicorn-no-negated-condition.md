## Changed

oxlint `unicorn/no-negated-condition` 全仓清零（#2775）：32 处 / 24 份。换法与同系列的 `eslint/no-negated-condition` 同形 —— 条件取反、两臂互换，没有一处改动求值顺序。

其中 3 处来自合并 `origin/master` 之后新落进 `src/components/workshop/**` 的 lora 强度代码（`use-workshop-generation.ts` / `CharacterDesigner.tsx` / `ShotStudio.tsx`），同批清掉：`loraStrength !== undefined ? {…} : {}` 与 `loraStrength !== undefined ? String(…) : "1"` 反向成 `=== undefined ? {} : {…}` / `=== undefined ? "1" : String(…)`。

这批的形态集中在两类「哨兵下标」：`idx !== -1 ? a[idx + 1] : 默认` 与 `if (idx === -1) {A} else {B}`，互换后读作 `idx === -1 ? 默认 : a[idx + 1]`。逐行核对 35 个改动行：新增行里的 `=== -1` / `=== ""` 在每个 hunk 内都能对上一处 `!==` 原文，`&&` / `||` 互换 0 处。

范围提醒：`scripts/**`、`tools/**` 不在 oxfmt 的判据面（`check-format.cjs` 只判 `src/**` + `.storybook/**`），所以只对这批里落在 `src/**` 的那 7 份跑格式化，脚本侧按 fixer 产物原样提交 —— 整批跑 oxfmt 会把别人的模板字面量缩进一起重排（实测 diff 从 35/35 涨到 82/85）。

整条规则至此全仓 0 命中（2415 份扫描）。
