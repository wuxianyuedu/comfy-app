## Fixed

- `useFilePicker` 的隐藏 `<input type="file">` 身份不稳定（#3692）：`Input` 在
  `useMemo` 里闭包捕获 `onPick`，而调用方的 `onPick` 几乎总是内联箭头 —— deps
  每渲染必变，memo 形同虚设，input 随父组件每次重渲染被卸载重挂。重挂窗口里
  落下的文件选择事件会打在已脱离 DOM 的旧节点上（诊断 #3657 时探针实测捕获过
  脱离 DOM 的幽灵 input）。
- 出口改形：`useFilePicker` 返回**现成的 `inputProps`**，调用点渲染
  `<FilePicker {...picker.inputProps} />` —— `FilePicker` 是模块级组件、身份
  天然恒定，重渲染只更新 props、不重挂；回调也不再有时效窗口。全部 11 处
  调用点（含两处经 hook 中转返回组件的）同批迁移。
