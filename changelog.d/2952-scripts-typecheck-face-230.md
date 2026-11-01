## Fixed

脚本档类型检查账本的 `face` 落后于判决面：`scripts/.scripts-typecheck-baseline.json`
写着 229，而 `tsconfig.scripts.json` 展开是 230 —— `#2948` 新增
`scripts/suspended-gate-tests.mjs` 时没人记账。

按既有出口 `node scripts/check-scripts-typecheck.cjs --update` 收紧到 230，
`total` 仍为 0（存量报错一处也没多）。账本不跟随判决面自动更新是这套机制的第二形态，
本单只修这一次的数，不新增判据。

#2952
