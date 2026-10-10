## Fixed

- **`docs/api/**` 的 4 份产物与源不一致（逐字机读事实，不是本 PR 引入的）**：`pnpm exec typedoc` 重生成后，`docs/api/interfaces/` 下 4 份 HTML 落到与源一致。复算证据：在 **干净的上游提交 `origin/master` @ `2fc7bef8`** 上跑 `node scripts/check-docs-api.cjs`，同样报「落后于源（4）」—— 这 4 份不是本 PR 引入的，而是**早就漂着**、只因为本 PR 碰了 `package.json`（typedoc 输入面之一）才被 `--staged` 触发面照出来（ISSUE #1329 那道判据的口径）。
  - 差异本身是**纯 union 顺序归一**（`"online" | "local"` → `"local" | "online"`），TypeScript 版本改变产物形态的产物 —— 零业务语义（同 §13.6.2 那条「允许顺手修别线的一行」的代价不对称：不修就没人能改 `package.json`）。
  - 为什么单列一个 commit + 单独一条碎片：§13.6.2 第 3 步 —— 「硬闸红随本批一起修时，**单独一个 commit + 单独一条 `changelog.d/` 碎片**，碎片里写明『这条不是本 PR 引入的』＋复算证据 ＋ 为什么顺手收掉」，混进功能提交会让人以为那是本次改动的附带调整。
