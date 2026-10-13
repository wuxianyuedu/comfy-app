## Fixed

- **`MessageCenterPanel` 的时间列漏用了具名字号档**（`src/components/message-center/MessageCenterPanel.tsx`，
  契约 03 §Typography / `tests/design-md-contract-sync.test.ts`）：那一行写的是
  `text-[10px]`，而 `@theme` 里 `--text-3xs: 10px` 本来就有 —— 换成 `text-3xs`，
  **零视觉变化**（同一个 10px），只是把字面量收回档位。
- **这条不是本次改动引入的**：现场是提交被组 C 拦下（「调用点字面字号从 140 涨到 141」），
  而本次改动只碰 `scripts/` `tests/` `docs/`，没有一个字号字面量。按 §13.6.2 先复算基线：
  `node scripts/base-check.mjs pnpm exec vitest run tests/design-md-contract-sync.test.ts`
  ⇒ `baseline-red`，**本检出与 `origin/master` @ `1353e63a` 两侧同红**。
  出处是那笔提交自己带进来的那一行（`git show 1353e63a` 里唯一的 `+.*text-\[Npx\]`）。
  它是**挡所有人的那一类**（硬闸断言，不是棘轮基线红），所以照 base-check 给的出口就地修掉，
  单独一个 commit、单独这一条碎片，不登记 `KNOWN_FAILED_FILES`、不放宽判据、
  更不用 `--no-verify` 换一条干净历史。
