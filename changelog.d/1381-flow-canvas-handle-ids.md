## Fixed

- **Storybook「画布层」注入的四个场景在画布上一条连线都没画出来**（ISSUE #1381）。
  `.storybook/flow-canvas.tsx` 的 `twoNodes` / `fanOut` / `mixedKinds` 三档一直把边的
  `sourceHandle` / `targetHandle` 写成 `"1:model"` / `"2:images"` 这种**「看着很像」的
  短序号** —— 而真画布上两套 handle id 口径各管一侧（`FlowNodePinRows.tsx` 与
  `WorkflowNode.tsx`）：**输出端是 `` `out:${name}` ``**（常量
  `OUTPUT_PORT_HANDLE_PREFIX`）、**输入端是 `ioKey`**。第三种形状两侧都不匹配，
  于是 React Flow **静默丢弃整条边** —— 不报错、控制台干净、`tsc` / `eslint` / 构建 /
  既有门禁全绿，画布只是少几条线。

  后果最直白的是 `fanOut`：它的场景名与 `about` 一直在说「一个源节点扇出三条连线」，
  而画布上四张卡片各自孤立、三条线一条都不在（真浏览器逐 story 数 DOM 上的
  `.react-flow__edge` 量到 `0`，修后 `3`）。`twoNodes` 与 `mixedKinds` 同因，
  同一个探针分别量到 `0 → 1` / `0 → 2`。

  **修法不是改个名字**：目标节点的渲染器得先按真口径挂端口（输入 `model` / `vae` /
  `clip` / `images` / `text`，输出对应的 `out:*`），场景里的边才谈得上连对；
  同批把三档场景的节点间距与视口按新卡高重排，并订正 `fanOut` / `twoNodes` 的
  注释（原文里那句「端点 id 形如 `"1:images"`」正是这处缺陷的写法来源）。

  `dense` 那一档**刻意改成不放边**：它摆的是装饰层（网格 / 标尺 / 缩放条），
  消费方 `WorkflowCanvasDecorations.stories.tsx` 不传 `nodeTypes`、节点走 React Flow
  默认外观 —— 边只会引用一个本档谁也不挂的 handle，留着就是「场景说有连线、
  画布上没有」的那种假形态。

## Changed

- **`tests/storybook-injection-layers.test.ts` 的端口判据换成「两侧现算交集」**。
  上一条版本按**一张手写的真端口表**判（只认 `output` / `inputImage` 那对条件端口）——
  它拦住了 `filledProject` 那次「把边连到 `picture` 才有的端口上」，却**完整漏掉**
  `flow-canvas.tsx` 这三档，因为后者的 handle 形状根本不在那张表的取值域里。
  **把一张手写的端口表当事实源，就是这次漏掉一半的原因。**

  现在改成问两侧各自的**事实**：场景侧取 `flow-canvas.tsx` 里每条边声明的 handle，
  渲染器侧取 `WorkflowPortHandle.stories.tsx` 的 `PortDemoNode` 实际挂的 `<PortHandle id>`
  （锚在它的 `rows` 上取，取整份文件会把画布**外**那一档的清单也算进来）；
  两侧必须对得上，且**都得非空**（空集会让 `every` 恒真 = 判据空转）。
  输出端前缀取自真出处 `OUTPUT_PORT_HANDLE_PREFIX`，不另抄字面量。

  变异三向实测全拦下：输出端写回旧形状 / 渲染器少挂一个端口 / 前缀常量改掉 ——
  三条都当场红，复位全绿。
