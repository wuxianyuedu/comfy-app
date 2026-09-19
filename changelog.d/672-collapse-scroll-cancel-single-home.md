## Changed

- **「折叠 / 展开」「可滚动的浮层选项列表」「定时轮询」三件事各收成一处实现**
  （ISSUE #672，规范 16 §16.2.4.13 ~ §16.2.4.15）。三条判据 **P10 / P11 / P12**
  一上来就是硬闸、不进棘轮基线。
  - `ui/disclosure` 的 `Disclosure`：收口三族折叠写法（原生 `<details>` 六处、
    自绘「布尔 state + 条件渲染 + `▸/▾`」四处、树形 `expanded*` 映射两份）。
    取 base-ui `Collapsible` 而非原生 `<details>` —— `hiddenUntilFound` 用
    `hidden="until-found"` 隐藏，**保留**「页内查找命中折叠内容自动展开」这条
    最值钱的语义。迁 11 处；`NodePreviewCard`（实色色带卡头）显式登记豁免。
  - `ui/option-list-popover` 的 `OptionListPopover`：收口画布四个 chip 各写一份的
    逐行同形浮层（触发器 `▾` + `max-h-* overflow-y-auto` + `role="option"` 行，
    选中配色四份各写各的）。`AttributeMultiSelect`（多选 + 搜索 + 自定义添加）
    语义不同，维持现状。
  - `ui/use-interval` 的 `useInterval`：收口 **9 处**各自 `setInterval` 的轮询
    （不立刻跑一次 / 后台空转 / 每次渲染重建定时器 / 前后台开关被抄两份 /
    跑在已卸载组件上）。迁 12 处，含 `use-comfy-stats` 与 `use-update-check`
    那段逐字重复的 `visibilitychange` 开关。
- 画布四个 chip 的「当前项」配色改走 `primary` 语义 token（此前
  `violet-500/20` / `fuchsia-500/20` / `primary-soft` / `bg-accent` 四份各写各的）。
- `useSimulatedProgress` 不再把 `tasks` 写进依赖数组（此前每次轮询返回新数组都
  重建定时器、把节拍重置）。
