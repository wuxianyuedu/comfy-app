## Changed

- **`components/workshop/` 目录 7 处 raw `<input>` / `<textarea>` 迁到
  shadcn 基元**（P68/P69 治理 · workshop 域，PR #930 之后按域分片治理的
  第一片）：
  - **P68 · 4 处 `<textarea>` → `<Textarea>`**：
    - `AgentOverlay.tsx:213` 聊天输入（`ref` + 手写 `scrollHeight` 自适应
      - `readTextInput` + `enterCommit` 全保留；`className` 加
        `field-sizing-normal` 关掉 shadcn Textarea 默认的 field-sizing-content
        自动撑高、`min-h-0 flex-1` 由 flex 布局管；焦点档从
        `focus:border-violet-500/40` 换成 `focus-visible:border-primary
focus-visible:ring-primary/30`，与整站焦点档一致、消掉 Chrome UA
        ring 叠加）
    - `ScriptMarkdownEditor.parts.tsx:273` 剧本主体（`ref` + selection
      跟踪 + `simpleKeyHandler(["Tab"])` 缩进 + `tabSize: 2` 全保留；
      `field-sizing-normal` + `border-0` + `rounded-none` 让全屏编辑器
      与父容器融合、无 shadcn 默认的圆角边框；`focus-visible:ring-0`
      关掉焦点环（编辑器整体聚焦、不需要控件级 ring））
    - `ShotStudio.tsx:385` 生图提示词编辑（`rows={2}` 固定行高 +
      `field-sizing-normal` 关掉自动撑高）
    - `StoryboardPlanner.parts.tsx:132` 画面描述编辑（同上 + `mt-2`
      保留与上一行的间距）
  - **P68 · 2 处 `<input type="number">` → `<Input>`**：
    - `FinalComposer.tsx:319` 镜头时长（`w-14` 紧凑档 + `clamp` 兜底
      保留；`h-auto py-1` 让 py 决定高度、覆盖 shadcn 默认 `h-8`）
    - `VideoStudio.parts.tsx:244` 视频时长（同上 + `py-0.5 text-[11px]`
      更紧凑档）
  - **P69 · 1 处 `<input type="checkbox">` → `<Checkbox>`**：
    - `mode-contract/dialog/ModeContractEditorView.tsx:188` 必备口
      勾选（`onCheckedChange` 签名 `(checked, event) => void`，本处不
      关心值、直接 `toggleRequired(input)`；`className="size-3"` 覆盖
      shadcn Checkbox 默认 `size-4`，与旧 `h-3 w-3` 一致；`accent-primary`
      浏览器原生着色档消失，改走 `data-checked:bg-primary` 与整站一致）

- **`scripts/.ui-primitives-baseline.json` 收紧**：P68 判据 13 → 7 处、
  P69 判据 6 → 5 处，合计 19 → **12**。剩 12 处全在 `studio/` 域
  （P68 7 · P69 5），下一 PR 治理。
