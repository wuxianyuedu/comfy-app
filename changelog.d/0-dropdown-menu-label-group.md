## Fixed

- **修复应用菜单控制台报错**：`TopBar` 的「应用」分组标题 `DropdownMenuLabel`（base-ui 的 `Menu.GroupLabel`）没有包在 `DropdownMenuGroup` 里，打开菜单即抛 `MenuGroupContext is missing`。补上 `DropdownMenuGroup` 包裹，与 `CanvasContextMenu` 的写法一致。
