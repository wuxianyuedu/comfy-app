## Fixed

- **设置页「加载设置失败」视图把 `<Button>` 塞进了 `Disclosure` 的触发插槽，浏览器报 `<button>` 不能是 `<button>` 的后代（水合错误）**：基元的 trigger 本身就是 `<button>`，往里再套一层 `<Button>` 在 HTML 里非法。现在触发插槽只放内容（`ChevronRight` + 文案），开关自己的外观直接穿 `buttonVariants({ variant: "outline" })`；同时新增 `rootClassName`（整排的排布容器），设置页与 `NodesTab` 分组头的「重试 / 完整错误 / 复制」「解析本目录」恢复成一行（此前它们各自独占一行），展开面板靠 `basis-full` 独占一行。
