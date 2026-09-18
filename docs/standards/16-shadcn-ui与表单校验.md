# 16. shadcn/ui 与表单校验（Form + Zod）

> 本章目标：明确 shadcn/ui 在本项目的定位与分工边界，并给出表单方案的**推荐实现与备选评判**。
> 配套脚本/钩子：`.githooks/pre-commit`（结构检查，见 §12.6/§12.8 的 kebab 硬规则）。

> **占位符约定**：本文中 `{{...}}` 形式的占位符代表文档引用的真实值（如可执行文件名、地址、端口），
> 真实值由 `pnpm doc:check` 运行时从源码/配置动态提取并核对。占位符语义见
> [`docs/reference-facts.md`](../reference-facts.md)。改动上游源码后可运行
> `pnpm doc:check` 检查本文是否有值未同步。

## 16.1 定位：ui/ 是你"拥有"的组件库，不是 npm 依赖

shadcn 的本质是**把组件源码复制进仓库**，而非引入一个版本锁死的 npm 包。因此：

- `src/components/ui/*` 就是项目自有代码，可以（也应该）被阅读和按需改造。
- 由工具按需生成：`pnpm dlx shadcn@latest add <comp>` 或项目已装的 `shadcn add <comp>`（见 `package.json` 的 `shadcn` 依赖）。
- 生成到 `src/components/ui/`，**文件名 kebab-case**（强制规则见 §12.6/§12.8，旧 PascalCase 已归一化）。
- 风格为 `base-nova`（`components.json`），底层是 **`@base-ui/react`**：生成的组件是 **base-ui 版**，不要混用 radix 版 shadcn。

## 16.2 分工原则：工具建界面，前端只写逻辑

```
ui/（工具生成，界面源码）        ← 尽量不碰
   ├─ button.tsx / dialog.tsx / input.tsx / form.tsx ...
业务代码（你写）
   ├─ src/app/(main)/...        页面 + 组合
   └─ src/components/<feature>/  feature 组件 + 组合 + 业务逻辑
```

