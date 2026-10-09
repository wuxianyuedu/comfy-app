## Fixed

- **Storybook 画布注入层的框架装不下内容，最后一张卡被切掉一截**（ISSUE #1381，规范 16 §16.2.3.13）。`StorybookFlowCanvas` 的框高是**一个常量**（`CANVAS_FRAME_CLASS` = `h-[560px]`），而节点渲染器的尺寸是**消费方**的事 —— 十行端点的 `PortDemoNode` 摆进 `twoNodes` / `fanOut` / `mixedKinds` 三档时比框高，钉住的视口把内容切掉：真浏览器量 `.react-flow__node` 下沿 vs 框下沿，`fanOut` 切 **151px**、`twoNodes` 切 **79px**、`mixedKinds` 切 **51px**（八张卡分三行，**整个第三行**在框外，而场景名与 `about` 一直在讲「八种业务节点混排」）。
  - 修法 = 给 `StorybookFlowCanvas` 加 **`fit`**（消费方显式声明）：传了就交回 React Flow 自己的 `fitView`（`ProjectCanvas` 的「适应视图」也是这套机制）把整场缩到框里，不传仍走场景钉住的 `viewport`。三档 story 加 `fit`。
  - **`fit` 是消费方的声明，不是场景的属性**：同一个 `twoNodes` 在十行卡下装不下、在 React Flow 默认外观（`Decorations` 的 `GridOff`）下装得下 —— 装不装得下取决于 `nodeTypes` 注入的渲染器，写进场景就会把 `GridOff` 一起缩走。
  - **`pinZoom` 标记反过来钉住另一半**：`zoomedIn` / `zoomedOut` / `dense` 三档被测的就是那个缩放，**不能**被 `fit` 缩走（缩走 = 看的不是那一档了）。两种口径在代码里是三元互斥，不并列传。
  - 不手写每档帧高（655 / 727 / 627px 是实测读数，写进代码就是第二个会漂的事实源），也不手搓缩放公式。

## Tests

- 新增 `tests/storybook-fit-viewport.test.ts`（5 条，进 `FIXED_STRUCTURAL_TESTS`）：**传了 `nodeTypes`（尺寸未知）的消费方，要么传 `fit`、要么用带 `pinZoom` 的场景**。按 **AST** 判（属性顺序 / 换行不固定，正则会在「属性写在另一行」时整片漏掉）；另有一条「解析器不是空转」的在场证明。四向变异实测全拦下：去掉 `fit` / `pinZoom` 场景被 `fit` / 删掉受控视口那条口径 / `fitView` 换成手搓 zoom。
  - 实测教训单独记着：`<X … />` 是 **`JsxSelfClosingElement`**、`<X …>…</X>` 才是 `JsxOpeningElement` —— 只看后者时本仓的用法全是自闭合，扫出来是**空集**（判据空转）。
- `tests/storybook-injection-layers.test.ts` 那条「视口是受控的」断言从 `viewport={scene.viewport}` 改成 `viewport: scene.viewport`（口径从 JSX 属性变成三元的一支），并补一句「`fit` 那条口径也要在场」。

## Docs

- 规范 16 新增 **§16.2.3.13**；`docs/guide-storybook.md` 的 React Flow 例子加 `fit`、坑位表补「框架装不下就传 `fit`」。
