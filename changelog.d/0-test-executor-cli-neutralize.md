## Fixed

- **`executor-cli.test.ts` 两条子图覆盖用例长期红（自漂移中和引入起）**：
  「提示词覆盖要写进内层 CLIPTextEncode」与「randomize 兜底生成的随机种子同样要
  落到内层 KSampler」断言的是 **wrapper（宿主）节点仍保留覆盖值**
  （`wrapper.widgets_values[0]` / `[6]`）。但 `applyRawOverrides` 末尾会跑
  `neutralizePromotedHostDrift`——它把宿主值折进内层后**就地清空宿主
  `widgets_values` 数组**（comfy-cli 展开子图读的是内层，清掉是为避开提升控件的
  槽位漂移回写）。于是宿主槽位读回 `undefined`，两条用例自该中和逻辑引入起就红
  （且不在 pre-commit 的组 C 子集里，一直没拦住）。

  改法：把断言对齐当前正确设计——**内层节点**拿到覆盖值/新随机种子（comfy-cli
  真正读的），并断言**宿主数组已被中和清空**（`length === 0`）。不放宽判据，反而
  把「宿主被中和」这一行为也钉进回归。纯测试改动，无生产代码变更。

## Notes

- 排查确认 `src/lib/comfyui/` 全量 34 个测试文件 522 用例现全绿，无其它同类陈旧断言。
