## Changed

- **`src/lib` 非空断言棘轮**扩到 **整个 src**（`scripts/check-non-null-assertions.cjs` v2）：
  lib 侧 PR-17 立基线 102 处 / 40 文件之后，components / app / server 三块仍是
  **盲区**——写视图侧的 `arr[i]!` 门不会响，等于给病灶留了一条漂移通道。
  `SCAN_DIR` 从 `src/lib` 升到 `src`，一次性把 3 个新盲区纳入：v2 首跑 `--report`
  报 **225 处 / 85 文件**（含 `use-settings-page.ts` 之类热区，与 lib 侧同机制、
  走每文件基线棘轮，只挡新增、允许下降）。
  `RULE_VERSION` 从 1 → 2（"量的定义"变了：旧基线 102 与新基线 225 不是同一个
  量），基线文件同步重写、`note` 与所有报错文案里的 `src/lib` 换成 `src`。
  `--update` 遇版本不一致**直接拒绝**，防「顺手放宽」后门——只有把脚本里的
  `RULE_VERSION` 常数与本次范围变化**共同评审**过才能重建基线，v1 → v2 就是
  这一条纪律的第一次执行。

## Added

- `tests/check-non-null-assertions.test.ts` 增一条用例：`v2 起扫描覆盖到
src/components / src/app / src/server`——写三个不同目录各一处 `!`，`--report`
  必须报 3 处、路径分别命中，锁死「扩范围」这件事**不回退**。
- `docs/standards/13-提交与-code-review.md` §13.5.6 段落重写：解释「为什么不
  直接开 eslint」与「为什么扫描范围要扩到整个 src」两件事，并说明 `RULE_VERSION`
  同时管**判据形态**与**扫描范围**这两类"量的定义变了"；pre-commit 清单第 28
  行的描述同步。`docs/generated/` 走 `pnpm doc:render` 重渲染。
