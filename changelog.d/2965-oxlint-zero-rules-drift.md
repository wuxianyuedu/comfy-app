## Fixed

**顺手清掉「已清零 oxlint 规则集」闸拦下的 12 处主干回潮**（溯源：#3071 把 SAFETY 注释改成独行，
插进了 `// oxlint-disable-next-line eqeqeq` 与目标行之间，disable 注释只对**紧邻的下一行**生效，
8 处刻意的 `!= null`（同时判 null 与 undefined）于是暴露给 #3016 的零命中闸；另有
`scripts/ci-github-verdict-read.mjs` 新带入的 4 处）。修法不改任何运行语义：

- 8 处 eqeqeq：把 SAFETY 注释与 disable 注释**对调顺序**（SAFETY 在上、disable 紧邻代码行），
  与仓内既有的合格形态（如 `queue-status.server.ts`）一致；`!= null` 一个字没动。
- `ci-github-verdict-read.mjs`：`[length - 1]` 换 `.at(-1)`；`5_000` 按
  numeric-separators-style 默认（不足 5 位不分组）写成 `5000`；`else if (!summary.completed)`
  按「肯定侧在前」对调两个分支，分支体原样搬运。
