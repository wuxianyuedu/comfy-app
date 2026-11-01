## Fixed

- **脚本档类型检查账本的 `face` 落后于判决面**（ISSUE #2952）：`#2866` 新增
  `scripts/suspended-gate-tests.mjs` 之后 `tsconfig.scripts.json` 展开 230 份，账上还写着 228，
  于是 `固定结构用例` 那一格的「面 ⇄ 账不许两份口径」当场红、整跑 exit 1，后面 18 格全 `skipped`。
  修法是把账收紧到实测（`node scripts/check-scripts-typecheck.cjs --update`）：
  `face` 228 → 230，`total` 仍为 0（本档是空账，任何一格出现都算新增 ⇒ 红）。
  **账本不会跟着面自己走** —— 新增 / 删除 `scripts/**/*.mjs` 的改动同批要跑一次 `--update`，
  否则红会落在下一个动脚本的人身上，而他那次改动与这件事毫无关系。
