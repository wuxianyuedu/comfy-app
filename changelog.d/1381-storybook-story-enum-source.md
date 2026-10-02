## Added

- 故事文件的**枚举来源**门禁 `scripts/storybook-check.mjs`（ISSUE #1381，规范 16
  §16.2.3.4）。`cva()` 返回的是一个 `(props?) => string` 的**函数**，`.variants` 只
  活在 TS 泛型里 —— 写成 `Object.keys(buttonVariants.variants.variant)` 时 tsc 会红，
  而 Storybook 在**加载期**抛 `Cannot read properties of undefined`，表现是
  「侧栏里列着这个组件的故事、画布上一片空白」，与「这个 story 挂了」的直觉完全
  对不上（首轮的 3 份 story 就是这么写的，靠逐 story 截图核出来的）。
  判据四条，AST 判、不看正则，所以注释里写这句讲规则本身**不算违规**：
  ① 没有 story 从 cva 的返回值上取变体表（基底按 `cva` 的**绑定名**判、也认 import
  进来的名字 —— 改名绕不过去，而「import 组件的变体表再点 `.variants`」正是踩坑原形态）；
  ② `argTypes` 的 `options` 指向的清单真的存在（拼错名 = 下拉空着，Storybook 不报错）；
  ③ 组件的每个变体轴在故事里都有候选清单（整条轴漏掉 = 那一档没人验）；
  ④ 手写清单覆盖该轴的每一档，且轴挂在从 props 派生的类型上。
  三处落点共用**同一份** `scripts/storybook-checks/cva-variant-source.mjs`
  （用例 + 门禁脚本都调它，不写第二份实现）：`tests/storybook-cva-variant-source.test.ts`
  进 `FIXED_STRUCTURAL_TESTS`，`scripts/storybook-check.mjs` 进 pre-commit 的 D 组与
  `pnpm check:all` 的 `storybook` 档（两侧即 `quality-gate.mjs` 的 `GATES` 与
  `quality-gate.ps1` 的 `$Blocks` / `-Mode` 单选值），并登记 launch-and-build §9.5
  跨平台动作对照表。脚本门禁四条方向的自测在 `tests/storybook-check-script.test.ts`。

## Fixed

- **`button.stories.tsx` 的尺寸清单少列了两档（ISSUE #1381）**：`SIZES` 只写了
  `xs / sm / default / lg / icon / icon-xs`，而 `buttonVariants` 的 `size` 轴有 8 档 ——
  `icon-sm` 与 `icon-lg` 从来没在故事里出现过。它们不是没人用：全库 **46 处**
  `size="icon-sm" | size="icon-lg"`（`dialog` / `sheet` / `sidebar` / 设置页各弹窗 /
  画布节点 / 工作流库…）。这正是「枚举值必须手写一份」的必然代价，也是上面那条
  判据存在的理由 —— 它把代价从「静默漏掉」变成「提交时报出来」。两档补齐后，
  变体矩阵页上终于能一眼看到这两档的形态。
