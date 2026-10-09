## Added

- **「双亲在、内容丢了一侧」有了提交前档**（ISSUE #1618，阶段一 1-2）。
  `check-merge-parents.mjs`（#1594）判的是合并的**形态**，而实测丢东西的那两次
  （`ad81a912` / `bdabd26f`）**形态全对** —— 双亲在、消息也像样，只是某个文件
  **整份取了非 HEAD 那一侧**。新增 `scripts/check-pending-merge-loss.mjs`，与形态档
  **同一个入口** `.githooks/prepare-commit-msg`：合并进行中（`MERGE_HEAD` 在场、
  结果在索引里）时当场判，命中即阻断并指名叫哪几份、给出口。
  - **三条合起来才算命中**（缺一条都会误报）：结果版（索引）≠ `HEAD` 版；
    结果版 == `MERGE_HEAD` 侧历史上那个文件出现过的某一版；且 `HEAD` 侧在该文件上
    确有还没被取代的改动（`HEAD` 版 ≠ merge-base 版）。「只有对方动过那个文件」
    是正当的，被第 3 条排除。
  - **与 1-1 共用内核**：抽 `scripts/merged-side-loss-core.mjs`（`findEarlierVersion`
    + 生成物前缀），两档问的是同一件事（「结果里这一版是不是等于更早的某一版」），
    取证只有一份实现（§12.12 的字面孪生要拦的正是这份）。`check-merged-side-loss.mjs`
    一并改走内核，行为不变（立案现场仍 86 份）。
  - **边界全取保守放行**：`source=commit`（`--amend` / cherry-pick / revert）→ 放行；
    **非合并提交 → 零输出、零耗时**（普通提交每次都会走到它）；浅克隆 / 取不到
    merge-base → 放行并说明；生成物（`docs/api/**`、`docs/generated/**`）→ 不判。
- 规则自测 `tests/pending-merge-loss-gate.test.ts`（10 格，真仓库跑合并）：
  整份取一侧 → 拦并指名 / 正确保留两侧 → 放行 / 非合并 → 零输出 / `--amend` → 放行 /
  **只有对方动过那个文件 → 放行**（误报防线）/ 生成物 → 不报 / 非 git → 放行 /
  混合 → 只报该报的那一份，另加两条钩子接线与「与 1-1 共用内核」。
  **两条变异各自被对应用例抓住**：核心检测恒假 → ①⑧ 红；恒真 → ②③⑤⑥ 红；复位全绿。

## Changed

- `.githooks/prepare-commit-msg` 由单条判据扩成两条（一前一后）：形态档
  `check-merge-parents.mjs` 之后接内容档 `check-pending-merge-loss.mjs`。
