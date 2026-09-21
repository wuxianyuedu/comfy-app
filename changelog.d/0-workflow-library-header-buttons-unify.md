## Changed

- **工作流库右上角三个动作按钮统一形态**：此前「导入工作流 / 模式契约 / 导入自定义节点」各写一套样式——粉渐变、深色 outline、纯紫实心，padding/圆角/字号也各不相同，还各带一个 emoji（🧩/ 渲染成绿、紫，与扁平语义色打架），一排看过去很杂。现收口到 `workflow-library-config.ts` 的一份基类 `HEADER_ACTION_BTN`（紧凑同高度同圆角同字重）：主按钮「导入工作流」保留 `btn-gradient` 强调，另两个统一为同款 outline 次要按钮；emoji 全换成 lucide 图标（FolderInput / Puzzle / PackagePlus），并去掉「导入自定义节点」多余的 `w-full` 与外层 `<div>`。
