## Fixed

- 修主干遗留 8 处 `oxlint-disable-next-line eqeqeq` 失效（`src/lib/comfyui/` 5 个文件）。**这条不是本 PR（runs API 改造）引入的**：#3071 把 SAFETY 注释从同行改为独行，插进了 disable 注释与目标代码行之间，使 `oxlint-disable-next-line` 不再紧贴代码行而失效；CI「已清零 oxlint 规则集（41 条全仓 0 命中）」闸因此在全仓点出 eqeqeq 8 处命中。复算证据：`node scripts/base-check.mjs "已清零 oxlint 规则集（41 条全仓 0 命中）"` 在 master@083b1d2e0 上同样 12 处命中（baseline-red），其中 8 处在主干 `src/lib/comfyui/`。该闸是硬闸（红了所有人都提交不了），按 base-check 口径就地收掉：把 SAFETY 注释与 disable 注释交换顺序，恢复 disable 紧贴代码行；复跑 `node scripts/check-oxlint-zero-rules.mjs` 全仓 0 命中。
