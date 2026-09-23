## Fixed

- **修复命令面板打开即崩**：`CommandDialog` 漏了 `<Command>` 这层祖先，导致 cmdk 的 `useCmdk` 在打开面板时取 `store.subscribe` 报 `Cannot read properties of undefined (reading 'subscribe')`（面板关闭时基元不渲染，故平时不暴露）。补回 `<Command>` 包裹，并加 `src/components/ui/command.test.tsx` 锁定回归（去掉包裹即复现原报错）。
