## Added

- 规范 16 新增 **§16.2.3.2「验证『是不是基元』时，别只认 `data-slot`」**：`data-slot` 是「被谁最后施加就归谁」的属性，Base UI 的复合件会在渲染路径上重写它 —— `<TooltipTrigger render={<Button/>}>`（`ui/hint` 与 `ui/sidebar` 折叠态都是这个形态）会把按钮本体的 `data-slot="button"` 换成 `tooltip-trigger`。按 `data-slot` 一刀切断言，就会把「加了悬停提示」误读成「退回手写 `<button>`」：假红一次，而真正想防的东西并没有被防住。
  给出两条合法写法（判基元自己的类 `group/button`，或接受 `data-slot` ∈ `{button, tooltip-trigger}` 并补前一条），并点名反面写法（`getAttribute("data-slot")` 直接等值）。
  同时确证这**不是视觉回归**：全库没有任何样式或门禁按 `[data-slot=button]` 取元素（`ui/button-group` 用的是 `button-group` / `select-trigger` 两个别的名字）。
- 同一节把 P76 / P80 犯过的同族错也收进来（控件换 combobox 后按 `value` + `<option>` 读的断言全废；`h-N w-N` 归 `size-N` 后按两个类名读的断言全废），共同形态是**批次改了结构、断言没跟着重算**，口径是「改这类断言时只换读法、不要动它锁的那件事」。落这一节而不是 §16.2.4，是因为它属于「怎么验证收口成功」的通用原则，不是某一条判据的账。
