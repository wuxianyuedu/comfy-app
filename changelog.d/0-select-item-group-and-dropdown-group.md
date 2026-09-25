## Fixed

- **`WorkshopAside.tsx` / `LogPanelOriginSelect.tsx`：`<SelectItem>` 用 `<SelectGroup>` 包起来**：
  shadcn `composition.md`「Items always inside their Group」。项目里
  `~/components/ui/select` 已导出 `SelectGroup`（Base UI 版），但两处 `<SelectContent>`
  里的 `<SelectItem>` 直接 map、缺外层 Group——Base UI 的 Select Popup 内部
  按 Group 建立 listbox / option 关系与键盘导航（`role="group"` + `aria-labelledby`
  在 Group 上、`role="option"` 在 Item 上）。缺 Group 时视觉与点选都正常，但
  **读屏器播报里少一层"这一组是什么"**（选项集之间的分组语义丢）。
- **`CanvasContextMenu.tsx`：首个"测试节点"下拉项补进 `<DropdownMenuGroup>`**：
  同一条 composition 规则；文件里其它 `<DropdownMenuItem>` 都已经在 Group
  内（"创建节点"、"删除节点"分组都齐全），只有首个测试项落在了 Group
  外面。
