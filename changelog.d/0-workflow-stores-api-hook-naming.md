## Fixed

- **`WorkflowStores` 的 store-api 访问器改 `use*` 前缀，消除 3 处 `react-hooks/rules-of-hooks` 抑制**：`getIOEditApi` / `getRgthreeApi` / `getViewerApi` 内部调 `useContext(WFStoresContext)`、本质是 hook，却因命名不带 `use` 前缀而靠文件内三条 `// eslint-disable-next-line react-hooks/rules-of-hooks -- 设计如此` 豁免。这削弱了编译期安全网——将来若有人在事件处理器里误调，linter 因函数名不是 hook 不会拦。改名 `useIOEditApi` / `useRgthreeApi` / `useViewerApi` 后，linter 真正对其调用位置强制 rules-of-hooks（全部调用点都在组件渲染期，改后 eslint 无错，即证明合法），三条抑制删除。