- **ui/ 原语 = 界面源码**，归工具/AI 生成与维护；业务代码只 `import` 并组合它们，写业务逻辑（状态、数据、事件、校验）。
- **尽量不要手改 ui/**：
  - 改样式/行为：优先在使用处以 `className` 覆盖，或扩展 `cva` 变体（仅当确属通用变体时）。
  - 上游更新：`shadcn add <comp>` 可覆盖重生成（会覆盖本地改动）——因此保持 `ui/` 干净、把定制收敛到使用处，是长期低成本的关键。
- 别名（见 `tsconfig.json` / `components.json`）：`~/components/ui`、`~/components`、`~/lib/utils`（`cn`）。**统一用 `~` 前缀**（`@/` 非本仓库约定）。

### 16.2.1 落地范式：controller hook + 纯展示视图

> 2026-09-02：以 `components/workshop/WorkshopPipeline.tsx`（原 1017 行 UI+逻辑混合体）为样板确立。
> 新页面与大型组件照此拆——目标是**逻辑可单测、界面可由工具重生成**。

四层职责（同一 feature 目录内）：

| 层       | 位置 / 命名                                        | 职责                                                          | 禁止                   |
| -------- | -------------------------------------------------- | ------------------------------------------------------------- | ---------------------- |
| ① 纯配置 | `<feature>/stage-config.ts`（kebab，`.ts`）        | 常量 + 派生展示数据（完成度、文案、网格）的**纯函数**         | React、副作用、DOM     |
| ② 逻辑   | `<feature>/hooks/use-<feature>.ts`（kebab，`.ts`） | state、持久化、拉取、生成流程、派生进度；返回 controller 对象 | `alert` / 直接操作 DOM |
| ③ 视图   | `<feature>/<Name>.tsx`（PascalCase）               | 只收 props + 组合 `ui/` 原语渲染，事件上抛                    | 自发请求、自算业务规则 |
| ④ 容器   | `<feature>/<Feature>.tsx`                          | 取 controller → 传给视图 → 挂弹层                             | 任何业务规则           |

要点：

- **controller 是唯一数据出入口**：`<WorkshopStageBody controller={controller} />`
  优于 30+ props 透传；视图仍是纯展示，只是整体消费 controller。
- **失败/阻断不走 `alert`**：逻辑层产出 `notice` 文案 + `dismissNotice`，由视图渲染提示条；
  `console.error` 照常保留，满足硬规则「失败路径必须有日志 + 用户可见出口」。
- **原生控件一律换 shadcn 原语**：`<button>` → `Button`、`<select>` → `Select`、
  `<textarea>` → `Textarea`；项目自有视觉 token（`bg-surface` / `text-ink` / `bg-primary/12`）
  在使用处以 `className` 覆盖（即 §16.2 允许的覆盖方式）。
- **base-ui 差异**：`Select` 的 `onValueChange` 签名为 `(value: string | null, details) => void`，
  业务侧用空串表达「未选」时需 `value ?? ""` 收敛。
- **顶层不建 `src/hooks/`**（§12.5）：feature 私有 hook 放 `<feature>/hooks/`，
  跨功能复用的就近放 `lib/`。

### 16.2.2 已落地案例

> 落地顺序：① `components/workshop/WorkshopPipeline.tsx`（见 §16.2.1 开头）、
> ② `workflow-library/WorkflowLibraryDetail`、③ `shared/DynamicWorkflowForm`、
> ④ `workshop/ApiChannelSettings`、⑤ `studio/history/*`、
> ⑥ `studio/project-canvas/MaterialLibraryPanel`。
> 后续（2026-09-04）：⑦ `workflow-library/WorkflowLibrary`、
> ⑧ `app/(main)/settings`（页面级容器：page.tsx 只剩三个早退分支，
> 视图 `SettingsPageView.tsx` + 逻辑 `hooks/use-settings-page.ts`）。
> **全库分批推进计划与棘轮护栏见
> [第 17 章 UI 与逻辑分离](17-UI与逻辑分离.md)**，其中 §17.5–§17.7 记录了
> 每一批的拆分手法与踩到的坑。

**`workflow-library/WorkflowLibraryDetail`（原 399 行）**

| 层     | 产物                                                                                                  | 内容                                                  |
| ------ | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| ① 配置 | `workflow-library-detail-config.ts`                                                                   | 页签定义、props 契约、IO 归一化、源数据派生           |
| ② 逻辑 | `hooks/use-workflow-library-detail.ts`                                                                | 详情查询、格式/同步标志派生、页签与弹层状态、动作包装 |
| ③ 视图 | `WorkflowLibraryDetailView.tsx` + `sections/DetailHeader.tsx`、`DetailBody.tsx`、`DetailControls.tsx` | 纯展示，动作经 `controller.actions` 上抛              |
| ④ 容器 | `WorkflowLibraryDetail.tsx`                                                                           | 取 controller → 传视图，仅 ~20 行                     |

**`shared/DynamicWorkflowForm`（原 958 行 UI + 逻辑混合体）**

| 层     | 产物                                                                               | 内容                                       |
| ------ | ---------------------------------------------------------------------------------- | ------------------------------------------ |
| ① 配置 | `dynamic-workflow-form-config.ts`                                                  | 对外 props 契约、数值行判定、类型徽章回退  |
| ② 逻辑 | `hooks/use-dynamic-workflow-form.ts`                                               | IO 切分/分组、行拖拽手势、图片上传、值写入 |
| ③ 视图 | `DynamicWorkflowFormView.tsx` + `sections/WidgetInputRow.tsx`、`WidgetControl.tsx` | 纯展示，事件全部上抛                       |
| ④ 容器 | `DynamicWorkflowForm.tsx`                                                          | 取 controller → 传视图，仅 ~45 行          |

两条共同要点：

- **容器对外 API 保持不变**（props / default 导出 / 类型名），消费方零改动：
  WorkflowLibraryDetail 只有 1 处消费方；DynamicWorkflowForm 有 5 处，靠 barrel
  `index.tsx` 原样导出兜住 ——"内部重构不影响调用方"全靠这一层。
- **hook 内不做 early return**：空态 / loading 交给视图判断，保证 hooks 顺序稳定
  （WorkflowLibraryDetail 的「未选中工作流」空态即走这条）。

### 16.2.3 混合形态台账与「自实现」棘轮（ISSUE #672，机器强制）

§16.2 的分工原则是「工具建界面、前端只写逻辑」，但在很长一段时间里它**只有原则、
没有判据** —— 于是实测出：`src/components/ui/` 的 29 个基元里只有少数被业务引用，
视图里手写 `<button>` 408 处、自建 `createPortal` 浮层 10 处、自写
`animate-spin`/`animate-pulse` 40 处，同一套按钮/浮层/加载态在多个目录里各实现一份。

（存量随治理逐批下降，当前值看 `pnpm ui:primitives:report` —— 写在正文里的
数字是**首次扫描快照**，不是实时值，免得每完成一批就要改一遍正文。）

**三条判据之外还有一侧**：P1/P2/P3 数的是「另一种写法出现了几次」，
对「**基元齐全但一次都没被用**」天然无感（`card` / `badge` / `input` /
`textarea` / `switch` / `separator` 的引用数都曾是 0）。那一侧由
`tests/ui-primitives-coverage.test.ts` 管，口径见 §16.2.4.4 ①。

本仓库的历史结论是**「只提醒 = 没有判据」**（§12.13 文件行数、§12.16 死代码同款），
所以这里给计数棘轮：把存量冻结在基线，只许降不许升。

```bash
pnpm ui:primitives            # 检查（棘轮：只许降不许升，pre-commit 第 12 步）
pnpm ui:primitives:report     # 只出清单（排批次用，不判失败）
node scripts/check-ui-primitives.cjs --update   # 治理后收紧基线
```

**三条判据**（`scripts/check-ui-primitives.cjs`，基线
`scripts/.ui-primitives-baseline.json`）：

| ID     | 判据                                        | 应改用什么                                                                                                                                                                             |
| ------ | ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | 视图层手写 `<button`                        | `~/components/ui/button` 的 `<Button>`（缺语义变体就先补变体）                                                                                                                         |
| **P2** | 视图层自建 `createPortal(` 浮层             | `ui/dialog` / `ui/popover` / `ui/sheet` / `ui/dropdown-menu`                                                                                                                           |
| **P3** | 视图层自写 `animate-spin` / `animate-pulse` | 块级加载态 → `ui/page-loading` 的 `PageLoading`；行内 / 按钮内 → 同模块的 `Spinner`；占位 → `ui/skeleton`；进度 → `ui/progress`；状态圆点的脉冲 → `ui/status-dot` 的 `StatusDot pulse` |

**三条判据当前都是硬闸**（P1/P2/P3 基线里已无条目，新增任何自实现直接被阻断）：
`pnpm ui:primitives` 在 2026-09 的分批治理后收于 **0 处 / 0 文件**。
「清零」不等于「以后不必管」—— 判据从棘轮变成硬闸（`--strict` 下基线上调即失败），
防护强度只增不减。

**范围与豁免**（脚本里的 `SCAN_DIRS` / `EXEMPT_DIRS`，与本节同源）：

- 扫描 `src/components/**` + `src/app/**`（与 §17.3 的棘轮同一批目录）；
- 豁免 `src/components/ui/**`（基元自身实现）、`<feature>/hooks/**`（§16.2.1 第②层
  是逻辑层）、`*.test.*` / `__tests__/**`；
- **豁免只剩两条**：`ui/` 自身实现与 `<feature>/hooks/**`（§16.2.1 第②层）。

  这里曾**整体豁免** `studio/ui/**` 与 `studio/shared/**`（理由是「它们是迁移对象
  而不是合规形态」）。P2 把它们的自搓浮层清干净后，豁免开始逐条归还；到
  §16.2.4 的目录归并完成时，两条豁免**已全部撤掉** —— 「豁免目录里的存量不进
  基线」意味着那里治理了多少、还剩多少**没有任何判据**，正是 §3.6.1「豁免必须
  显式」要防的失效模式。撤掉之后 P1/P2/P3 各自**全库清零**（含归并进来的
  11 + 24 个文件），棘轮由此变成硬闸。

  撤掉的另一面是**目录不得复活**：归并完还得有个判据挡住「下一个人再
  `mkdir studio/ui` 起一套」，见 `tests/ui-kit-single-home.test.ts`。

### 16.2.5 浮层层级是一张刻度表（ISSUE #672 P2 → P4，机器强制）

浮层收拢过程中暴露出第二处不一致：**层级各处一套魔数**。同一件事（下拉浮层）
在 `MultiSegmentPopover` 是 `9999`、`WorkflowSeedModeButton` 是 `9999` 配 `9998`
遮罩、节点 JSON 浮层用 `9000`/`9001`，全屏抽屉散落 `10005`/`10020` ——
谁也说不清「它比谁高」，新增一层只能再编一个更大的数。

P2 先把自搓浮层收进 `ui/` 原语、定下两条刻度；**P4 复查时余量里仍有 7 处
自成一档**（`9998` / `z-[10000]` / `z-[10020]` / `z-80` / `z-60` / 全屏视图的
`z-50` / `studio/logs` 的 `z-99`+`z-200`）。所以这里不再只定两条，而是**一张成体系
的刻度表** —— 每一档都对得上一类真实存在的浮层关系，不是「把魔数换个名字」。

**数值同时定义在两处**（`src/app/globals.css` 的 `@theme` 供工具类，
`src/lib/shell/overlay-z.ts` 供行内 `zIndex`），两处必须一致 —— 由
`src/lib/shell/overlay-z.test.ts` 逐档钉住。`zClass(tone)` 由档名派生工具类名，
不手抄第二份 `z-*` 字符串表。

| 档            | 值   | 工具类         | 谁在这一档                                                      | 判据                                           |
| ------------- | ---- | -------------- | --------------------------------------------------------------- | ---------------------------------------------- |
| `Z.base`      | 10   | `z-base`       | **局部叠层下限**：画布节点内容 / 子图、卡片内遮罩、节点内浮标   | 参照点是**自己的定位祖先**，比较对象在容器内部 |
| `Z.canvasUi`  | 20   | `z-canvas-ui`  | 画布 chrome：工具栏 / 侧栏 / 面板 / 角标提示                    | 压过节点，但仍在**所处容器**那一层             |
| `Z.canvasMax` | 30   | `z-canvas-max` | 画布最上层：IO 预览 / 底部工具栏 / 固定触发钮                   | 压过 `canvasUi`，仍不越出容器                  |
| `Z.modal`     | 90   | `z-modal`      | **模态遮罩与抽屉**、全屏视图、消息中心                          | 应用内的「顶」（`Z.overlay` 是它的旧名，同值） |
| `Z.popup`     | 100  | `z-popup`      | **挂在 `body` 的浮层**：下拉 / 气泡 / 右键菜单 / 节点 JSON 浮层 | 由模态内的控件打开，**必须压过 `modal`**       |
| `Z.toast`     | 1000 | `z-toast`      | 全局提示、底部状态栏（应用级 chrome）                           | 任何浮层之上                                   |

**三条判据（缺一条这张表就会退化回「一串更大的数」）**：

1. **`modal` 刻意不进 1000~1200 区间**：那是 React Flow 给节点选中态（约 1010）
   与悬浮态（1180，见 `globals.css`）留的位，应用模态插进去会和节点争层级。
2. **`popup` 必须高于 `modal`**：`ui/select` / `ui/popover` / `ui/dropdown-menu` /
   `ui/tooltip` 都是 portal 到 `body` 的，而它们常常**由模态内部的控件**打开。
   低于模态 = 点得开、点不中（同 §16.2.4 的日志面板回归，ISSUE #262）。
   `studio/logs` 的层级契约因此不再自成一档，直接取 `Z.modal` / `Z.popup`。
3. **画布内部的层级属于本表，但只在容器内比较**：它们从 `base` 起排，是为了让
   「同一个容器内部的关系有名字」，而不是「要和模态比高低」。跨容器比高低是
   误用 —— 那些元素压根不在同一个层叠上下文里。

**两条硬约束（不在表里的写法一律阻断）**：

- 行内数字 `zIndex: 7` 与任意值写法 `z-[10000]`（规范 03 §3.2 已禁 arbitrary）
  **全库清零**，属硬闸；
- 刻度之外的**裸数字具名档**（`z-9999` / `z-80` / `z-99` …）按文件记棘轮、
  只许降不许升 —— 写得出来就说明又编了一档。

```bash
pnpm ui:overlay-z            # 检查（棘轮 + Z1/Z2 硬闸，pre-commit 第 27 步）
pnpm ui:overlay-z:report     # 只出清单（排批次用，不判失败）
node scripts/check-overlay-z.cjs --update   # 治理后收紧基线
```

**范围与豁免**（`scripts/check-overlay-z.cjs` 的 `SCAN_DIRS` / `EXEMPT_DIRS`，
与本节同源）：扫 `src/components/**` + `src/app/**`；豁免
`src/components/ui/**`（shadcn **工具生成、尽量不手改**的目录，§16.1 ——
基元内部的 `z-50` 改成项目档会在下一次 `shadcn add` 被改回去，而机械换算
只会算错：`z-50` 在工具生成的语义里是「弹层」，在刻度表里对应的是 `popup`，
不是它数值上靠近的 `modal`）、`<feature>/hooks/**`（§16.2.1 第②层是逻辑层）、
`*.test.*` / `__tests__/**`。

**为什么豁免不是「灰区」**：`ui/` 里真正需要**语义正确**的那几处（`dialog` /
`sheet` 是模态档，`popover` / `dropdown-menu` / `select` / `tooltip` 是弹层档，
`dialog-overlay` 的遮罩是模态档）已经显式改成 `z-modal` / `z-popup`；剩下未改的
`z-50` 是工具生成的形态，判据够不着它们，而**改了反而更危险**（会被重新生成覆盖）。

**内容层的遮罩不在此列**：浮层遮罩的 class 串统一由
`src/components/ui/dialog-overlay.ts` 的 `dialogBackdropClass()` 产出，
`ui/dialog` 的 `DialogContent` 与 `ui/sheet` 的 `SheetContent` 共用同一份，
它同时承载「顶部让出标题行」的硬规则（ISSUE #310：遮罩曾铺满视口，把页签与
窗口按钮一起盖住）。**内容层不再自绘遮罩** —— base-ui 的 Backdrop 负责点遮罩
关闭，自绘的那一份会与它叠成两层。

**为什么 `lib/full-screen-layer.ts` 的 `overlayClass` 参数不变**：它是**定位**
判据（顶部让出标题行），层级由调用方经 `zClass` 参数给 —— 两件事分开，才让
「让位」这条硬规则（`check-title-bar-clearance.cjs`）不被层级改名牵动。
P4 之后所有调用方传的都是 `zClass("modal")` / `zClass("canvasMax")`。

### 16.2.4 混合形态台账（现状，不是目标）

> 这一节不是规范、是**排批次的账**：把「哪里还有第二套实现」写下来，
> 免得每轮扫描都重新发现一遍（与 §3.6.1「豁免必须显式」同一个用意）。

按「同一件事有几份实现」排序（**P2 已完成的条目保留在此，作为「怎么迁」的样板**）：

| 形态             | 现状                                                                                                              | 去向                                                                                                | 状态                                        |
| ---------------- | ----------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 对话框/浮层      | ~~`ui/dialog.tsx`（业务零引用） / `studio/ui/ModalDialog.tsx` / 10 个文件各自 `createPortal`~~                    | `ModalDialog` 改基于 `ui/dialog`；10 处自建 portal 全部换成 `ui/dialog` / `ui/popover` / `ui/sheet` | ✅ **P2 完成（P2 判据清零）**               |
| 空态             | ~~`ui/empty-state.tsx` / `studio/ui/EmptyState.tsx` / `DynamicWorkflowForm/sections/EmptyStateHint.tsx` 三份~~    | 合并到 `ui/empty-state.tsx`（props 取并集，`variant` 分流 `page`/`error`/`hint`）                   | ✅ **P2 完成**                              |
| 按钮             | ~~`ui/button.tsx` + 视图里的 400+ 处手写 `<button>`~~                                                             | P1 棘轮逐批换 `<Button>`；变体见 §16.2.4.1                                                          | ✅ **P1 判据清零**（分 5 批，见 §16.2.4.2） |
| 加载态           | `ui/skeleton.tsx` / `ui/progress.tsx`（均零引用）+ 17 个文件自写 spinner                                          | P3 棘轮；`ui/page-loading` 的 `Spinner` 是**内联**加载态的唯一出口（按钮内/一行文字里）             | ✅ **P3 判据清零**                          |
| 状态圆点         | ~~ComfyUI / Drizzle Studio / Ollama 三条状态行各自写一份四分支三元套娃 + 各写各的 `bg-emerald-400` 等色值~~       | `ui/status-dot.tsx` 的 `StatusDot`（状态语义 `up`/`busy`/`probing`/`down` → 语义 token）            | ✅ **全库唯一实现（余量见 §16.2.4.5）**     |
| 状态胶囊         | ~~**七个文件**各写一份「状态 → 配色」表（`emerald-500/15` / `emerald-400/10` / `emerald-100` 三种深浅各不相同）~~ | `ui/status-badge.tsx` 一份（`dot` 形态 / `dot={false}` 角标）；文案留在调用处                       | ✅ **见 §16.2.4.5 ①**                       |
| UI kit 目录      | ~~`components/ui/`（33）/ `components/studio/ui/`（11）/ `shared/` / `DynamicWorkflowForm/sections/`~~            | 见 §16.2.4.3                                                                                        | ✅ **归并完成（豁免已归还）**               |
| 基元齐全但没人用 | ~~`card` / `badge` / `input` / `textarea` / `switch` / `separator` 引用数为 0~~                                   | 接上有明确场景的一批，其余记为「有基元、无场景」                                                    | ✅ **见 §16.2.4.4 ①**                       |
| 两套 token 口径  | ~~`shadcn` 别名与项目 token **各写一份字面量**（同一颜色 2~3 份拷贝）~~                                           | 别名**只做 `var()` 转发**（项目 token 是唯一事实来源）；`@theme inline` 不再重定义项目 token        | ✅ **已合并，见 §16.2.4.4 ② / 03 §3.6.4**   |
| 余量主题色       | ~~115 处写死色值「既不是豁免、也不是待治理项」~~                                                                  | 逐条定性：token 化 18 处 / 登记豁免 97 处 / 进固定暗色清单 2 处                                     | ✅ **基线归零，见 §16.2.4.5 ②**             |

`pnpm ui:primitives:report` 输出的就是本表的机器版数据，排批次时照它来。

**P2 的做法（可直接照抄到后续批次）**：迁移一个浮层 = 换掉两件事 ——
① `createPortal(...)` → `ui/` 原语的容器；② 随之删掉该文件**自己那份**
「手写 Esc、手写遮罩点击关闭、手写定位 + 滚动重定位、手写 z-index 魔数」。
只换 ① 不删 ② 会留下两套关闭语义同时生效（例如 Esc 触发两次 dismiss）。

| 形态                 | 原来自搓的位置                                                                                                            | 现在                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 确认对话框           | `studio/ui/ModalDialog.tsx`（自搓 portal + Esc + 焦点）                                                                   | `ui/dialog` 的 `Dialog` / `DialogContent`，自动聚焦确认按钮的行为保留 |
| 节点 JSON 浮层       | `WorkflowNodeJsonPopover.tsx`（自搓遮罩 + `computePos` 定位 + Esc）                                                       | `ui/dialog`；`workflow-utils.ts` 的 `computePos` 一并删除             |
| 源码查看弹窗         | `debug/DebugChainFooter.tsx`（自搓遮罩按钮 + Esc）                                                                        | `ui/dialog`；载入态改 `ui/page-loading`                               |
| 模型标签编辑器       | `workflow-library/sections/MetaEditor.tsx`（自搓遮罩 + 点击外点关闭）                                                     | `ui/dialog`                                                           |
| 属性多选下拉         | `workshop/AttributeMultiSelect.tsx`（自搓定位 + Esc/外点 + 重定位）                                                       | `ui/popover`（翻上/翻下、收边、重定位交给 base-ui Positioner）        |
| 4 个工作流 chip 下拉 | `project-canvas/Workflow{Pick,ModelFilter,SourceFilter,ModePick}Chip.tsx` + `workflow-node-popover.ts` 基元               | `ui/popover`；`workflow-node-popover.ts`（定位/关闭基元）整个删除     |
| 两个设置抽屉         | `studio/ProjectCanvasSettings.tsx`、`studio/canvas/WorkflowCanvasSettings.tsx`（各自 `FullScreenLayer` + 遮罩按钮 + Esc） | `ui/sheet`（`side="right"`）                                          |

### 16.2.4.2 P1 按钮分批的进度与做法

按钮这一条不是「一次性替换」，而是**一次一个目录**地把手写 `<button>` 换掉，
因为绝大多数调用点带着自己的布局类（全宽列表行、图标圆钮、Tab 项），
变体只能接管外观语义，尺寸与排布仍由调用处的 `className` 承担。

**已完成批次**（每批都把该目录清零，再 `--update` 收紧基线）：

| 批次 | 目录                                                               | 清零处数       | 手法                                                                   |
| ---- | ------------------------------------------------------------------ | -------------- | ---------------------------------------------------------------------- |
| 1    | `studio/logs/`                                                     | 16             | 图标钮 → `size="icon-xs"`；Tab → `variant="ghost"` + `h-auto`          |
| 1    | `studio/workflow-library/`                                         | 28             | 文字动作 → `variant="outline"` / `"ghost"`；实心紫 → `"primary-solid"` |
| 2    | `studio/project-canvas/`（含 `CanvasNode/`）                       | 84             | 见下                                                                   |
| 3    | `studio/workflow-editor/`                                          | 14 + 2（P3）   | 见下                                                                   |
| 4    | `app/(main)/settings/` + `components/settings/`                    | 45 + 11（P3）  | 见下                                                                   |
| 5    | 全库清零：`workshop/` + `studio/` 散件 + `app/` + 剩余 `studio/**` | 174 + 24（P3） | 见下                                                                   |

**`studio/project-canvas/` 这批评测出的三条口径**：

1. **Popover 里的选项行**（`role="option"`）也换成 `<Button variant="ghost">`：
   base-ui 的 `Button` 会把 `role` / `aria-selected` / `title` / `key` 原样透传
   到 `<button>`，行为不变；`rounded-none` 抵消基元默认圆角，保住行样式的
   边到边观感。
2. **`type="button"` 可以随转换删掉**：base-ui 的 `useButton` 自带
   `type: 'button'`（见 `@base-ui/react/internals/use-button`），不会退化成
   表单提交钮。
3. **`h-auto` 是覆盖基元高度的标准手法**：基元的 `size` 变体写死了 `h-6/7/8/9`，
   调用处要沿用自己那套 `px/py` 就必须 `h-auto`，否则高度被基元压掉。

**`studio/workflow-editor/` 这批评测出的两条口径**：

4. **覆盖基元默认值是「成套 + 讲顺序」两件事**：顶栏按钮原本全走
   `workflow-editor-topbar-config.ts` 的 `topBarButtonClass(tone, density)`，
   它的尺寸与底盘是为「窄窗退化顺序」专门设计的（ISSUE #404）。换成 `<Button>`
   后，`cn()` 把 `buttonVariants(...)` 排在调用处 `className` **之前** ——
   基元的 `h-8 px-2.5 rounded-lg` 与 `ghost` 的 `hover:bg-muted` 本就会被
   后面的类覆盖，但**依赖「碰巧排对了」不是判据**：基元里没写的那几档
   （起始 `bg-*`）会漏过去。所以 `topBarButtonClass` 的每个 tone 都**显式
   带齐** `h-auto px-0 rounded-none bg-transparent`（`h-auto` 是第 3 条的同一
   手段，这次连「无起始底色」一起归位）。

   ⚠️ **顺序是载荷**：`cn()` 走 tailwind-merge，同一属性**后面的类赢**。
   覆盖串里的 `rounded-none` / `px-0` 只是「先声明要归位」，真正生效的必须是
   tone 的 `rounded-md|lg` 与密度的 `px-*` —— 把覆盖串排到 tone 之后，
   tailwind-merge 会把 tone 的圆角吃掉、按钮全部变直角，而**源码里两串都在**，
   只有合并结果能证明对错。所以拼装顺序固定为
   `base → 覆盖串 → 密度 → tone → extra`，并由契约测试逐个 tone 断言
   「tone 的圆角索引 > 覆盖串索引」+「密度的 `px-*` 索引 > `px-0` 索引」。

5. **颜色字面量随转换一并收口**：本批把顶栏/画布残留的 `violet-*` /
   `amber-*` / `sky-*` / `rose-*` / `red-*` / `emerald-*` 全部换成
   `primary-*` / `warning-*` / `info-*` / `destructive` / `success-*`
   （§3.6.2）。这些字面量本来就不该在视图里 —— 之前只是因为顶栏是
   「另一套 UI kit」而没被追到。

**判据自身的修正**：本批同时给 `check-ui-primitives.cjs` 的 P1/P2/P3 加了
**注释剥离**。判据原来直接数原始文本里的 `<button`，于是「原来是 `<button>`
手搓，现改走 `<Button>`」这类**说明性注释**会被当成实现计上 —— 该文件的计数
停在原地，棘轮永远降不下去（同款教训见 `check-theme-colors.cjs` 的注释剥离：
注释里的 `#346` 被误判成 3 位色值）。剥离后 P1 立刻多降 2 处
（`studio/RequiredSummary.tsx` 与本模块），说明此前一直在为注释记账。
**字符串/模板字面量不剥离** —— `"<button"` 同样是「自己实现一份」的信号。

**`app/(main)/settings/` + `components/settings/` 这批评测出的三条口径**：

6. **「本页主按钮」这种局部原语要换成基元的包装，不是平行实现**。设置页
   `SettingsPrimitives` 的 `Btn` 此前是第二个 `<button>`（自拼尺寸类 +
   自拼配色 `bg-primary hover:bg-primary-hover text-white`）。改法不是「把
   `<button>` 换成 `<Button>` 但保留全部自拼类」—— 那只是换了个标签名。正确
   拆法是**分工**：配色交给 `variant`（`primary-solid` / `success-solid`），
   本模块只留该页特有的**排布契约**（`statusButtonClass`：不许换行 / 不许被
   flex 压扁 / 行框归位，ISSUE #423）。这与顶栏的 `topBarButtonClass` 是同一
   手法，区别只是契约的内容（顶栏管「窄窗退化顺序」，设置页管「状态行不许
   被压扁」）。原语随之改名 `StatusButton`，名字说明它属于状态行。
7. **内联加载态用 `Spinner`，不要用 `PageLoading`**。`PageLoading` 是块级
   加载态（居中 + 文案 + `size-9` 转圈），放进按钮里会让按钮被撑高。此前各
   调用点因此退回 `<Loader2 className="animate-spin" />` —— 那正是 P3 判据
   计数的「自写 spinner」。现在 `ui/page-loading` 同时导出裸转圈 `Spinner`
   （`size-4`、继承 `currentColor`），`PageLoading` 内部也复用它，全库只剩
   一处 `animate-spin`。判据：**块级用 `PageLoading`，行内 / 按钮内用
   `Spinner`**，不要写 `PageLoading label=""`。
8. **同一组「状态圆点」跨三个文件重复时，收成 `ui/` 基元而不是本页常量**。
   设置页三条状态行的圆点此前各写一份四分支三元套娃（配色还是各写各的
   `bg-emerald-400` / `bg-amber-400` / `bg-sky-400` / `bg-rose-400`），这才是
   典型的「同一个组件到处实现一份」。收进 `ui/status-dot.tsx` 的 `StatusDot`
   后，状态语义（`up` / `busy` / `probing` / `down`）与颜色只定义一次；**判定
   逻辑（哪个字段组合算 busy）留在各视图的纯派生函数里**（`comfyDotState` /
   `dbStudioDotState`），因为那是业务判据、不是样式。日志「跟随中」的脉冲
   小点也复用它（`pulse`），顺带消掉三份重复的 `animate-pulse`。

**收尾批次（第 5 批，P1/P3 双双清零）的口径**：

9. **`variant` 只在「语义能对上」时接管配色，其余交给 `className`**。
   不是每个手写按钮都有对应的语义变体 —— `TitleBarTabs` 的窗口按钮是
   「无底色、hover 变色」、`IOEditContext` 的节点 id 徽标是「mono 小字 +
   点线框」、`WorkflowNodeJsonPopover` 的三个控件是行内 `style` 驱动的。
   这些一律用 `variant="ghost"` / `"outline"` + 原 `className`，**不要为了
   「用上变体」而改变外观**：转换的验收标准是**渲染结果不变**（快照测试
   就是为此存在的），不是「配色都走变体」。
10. **`role="switch"` / `role="tab"` 的按钮照换**：base-ui 的 `Button` 会把
    `role` / `aria-checked` / `aria-selected` / `tabIndex` / `onMouseDown`
    原样透传（第 1、2 条同款），`h-[18px] w-[32px] p-0` 之类的尺寸类照旧由
    调用处给。不要因为「它其实是开关」就留在手写形态 —— P1 判据不区分语义。
11. **枚举状态圆点一律走 `StatusDot`**：本批把 `BrowserStatusBar` 的
    dev server 灯、`LibraryHostCard` 的节点相位点、`WorkflowRunLogButton`
    的「跟随中」点、`CustomNodesSettings` 的两处「解析中」点、`AgentOverlay`
    的三个「正在输入」点全部换成 `StatusDot`（`probing` / `busy` + `pulse`）。
    调用处特有的装饰（状态栏灯的发光描边）经 `className` 传下去，**不要
    另起一个圆点实现**。`AgentOverlay` 的错峰脉冲用 `[animation-delay:0.15s]`
    这类任意值类表达，不再写行内 `style={{ animationDelay }}`。
12. **`animate-pulse` 的「骨架占位」走 `Skeleton`**：`HistoryPanel` 的五条
    骨架、`MaterialLibraryPanel` 的两条、`ModelLibrary`（两处）、
    `WorkshopStageBody` 的懒加载占位全部换成 `ui/skeleton` 的 `<Skeleton>`。
    `Skeleton` 的 `bg-muted` 会被调用处的 `bg-subtle` 覆盖（tailwind-merge
    后面的类赢），所以迁过来时保留原底色类即可。
13. **`ui/progress` 的 `value={null}` 就是「不确定进度」**：定妆照的
    「通道不提供进度」此前自写一条 `animate-pulse` 的满宽条，现在传 `null`
    给 `Progress` —— base-ui 会渲染成不确定进度条（脉动）。**不要传 0 冒充
    确定性进度**（那会把「不知道」画成「刚开始」）。

**收尾批次的另一件事：`dynamic()` 的 `loading` 也归 P3**。
`WorkflowLibrary` 那段「居中 spinner + 文案」的自写加载态换成 `PageLoading`
（块级用 `PageLoading`，第 7 条同一口径）。

**目录豁免的归还进度**：`studio/ui/` 与 `studio/shared/` 当时仍在
`EXEMPT_DIRS` 里（§16.2.3 的「临时豁免」），所以那一批的「清零」只指**已纳入
扫描范围的视图层**。两处豁免的归还即下一节（§16.2.4.3）。

### 16.2.4.1 按钮的语义变体（P1 的前置条件）

把 400 处手写 `<button>` 换成 `<Button>`，**前提是 `Button` 先有对应的语义
变体** —— 否则替换只能靠 `className` 把原样式一字不差搬过去，那既没减少
重复，也把「按钮该长什么样」的决定权继续留在调用处。实测视图里的手写按钮
用的是 `violet / red / rose / emerald / amber / cyan` 六个色系，`Button` 原本
只有 `default / outline / secondary / ghost / destructive / link`，缺口就在这里。

现在 `ui/button.tsx` 的 `variant` 多出 8 支，**按语义角色命名、不按色名**
（§3.6.2：换品牌色时调用处不用改）：

| 变体            | 形态     | 对应视图里的手写写法                                       |
| --------------- | -------- | ---------------------------------------------------------- |
| `primary`       | 品牌软底 | `bg-violet-500/15 text-violet-700 dark:text-violet-300`    |
| `danger`        | 危险软底 | `bg-red-500/10 text-red-700 dark:text-red-300`             |
| `success`       | 成功软底 | `bg-emerald-500/10 text-emerald-700 dark:text-emerald-400` |
| `warning`       | 警告软底 | `bg-amber-500/10 text-amber-700 dark:text-amber-300`       |
| `info`          | 信息软底 | `bg-cyan-500/10 text-cyan-700 dark:text-cyan-300`          |
| `primary-solid` | 品牌实心 | `bg-violet-500/90 text-white hover:bg-violet-500`          |
| `danger-solid`  | 危险实心 | `bg-red-500 text-white`                                    |
| `success-solid` | 成功实心 | `bg-emerald-500 text-white`                                |
| `warning-solid` | 警告实心 | `bg-amber-500 text-white`（设置页批次补出）                |

三条口径：

1. **软底是主力形态**（手写按钮的绝大多数是这个），实心只出**实测用到**的那些色
   —— 首批三色（品牌 / 危险 / 成功），设置页批次按实测补出 `warning-solid`
   （「继续等待视频生成」是实心琥珀，它同时是「进行中」与「需要用户动手」
   两种语义的交叠，软底不足以表达）。**补变体的依据是实测，不是「凑齐色系」**；
2. **每个软底变体的文字档走 `*-strong` token**，不是同色相原色：同一个琥珀
   `#d97706` 当底色可以、当浅底上的文字色对比度不足 —— 这正是「写死字面量」
   表达不了的那层区分（§3.6.2 末尾同款论证）；
3. **既有六个变体一个不动**（`destructive` 仍是软底危险，与 `danger` 并存是
   历史包袱：`destructive` 属 shadcn 名词空间、`danger` 属本项目的语义角色命名。
   新代码用 `danger`，`destructive` 留待随 shadcn 基元一起收口）。

**顺带修掉一颗哑弹**：`--color-success-strong` 一直存在，但
`status-badge.tsx` 引用的 `text-warning-strong` **从未定义过** —— `QUEUED` /
`PENDING` / `DRAFT` 三个状态因此渲染成无色（Tailwind 生成不出这个类，
静默不报错）。本次补齐 `--color-warning-strong` / `--color-danger-strong` /
`--color-info-strong` 两态取值。

**机器判据**：`src/components/ui/button.test.tsx` —— 逐个钉住「这 8 支变体存在」
「产出的类名不含任何 Tailwind 原生调色板字面量」「软底变体的文字走 `-strong`」，
以及「既有 6 个变体仍在」。变体被删或改回写死色，这里先失败。

### 16.2.4.3 UI kit 目录归并（P1 从「已扫描范围清零」到「全库清零」）

台账最后一行的落地。四套「放通用件的地方」收成两处，各自的判据不同：

| 原位置                                                                | 14 个文件的去向                       | 为什么是这里                                                                                                                                                                                           |
| --------------------------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `components/studio/ui/`（11 个）                                      | `components/ui/`，文件名转 kebab-case | 它们是**跨域**的通用件（`SelectMenu` / `ConfirmDialog` / `JsonViewer` / `MediaThumbnail` / `EditableLabel`…），不只 studio 用 —— `app/(main)/settings`、`app/login`、`components/workshop` 都在引      |
| `components/studio/shared/` 的通用件（3 个）                          | `components/ui/`                      | 同上（`SegmentPopover` / `ValidationErrorList` / `SeedModeButton`）                                                                                                                                    |
| `components/studio/shared/` 的表单件（19 个）+ `DynamicWorkflowForm/` | `components/studio/workflow-form/`    | 它们是**工作流参数表单专属**的复合件（`DimensionControl` / `GroupedControls` / `WorkflowFormControls` / `PortHandle`…）：域内共享，不是跨域基元 —— 搬进 `ui/` 只会让「ui/ 是 shadcn 基元」这条口径失真 |
| `components/studio/shared/workflow-io.ts` / `useMiniMapJump.ts`       | `components/studio/` 域根             | 前者是工作流 IO 的纯逻辑（52 处引用），后者是画布视图工具 —— 都不属于「参数表单」                                                                                                                      |

**为什么不是「全部塞进 `ui/`」**：`ui/` 在本仓库有一条明确口径 ——
**shadcn 官方 kebab-case 基元目录**（§12.5 的命名例外正是为它开的）。
把 `DimensionControl` 这种「域内表单复合件」也放进去，等于把「工具生成的基元」
与「业务组合件」混在一层，下一个人 `shadcn add` 时就分不清哪些能重生成。
所以分工是：**跨功能复用 → `ui/`；域内复用 → 本域目录**（§16.2.4 台账原话
「后三处归入 `ui/`，一次搬一个域」按这个口径落成）。

**顺带收掉的同源问题**（这批的真正收获）：

1. **`floating-position.ts` 整个删除**。它承载的「视口翻转 / 收边 / 高度封顶」
   在 §16.2.4 的浮层迁移完成后**只剩自己的单测在用** —— 同一件事（摆位）
   已经由 base-ui 的 Positioner 承担，再留一份自有实现就是第三份口径。
2. **`SeedModeButton` 的视口翻转单测重写**。旧用例断言 `style.top === 324`
   这类**派生像素值**：那是自搓定位的实现细节，换了 Positioner 就整片失效。
   新用例只锁本组件**自己欠的语义**（四个选项、选中态、点击即回调并收起）——
   「把基元的实现细节当成自己的契约」正是这次踩到的坑，写进用例注释。
3. **`ui/` 基元与新家对齐命名**：`ModalDialog`→`ConfirmDialog`、
   `DarkSelect`→`SelectMenu`（后者与 `ui/select` 区分：它是「自定义样式的
   列表菜单」，不是原生 select 的包装）。

**机器判据**：`tests/ui-kit-single-home.test.ts` —— 三个断言：
① 已退役的 `studio/ui` / `studio/shared` 目录**不得复活**；② `ui/` 下全是
kebab-case；③ 除 `ui/` 外没有别的目录在放「与 `ui/` 同名的基元」。
为什么需要它：`EXEMPT_DIRS` 撤掉只保证「再放进去的东西会被数」，
挡不住下一个人 `mkdir studio/ui` 起一套新的 —— **目录本身的存在才是信号**。

### 16.2.4.4 剩下的三条账（基元齐全但没人用 / 两套 token / 余量主题色）

§16.2.4.3 之后，台账里还写着两条「⏳」，加上扫描器里仍有的存量，共三件事。
本节把它们的**当前状态**与**判据**写下来，免得下一轮再重新发现一遍。

**① 基元齐全但没人用**（台账里最后一条硬账）。

`ui/` 的基元数一直在 29~33 之间，但 ISSUE #672 首轮体检实测：**只有 3 个
被业务真正引用**。P1/P2/P3 三条棘轮对这件事**天然无感** —— 它们数的是
「另一种写法出现了几次」，而「零引用的基元」是**没有出现**的那一侧：
`<input>` / `<textarea>` / `<input type="range">` / `<hr>` / 自绘开关
全都不在 P1/P2/P3 的判据里。

本批把「有明确对应场景」的一批接上业务，并把「接上了」变成不可回退的事实：

| 基元                      | 接上的落点                                        | 之前是                                         |
| ------------------------- | ------------------------------------------------- | ---------------------------------------------- |
| `ui/card`                 | `model/ModelCard` 的卡片外壳                      | 手写 `rounded-xl border overflow-hidden`       |
| `ui/badge`                | `ModelCard` 的封面类型徽标                        | 手写 `<span>` + 圆角类                         |
| `ui/input`                | 设置页「用量测试」弹窗的文本输入                  | 手写 `<input className="…rounded-lg border…">` |
| `ui/textarea`             | 设置页提示词 / 工作流导入 JSON / 影片剧本与提示词 | 手写 `<textarea>`（5 处）                      |
| `ui/switch`               | 画布设置与项目设置抽屉的开关                      | **两份**自绘「圆角底 + 绝对定位圆点」          |
| `ui/separator`            | 影片工作台的分隔线                                | `<hr>`（自带 UA 样式）                         |
| `ui/range-slider`（新增） | 训练超参 4 处 + 画布设置滑块                      | `accent-violet-500` 与一处自绘渐变             |

两条口径（写进本节的用意正是它们**反直觉**）：

1. **`ui/switch` / `ui/separator` / `ui/input` 这类「原生元素能直接写」的基元
   也要接**：它们的价值不在「能不能写出来」，而在**样式改动只有一处**。
   两个自绘开关是典型反例 —— 两处同形实现各自维护，改一次要点两遍名。
   （同 §16.2.3 的「同一件事有几份实现」。）
2. **`ui/range-slider` 用原生 `<input type="range">` 而非 `ui/slider`**：
   后者是无原生 input 的复合控件（键盘语义、拖动、a11y 全由 base-ui 自搭），
   替换现有 range 等于**换掉一套交互与 DOM 结构**。本基元的定位是
   「把原生 range 的外观收口到语义 token」——**只接管取材，不接管行为**。
   这与 §16.2.4.2 第 9 条同源：转换的验收标准是**渲染结果不变**。
   两处刻意的手法：已填充段用 `background` 渐变画（`accent-*` 只能染
   WebKit 的轨道与滑块，表达不了「条上直接看出取值」），颜色经
   `color-mix(in srgb, var(--color-*), transparent)` **现取 token**。

**不做的那一批，以及为什么**：见下方 §16.2.4.6 —— 这一批的结论**已经复查过，
不再是「都没有场景」**（原结论把七条整批记成无场景，实测五条是误判）。

**机器判据**：`tests/ui-primitives-coverage.test.ts` —— 逐条断言上表里每个
基元**至少有一个业务消费点**（消费点统计排除 `ui/` 自身与测试）。清单是
**显式**的：要摘掉一个必须改本文件，也就是必须在 Review 里讲清理由。

**② 两套 token 口径**（`shadcn` 别名 vs 项目 `ink-*` / `surface-*`）。

现状：两边**并存**，语义有重叠也有分工 ——
`bg-card` ↔ `bg-surface`、`bg-muted` ↔ `bg-subtle`、
`text-muted-foreground` ↔ `text-ink-muted`、`bg-popover` ↔ `bg-panel`。
实测用量：项目系 `border-border-strong` 191 / `text-ink-muted` 236 /
`bg-surface` 178；shadcn 系 `border-border` 519 / `text-muted-foreground` 320。

**✅ 已合并（本批）**：别名不再自己写字面量，改为**只做 `var()` 转发**到项目
token —— 「合并」这一步**不需要动 `ui/` 里的任何一行**，所以原先记下的那个
顾虑（把基元里的别名改成项目 token、下一次 `shadcn add` 会改回去）**在正确
的合并方式下并不存在**：基元继续写 `bg-card`，变的只是 `bg-card` 背后指向
谁。口径与判据见 **03 §3.6.4**（T1 单向 / T2 不重名 / T3 无环），
`tests/theme-token-single-source.test.ts` 守着。

合并过程中揪出并修掉的**静默 bug**（这是本批最有价值的产出，不是「消除重复」
本身）：`@theme inline` 把 `--color-primary` / `--color-accent` / `--color-muted` /
`--color-border` 四行重定向回别名，而 `@theme` 里同名 token 早有值 —— 编译产物
里同名两处、后者获胜，**项目 token 的含义被静默换成了别名**。
`var(--color-muted)` 在浅色下取到 `#f7f8fa`（近白表面）而不是 `#6b6b76`
（文字灰）—— `.u-chip` / `.u-ghost` 与 `WorkflowNodeJsonPopover` 的小字在浅色
下几乎看不见，而 tsc / eslint / 主题色扫描器**全绿**。

**可观测的行为变化只有 4 处，逐条列出**（UI 一致性改动不许藏差异）：

| token                    | 变化                  | 说明                                                                |
| ------------------------ | --------------------- | ------------------------------------------------------------------- |
| `--color-muted`（深）    | `#9a9aad` → `#141419` | 名字归位：它是 shadcn 的**表面**语义（`bg-muted`），浅色档本就如此  |
| `--secondary`（深）      | `#16161c` → `#141419` | 归一化到 `--color-subtle`（浅色档不变；原深色档与浅色档语义不一致） |
| `--sidebar-accent`（深） | `#16161c` → `#141419` | 同上（`--sidebar*` **零引用**）                                     |
| `--sidebar`（浅）        | `#ffffff` → `#f0f1f5` | 归一化到 `--color-panel-deep`（`--sidebar*` **零引用**）            |

另新增两颗项目 token：`--color-on-brand`（品牌实心底上的文字色）与
`--color-ring-shadow`（浮层 1px ring，原先只存在于别名里）。**编译产物的
utility 类集与合并前逐字节一致**（`bg-muted` / `text-muted` 这类靠桥生成的
类没有掉过一个），用脚本对过全量清单。

**顺带修掉的语义错位**：`var(--color-muted)` 被 6 处当「弱文字」用
（`globals.css` 的 `.u-chip` / `.u-ghost`、`WorkflowNodeJsonPopover` ×4），
它的正主是 `--color-ink-muted` —— 那 6 处已改到正确 token 上。

**③ 余量主题色**：上一批把**表面/文字语义**的写死色值清了 27 处
（142 → 115），本批把剩下的 115 处**逐条定性完毕**（详见 §16.2.4.5）。

## 16.2.4.5 状态色收口与「逐条定性」（ISSUE #672，机器强制）

§16.2.4.4 的三条账里，① 与 ③ 在本批收口。收口的实质不是「又清了几个文件」，
而是**把三处一直没人管的重复收成一处、把 115 处余量逐条定性**。

**① 状态徽标 / 状态圆点：配色从此只有一处。**

| 形态     | 此前                                                                                                                                                                                                                      | 现在                                                                                 |
| -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| 状态胶囊 | **七个文件**各写一份「状态 → 配色」表（任务历史 `STATUS_STYLE`、执行日志两份 `statusClass`、项目产出 `STATUS_CHIP`、画布节点 `CanvasNodePrimitives.StatusBadge`、自定义节点设置两份、工坊三处 `StatusBadge`/`ClipBadge`） | `ui/status-badge.tsx` 一份（`dot` 形态供独立徽标、`dot={false}` 供叠在媒体上的角标） |
| 状态圆点 | 四处各写一份（`ui/status-dot` 已有实现，但视图里仍有 `bg-emerald-400` / `bg-cyan-400` / `bg-success-strong` 的手写 span）                                                                                                 | `ui/status-dot` 唯一实现                                                             |

**文案不进基元**：同一个状态在不同界面叫法不同（任务历史「已完成」/ 画布节点
「运行后生成」/ 镜头「片段就绪」），那是**业务文案**；基元只负责「状态 →
配色」。画布小写词（`idle`/`running`/`done`/`error`）到大写状态键的映射收在
`lib/project-canvas/canvas-types.ts` 的 `STATUS_BADGE_KEY`，与 `STATUS_LABEL`
并排 —— 此前两处徽标各写一份映射，改一处漏一片。

**② 余量主题色 115 处 → 逐条定性（基线归零）。**

口径就是 §3.6.1 末段那句「存量必须逐条定性，登记进 `EXEMPT_TABLES`（带理由）
或就地 token 化」——**放进存量里等于两者都不是**。115 处的去向：

| 去向                                                                             | 处数 | 典型落点                                                                                                                        |
| -------------------------------------------------------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------------------- |
| **就地 token 化**（新增 `--color-edge-flow-*` 四档 + `--color-edge-focus-halo`） | 5    | `ProjectCanvas` 的连线渐变四档、`ProjectEdge` 的选中光晕                                                                        |
| **就地 token 化**（写死的透明色 → `color-mix` 现取）                             | 4    | `HomePage` 的类别底色 `bg-[${color}/15]`：Tailwind JIT 扫不到运行时模板，**那条写法从来就没生效过**                             |
| **就地 token 化**（状态色 → 语义类名）                                           | 9    | `CustomNodesSettings` 的两份 `rgba`/`hex` 状态表                                                                                |
| **登记进类型色例外**                                                             | 97   | 画布连线 / 端口 / 节点模式 / 角色 / 类别色常量表（含 `workflow-node-palette` 的三个两态外观表、`RgthreeBodies` 的 3D 光照参数） |
| **登记进固定暗色清单**                                                           | 2    | `ui/water-fill-progress` 的水幕（极小块叠层 + 刻意保留 ~0.9 让底层内容可见，两条判据都成立）                                    |

**「零基线」本身防不住什么**（所以配了测试）：棘轮为 0 之后，把一处**真漏改**
顺手登记进 `EXEMPT_TABLES` 是唯一能让数字变漂亮又不改代码的动作 —— 豁免不计入
基线，登记完就再也不会出现在报告里。`tests/check-theme-colors.test.ts` 因此钉住：
**每条豁免必须带说清「为什么这行色值是内容自己的颜色」的理由**（不能一句
「类型色」了事）。

### 16.2.4.6 零引用基元的分档复查（`tabs` / `accordion` / `scroll-area` / `avatar` / `alert` / `dropdown-menu` / `form`）

> 这一节替代了原先那句「七条在本应用里**没有对应场景**」。**它是一次误判，
> 而且是「按名字比、没按形态找」造成的** —— 复查时逐条去找「库里谁在实现
> 这件事」，七条里五条都有实打实的落点。教训与 §12.12 的孪生对判据同源：
> 判「重复」不能按文件名比，要按**形态**比。

实测引用数（业务侧引用 `~/components/ui/<name>` 的文件数，排除 `ui/` 自身与测试）：
**七条全为 0**。所以「没人用」是事实 —— 但**「没人用」与「没场景」是两件事**，
下面按落点分三档。

#### 第一档：有明确落点，欠治理（待接）

| 基元            | 库内实际的对应形态                                                                                                                                                                                                                                                                                                                                                           | 判断依据                                                                                                                                                                                                                                                                  |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`          | `workflow-library` 详情面板三页签（自绘 `TabButton`：手动 `h-auto rounded-none` + 靠 `active` 条件渲染一条 `absolute inset-x-3 bottom-0 h-0.5` 渐变指示条）；应用级页签 `TitleBarTabs` / `ShellTabs` 已有完整 `role="tablist"` / `role="tab"` / `aria-selected` + Enter/Space 键盘处理                                                                                       | 形态是**标准页签**：`ui/tabs` 的 `line` 变体本身就带 `after:` 指示条与方向键导航，`tabIndex` / `aria-selected` / 键盘三件套全在基元里                                                                                                                                     |
| `alert`         | 至少 6 处「带语义色边框 + 图标 + 正文」的内联提示块：登录页 `notice`（`border-violet-500/30 bg-violet-500/10`）、训练页「未配置训练后端」横幅（`border-warning/30 bg-warning/10`）、画布节点 `ErrorPanel` 的参数提示（`border-warning/25 bg-warning/8`）、`CharacterPortraitStudio` 的 `role="alert"` 错误行（写死 `bg-red-100 text-red-800 dark:text-red-300`）、设置页若干 | 这正是 `ui/alert` 的 `variant=default\|destructive` 的形态；其中 `CharacterPortraitStudio` 那处**已经写了 `role="alert"`**，只差把外壳换成基元                                                                                                                            |
| `dropdown-menu` | 两处自绘菜单：画布右键菜单 `CanvasContextMenu`（`fixed` + `style={{left:x,top:y}}` 手定位 + 自绘遮罩关闭 + 手写分组标题/分隔线）、项目切换器 `ProjectSwitcher`（`absolute top-10 left-0` 手定位 + 同样的遮罩与分组/分隔线）                                                                                                                                                  | 形态是**菜单**（一组命令项 + 分组标签 + 分隔线），不是选择框 —— `ui/select`（值选择）与 `ui/select-menu`（列表选择）都覆盖不了「点一项执行一个动作」。`ui/dropdown-menu`（base-ui `Menu`）自带 Portal / Positioner / Esc / 外点关闭 / 方向键 / `GroupLabel` / `Separator` |

这三条的**共同点**：现状是「自绘外壳 + 手写交互语义」，而基元的交互语义是现成的；
接上与 §16.2.4.2 第 9 条一致 —— **正确做法是同时删掉调用处那份手写语义**
（见 §16.2.4 末的「P2 的做法」），只换容器会留下两套 Esc / 两套外点关闭。

> ⚠️ `tabs` 的两处落点里，**应用级页签（`TitleBarTabs` / `ShellTabs`）不建议接**：
> 它们是「窗口标题行」的一部分，页签条里混着拖拽区与窗口按钮，
> `TabsList` 的 `inline-flex w-fit` + 各项 `flex-1` 布局契约与「页签按内容宽度
> 排布、右侧留出拖拽空白区」直接冲突。这属于**外观会变**，按第 9 条不动。
> 详情面板那一处才是干净的落点。

#### 第二档：选型未发生，不是「欠治理」（须先决策）

| 基元      | 实测                                                                                                                                                                                          | 为什么不是「待接」                                                                                                                                                                                                                                                            |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/form` | **全库零 `useForm(` 调用**；`react-hook-form` 只被 `ui/form.tsx` 自己 import；`@hookform/resolvers` 与 `zod` 在 `package.json` 里，但业务侧无人组装 `useForm({ resolver: zodResolver(...) })` | 接它**不是换组件**：`ui/form` 是 RHF 的 `FormProvider` + `FormField` 包装，用上它意味着这个功能的状态与校验改由 RHF 管 —— 那是**数据层设计决定**，得先定「哪些表单迁、校验规则谁持有」。这一条按「另开一次设计决定」处理，与本文件 §16.2.4.4 ② 当年对待「两套 token」同一口径 |

顺带澄清一个容易混的命名：`WorkflowFormControls.tsx` / `DynamicWorkflowForm/` 里的
「Form」指**工作流参数表单**（由 `workflowIO` 动态生成），与 `ui/form`（RHF 族）
没有任何关系 —— 按目录名找会误判成「已经在用了」。

#### 第三档：确有近似形态，但接上会改变外观或交互语义（按现状不动）

| 基元          | 近似形态                                                                                                                                               | 为什么不动                                                                                                                                                                                                                                                                                                                           |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scroll-area` | 全库 **57 个文件**在用 `overflow-y-auto` / `overflow-auto` 的滚动容器                                                                                  | `ui/scroll-area` **不是** `overflow:auto` 的样式包装：它套 base-ui 的 `Root` + `Viewport` + 自绘 `ScrollBar`，要求显式高度契约（`Viewport` 撑满 `Root`）。现有容器绝大多数高度由 flex 链推出、滚动条是**原生**的；换上等于同时改滚动条外观、滚动行为与布局约束 —— 这是「换一套交互」，不是「收口取材」                               |
| `accordion`   | 6 个文件用原生 `<details>/<summary>`（历史详情原始 JSON、节点错误面板参数、工坊三处生成过程），另有若干 `{isOpen && …}` 条件渲染的展开块（训练页日志） | 原生 `<details>` 的**展开态是浏览器原生 a11y 语义**（`<summary>` 自带可聚焦与 toggle 角色）且支持「查找时自动展开」；`accordion` 的价值在于「一组互斥面板 + 动画 + 键盘导航」，而这 6 处是**单个独立折叠块**，没有互斥分组。训练页的 `{isOpen && …}` 反而更像 accordion 的落点，但它当前是按钮触发的，接上要改触发器形态（外观会变） |
| `avatar`      | 首页顶栏一个 `u-avatar`（纯 CSS 底 + 圆形 div），工坊 5 处「首字母圆形徽标」                                                                           | 两者都不是**头像**：顶栏那个没有图片（`AvatarImage` 无从渲染、`AvatarFallback` 恰好够用但换成基元只多一层嵌套），工坊那 5 处是**首字母初值**徽标（`bg-primary-soft` + 单字），语义是「角色编号」不是「用户头像」。接上基元 = 为一个 div 加两层包装                                                                                   |

**判据归属**：§16.2.4.4 ① 的 `REQUIRED_CONSUMERS` 清单仍然是「**已经用上的不许
掉回 0**」；第一档（`tabs` / `alert` / `dropdown-menu`）接上后**同批登记进该清单**。
第二、三档**不登记**，理由就写在上面两张表里 —— 这与该文件头部注释
（「判据刻意只钉已有落点、不要求穷尽」）同源。

**这一节的用法**：下一轮做「零引用基元」时，**不要**再按目录名扫一遍「有没有
出现 `tabs` 这个词」，而要按**形态**找（「谁在实现一组切换面板」）。这次误判的
根因就是按名字比。

## 16.3 新增一个组件的标准动作

```bash
# 项目已装 shadcn，直接：
shadcn add dialog form input select
# 或显式锁定版本：
pnpm dlx shadcn@latest add dialog form input select
```

- 生成后校验：文件名 kebab；导入路径用 `~/components/ui/<name>`。
- shadcn CLI 默认写 `@/` 别名（`components.json` 的 alias 是 `~/`，CLI 生成的
  组件仍可能带 `@/`）；本仓库用 `~`，生成后**顺手把 `@/` 改成 `~/`**，
  保持 `~/components/ui/<name>` 一致。这条不再靠人记：`scripts/check-import-alias.cjs`（R13，见 [12 §12.8.0](12-代码组织与文件结构.md#1280-import-别名只有一种-issue-640机器强制)）
  会在提交阶段拦下 —— 而 `ui/` 是「工具生成、尽量不手改」的目录，正是漂移的高发区。
- 不要从 radix 版 shadcn 仓库复制组件；遇到缺失原语用 `shadcn add` 生成 base-ui 版。

## 16.4 表单方案：shadcn Form + react-hook-form + Zod（schema 驱动 + 自动校验）

### 现状核对（2026-09-02）

| 所需                         | 状态               |
| ---------------------------- | ------------------ |
| `zod`（schema）              | ✅ 已具备 `zod@^4` |
| `@base-ui/react`             | ✅ 已具备          |
| `react-hook-form`            | ❌ 缺失            |
| `@hookform/resolvers`        | ❌ 缺失            |
| `src/components/ui/form.tsx` | ❌ 未生成          |

### 一次性启用（注意 registry 阻塞）

> 本仓库 `components.json.registries` 当前为空。shadcn 4.x 采用 registry 模型，裸 `shadcn add form` 会**静默不生成**（仅打印 "Checking registry" 后退出）。这是 registry 配置问题，不是方案问题。

启用步骤：

1. 确认/配置团队 shadcn registry（或临时用 `shadcn add @shadcn/form`）。生成产物为 **base-nova / base-ui 版** `src/components/ui/form.tsx`——底层 `@base-ui/react` 已导出 `Form`（`onFormSubmit(formValues)`、`validationMode`）与 `Field` 原语，shadcn 的 `form.tsx` 即 RHF `Controller` + base-ui `Field` 的封装。
2. 安装运行时依赖（若 `shadcn add` 未自动装）：
   ```bash
   pnpm add react-hook-form @hookform/resolvers
   ```
3. 校验：`src/components/ui/form.tsx` 存在，且 import 来自 `@base-ui/react`（**非** `@radix-ui/*`）。

> 当前状态（2026-09-02，已补齐）：`zod@4` ✅；`react-hook-form@7.87` ✅；`@hookform/resolvers@5.9.1` ✅；`src/components/ui/form.tsx` 已生成（base-ui 兼容：RHF `Controller` + 项目 `Label`，`FormControl` 用 `cloneElement` 透传 `id`/`aria-*`，未引入 radix 依赖）。开箱即用。

### 最小范式（schema 驱动 + 自动校验）

```tsx
"use client";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form";
import { Input } from "~/components/ui/input";
import { Button } from "~/components/ui/button";

// 1) schema 单一真相源
const schema = z.object({
  email: z.string().email("邮箱格式不正确"),
  password: z.string().min(8, "至少 8 位"),
});
type LoginValues = z.infer<typeof schema>; // 前后端共用此类型

export function LoginForm() {
  const form = useForm<LoginValues>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
    mode: "onBlur", // 校验时机：失焦校验，可改 onChange/onsubmit
  });
  return (
    <Form {...form}>
      <form
        onSubmit={form.handleSubmit((v) => submit(v))}
        className="grid gap-3"
      >
        <FormField
          control={form.control}
          name="email"
          render={({ field }) => (
            <FormItem>
              <FormLabel>邮箱</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        {/* password 同理 */}
        <Button type="submit" disabled={form.formState.isSubmitting}>
          登录
        </Button>
      </form>
    </Form>
  );
}
```

- 校验时机：`mode` 默认 `onSubmit`；交互场景用 `onBlur` / `onChange`。
- **服务端复用同一 `schema`**（`z.infer` 出类型）→ 前后端类型一致，杜绝漂移。
- 错误信息集中在 `schema` 的第二个参数；文案与规则绑定，改动只在一处。

## 16.5 方案评判与备选（请给出结论）

| 方案                                | 类型安全                   | 性能                   | 与 shadcn 集成                         | 本项目适配               |
| ----------------------------------- | -------------------------- | ---------------------- | -------------------------------------- | ------------------------ |
| **RHF + Zod + shadcn Form**（推荐） | 良（`z.infer`）            | 优（非受控，少重渲染） | 官方范式，`form.tsx` 已对 base-ui 适配 | ✅ 最契合                |
| TanStack Form                       | 极佳（编译期推断、无 ref） | 优                     | 需手动接 shadcn                        | 可选，追求极致类型时评估 |
| 受控 + `zod.safeParse`              | 良                         | 差（每次按键重渲染）   | 无                                     | 仅极简小表单             |
| Conform                             | 良                         | 优（渐进增强）         | RSC 向                                 | 本客户端重 SPA 不太契合  |

**结论**：本项目（Next 16 + React 19 + `@base-ui/react` + shadcn `base-nova`）采用 **react-hook-form + Zod + shadcn Form** 为最佳默认：

- shadcn 官方范式，`form.tsx` 已对 base-ui 适配，开箱即用；
- 非受控、校验与 UI 解耦、生态最大、文档最全；
- 与既有 `zod@4` 无缝衔接，schema 同时驱动前后端类型。

## 16.6 团队 Registry（本地，base-ui 兼容）

> 没有公共 shadcn registry，团队自建本地 registry，供 `shadcn add @comfy-app-t3/<comp>` 使用。

### 目录（本地，独立于项目仓库）

```
D:/dev/Comfy-APP-T3/registry/
├── index.json            ← 注册表索引（= r/registry.json）
├── r/
│   ├── registry.json     ← 索引副本（shadcn list 需要）
│   ├── form.json         ← 各组件 manifest（含内联源码 content）
│   ├── button.json
│   ├── input.json
│   ├── label.json
│   ├── textarea.json
│   ├── select.json
│   └── switch.json
├── serve.mjs             ← 本地静态服务（Node，修复 Windows 路径）
└── gen.mjs              ← 批量生成器：从 src/components/ui/*.tsx 抽依赖并写 r/<name>.json
```

`index.json` + `r/registry.json` 已登记并内联全部 28 个 `ui/` 组件源码（base-ui 版）。

### 启动本地服务（必须，shadcn CLI 不支持 `file://`）

双击 `tools\registry\start-registry.ps1`（或手动）：

```bash
node D:/dev/Comfy-APP-T3/registry/serve.mjs {{registry.port}}
# → http://127.0.0.1:{{registry.port}}   （前台运行；关掉终端即停；端口占用会提示已在运行）
```

### 项目侧注册（`components.json` 已配）

```json
"registries": {
  "@comfy-app-t3": "http://127.0.0.1:{{registry.port}}/r/{name}.json"
}
```

### 使用

```bash
# 列出团队组件
pnpm exec shadcn list @comfy-app-t3
# 查看单个组件 manifest
pnpm exec shadcn view @comfy-app-t3/form
# 安装（生成的 base-ui 版会写入 src/components/ui/）
shadcn add @comfy-app-t3/form @comfy-app-t3/select
```

### 新增/更新一个团队组件

- **批量（推荐）**：改完 `src/components/ui/*.tsx` 后跑 `node D:/dev/Comfy-APP-T3/registry/gen.mjs`，自动抽依赖、写 `r/<name>.json`、重建 `index.json` + `r/registry.json`（已存在的 manifest 不会被覆盖，保留手调内容）。
- **手动**：复制源码到 `r/<name>.json` 的 `files[].content`（`target` 指定落地 `src/components/ui/<name>.tsx`），并在 `index.json` + `r/registry.json` 的 `items` 登记 `name`/`type: registry:ui`/`title`/`description`/`dependencies`/`registryDependencies`。
- 服务已在跑则立即生效，无需重启。

> 注意：`components.json` 指向的是本地 dev 服务 `127.0.0.1:{{registry.port}}`，仅本机/团队内网可用；若要对外共享，把 `registry/` 推到任意可 HTTP 访问的位置并改 URL 即可。

**何时换 TanStack Form**：当表单出现"超复杂动态字段 + 极致类型推导"需求（如字段级条件联动、嵌套数组的严格推断），TanStack Form 的 headless + 编译期类型推断更省心（无 `Controller`/`ref` 心智负担）。其余情况保持 RHF + Zod。

## 16.6 base-ui 注意事项

- 所有 shadcn 组件须为 **base-ui 版**（风格 `base-nova`）。
- 若 `shadcn add form` 生成的 `form.tsx` 误引 `@radix-ui/*`，改回 `@base-ui/react` 对应导出（Label/Form 原语）。
- 不要从 radix 版 shadcn 复制组件进 `ui/`。

## 16.7 不碰 ui/ 的硬规则（与 §12 一致）

- 文件名 kebab（R1(ui) 硬规则，提交即卡）。
- 不手工编辑 `ui/` 内组件源码；界面变更通过 `shadcn add` 重生成，或在使用处以 `className` 覆盖。
- 业务表单/页面放在 `src/components/<feature>/`、`src/app/`，只 `import ~/components/ui/*`。
- 新增原语一律走 `shadcn add`，不要把整段 UI 逻辑写进 `ui/`。
- **新增视图代码前先查 `ui/` 有没有现成基元**（§16.2.3 的棘轮会在提交阶段拦下
  手写 `<button>` / 自建 portal / 自写 spinner）。需要覆盖样式就在使用处以
  `className` 覆盖或扩展 `cva` 变体，**不要**在原地另起一份实现。
