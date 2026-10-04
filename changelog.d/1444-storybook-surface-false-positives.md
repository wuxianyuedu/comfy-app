## Fixed

- **故事面判据「必填 props 的 args」在适配件上必然误报：全仓 6 处缺口逐份查完，没有一份是真缺口**（#1436 承接项，ISSUE #1444）。判据只统计 story 的 `args` 对象，于是两类正当写法被全判成缺口：
  - **在适配件里已经显式传了**：`<ViewTabStrip activeKey={…} onSelect={…} />`、`useFilePicker({ onPick: … })` —— 组件在画布上读得到值。连报错文案自己承诺的「在 `render` 里显式传也算」都没兑现。
  - **接口在出参方向**：`mediaDragSourceProps(): MediaDragSourceProps` 的必填成员 `draggable` / `onDragStart` 不是「要传进去的 props」，算成缺口等于逼人给组件塞三个它从不消费的死参数。
  - 修法两条：`assignedNamesIn()` 把「故事文件里任何赋值点（JSX 属性 / 对象字面量属性 / 解构绑定）」与 `args` 同等看待；`hasInputSideReference()` 只计入参方向（参数类型 / 变量声明类型）引用到的 `XProps`。**没有**去给那 6 份 story 补 `args` —— 补就得写死参数，那是拿假数据糊判决。`missingRequiredArgs` 签名不变，四个调用点零改动。
  - 回归：`tests/storybook-story-surface.test.ts` 新增 3 条（显式传 / hook 传 / 出参接口），并做变异验证 —— 撤掉任一条修正，对应用例即红。

## Changed

- **Tailwind canonical 候选清零**：`file-picker.stories.tsx` 的 `w-[30rem]` → `w-120`（= `calc(var(--spacing) * 120)`）、`media-drag-source.stories.tsx` 的 `w-[36rem]` → `w-xl`（= `var(--container-xl)`）。`node scripts/tw4-canonical-report.mjs` 故事文件归 0。
- 测试文件那 3 处候选**逐处判过、决定留**：`ViewContainer.test.tsx` 的 2 处 `max-w-[50rem]` 是「className 里另写 `max-w-*` 不盖档位」这条用例的负样本本体；`log-panel-layers.test.ts` 的 `z-[200]` 断言就是 `parseZClass("z-[200]") === null`，改成 canonical 会让用例变空谈。

## Docs

- 规范 §16.2.3.8 更新「③ 是单向的」与「必填项怎么读」两段：补上这轮「6 处误报 → 0」的收紧过程与两类根因，并记一句「误报比漏报难发现 —— 误报会让人照着错误的要求改代码」。
