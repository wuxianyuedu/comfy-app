## Fixed

- **画布网格层在平移时每帧重渲染（`src/components/studio/WorkflowCanvasDecorations.tsx`）**：
  `CanvasGrid` 的 `useStore` 选择器返回 `{ minorAlpha, showFineLines }` 这个**新对象**，
  `Object.is` 永不相等 —— 选择器本体在 store 每次更新时都要跑，而平移每帧都会换一份
  `transform`，于是两层 `<Background>` 跟着每帧重渲染。改为只订阅标量 `transform[2]`
  （zoom），淡入曲线在渲染里算：平移不改 zoom，网格层因此不再参与每帧重渲染。
