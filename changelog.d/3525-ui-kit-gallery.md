## Added

- 设置外新增「UI 控件总览」页（`/ui-kit`）：把项目全部可视化基元摆到同一屏，
  并排语义 token 墙与七个分组（按钮 / 输入 / 浮层 / 导航 / 反馈 / 数据展示），
  右上角一键在明暗两态间翻面 —— 控件颜色 / 背景色错档在这里一眼可见（#3525）。
  应用内入口在命令面板（⌘/Ctrl+K）「其他」组。

## Fixed

- 修复 `/ui-kit` 打开时浏览器 console 三类报错：①「UI 控件总览」页 OptionListPopover
  演示把 `<Button>`（原生 `<button>`）塞进 `PopoverTrigger`（本身已是 `<button>`），
  button 套 button 属无效 HTML，水合直接失败、整树客户端重渲染——改按真实用法传 chip
  `<span>`；②NavigationMenuTrigger 用 `render={<Link/>}` 渲染成锚点却没关
  `nativeButton`，补 `nativeButton={false}` 消掉 base-ui 运行时不变量报错；
  ③CodeBlock 预载语言表漏 `bash`，演示 `pnpm dev` 时代码高亮抛 ShikiError——补入
  langs（对其他调用方同为净收益）。三类都不是静态可判的错（tsc / build / SSR 全绿），
  新增 `e2e/ui-kit-gallery.spec.ts`（@critical）：访问该页断言零 console error /
  零未捕获异常 + 分区渲染 + 主题开关可交互，把「浏览器里不报错」变成合并前门禁。
