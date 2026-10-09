## Added

- **页面级像素基线补齐最后两档：xyflow 画布与弹窗/浮层尺寸**（ISSUE #1381）。此前
  `e2e/visual/` 只有登录页、首页、模型库空态三档，规范 11 §11.8 的「当前落点」表里
  「xyflow 画布」「弹窗/浮层尺寸」两格一直写着**待补**，而分工判据也只判前三档
  —— 也就是说那两行全靠人记得，没有任何东西守着。
  - `e2e/visual/canvas.visual.spec.ts`：`canvas-filled`（四张真节点 + 三条真连线 +
    真视口）与 `canvas-empty`（空画布引导卡，同时充当画布这一档的空态）。
  - `e2e/visual/overlay.visual.spec.ts`：`overlay-log-default` / `overlay-log-wide`
    ——同一浮层的默认档与加宽档，两档宽度由 `boundingBox()` 断言（ISSUE #720 的
    静默失效正是「加宽按了、宽度一个字没变」，只截图指不出是尺寸这件事）。

## Fixed

- **`tests/visual-storybook-division.test.ts` 的档位清单从三档补到五档**：新增
  「判过 React Flow 视口」与「量过浮层本体宽度」两条，并各带反向自证（写错正则时
  不会恒绿）。变异核过：删掉任一份新 spec，对应那条当场红。

## Docs

- 规范 11 §11.8：「当前落点」表两格从「待补」改成真落点，并补「两档的钉法」一节
  ——画布的视口要等 `fitView` 收敛（第一帧是过渡值）、边只在端口真的存在时才渲染
  （别的组合 React Flow 静默不画）；浮层那一档的被测对象是宽度而不是浮层里的内容
  （日志行逐帧在长，页脚那颗 `服务 <bootId>` 徽标逐次不同且变宽）。
- `docs/guide-storybook.md`「它不做什么」补上「那一侧五档齐了」；
  `docs/guides/PRODUCTION-GAPS.md` 的 F6 同步更新（连带把「三档」的旧口径改成五档）。
