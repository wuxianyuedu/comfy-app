## Fixed

- **`ui/json-viewer.tsx` 手拼 `window.addEventListener("keydown", onKey)` 迁 `useHotkey`**：
  此前 `useEffect` 里自己挂全局 keydown、判 `metaKey || ctrlKey` 加 `f` 键。
  修饰键跨平台是对的，但**不过滤输入焦点**：用户在别的输入框里打 ⌘F 也会被
  本组件抢走，而它只是这一处 JSON 气泡的查找。改用仓库唯一出口
  `useHotkey({ key: "f", mod: true }, focusSearch)` 之后，`filterInput`
  默认 `true`、命中时默认 `preventDefault`，两处一并解决。

## Changed

- **P20 判据的 `ui/` 层豁免面收窄**（`scripts/check-ui-primitives.cjs`）：
  原来整片 `ui/` 走 `EXEMPT_FILE_PATTERNS` 放行，理由是"`ui/` 基元自身实现
  （`use-hotkey` 就要挂 keydown）"。但那是给基元实现开的口子、不是给业务
  组件绕开这个基元的 —— 而 `json-viewer.tsx` 正好钻了这个洞。改成只放行
  `src/components/ui/use-hotkey.ts` 一个文件。若后续在其它基元里出现"这个
  基元自身就该挂 keydown"的正当需求，按文件逐个补进来并写明理由。
  回归：`pnpm exec node scripts/check-ui-primitives.cjs` 在 `json-viewer` 迁完
  后仍 0 处、豁免面收窄未引入新红。
