## Fixed

- 视觉整改一批（#3720，六条反馈）：
  - **渐变按钮退役**：`variant="gradient"`（紫→品红→粉三段渐变）的四颗按钮
    （导入工作流 / 编辑剧本 / 新建剧本 / 项目入口创建）与画布节点里的同款共享
    class 改用实心品牌色（primary-solid）；Button 的 gradient 变体与
    globals.css 的 `.btn-gradient` 成死代码一并移除（品牌渐变 token 保留——
    页签选中态仍在用）。
  - **NumberField 的 +/- 按钮不再有自己的底色**：悬停不再染灰（容器本身就是
    一块面），反馈走字色。
  - **Select 下拉的选项高亮与 SelectMenu 对齐**：悬停=浅灰（bg-surface-2）、
    选中=品牌紫（primary-500/20 + primary-strong + font-medium），不再走
    粉色 accent。
  - **Tooltip 气泡主题跟随**：此前 `bg-foreground text-background` 在浅色主题
    是深底白字；改用 popover token + 描边投影（浅色=浅底深字），长文件名
    断行用 `wrap-anywhere` 不溢出气泡。
  - **工作流表单的尺寸控件**（DimensionControl / AspectMegapixelControl）：
    盒子描边/底色/标签从粉色 accent 改品牌紫，与全局一致。
