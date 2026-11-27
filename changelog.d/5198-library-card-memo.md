## Changed

- **角色库 / 资产库列表卡片 memo 化，消除父渲染触发的全量重渲（ISSUE #5198）**：两库网格此前把未 memo 的 `CharacterCard` / `AssetCard` 交给 `items.map`，并在渲染期现造 `onCancelGeneration` / `onRemove` 回调、用 `Array.includes` 逐卡做 O(n) 选中判定——搜索打字、生成态轮询或选中切换任一触发都会把整个网格（角色默认 120、上限 500，资产同量级）全部重渲一遍（规范 14 C7）。本次同批收口：① 两张卡片改 `memo()` 包裹，删除 / 移动回调改收 id，父组件可直接透传稳定 handler；② controller 把 `openDetail` / `openRemove` 等回调收成 `useCallback`，取消回调只依赖稳定的 `action.run` 并用 ref 读最新列表，跨渲染引用不再失效；③ 角色选中态在 controller 里做成 `Set`，卡片用 `has(id)` 取代逐项 `includes`。回归用例钉住卡片 memo 包裹、回调稳定性与集合语义。
