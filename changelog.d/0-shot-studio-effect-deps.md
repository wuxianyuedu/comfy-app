## Fixed

- **分镜工作室的自动预填 effect 每次父级渲染都重跑（`src/components/workshop/ShotStudio.tsx`）**：
  依赖数组里有 `scenes` / `characters` / `styles` 三个父级传入的数组（每次渲染都可能是
  新引用），于是父级任何一次重渲染都会触发一遍 O(N) 的 `some` 扫描。预填逻辑抽成
  `useAutoFillPrompts`（顺带让 `ShotStudio` 回到函数长度预算内）：三个数组走 ref
  （每次渲染后同步、只在真正要填的那一次读取），触发源收窄到 `shots` + `onShotsChange`
  （setState，引用稳定）——填充行为不变。
