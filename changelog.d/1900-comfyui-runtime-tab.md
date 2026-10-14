## Changed

- **ComfyUI 的运行态从设置页搬到侧栏一页**（ISSUE #1900）：设置 → 创作后端现在**只管配置**（路径 / comfy-cli 解释器 / 端口 / 启动参数 / 自动拉起 / 桌面实例的存储目录），而**运行状态、启动 / 关闭、打开查看、每一次启动的日志**整块归新的全局页签「ComfyUI」（侧栏排「队列」之后）。两件事的节奏本就不同 —— 路径配一次，运行态每次跑图前都要看一眼 —— 挤在同一屏上的结果是：改路径的人要先等一遍秒级探测，看日志的人要滚过一屏输入框。
  - **不留第二份实现**：设置页那一侧不再持任何运行态（`useSettingsComfy` 缩到「安装形态 + 存储目录」两份只读派生），运行逻辑整体归 `src/components/studio/comfyui/hooks/use-comfyui-control.ts`。启动动作因此**不再**「先保存草稿再拉起」——那一页没有草稿，服务端按库里已保存的配置拉起（想改路径去设置页改、保存、回来启动）。
  - **反馈通道**：本页是普通视图，动作结果走 toast；设置页那一版的整页提示条不动。
  - **撤掉动作之后必须给落点**：设置页那一段留一句指路 + 一枚「去启动与查看日志」按钮（`workspace:navigate`），否则用户按老位置找「启动 ComfyUI」会以为功能被砍了。队列屏离线时的出口也跟着改口径（从「去设置里启动 ComfyUI」改成「去「ComfyUI」页启动」，落点从设置页换成这一页）。

## Fixed

- **状态行那套排布判据（ISSUE #423）不再绑在设置页目录上**：`settings-status-row-config.ts` → `ui/service-status-row.tsx`，`StatusButton` 随它一起（原先在设置页的 `SettingsPrimitives` 里）。ISSUE #1900 之后它的消费者跨了两个屏，留在任一侧都会让另一侧反向依赖某个屏的目录。
- **「运行日志框」同因搬家**：`RuntimeLogBox` 与 `use-runtime-log-source` 从设置页目录移到 `studio/logs/`，ANSI 着色（`AnsiLogText`）一并从 `SettingsPrimitives` 拆出。设置 → 数据库 / 本地模型的日志框行为不变，只是不再从「某个屏的目录」取件。

## Tests

- 新增 `src/components/studio/comfyui/hooks/use-comfyui-control.test.ts`：运行态那一组用例（事件到了立刻重问 / 启动关闭打开 / 启动日志的会话切换与跨包 id 原样回传 / 浏览器形态走新页签）**整体从 `use-settings-page.test.ts` 搬来**，判据一条没少，只把反馈通道断言从 `flash` 换成 toast、去掉「先保存草稿」那一组。
- 新增 `src/components/studio/comfyui/ComfyuiControlView.test.tsx`：四态文案、互斥主行动只留一颗实心、未配置路径时启动禁用**并有去设置页的出口**、日志框在页上。
- 新增 `src/app/(main)/settings/components/ComfyuiSection.test.tsx`：配置项都还在、四颗运行按钮与日志框都不在这一分区、指路出口真的派发 `workspace:navigate`。
- `use-settings-page.test.ts` 新增两条**反向**判据（搬家的机器判据）：设置页不再订阅运行态通道、安装形态不依赖运行态探测。
- `service-status-row.test.tsx` 的扫描目标跟着搬（原断言「设置页三条状态行」，现在是设置页两行 + 侧栏「ComfyUI」页一行）。
