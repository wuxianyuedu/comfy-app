## Fixed

- **「七个基元在本应用没有对应场景」是一次误判，已逐条复查改正**（规范 16 §16.2.4.6，
  ISSUE #672）。上一轮把 `tabs` / `accordion` / `scroll-area` / `avatar` / `alert` /
  `dropdown-menu` / `form` 整批记成「有基元、无场景」，复查实测**七条里五条都有实打实的
  落点** —— 误判根因是**按目录名比、没按形态找**。结论改为按档记：

  - **欠治理（有明确落点）**：`tabs`（工作流库详情三页签自绘 `TabButton`）、
    `alert`（至少 6 处「语义色边框 + 图标 + 正文」的内联提示块，其中
    `CharacterPortraitStudio` 那处已经写了 `role="alert"`）、`dropdown-menu`
    （画布右键菜单 `CanvasContextMenu` 与项目切换器 `ProjectSwitcher` 都是
    「命令项 + 分组标题 + 分隔线」的菜单形态，`ui/select` 与 `ui/select-menu`
    覆盖不了「点一项执行一个动作」）。
  - **选型未发生，不是欠治理**：`ui/form` —— **全库零 `useForm(` 调用**，
    `react-hook-form` 只被 `ui/form.tsx` 自己 import。接它意味着表单状态与校验
    改由 RHF 管，属数据层设计决定，须先决策。
  - **确有近似形态但接上会改变外观 / 交互语义**：`scroll-area`（库里 57 个文件在
    用 `overflow-y-auto`，而基元套 base-ui 的 `Root`/`Viewport` + 自绘滚动条，
    有显式高度契约）、`accordion`（6 处原生 `<details>/<summary>` 是**单个独立**
    折叠块，没有互斥分组）、`avatar`（顶栏那处是纯 CSS 底、无图片；工坊 5 处是
    **首字母初值徽标**，语义是角色编号不是用户头像）。

  顺带澄清一处易混命名：`WorkflowFormControls.tsx` / `DynamicWorkflowForm/` 里的
  「Form」指**工作流参数表单**（由 `workflowIO` 动态生成），与 `ui/form`（RHF 族）
  无关 —— 按目录名找会误判成「已经在用了」。

## Changed

- **`tests/ui-primitives-coverage.test.ts` 头部注释同步改正**：原注释把七条整批
  写成「没有对应场景」，现改为按「欠治理 / 选型未发生 / 按现状不动」三档记录，
  并写明复查要求（按形态找，不按名字找）。判据本身不变 —— 仍是「已经用上的
  不许掉回 0」，第一档接上后同批登记进 `REQUIRED_CONSUMERS`。
