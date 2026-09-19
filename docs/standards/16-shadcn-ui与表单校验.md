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

**判据**（`scripts/check-ui-primitives.cjs`，基线
`scripts/.ui-primitives-baseline.json`）：

| ID     | 判据                                                                   | 应改用什么                                                                                                                                                                             |
| ------ | ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **P1** | 视图层手写 `<button`                                                   | `~/components/ui/button` 的 `<Button>`（缺语义变体就先补变体）                                                                                                                         |
| **P2** | 视图层自建 `createPortal(` 浮层                                        | `ui/dialog` / `ui/popover` / `ui/sheet` / `ui/dropdown-menu`                                                                                                                           |
| **P3** | 视图层自写 `animate-spin` / `animate-pulse`                            | 块级加载态 → `ui/page-loading` 的 `PageLoading`；行内 / 按钮内 → 同模块的 `Spinner`；占位 → `ui/skeleton`；进度 → `ui/progress`；状态圆点的脉冲 → `ui/status-dot` 的 `StatusDot pulse` |
| **P4** | 视图层自写 `::-webkit-scrollbar` 外观                                  | `globals.css` 的三个具名类：`.custom-scrollbar`（密集日志区）/ `.soft-scrollbar`（文字编辑区）/ 全局兜底（见 §16.2.4.9）                                                               |
| **P5** | 视图层自写剪贴板写入（`navigator.clipboard` / `document.execCommand`） | `~/lib/browser-io` 的 `copyText`（含降级链路与 `navigator` 存在性判定）                                                                                                                |
| **P6** | 视图层自写 Blob 下载（`URL.createObjectURL`）                          | `~/lib/browser-io` 的 `downloadText` / `downloadJson`（`revoke` 与 `click` 的顺序收在出口里）                                                                                          |
| **P9** | 视图层自绘模态浮层（视图里出现 `overlayClass(`）                        | `ui/dialog` 的 `Dialog` / `DialogContent`（居中卡片）或 `ui/sheet` 的 `SheetContent`（右侧抽屉）；全屏视图走 `ui/fullscreen-dialog` / `FullScreenLayer`（见 §16.2.4.12）                 |
| **P10** | 视图层自绘折叠 / 展开开关（`<details>` 或 `role="button"` + `▸/▾`）     | `~/components/ui/disclosure` 的 `Disclosure`（见 §16.2.4.13）                                                                                                                          |
| **P11** | 视图层自绘可滚动浮层选项列表（同文件里既建 `PopoverTrigger` 又画 `▾`） | `~/components/ui/option-list-popover` 的 `OptionListPopover`（见 §16.2.4.14）                                                                                                          |
| **P12** | 视图 / 逻辑层里自写 `setInterval(` 轮询                                 | `~/components/ui/use-interval` 的 `useInterval`（见 §16.2.4.15）                                                                                                                       |
| **P13** | 视图 / 逻辑层里自写搜索关键字归一化（`.trim().toLowerCase()`，**或只 `trim()`**） | `~/lib/list-filter` 的 `normalizeNeedle` / `matchesNeedle` / `filterGroups`（见 §16.2.4.16）                                                                                 |
| **P14** | 视图里自写展开集合的翻转样板（`{ ...src, [key]: !src[key] }`）           | `~/components/ui/expansion-set` 的 `useExpansionSet`（见 §16.2.4.17）                                                                                                                 |
| **P15** | 视图里自写面板加宽档的三元（`<flag> ? <X>.wide : <X>.base`）             | `~/components/ui/wide-panel` 的 `useWidePanel` / `WidePanelToggle`（见 §16.2.4.18）                                                                                                   |
| **P16** | 视图里自绘进度条填充（`style={{ width: \`${…}%\` }}`）                   | `~/components/ui/progress-bar` 的 `ProgressBar`；**数值**（夹取 / 比例 / 下限可见宽度）走 `~/lib/progress` 的 `clampPct` / `toPct` / `pctToWidth`（见 §16.2.4.19）                       |
| **P17** | 视图里自写键值行（muted/faint 标签叶子 + `displayValue(` / `JSON.stringify(` 值） | `~/components/ui/key-value-rows` 的 `KeyValueRows`（四种布局；缺值仍走 `~/lib/display-value`，见 §16.2.4.20）                                                                  |

**P4~P17 与 P1~P3 的性质不同，别混**：P1/P2/P3 是**计数棘轮**（先冻结存量、逐批降）；
P4~P17 一上来就是**硬闸** —— 「自绘滚动条 / 写剪贴板 / 触发下载 / 手工文件选择 /
缺值占位符 / 模态浮层 / 折叠开关 / 浮层选项列表 / 轮询 / 搜索归一化 / 展开集合 /
加宽档 / 进度条 / 键值行」这十四件事的**定义**只能有一处，没有「冻结在某个数字」
的中间态可言。
因此它们**不进基线**（`--update` 也不接受带违规的基线，否则「把违规一起写进
基线」就成了唯一的绕过方式）。
清零过程：P4 见 §16.2.4.9、P5/P6 见 §16.2.4.10、P7/P8 见 §16.2.4.11、
P9 见 §16.2.4.12、P10 见 §16.2.4.13、P11 见 §16.2.4.14、P12 见 §16.2.4.15、
P13/P14/P15 见 §16.2.4.16 ~ §16.2.4.18、P16/P17 见 §16.2.4.19 ~ §16.2.4.20。

**P4~P17 当前都是硬闸**（基线里已无条目，新增任何自实现直接被阻断）：
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

#### 16.2.3.1 浮层的「位置由谁定」：有锚点就必须交给 Positioner（ISSUE #717）

P2 把浮层收拢到 `ui/` 原语时踩过一个坑，值得单独立一条判据：**收拢容器不等于
收拢定位**。

节点 JSON 浮层的触发者是画布节点里的 `#id` 芯片，浮层却是由 store 打开的。
迁移时它被换成了 `ui/dialog` 配 `popupClassName="fixed top-24 left-1/2 …"` ——
看起来「自定义了这一处的位置」，实际是**丢掉了锚点定位**：`DialogContent` 的
Popup 基类自带 `top-1/2 -translate-y-1/2`，调用处的 `top-24` 覆盖不掉它，
两者叠加把浮层推到视口之上（实测 `top: -174`），头部与正文开头整片裁在窗口外。

**判据**：浮层的定位应当由基元的 Positioner 负责（`ui/popover` 可传 `anchor`，
支持元素 / 虚拟元素 / `{ getBoundingClientRect }` 形式的回调），翻转（flip）与
视口内收边（shift）也由它算 —— **不要在调用处手写 `top` / `left` / `translate`
去夹紧视口**：那既覆盖不掉基类自带的定位，也是第三份「摆位」口径
（§16.2.4.3 已把 `computePos` 这类派生像素值整片删掉过一次）。

`ui/dialog` 的 Popup 里**没有** Positioner，结构上就表达不了锚点定位；有锚点的
浮层一律走 `ui/popover`。没有锚点（居中模态）才用 `ui/dialog`。

**验证口径**：这类「位置对不对」的问题，单测只能锁结构（浮层挂在 Positioner 里、
关闭语义齐全），**别断言 `style.top` 这类派生像素值**（同 §16.2.4 的
`seed-mode-button` 那条）；四边是否真的在视口内，用真实浏览器按两档窗口
（宽窗 / 窄窗）各验一次。

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

| 形态             | 现状                                                                                                                                                                                              | 去向                                                                                                                                          | 状态                                        |
| ---------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| 对话框/浮层      | ~~`ui/dialog.tsx`（业务零引用） / `studio/ui/ModalDialog.tsx` / 10 个文件各自 `createPortal`~~                                                                                                    | `ModalDialog` 改基于 `ui/dialog`；10 处自建 portal 全部换成 `ui/dialog` / `ui/popover` / `ui/sheet`                                           | ✅ **P2 完成（P2 判据清零）**               |
| 空态             | ~~`ui/empty-state.tsx` / `studio/ui/EmptyState.tsx` / `DynamicWorkflowForm/sections/EmptyStateHint.tsx` 三份~~                                                                                    | 合并到 `ui/empty-state.tsx`（props 取并集，`variant` 分流 `page`/`error`/`hint`）                                                             | ✅ **P2 完成**                              |
| 按钮             | ~~`ui/button.tsx` + 视图里的 400+ 处手写 `<button>`~~                                                                                                                                             | P1 棘轮逐批换 `<Button>`；变体见 §16.2.4.1                                                                                                    | ✅ **P1 判据清零**（分 5 批，见 §16.2.4.2） |
| 加载态           | `ui/skeleton.tsx` / `ui/progress.tsx`（均零引用）+ 17 个文件自写 spinner                                                                                                                          | P3 棘轮；`ui/page-loading` 的 `Spinner` 是**内联**加载态的唯一出口（按钮内/一行文字里）                                                       | ✅ **P3 判据清零**                          |
| 状态圆点         | ~~ComfyUI / Drizzle Studio / Ollama 三条状态行各自写一份四分支三元套娃 + 各写各的 `bg-emerald-400` 等色值~~                                                                                       | `ui/status-dot.tsx` 的 `StatusDot`（状态语义 `up`/`busy`/`probing`/`down` → 语义 token）                                                      | ✅ **全库唯一实现（余量见 §16.2.4.5）**     |
| 状态胶囊         | ~~**七个文件**各写一份「状态 → 配色」表（`emerald-500/15` / `emerald-400/10` / `emerald-100` 三种深浅各不相同）~~                                                                                 | `ui/status-badge.tsx` 一份（`dot` 形态 / `dot={false}` 角标）；文案留在调用处                                                                 | ✅ **见 §16.2.4.5 ①**                       |
| UI kit 目录      | ~~`components/ui/`（33）/ `components/studio/ui/`（11）/ `shared/` / `DynamicWorkflowForm/sections/`~~                                                                                            | 见 §16.2.4.3                                                                                                                                  | ✅ **归并完成（豁免已归还）**               |
| 基元齐全但没人用 | ~~`card` / `badge` / `input` / `textarea` / `switch` / `separator` 引用数为 0~~                                                                                                                   | 接上有明确场景的一批，其余记为「有基元、无场景」                                                                                              | ✅ **见 §16.2.4.4 ①**                       |
| 两套 token 口径  | ~~`shadcn` 别名与项目 token **各写一份字面量**（同一颜色 2~3 份拷贝）~~                                                                                                                           | 别名**只做 `var()` 转发**（项目 token 是唯一事实来源）；`@theme inline` 不再重定义项目 token                                                  | ✅ **已合并，见 §16.2.4.4 ② / 03 §3.6.4**   |
| 余量主题色       | ~~115 处写死色值「既不是豁免、也不是待治理项」~~                                                                                                                                                  | 逐条定性：token 化 18 处 / 登记豁免 97 处 / 进固定暗色清单 2 处                                                                               | ✅ **基线归零，见 §16.2.4.5 ②**             |
| 滚动条外观       | ~~`.custom-scrollbar`（`globals.css`）与 `SCROLLBAR_VISIBLE_CLASSES`（视图里的任意值变体）**各写一份**自绘滚动条外观，取值已漂移~~                                                                | `globals.css` 是三档的唯一出口（`.custom-scrollbar` / `.soft-scrollbar` / 全局兜底），取值逐条保留；P4 硬闸禁止视图再写 `::-webkit-scrollbar` | ✅ **见 §16.2.4.9**                         |
| 表单校验规则     | ~~`ui/form`（RHF 族）零引用，规则该归谁持有**未决策**~~                                                                                                                                           | **决定不接**：字段级规则住 `src/lib/<domain>/*-schema.ts` 的纯函数，集合级留 controller                                                       | ✅ **已决策，见 §16.2.4.8**                 |
| 剪贴板写入       | ~~**4 份实现**（`copyText` / `copyLogText` / 两处内联），其中 6 个落点**完全没有降级链路**——可选链在 Tauri 的 `http://` 非安全上下文里把失败吞掉~~                                                | `~/lib/browser-io` 的 `copyText`（两条通道 + `navigator` 判定）；P5 硬闸禁止视图再写 `navigator.clipboard` / `execCommand`                    | ✅ **见 §16.2.4.10**                        |
| Blob 下载        | ~~**7 份实现**，`revokeObjectURL` 与 `click()` 的**先后顺序不统一**（先 revoke 会让大文件拿到失效 URL）~~                                                                                         | `~/lib/browser-io` 的 `downloadText` / `downloadJson`；P6 硬闸禁止视图再写 `URL.createObjectURL`                                              | ✅ **见 §16.2.4.10**                        |
| 相对时间         | ~~**5 份实现**，档位/后缀各不相同（`workspace` 与 `WorksGallery` 两份逐字相同）~~                                                                                                                 | `~/lib/time-format` 的 `timeAgo`（`maxDays` / `suffix` 承载差异）；域模块保留原名转发                                                         | ✅ **见 §16.2.4.10**                        |
| 时刻格式化       | ~~**6 份实现**，带毫秒的两处逐字相同；`workshop` 4 处**连区域设置都没固定**~~                                                                                                                     | `~/lib/time-format` 的 `formatClock`（`millis` 档）；跨天补日期留在 `logs/log-format.ts`                                                      | ✅ **见 §16.2.4.10**                        |
| 字节容量         | ~~**3 份实现**（`fmtBytes` / `fmtSize` / `formatSize` **三个名字**），而 `src/lib/format-bytes.ts` 早就在；1024 字节整这一档还敢给出不同答案~~                                                    | `~/lib/format-bytes` 的 `fmtBytes`（既有出口，本批把两处漏网的接上）                                                                          | ✅ **见 §16.2.4.10**                        |
| 隐藏文件选择框   | ~~**9 份实现**（`useRef` + `ref.current?.click()` 6 处、`<label htmlFor>` 隐式关联 2 处、input 直接露在界面 1 处）；多数落点**没有复位 `event.target.value`** —— 连选同一个文件不触发 `change`~~  | `~/components/ui/file-picker` 的 `useFilePicker` / `FilePickerButton`；**P7 硬闸**禁止视图再写「隐藏 input + 手工触发」                       | ✅ **见 §16.2.4.11**                        |
| 一次性反馈       | ~~**6 份实现**，分两族：4 处裸 `setTimeout(() => setX(false), 1xx)`（**连卸载都不管**）、2 处手写 `timerRef` + `clearTimeout`；复位时长 1200/1400/1500/8000 各不相同且**没有一处说得清为什么**~~  | `~/components/ui/use-flash-state` 的 `useFlashState`（单值）/ `useFlashLatch`（多字段同生共死）；`DEFAULT_FLASH_MS` 是唯一默认值              | ✅ **见 §16.2.4.11**                        |
| 模态浮层         | ~~**16 个视图**各拼一份 `overlayClass("modal", …)` 外壳（**一处 `createPortal` 都没有** —— 所以 P2 全库清零之后这批依然漏过）；a11y 语义各写各的：16 份里**只有 3 份**接 Esc、**3 份**声明 `role="dialog"`、**0 份**做焦点锁与焦点归还~~ | `ui/dialog` 的 `Dialog` / `DialogContent`（居中卡片）、`ui/sheet` 的 `SheetContent`（抽屉）；全屏视图仍走 `FullScreenLayer` / `ui/fullscreen-dialog`；**P9 硬闸**禁止视图再自绘模态外壳 | ✅ **见 §16.2.4.12**                        |
| 缺值占位符       | ~~**31 处**裸写 `?? "—"`，而「什么算不存在」**四种判法**：`??`（只管 null/undefined）、`\|\|`（把 `0` 与 `""` 也当缺值 —— 「步数 0」显示成「—」）、`> 0 ? x : "—"`、`!= null ? String(x) : "—"`~~ | `~/lib/display-value` 的 `displayValue` / `EMPTY_PLACEHOLDER`；**P8 硬闸**禁止视图再写占位符字面量                                            | ✅ **见 §16.2.4.11**                        |
| 折叠 / 展开      | ~~**三族写法**：原生 `<details>` 六处、自绘「布尔 state + 条件渲染 + `▸/▾`」四处、树形 `expanded*` 映射两份；无障碍语义各写各的（自绘那份基本只有 `onClick`，`NodesTab` 还被迫用 `role="button"` 绕开「button 嵌 button」）~~ | `~/components/ui/disclosure` 的 `Disclosure`（`caret` / `chevron` / `none` 三种标记；排内其余动作走 `leading` / `trailing`）；**P10 硬闸**禁止视图再自绘折叠开关 | ✅ **见 §16.2.4.13**                        |
| 浮层选项列表     | ~~画布四个 chip 各写一份**逐行同形**的浮层（触发器 `▾` + `max-h-* overflow-y-auto` + `role="option"` 行），选中配色四份各写各的（`violet-500/20` / `fuchsia-500/20` / `primary-soft` / `bg-accent`）~~ | `~/components/ui/option-list-popover` 的 `OptionListPopover`；**P11 硬闸**禁止视图再手搓 chip 浮层 | ✅ **见 §16.2.4.14**                        |
| 定时轮询         | ~~**9 处**各自 `setInterval` + `clearInterval`：不立刻跑一次 / 后台空转 / 每次渲染重建定时器 / 前后台开关被抄两份 / 跑在已卸载组件上~~ | `~/components/ui/use-interval` 的 `useInterval`（`immediate` / `pauseWhenHidden` / 回调放 ref）；**P12 硬闸**禁止视图再写 `setInterval` | ✅ **见 §16.2.4.15**                        |
| 可搜索过滤       | ~~**8 处**各写一遍 `trim().toLowerCase()`，其中 `AttributeMultiSelect` **只写了 `trim()`** —— 候选含拉丁字母（`JK制服`）时用户输 `jk` 一条也搜不到~~ | `~/lib/list-filter` 的 `normalizeNeedle` / `matchesNeedle` / `filterGroups`；**P13 硬闸**禁止视图再自写归一化 | ✅ **见 §16.2.4.16**                        |
| 展开集合         | ~~一棵树用了 **3 份**同形 `Record<string, boolean>`，每份配一组逐字同形的读写，外加一段**抄了两遍**的「补默认展开」（`!!map[k]` 把「收起过」与「没碰过」压成同一个 false）~~ | `~/components/ui/expansion-set` 的 `useExpansionSet`（`isExpanded` / **`hasKey`** 两种判据 / `seedDefaults` 不覆盖已有表态）；**P14 硬闸** | ✅ **见 §16.2.4.17**                        |
| 面板加宽档       | ~~`LogPanel` / `GlobalStepLogPanel` / `WorkflowRunLogModal` 三份逐字同形（`useState` + 同一文件里两处三元 + 按钮文案图标），且三份**都没有持久化** —— 加宽后关掉再打开又变回窄档~~ | `~/components/ui/wide-panel` 的 `useWidePanel`（记忆按 `id` 落 localStorage）/ `WidePanelToggle`；**P15 硬闸** | ✅ **见 §16.2.4.18**                        |
| 异步动作的进度   | ~~**10 处**各写一遍「track + `width: X%` + 百分比文字」，写法四派（`Math.max(4, p)` 可见下限 / 自算比例 / 不夹取 / 算好的 pct）；且**只有 2 处**声明 `role="progressbar"`~~ | `~/components/ui/progress-bar` 的 `ProgressBar`（形态）+ `~/lib/progress` 的 `clampPct` / `toPct` / `pctToWidth`（数值）；**P16 硬闸** | ✅ **见 §16.2.4.19**                        |
| 键值行           | ~~**5 处**各写一遍「标签 + 值 + 空值占位」的行，四种布局语言（隔行参数表 / 网格卡片 / `<table>` / 行内状态项）~~ | `~/components/ui/key-value-rows` 的 `KeyValueRows`（`rows` / `stacked` / `table` / `inline` 四布局）；缺值仍走 `~/lib/display-value`；**P17 硬闸** | ✅ **见 §16.2.4.20**                        |

`pnpm ui:primitives:report` 输出的就是本表的机器版数据，排批次时照它来。

**P2 的做法（可直接照抄到后续批次）**：迁移一个浮层 = 换掉两件事 ——
① `createPortal(...)` → `ui/` 原语的容器；② 随之删掉该文件**自己那份**
「手写 Esc、手写遮罩点击关闭、手写定位 + 滚动重定位、手写 z-index 魔数」。
只换 ① 不删 ② 会留下两套关闭语义同时生效（例如 Esc 触发两次 dismiss）。

| 形态                 | 原来自搓的位置                                                                                                            | 现在                                                                  |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| 确认对话框           | `studio/ui/ModalDialog.tsx`（自搓 portal + Esc + 焦点）                                                                   | `ui/dialog` 的 `Dialog` / `DialogContent`，自动聚焦确认按钮的行为保留 |
| 节点 JSON 浮层       | `WorkflowNodeJsonPopover.tsx`（自搓遮罩 + `computePos` 定位 + Esc）                                                       | `ui/popover` + **锚点定位**；`workflow-utils.ts` 的 `computePos` 一并删除（见 §16.2.3.1） |
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

**③ 密集列表行的内联小徽标：`ui/list-badge`（ISSUE #716）。**

上表两条按「状态」分类，这一条按**出现的容器**分类 —— 它是第三个形态，
判据不是「长什么样」而是「它出现在哪里」：

| 基元             | 形态                                  | 用在哪                                                     |
| ---------------- | ------------------------------------- | ---------------------------------------------------------- |
| `ui/status-dot`  | 一个圆点                              | 状态行左侧                                                 |
| `ui/status-badge`| 圆点 + 文字的胶囊（`text-xs` + 边框） | 卡片头、详情头这类**独立徽标**                             |
| `ui/list-badge`  | 纯文字的紧凑小块（`text-[9px]`，无边框） | 列表行里**紧跟标题**的元信息                               |

**为什么不能复用一个**：列表行的高度是按「每行一行文字」定的，`text-xs` 胶囊
比行内文字还高，一行里塞几个就把行撑成两倍高。工作流库列表曾因此每项挤进四枚
手写 `text-[9px]` span（`对外参数未配置` / `本地` / 类型 / 模型标签），加上名称后
总宽超过侧栏、被根容器的 `overflow-hidden` 裁掉。收口之后**尺寸不再由每处各写
一遍**，`tone` 的取色也回到语义 token（此前是 `bg-emerald-500/12 text-emerald-700
dark:text-emerald-300` 这类写死值）。

**同批的两条收口口径**（可照抄到下一批）：

1. **一行里的「闸门」与「元信息」要分开对待**。`无可执行内容` 是**闸门**
   （这条工作流根本跑不了），它必须留着并占位；`对外参数未配置` 是**元信息**
   （还能跑，只是工坊驱动不了），它该收成一枚状态标记 —— 完整口径（缺哪些口）
   挪进 `title`。一行的宽度预算只够一个长标签，留给闸门。
2. **判据是「出现在哪里」，不是「长什么样」**。按外观找会得到「三个都是徽标」，
   进而得出「合并成一个」的错误结论；按容器找才看得出列表行的高度预算是另一档。
   这与 §16.2.4.10 的「扫描要按问法设计，不是按目录」是同一条方法论。

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

#### 第一档：有明确落点，欠治理（✅ 已接，见 §16.2.4.7）

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

#### 第二档：选型未发生，不是「欠治理」（✅ 已决策，见 §16.2.4.8）

| 基元      | 实测                                                                                                                                                                                          | 为什么不是「待接」                                                                                                                                                                                                                                                     |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/form` | **全库零 `useForm(` 调用**；`react-hook-form` 只被 `ui/form.tsx` 自己 import；`@hookform/resolvers` 与 `zod` 在 `package.json` 里，但业务侧无人组装 `useForm({ resolver: zodResolver(...) })` | 接它**不是换组件**：`ui/form` 是 RHF 的 `FormProvider` + `FormField` 包装，用上它意味着这个功能的状态与校验改由 RHF 管 —— 那是**数据层设计决定**。✅ **决定已做出：不接**，字段级规则改住 `src/lib/<domain>/*-schema.ts` 的纯函数、集合级留 controller（见 §16.2.4.8） |

顺带澄清一个容易混的命名：`WorkflowFormControls.tsx` / `DynamicWorkflowForm/` 里的
「Form」指**工作流参数表单**（由 `workflowIO` 动态生成），与 `ui/form`（RHF 族）
没有任何关系 —— 按目录名找会误判成「已经在用了」。

#### 第三档：确有近似形态，但接上会改变外观或交互语义（按现状不动）

| 基元          | 近似形态                                                                                                                                               | 为什么不动                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `scroll-area` | 全库 **54 个文件**在用 `overflow-y-auto` / `overflow-auto` 的滚动容器；其中 **5 个组件**另加了自绘滚动条外观（`custom-scrollbar`）                     | 判据**已更正**（见下）。**真正挡住迁移的不是「高度由 flex 链推出」** —— `ScrollArea.Root` 的 `Viewport` 是 `size-full`，flex 链推得出来的高度它照样撑满。挡住的是**命令式滚动跟随**：这 5 处全部持有滚动容器的 `ref` 并直接读写 `scrollTop`（贴底跟随 / 只滚不跳 / 加载更多），而 `ui/scroll-area` 的 `Viewport` 是内部子树、不转发 ref（`ScrollAreaViewport` 本身是 `ForwardRefExoticComponent`，是 `ui/` 这份封装没把它透出来）。要接就得改 `ui/`（工具生成目录，下次 `shadcn add` 会覆盖）—— 代价大于收益 |
| `accordion`   | 6 个文件用原生 `<details>/<summary>`（历史详情原始 JSON、节点错误面板参数、工坊三处生成过程），另有若干 `{isOpen && …}` 条件渲染的展开块（训练页日志） | 原生 `<details>` 的**展开态是浏览器原生 a11y 语义**（`<summary>` 自带可聚焦与 toggle 角色）且支持「查找时自动展开」；`accordion` 的价值在于「一组互斥面板 + 动画 + 键盘导航」，而这 6 处是**单个独立折叠块**，没有互斥分组。训练页的 `{isOpen && …}` 反而更像 accordion 的落点，但它当前是按钮触发的，接上要改触发器形态（外观会变）                                                                                                                                                                         |
| `avatar`      | 首页顶栏一个 `u-avatar`（纯 CSS 底 + 圆形 div），工坊 5 处「首字母圆形徽标」                                                                           | 两者都不是**头像**：顶栏那个没有图片（`AvatarImage` 无从渲染、`AvatarFallback` 恰好够用但换成基元只多一层嵌套），工坊那 5 处是**首字母初值**徽标（`bg-primary-soft` + 单字），语义是「角色编号」不是「用户头像」。接上基元 = 为一个 div 加两层包装                                                                                                                                                                                                                                                           |

**判据归属**：§16.2.4.4 ① 的 `REQUIRED_CONSUMERS` 清单仍然是「**已经用上的不许
掉回 0**」；第一档（`tabs` / `alert` / `dropdown-menu`）接上后**同批登记进该清单**。
第二档的结论落在 §16.2.4.8（表单规则归属），第三档**不登记**，理由就写在上面
两张表里 —— 这与该文件头部注释（「判据刻意只钉已有落点、不要求穷尽」）同源。

**这一节的用法**：下一轮做「零引用基元」时，**不要**再按目录名扫一遍「有没有
出现 `tabs` 这个词」，而要按**形态**找（「谁在实现一组切换面板」）。这次误判的
根因就是按名字比。

**复查更正的那一条（`scroll-area`）—— 记下来是因为它是同一种错的第二次**：
原判据说「现有容器高度由 flex 链推出，接上就得同时改布局约束」。这句话**听起来
成立、实测不成立** —— 真正该问的是「**谁在命令式地操作滚动**」，而不是「高度
是怎么来的」。一个容器只要持有 `ref` 并读写 `scrollTop`，换成任何「把滚动元素
藏进子组件」的封装都不行，与高度怎么来无关。判据写错方向时，**结论对了
（不动）而理由站不住**，下一轮复查的人拿这条理由去核对会得出相反的判断 ——
这比结论错更费时间。

### 16.2.4.7 第一档三条的落地（`tabs` / `alert` / `dropdown-menu`）

第一档三条已接上业务，落点在下面这张表里。三条的**共同做法**：
**接上基元的同时删掉调用处那份手写交互语义** —— 只换容器会留下两套 Esc /
两套外点关闭同时生效（§16.2.4「P2 的做法」的原样）。

| 基元            | 落点                                                                                                                                                                                                                                                                                                                      |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `tabs`          | `workflow-library` 详情面板三页签：自绘 `TabButton` 删除，改 `ui/tabs` 的 `line` 变体；`DetailBody` 由「按 `activeTab` 分支」改成「每个页签各一个 `TabsContent` 面板」（base-ui 只挂载当前面板）。指示条颜色收进 `globals.css` 的 `.detail-tab-trigger::after`（token 渐变，不写死调色板）                                |
| `alert`         | 六处：登录页 `notice`、训练页「未配置训练后端」横幅、设置页「读取失败」提示条、节点 `ErrorPanel` 参数提示、工坊 `CharacterPortraitStudio` / `ShotStudio` / `VideoStudio` 三处行内错误行。`ui/alert` 补出 `warning` / `info` / `success` / `danger` 四支语义变体（原先只有 `default` / `destructive`，而视图里全是语义色） |
| `dropdown-menu` | 画布右键菜单 `CanvasContextMenu`（自绘遮罩 + `fixed` 手定位删除，改「零尺寸定位锚点 + 受控 `open`」）与项目切换器 `ProjectSwitcher`（触发器即原按钮，`modal={false}` 以容纳重命名输入框）                                                                                                                                 |

**这批新钉的五条口径（可直接照抄到下一批）**：

1. **`ui/alert` 的默认布局是 `grid`，只有「图标 + 标题 + 正文」这种分行结构该用它**。
   连续文字流（正文里夹内联链接）的通知横幅必须显式回到 `block` ——
   否则每个文字节点各自成行、排版散架。这是「基元默认值 vs 内容形态」的判据，
   不是配色问题。行内错误行还要 `border-transparent` + 紧凑 `px/py` 保住原观感。
2. **缺语义变体时补变体，不是把颜色写进调用处**。`ui/alert` 只出 `default` /
   `destructive` 时，六处通知块只能各写各的 `border-warning/30 bg-warning/10`；
   补出四支语义变体后颜色只有一个出口（与 §16.2.4.1 的 `Button` 同源）。
   文字档一律走 `-strong` token。
3. **`base-ui` 的浮层需要定位锚点，而右键菜单的锚点是「一个点」**。
   `ui/dropdown-menu` 的 `Positioner` 按 `--anchor-width` 算宽，零尺寸锚点会
   算出 0 宽 —— 所以要用固定宽 `className` 覆盖回去。这是「锚点形态决定要不要
   额外覆盖」的判据。
4. **用 `render` 属性把基元的触发器「长成」自有按钮**（`ProjectSwitcher`），
   而不是反过来在自有按钮里塞 `asChild` —— base-ui 的 `render` 是它的官方
   组合口径，`Button` 的样式与语义都保留。
5. **菜单里带输入框时用 `modal={false}`**（重命名表单）：`modal` 会锁页面滚动
   并把交互限制在菜单内，而这里需要一个可聚焦的文本框。菜单自身仍由 base-ui
   管 Esc / 方向键 / 外点关闭。

**这一批没有动的**（按 §16.2.4.6 第三档的口径保持现状）：`WorkflowEditorTopbar`
的三条行内校验 `<p>`、`WorkflowEditorInner` 的 IO 编辑模式提示与子图下钻错误条 ——
它们是**行内 / 浮层状态行**（`rounded-md` 小尺寸、带 `z-canvas-max` 定位或
`pointer-events-none` 包裹），不是 `ui/alert` 的「块级通知」形态；套基元会改尺寸
与定位契约。其余归属第二 / 第三档（`form` 选型未发生，`accordion` /
`scroll-area` / `avatar` 接上会改外观或交互）。

**判据**：三条已登记进 `tests/ui-primitives-coverage.test.ts` 的
`REQUIRED_CONSUMERS`（「已经用上的不许掉回 0」）；各自的接线另有契约测试
（`WorkflowLibraryDetailTabs.test.tsx` / `ui/alert.test.tsx` /
`CanvasContextMenu.test.tsx` / `ProjectSwitcher.test.tsx`）。

### 16.2.4.8 第二档的落地：表单校验规则归谁持有（`ui/form` 的选型决定）

第二档此前登记为「**选型未发生，须先决策**」，理由是「用上 `ui/form` 意味着这个
功能的状态与校验改由 RHF 管，那是数据层设计决定」。**这次把它决掉了**，结论是
**`ui/form`（RHF 族）不进业务表单**。

**为什么不进。** 两条判据，缺一条都还能勉强接：

1. **与 §16.2.1 的「controller 是唯一数据出入口」直接冲突。** `ui/form` 是 RHF 的
   `FormProvider` + `FormField` 包装 ——`useForm()` 本身就是一份 controller。接它
   等于同一个草稿有两个持有者（feature hook 的 state 与 RHF 的 store），提交前还
   得对账。这不是「换个组件」，是**把数据层拆成两半**。
2. **本项目要校验的东西，一半不是字段级的。** 字段级（名称非空、trim 后判定）
   是纯函数；但「模型名是否与列表里的条目重名」「编辑态条目是否还存在」要看
   **列表** —— zod schema 表达不了，只能 `.refine` 注入，而注入源在服务端拉取的
   列表里。schema 于是不再是纯函数，RHF 的 `resolver` 那层收益也一并落空。

**替代口径（这才是这次真正的产出）——校验规则按「要不要看别的数据」切开：**

| 规则                                 | 住哪                                    | 判据                                                                                    |
| ------------------------------------ | --------------------------------------- | --------------------------------------------------------------------------------------- |
| **字段级**（该字段自己的值就能判定） | `src/lib/<domain>/*-schema.ts` 的纯函数 | 不 import React、不读列表；可在这里穷举单测                                             |
| **集合级**（要看别的数据）           | controller（feature hook）              | 返回 `{ ok, error }`；失败**错位到具体字段**（重名 → 名称字段），没有对应字段的才走横幅 |

首个落点：`src/lib/llm/remote-model-schema.ts` 的 `validateRemoteModelFields`，
由 `useRemoteModelDialogs` 在 `submitDialog` 的第一关调用。**顺带修掉一处真实的
交互缺陷**：提交按钮原先 `disabled={!addForm.model.trim()}` —— 名称空时**点不动
按钮**，字段级提示就永远出不来（用户只看到灰按钮，不知道该填哪）。现在按钮可用，
点下去逐字段标红。

**既有同类实现不用改。** `validateTrainForm`（`studio/training-studio-config.ts`）
已经是「纯函数 + 返回第一条错误文案」的形态，与上表第①行同源；它返回单条文案
而非逐字段映射，是**当时**视图只有一条提示位。这两条并存不算两套口径 ——
判据是「规则是纯函数、住在 lib 的域模块里、视图不自己判定」，两者都满足。
`WorkflowFormControls` / `DynamicWorkflowForm` 里的「Form」**仍与 `ui/form` 无关**
（那是按 `workflowIO` 动态生成的工作流参数表单）。

**机器判据**（写进 `tests/ui-primitives-coverage.test.ts`）：schema 模块存在、
不 import React；弹窗视图不 import `zod`、只消费 controller 转述的 `fieldErrors`。

### 16.2.4.9 自绘滚动条外观收成一处（P4 硬闸）

复查第三档 `scroll-area` 时顺出来的另一条账，**与 `scroll-area` 本身无关** ——
它是按**滚动容器的实现**找会漏掉、按**滚动条的实现**找才会撞上的一类重复。

**实测：库里有两份自绘滚动条外观。**

| 在哪                                                                     | 长什么样                                                                                        |
| ------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `globals.css` 的 `.custom-scrollbar`                                     | `8px`，thumb `--color-border-strong`，hover `--color-ink-icon`                                  |
| 视图文件 `ScriptMarkdownEditor.parts.tsx` 的 `SCROLLBAR_VISIBLE_CLASSES` | 一组任意值变体：`[&::-webkit-scrollbar]:w-2.5!` / `:bg-border-strong!` / `:hover:bg-ink-muted!` |

两处是同一件事（给滚动容器一个自绘滚动条），取值却各写一份且**已经漂移**
（宽度 8px vs 10px、hover 色 `ink-icon` vs `ink-muted`）。`ui/scroll-area` 还有
第三份（base-ui 自绘 `ScrollBar`，thumb 走 `bg-border`），但它是零引用的工具生成物。

**收口方式：只搬定义、不动取值。** 视图里那份搬进 `globals.css` 成为
`.soft-scrollbar` —— **取值逐条照搬**（10px / 透明轨道 / `--color-border-strong` /
`rounded-full` / hover `--color-ink-muted`），所以 `SCROLLBAR_VISIBLE_CLASSES`
从一长串任意值变体退化成 `"soft-scrollbar overflow-y-auto"`，**调用处零改动、
渲染结果不变**（§16.2.4.2 第 9 条）。`globals.css` 顶部现在写清三档的**出处与
各自谁在用**（全局兜底 / `.custom-scrollbar` 密集日志区 / `.soft-scrollbar`
文字编辑区），另加一条 `textarea::-webkit-scrollbar`（只滚不显示）。

**为什么不干脆合并成一份**：三档是**刻意的观感差异**（日志区要看得见 thumb、
编辑区不要抢视线、画布节点文本框干脆不显示），合并等于改外观。判据是
「同一件事的**定义**只有一处 + 每处取值各有出处」，不是「所有地方长一样」——
与 §16.2.4.1「缺语义变体时补变体，不是把颜色写进调用处」同源。

**判据 P4（硬闸，不是棘轮）**：`src/**` 里不得再出现 `::-webkit-scrollbar`，
由 `scripts/check-ui-primitives.cjs` 拦截 —— 接在既有 P1/P2/P3 之后，但**不进
棘轮基线**：它的口径是「必须为 0」，`--update` 也不接受带违规的基线（这点单测
钉住了）。`ui/scroll-area` 那套走 `ui/` 的目录豁免（工具生成物，口径见 §16.2.4.6
第三档）。

> 为什么必须有判据而**不是只写进规范**：这条账藏了很久，因为按目录名 / 按
> 「谁在用 `overflow-y-auto`」都看不见它 —— 它只出现在「谁在写
> `::-webkit-scrollbar`」这个问法下。写完类名之后，下一次有人想给某个面板
> 「单独调一下滚动条」，最容易的动作就是再贴一组任意值变体（因为那样不用
> 碰全局样式），而结果又是两份定义开始漂移。

**同批补的一处判据盲区（R10）**：`check-file-structure.cjs` 的 R10（注释里禁止
「历史流水」）此前只扫 `.ts` / `.tsx`，**`.css` 是盲区** —— 而样式注释恰恰是最容易
被整段搬运的一类。把 `.css` 纳入扫描后，`globals.css` 里立刻报出三处
（`T11` / `T10` ×2，另有 `R-ardot18` / `R-ardot106` / `R-ardot103` 已在同批清掉）。

### 16.2.4.10 按形态再扫一遍：三件事各收了 4~7 份实现（P5/P6 硬闸）

§16.2.4.9 的结论是**「按目录名 / 按文件名的问法看不见重复，按形态的才看得见」**。
这一批把那句口径**当成方法用了一遍**：不问「库里有没有 `clipboard` 这个词」，
而问「**谁在把一段文本送出去**」「**谁在把时间写成给人看的字**」。四问法各撞出一条账。

#### 问法一：谁在把一段文本送出去（剪贴板）

实测 **4 份实现**，且各自写法不同：

| 在哪                                                        | 兜底写法                                                         |
| ----------------------------------------------------------- | ---------------------------------------------------------------- |
| `history/hooks/use-history-detail-actions.ts` 的 `copyText` | 返回 `boolean`；临时 `<textarea>` 用 `position:fixed; opacity:0` |
| `logs/log-export.ts` 的 `copyLogText`                       | 静默；同一个 `<textarea>` 用默认定位、不设 `opacity`             |
| `WorkflowNodeJsonPopover.tsx`                               | 只在自己那份里再写一遍 `execCommand`，`left:-9999px`             |
| `DebugChainFooter.tsx` / `ShellTabs.tsx` / 其余 6 处        | 直接 `navigator.clipboard?.writeText(...)`，**完全没有降级链路** |

最后一行才是这条账的实质：**没有降级链路的那几处，在 Tauri 的 `http://` 非安全
上下文里直接失败**（`navigator.clipboard` 是 `undefined`），而它们的写法看起来
「已经用了可选链、应该没问题」—— 可选链在这里恰好**吞掉了失败**。

#### 问法二：谁在触发一次下载

实测 **7 份实现**，`URL.revokeObjectURL` 与 `a.click()` 的**先后顺序都不统一**。
先 revoke 会让尚未开始的下载拿到失效 URL（大文件必现）—— 而这件事在 7 份里
有 3 份写错顺序、却因为小文件测试（同步完成）而一直没暴露。

#### 问法三：谁在把时间写成给人看的字

| 形态                  | 份数  | 漂移                                                                                                                                         |
| --------------------- | ----- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `刚刚 / N 分钟前 / …` | **5** | 阈值档位各不相同（一处 30 天封顶后转日期、两处每档带「修改」后缀、一处不带）；`workspace` 与 `WorksGallery` **两份逐字相同**                 |
| `HH:mm:ss` 时刻       | **6** | 带毫秒的两处**逐字相同**；`workshop` 那 4 处裸调 `toLocaleTimeString()`，**连区域设置都没固定**（宿主 12 小时制时会多出 AM/PM 把日志行撑开） |

#### 问法四：谁在把字节写成容量

**3 份实现**，而 `src/lib/format-bytes.ts` **早就存在**（`AppUpdateSection` /
`BrowserStatusBar` 已在用）。`model-library-config.ts` 与 `MaterialLibraryPanel.tsx`
各写一份，且 **降档阈值写法还不一致**（`>` vs `>=`）—— 1024 字节整这一档
两处给出不同答案。这是**「出口存在但没人知道」**型重复，比「没有出口」更难发现：
扫描「谁在实现 `formatBytes`」会全部漏掉，因为两处一个叫 `fmtSize`、
一个是文件内私有的 `formatSize`。

#### 收口：两个顶层单例 + 两条硬闸

按「同一件事的定义只有一处，取值逐条保留」收口（§16.2.4.9 同款）：

- `src/lib/browser-io.ts`：`copyText`（返回 `boolean`，两条通道 + `navigator`
  存在性判定）、`downloadText`、`downloadJson`。这是 `src/lib/` 的**顶层单例**
  （同 `format-bytes.ts` / `error-message.ts`），已登记进 `check-file-structure.cjs`
  的 `DOMAIN_EXEMPT` 并设覆盖率门槛（§18.14 三件事同批做完）。
- `src/lib/time-format.ts`：`timeAgo`（`maxDays` / `suffix` 两个**显式**选项承载
  调用处的差异，不做「统一成一种」）、`formatClock`。

**调用处零行为变化**的证据：`history-utils.ts` / `history-panel-types.ts` 保留
原名转发（消费方一行未改）；`log-format.ts` 的 `formatTime` 跨天补日期的逻辑
**留在原处**，只把「时刻本身怎么写」换成 `formatClock`；`log-export.ts` 的
`copyLogText` / `downloadLogText` 签名不变。逐处比对见本批的 checklist。

**为什么不合并 `history-utils` 与 `history-panel-types` 的其余部分**：那是**域语义**
差异（全量历史页分页 + 日期分组 vs 画布侧栏 80 条 + 双密度），合并会制造第二个
错误抽象（§16.2.4.6 / §17.6.1 同款判断）。本批只收「相对时间怎么写」这一件事 ——
它在两处**不承载任何域语义**，此前各写一份纯属偶然。

#### 判据：P5/P6（硬闸，不留存量）

`check-ui-primitives.cjs` 新增两条，与 P4 同性质（`HARD_GATE_RULES`，不进基线）：

- **P5** `navigator.clipboard` / `document.execCommand(` 出现在视图里；
- **P6** `URL.createObjectURL(` 出现在视图里。

`tests/ui-primitives-coverage.test.ts` 再从**另一侧**钉住出口：两个共享模块必须
导出约定的名字、且至少有一处业务引用 —— 否则「抽出出口但没人用」等于没做。
`ui/json-viewer.tsx` 的复制按钮也改走 `copyText`（它是 `ui/` 工具生成目录里的
`z-*` 同款判断：**语义正确性优先于「不手改」**，见 §16.2.5 末段）。

> 方法论记一笔：这四条账**没有一条**能靠读目录结构或文件名看出来。
> `fmtSize` / `formatSize` / `fmtBytes` 是同一个函数的三个名字；
> `copyText` 在四处叫同一个名字却有四种行为。**扫描要按问法设计，不是按目录。**

### 16.2.4.11 上一批留下的三条账：交互样板与判据口径（P7/P8 硬闸）

§16.2.4.10 收尾时留了三笔「扫到但没动」的账。这一批做掉，形状与上一批**不同** ——
上一批的账是「一个动作有几份实现」，这一批是**「一件交互的样板」**与
**「一个判断的口径」**。后者尤其值得单独记：它不是重复代码，是**同一个决定的多种写法**。

#### 账一：隐藏文件选择框（P7）

**9 份实现，三种写法**：

| 写法                              | 落点                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `useRef` + `ref.current?.click()` | `CanvasNode` 的 `use-file-upload`（**两个** ref / 两个 click）、`use-dynamic-workflow-form`、`MaterialLibraryPanel`、`WorkflowImportPanel`、`TrainingStudio`、`CharacterPortraitStudio`、`ExtractToolbar`、`WorkshopStageBody` |
| `<label htmlFor>` 隐式关联        | `UsageTestDialog`、`VideoQueueModal`（后者是全仓唯一靠 `id` 拼接触发的入口）                                                                                                                                                   |
| input 直接露在界面上              | `FilmStudio` 的 BGM 选择器                                                                                                                                                                                                     |

三个共性问题只有放在一处才收得住：

1. **`click()` 在 ref 未挂上时是静默空操作** —— 界面「点了没反应」，
   既没有反馈也不知道该去查什么；
2. **多数落点没有复位 `event.target.value`** —— 浏览器只在取值变化时派发
   `change`，于是用户第二次选**同一个文件**时回调根本不触发，
   表现成「上传按钮坏了」。这条缺陷是**静默**的：没有报错、没有告警。
3. 同一文件里两个隐藏 input + 两个 ref + 两个 `click()` 的样板重复。

收口进 `~/components/ui/file-picker`：`useFilePicker`（命令式，`open()` + `<picker.Input />`）、
`FilePickerButton`（声明式，按钮与 input 二合一）。`onPick` 同时给 `file` 与整份
`FileList` —— 多选落点（数据集、素材库）要整份交给上传管线。

> **判据只管「隐藏」这一种形态**（P7 数 `<input type=file>` 同标签内出现
> `hidden`）。`FilmStudio` 的 BGM 选择器是**用户可见的表单字段**（靠 `file:`
> 伪元素美化、就地显示已选文件名），是另一种形态，不欠 file-picker 的契约 ——
> 硬把它改成「隐藏 input + 按钮」是**改坏外观去迎合判据**，所以进
> `tests/check-ui-primitives.test.ts` 的反面用例，明确记下「可见输入框放行」。

#### 账二：一次性反馈（`useFlashState` / `useFlashLatch`）

**6 份实现，两族**：

| 族              | 落点                                                                          | 缺陷                                                                                                                                       |
| --------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 裸 `setTimeout` | 设置页报错复制、`ProjectOutputs`、`WorkflowNodeJsonPopover`、`ui/json-viewer` | 定时器**没人管** —— 组件卸载后仍 `setState`（**日志行会随翻页/锚点窗口被卸载**）；连点时旧定时器没清，第一次的复位**提前抹掉**第二次的亮起 |
| 手写 `timerRef` | `logs/LogRow`、`logs/SaveExportButton`、设置页 `use-settings-page`            | 行为正确，但与上一族逐行同款、各写一份；时长散落                                                                                           |

复位时长此前是 **1200 / 1400 / 1500 / 8000**，**没有一处说得清为什么是它**。
现在 `DEFAULT_FLASH_MS = 1500` 是唯一默认值，需要不同的落点显式传值
并写明理由（`logs` 的保存回执留 8s：它要给出**路径**，用户得看清并可能抄下来；
行内复制 1.2s：反馈就长在按钮上，停留越久越像常驻标签）。

`SaveExportButton` 是**多字段**场景（「已保存 <路径>」与失败标记必须**同生共死**），
所以另有 `useFlashLatch(durationMs, empty)` —— 两个 `useFlashState` 会各起一个
定时器，时长一改就漂移，留下「已保存还在、失败标记已消失」的自相矛盾画面。

#### 账三：缺值占位符（P8）—— 这条不是重复，是**口径**

**31 处**裸写 `"—"`，而「什么算不存在」有**四种判法**：

| 写法                          | 把谁当成「不存在」        | 问题                                             |
| ----------------------------- | ------------------------- | ------------------------------------------------ |
| `x ?? "—"`                    | 只有 `null` / `undefined` | 空串会渲染成空白格                               |
| `x \|\| "—"`                  | 再加 `0` 与 `""`          | **「步数 0」显示成「—」** —— 它是真实跑过的 0 步 |
| `value > 0 ? value : "—"`     | 再加负数                  | 计数徽标的域语义，但混在通用判据里看不出         |
| `x != null ? String(x) : "—"` | 只有 `null` / `undefined` | 与第一种等价、写法不同                           |

四种只差一两个字符，**都编译、都运行、类型都对**，差别只在**一个语义决定**上。
散在 31 处，这个决定就永远不会被统一说出来 —— 所以收口的意义不在「少写几个字符」，
而在**把口径写进一个文件头**：

- `undefined` / `null` / `""` / `NaN` → 占位符；
- **`0` / `false` 照常显示**（真实测到的值不是缺值）；
- 想把 `0` 当缺值的**域**必须显式写自己的判据（实例：`model-library-config.ts`
  的 `fmtSize` —— 模型列表里 `fileSize=0` 表示尚未探到，显示 `0 B` 会让用户
  以为模型是空的）。

出口 `~/lib/display-value` 的 `displayValue` / `nonEmpty` / `EMPTY_PLACEHOLDER`
（`src/lib` 顶层单例，同 `format-bytes.ts`）。`workflow-utils.ts` 的
`renderWidgetValue` / `renderSubgraphWidgetValue` 保留原职（布尔成 ✓/✕、
小数去尾零 —— 「有值时怎么渲染」），只把「没有值时显示什么」换成出口调用。

#### 判据：P7/P8（硬闸）+ 出口侧契约

`check-ui-primitives.cjs` 新增两条，与 P4~P6 同性质（`HARD_GATE_RULES`，不进基线）：

- **P7** 视图里「`<input type=file>` + `hidden`」同标签出现；
- **P8** 视图里出现占位符字面量 `"—"`。

`tests/ui-primitives-coverage.test.ts` 从**另一侧**钉住 `file-picker` 的导出名与
业务引用数（≥3，远低于现状的 9 —— 它要挡的是「掉回 0/1」而不是锁死数量）；
`src/lib/display-value.test.ts` 与 `src/components/ui/use-flash-state.test.ts`
按**边界值**与**时间轴**设用例（`0`/`false`/NaN 站哪一边、卸载后是否还 `setState`、
连点是否被旧定时器打断）—— 这些恰恰是各自调用点看不出来的部分。

### 16.2.4.12 「模态浮层」也是同一件事的多种写法（P9 硬闸）

§16.2.4.10 的方法论再扫一遍时撞出这条：**16 个视图各拼了一份模态浮层外壳**。
它和前面几批的形状都不一样 —— 前几批是「一个动作有几份实现」（四份剪贴板、
七份下载），这条是**一个形态有很多种写法**，而且**P2 追不到它**。

#### 为什么 P2 全库清零了、这批还在

P2 数的是 `createPortal(`。而 16 个落点里**一处 portal 都没有** —— 它们把遮罩
写成一个普通 `<div className={overlayClass("modal", …)}>`，靠 `fixed` 定位铺满。
**判据问的是「有没有用某个 API」，于是「用另一种方式做同一件事」全部漏过。**

> 教训与 §16.2.4.9 同源：**扫描要按形态设计，不是按 API。** P9 的问法是
> 「这个文件自己拼了一份模态外壳吗」，形态锚点取 **`overlayClass(`** ——
> 它是本项目顶层浮层定位的唯一出口（`fixed top-title-bar …`，同时被
> `check-title-bar-clearance.cjs` 认），视图里出现它 = 在自绘浮层容器。

#### 不止是重复：a11y 语义在 16 份之间分叉

真正的病灶不是「多写了几行」，而是**每一份各自决定要实现哪些无障碍行为**：

| 行为 | 16 份里有几份做到了 |
| --- | --- |
| 点遮罩关闭 | 15（`ModelLibrary` 把遮罩写成一个**兄弟 div** 单独接 `onClick`；`VideoQueueModal` / `LogPanel` 干脆没有） |
| Esc 关闭 | **3**（`SourceModal` / `ModelTagManager` / `DeleteWorkflowModal`） |
| `role="dialog"` + `aria-modal` | **3**（`ContentAssetNode` / `ModelTagManager` / `DeleteWorkflowModal`） |
| 焦点锁在弹窗内 / 关闭后归还焦点 | **0** |

也就是说：**同一个「模态弹窗」在库里有 16 种行为组合**，用户能不能用键盘
退出，取决于他打开的是哪一个弹窗。这类差异**没有报错、没有告警**，
tsc / eslint 也都不看 —— 只能靠「同一件事只允许一处实现」从结构上消除。

#### 顺带清掉的两处同族

- **`DeleteWorkflowModal` 是 `ConfirmDialog` 的第二份实现**（同一个「危险色
  圆角卡片 + 确认/取消」，连「确认中不许关」这条语义都各写了一遍：前者用
  「遮罩点击被阻断」，后者用 `pending` 把确认按钮置为 spinner）。已改成
  `ConfirmDialog` 的薄包装，那句阻断语义换成更准确的 `pending`。
- **`ProjectOutputs` 的元数据抽屉**是 `ui/sheet` 的第二份实现
  （`w-[380px]` 右锚定面板 + 手写遮罩 `onClick`）—— 与设置页两个抽屉
  （已迁 `ui/sheet`）是同一件事的两套写法。已迁 `ui/sheet`（`side="right"`）。

#### 迁移口径（可直接照抄）

1. **居中卡片 → `<Dialog>` + `<DialogContent>`**。基元自带
   Esc / 点遮罩关闭 / 焦点锁 / 焦点归还，以及 `role` 与 `aria-*`。
2. **形态差异经 `className` / `popupClassName` 表达，不重写外壳**：
   宽度用 `popupClassName`；调用处自己的卡片外观（`bg-panel` +
   `border` + `rounded-2xl`）原样保留在 `DialogContent` 的**子** div 上
   （`className="bg-transparent p-0 ring-0"` 抵消基元默认卡片 chrome）——
   验收标准仍是 **渲染结果不变**（§16.2.4.2 第 9 条）。

   > **传宽度只传 `w-*`，不要传 `max-w-*`**（ISSUE #720）：基类里曾有带变体的
   > `sm:max-w-sm`，而 Tailwind 把**带变体**的 utility 排在所有无变体之后 ——
   > 调用处传 `max-w-[96vw]` 也好、`max-w-6xl` 也好，量到的永远是被它压住的
   > 24rem。三个日志弹窗的「加宽」按钮因此长期是**按了没反应**（状态在变、
   > 宽度不动）。现在基类只留无变体的兜底上限，调用处一律用**另一族的
   > `w-*`** 给结论：跨族才有确定的优先级，同族只能「谁赢看产序」。
   > 宽度档的单一出口是 `~/components/ui/dialog-width`（含选档理由）。
3. **不该统一的那几类，别硬塞**：
   - **全屏视图**（设置 / 工作流编辑器 / 脚本编辑器 / 消息中心…）走
     `FullScreenLayer` / `ui/fullscreen-dialog` —— 它们要的是「让出窗口标题行、
     铺满内容区」，与「居中卡片」是两个形态（基元里早就分家，见 `ui/fullscreen-dialog`
     文件头的论证）。**P9 的判据够不着它们**：调用处传的是基元组件的 props，
     不出现 `overlayClass(`。
   - **画布内部的叠层**（`Z.base` / `Z.canvasUi` / `Z.canvasMax`）在同一容器内
     比较高低，与「模态」不是一层（§16.2.5 第 3 条）。

#### 迁移中撞出来的一条坑：Portal 渲染会错开一次提交

`LogPanel` 迁到 `ui/dialog` 之后，**虚拟化静默退化成整页渲染**（200 行全渲染）。
根因不是虚拟化坏了，而是：面板内容经 Portal 渲染，**挂载比本组件晚一个提交**，
而它的「量滚动视口」effect 只在 `[isOpen]` 变化时跑 —— 那一次 `bodyRef.current`
还是 `null`，量测被跳过，之后再也没有第二次。jsdom 里两条分支**都渲染全部行**，
肉眼完全看不出来，只有量 DOM 节点数才发现（这正是 `LogPanel.test` 里那条
「虚拟化没生效在 jsdom 里不可见」的用例存在的理由）。

口径：**依赖「元素出现了没有」而不是「面板开了没有」** —— 把滚动元素本身放进
state（`ref` 回调里 `setBodyEl(el)`），量视口的 effect 依赖它。这样量测与
挂载方式无关，换任何 lazy / portal 容器都不会再静默失效。

#### 判据：P9（硬闸）+ 出口侧契约

`check-ui-primitives.cjs` 新增 **P9**（`HARD_GATE_RULES`，不进基线）：
**视图里出现 `overlayClass(`**。与 P1 同款，判据先过 `stripComments` ——
把理由（「此前这里是 `overlayClass("modal", …)` 自绘的浮层」）写进注释
不该让计数停在原地。

`tests/ui-primitives-coverage.test.ts` 从**另一侧**补两条契约：

- `ui/dialog` 导出 `Dialog` / `DialogContent`，且业务引用数 ≥8
  （这批之后是十处上下，门槛刻意留在现状之下 —— 挡「掉回 0/1」，不锁死数量）；
- `ui/sheet` 同样，引用数 ≥3。

**为什么两侧都要有**：P9 挡得住「新增自绘」，挡不住「下一个人的新弹窗又照抄一份」
—— 而 16 处自绘能长期存在，正是因为**没人觉得 `ui/dialog` 是必选项**
（它此前只有 4 个业务引用）。

### 16.2.4.13 「折叠 / 展开」也是同一件事的多种写法（P10 硬闸）

§16.2.4.12 收尾时留了三个问法，第一个是**「谁在把一段内容折叠 / 展开」**
（`<details>` / 自绘 accordion / 状态驱动）。按形态扫下来，全库有**三族写法**
在做同一件事：

| 族 | 写法 | 落点 |
| --- | --- | --- |
| ① 原生 | `<details>` / `<summary>` | `ErrorPanel` ×2、`HistoryDetailModal`、`CharacterDesigner`、`CharacterPortraitStudio`、`ExtractToolbar` ×2 |
| ② 自绘 | 布尔 state + 条件渲染 + `▸/▾` 或 `Chevron` 切换 | `SettingsLoadError`、`LlmLocalSection`、`NodesTab` 的分组头与节点计数单元 |
| ③ 树形 | `expandedParents` / `expandedNodeList` / `nodeExpanded` 三份映射 | `NodesTab`（同文件里三层嵌套） |

**差别不是风格，是无障碍语义各写各的**：`<details>` 天生带 `role` /
`aria-expanded` / 键盘切换 / **浏览器页内查找时自动展开**；自绘那份基本只有
`onClick`，`NodesTab` 还为此专门补了 `role="button"` + `tabIndex` +
Enter/Space 处理 —— 而它的注释里写着「**不能**用原生 button，因为把 button
嵌在 button 里在 HTML 里非法」：那个嵌进去的按钮正是分组头右侧的「解析本目录」。
**自绘外壳逼出来的绕路，比重复本身更值得记。**

#### 出口：`ui/disclosure` 的 `Disclosure`

形态取 **base-ui 的 `Collapsible`** 而不是原生 `<details>`：

- `CollapsiblePanel` 的 `hiddenUntilFound` 用 `hidden="until-found"` 隐藏 ——
  **保留了 `<details>` 最值钱的那条**（页内查找命中折叠内容会自动展开），
  换成自绘「条件渲染」就丢了；
- 触发器的 `aria-expanded` / `aria-controls` / 键盘语义收进基元，调用处不再
  自己补 `role="button"` 与 `onKeyDown`；
- 受控 / 非受控都支持 —— `ErrorPanel` 的 `errExpanded` 会被运行状态重置、
  `CharacterPortraitStudio` 的 `open={busy}`，这两处要「外部状态驱动」，传
  `open` + `onOpenChange`；其余交给基元自己管（`defaultOpen`）。

#### 迁移口径（可直接照抄）

1. **标记由 `marker` 选**：`none`（调用处自己画，如 `ErrorPanel` 的 `▼/▲`）/
   `caret`（`▸/▾` 字符）/ `chevron`（`ChevronRight`，展开转 90°）。
   行样式、内边距、卡片外观一律由调用处经 `className` / `panelClassName` 给
   —— 验收标准仍是**渲染结果不变**（§16.2.4.2 第 9 条）。
2. **同一排按钮里只有一个是折叠开关时，其余走 `leading` / `trailing`**：
   基元的 trigger 是 `<button>`，往它里面塞 `<Button>` 在 HTML 里非法
   （React 会报水合错误）。落点：设置页的「重试 / 完整错误 / 复制」、
   `NodesTab` 分组头右侧的「解析本目录」、工坊两处的「历史」。
3. **`▾/▸` 放在标题右侧时**用 `flex-row-reverse` + 标题 `flex-1`
   （`LlmLocalSection` 的两端对齐观感由此不变）。
4. **树形结构的外层可以就让 Root 当那层容器**（`panelClassName="contents"` 或
   `hidden`）—— 例如 `NodesTab` 的「节点计数」单元只接管那一行，展开的节点
   清单仍由外面既有的 `nodeListOpen &&` 条件渲染承担。

#### 不迁的一类：卡片外壳是实色色带的复合件

`NodePreviewCard`（自定义节点预览卡）**维持自绘**并显式登记豁免：它的头部是
一条「取自 `category`」的实色色带（inline style 画底 + 白字徽标），刻意镜像
ComfyUI 节点卡外观，与 disclosure 的「一行文字 + 折叠标记」不是一个形态；
换基元会改掉那条色带的渲染契约。豁免写在 `check-ui-primitives.cjs` 的
`EXEMPT_FILES.P10` 里（**带理由**，不是按目录放行）。

#### 判据：P10（硬闸）

`check-ui-primitives.cjs` 新增 **P10**（`HARD_GATE_RULES`，不进基线）：

- 数 **`<details>`**（原生写法）；
- 数 **`role="button"` 与 `▸` / `▾` 同时出现的文件**里的标记数 —— 两个条件
  同时成立才计。**为什么必须「同时」**：`▾` 单独出现会误判浮层 / 下拉 / 弹窗
  触发器（`ProjectSwitcher` / `MetaEditor` / chip 都画一个 `▾`），
  而 `PopoverTrigger` 单独出现会误判表单里的 `SelectMenu` 调用处。
  这是 §16.2.4.10 那条方法论的第三次应用：**判据按形态取，不按 API**。

### 16.2.4.14 「可滚动的浮层选项列表」有多份写法（P11 硬闸）

三个问法里的第二个：**「谁在做一个可滚动的浮层列表」**。

画布节点上的四个 chip 各写了一份**逐行同形**的浮层：

| chip | 触发器 | 内容 | 选中配色（各写各的） |
| --- | --- | --- | --- |
| `WorkflowPickChip` | `h-6 … rounded-lg` + `▾` | `max-h-72 overflow-y-auto` | `bg-violet-500/20` |
| `WorkflowModePickChip` | 同上 | 无滚动上限 | `bg-violet-500/14` |
| `WorkflowSourceFilterChip` | 同上 | 无滚动上限 | `bg-primary-soft` |
| `WorkflowModelFilterChip` | 同上 | `max-h-72 overflow-y-auto` | `bg-fuchsia-500/20` |

四份都做同一套动作：触发器上一个 `▾`（`open` 时 `rotate-180`）、内容区
`max-h-* overflow-y-auto`、每行 `<Button role="option" aria-selected>` 配
「选中高亮 + 勾」。**改一处品牌色漏三片，且四份都不受主题 token 控制。**

#### 出口：`ui/option-list-popover` 的 `OptionListPopover`

基元负责**壳与行**：触发器（含 `▾` 与旋转，`group-data-[popup-open]` 变体切
形态，不靠 JS 条件类）、可滚动内容区、选项行的 `role` / `aria-selected` /
选中态配色（走 `primary` 语义 token）/ 勾标记、`Escape` 与外点关闭
（由 `ui/popover` 的 base-ui Positioner 给，调用处不再自绘）。

调用处只提供：`value`、`items`（`label` + 可选 `prefix` / `suffix` / `title`）、
`onSelect`、以及 chip 自己的 `trigger` 外观。

**为什么不做成 `ui/select-menu` 的别名**：`select-menu` 是 `combobox` 语义
（有 listbox id / 键盘高亮索引 / `aria-controls`），用于表单里「选一个值」；
本基元是画布上的轻量「点一项切换」，没有高亮索引，行内容也更自由（计数、
类型章、颜色点）。硬合会把 combobox 的 a11y 契约塞进 chip。

`onOpenChange` 透传出去，供 `WorkflowModePickChip` 的
`PopoverAutoClose`（画布一变换就关掉弹层）使用；`disabled` 走基元的
`aria-disabled` / `disabled`，不再由调用处用 `pointer-events-none` 假装。

#### 判据：P11（硬闸）

`check-ui-primitives.cjs` 新增 **P11**（`HARD_GATE_RULES`，不进基线）：
**同一文件里既自建 `PopoverTrigger`、又自己画 `▾`** —— 那就是「手搓 chip
浮层」。单看 `▾` 会误判 `DropdownMenu` / `Dialog` 的触发器；单看
`PopoverTrigger` 会误判 `SelectMenu` 的调用处。

#### 不迁的一类：多选 + 搜索 + 自定义添加

`AttributeMultiSelect`（角色属性多选下拉）**维持现状**：它是「搜索框 + 分组
多选 + 复选框 + 底部自定义添加」的 combobox 形态，与单选 chip 的语义不同，
且它**已经**走在 `ui/popover` 上（P2 阶段完成）。为「统一」把它塞进
`OptionListPopover` 只会把两种语义揉成一个长参数表。

### 16.2.4.15 「给一个异步动作配取消 / 轮询」有多种写法（P12 硬闸）

三个问法里的第三个：**「谁在给一个异步动作配取消」**。按形态扫下来，
「定时轮询」这一族最集中 —— 全库 **9 处** 各自 `setInterval(onDone, N)` +
在清理函数里 `clearInterval`，写法分三族、缺陷各异：

| 缺陷 | 落点（收口前） |
| --- | --- |
| **不立刻跑一次**（挂载后先空一个间隔） | `use-training-studio`、`VideoQueueModal`、`use-history-panel`、`use-runtime-log-source` |
| **后台标签页空转**（浏览器把后台定时器降到 ≥1min，请求照发） | 上述 + `use-code-update-watch`；只有 `use-comfy-stats` / `use-update-check` 接了 `visibilitychange` |
| **前后台开关被逐字抄两份** | `use-comfy-stats` 与 `use-update-check` 的 `visibilitychange` 块完全同形 |
| **每次渲染重建定时器**（回调进依赖数组 → 计时反复重置） | `use-history-panel`（`refreshRef` 手工保鲜）、`useSimulatedProgress`（`[tasks]` 依赖） |
| **跑在已卸载组件上** | `use-film-studio` 的 `setInterval(() => void poll(tid))` |

#### 出口：`ui/use-interval` 的 `useInterval`

把三件事一次给全：

1. **挂载即先跑一次**（`immediate`，默认 `true`）—— 用户不必等一个完整间隔；
2. **`pauseWhenHidden`**（默认 `true`）—— 切后台暂停、回前台**立即补跑一次**
   再恢复定时；语义与 `use-comfy-stats` / `use-update-check` 的既有实现一致，
   并把那段被抄两份的开关收成一份；
3. **回调放 ref** —— 传新函数不重建定时器（此前 `useCallback` 依赖数组容易
   写错的地方，包括「回调里读到的 `tasks` 是不是最新」）。

`ms: null`（或 0）表示**不轮询** —— 受控开关（`enabled` / `active` /
`running` / `taskId` 存在与否）用它可以表达，不必再自己起停。

**不替你吞掉卸载后的 `setState`**：React 18+ 对已卸载组件不再告警，静默兜底
反而会掩盖「这个请求本来就该被取消」。确实需要守卫的落点保留自己的
`stoppedRef` / `mountedRef`（`use-code-update-watch` / `LogProvider` /
`use-dev-server-liveness` 三处如此），并在注释里写明「间隔的起停已收在
`useInterval`，这个 ref 管的是**已经发出的那次请求**」。

**背压（上一轮没回来就发下一轮）不在这里挡** —— 那是调用方的决定：多数轮询
是幂等的单次查询，重叠无害；需要串行的落点自己在 `run` 里排队。

#### 迁移落点（10 处）

`use-comfy-stats` / `use-update-check` / `use-training-studio` /
`VideoQueueModal` / `use-history-panel` / `use-runtime-log-source` /
`GlobalStepLogPanel` / `history-utils`（`useSimulatedProgress`）/
`LogProvider` / `use-code-update-watch` / `use-dev-server-liveness` /
`use-film-studio`。

其中两处的口径值得单独记：

- **`use-film-studio`**：原来是「`fetchDetail` 里 `??= setInterval` 自启、
  跑完 `stopPoll()` 自停」。改成由 `running`（派生自 `film.status`）决定
  `ms`，并把 `immediate` 设为 **`false`** —— 进 running 那一次详情**已经由
  `create` / `cancel` / `recompose` 显式拉过**，再补一次只是把状态多刷一遍。
  这正是「一轮迁移里最容易改坏的一处」：默认的 `immediate: true` 会让
  mock 队列里的第二个响应立刻覆盖第一个。
- **`useSimulatedProgress`**：原来把 `tasks` 写进依赖数组，轮询每次返回新数组
  都要重建定时器、把 1.5s 的节拍重置；收口后定时器稳定，回调里读最新 `tasks`。

#### 判据：P12（硬闸）

`check-ui-primitives.cjs` 新增 **P12**（`HARD_GATE_RULES`，不进基线）：视图 /
逻辑层里出现 `setInterval(`。豁免只有 `app/api/**`（服务端路由的 SSE 心跳 /
轮询是服务端定时器，不在 React 生命周期里）。

```bash
pnpm ui:primitives            # 检查（棘轮 + P4~P15 硬闸，pre-commit 第 12 步）
pnpm ui:primitives:report     # 只出清单
node scripts/check-ui-primitives.cjs --update   # 治理后收紧基线
```

### 16.2.4.16 「可搜索列表过滤」有八份写法（P13 硬闸）

§16.2.4.15 收尾时留了三个问法，第一个是**「谁在自己实现一个可搜索的列表过滤」**
（搜索框 + 分组过滤：关键字归一化、分组保序、空组丢弃）。

按形态扫下来，全库有 **8 处**各写一遍「怎么把用户输入变成一个可用的搜索关键字」：

| 落点 | 归一化写法 | 可搜字段 |
| --- | --- | --- |
| `AttributeMultiSelect`（工坊角色属性多选） | **只 `trim()`** | 分组选项（`options`） |
| `model-library-config` 的 `filterModels` / `filterFolders` | `trim().toLowerCase()` | 名称 + 文件名 / 目录名 + 标签 |
| `workflow-library-config` 的 `filterWorkflows` / `filterPending` | `trim().toLowerCase()` | 名称 |
| `log-store` 的 `matchesSearch` | `trim().toLowerCase()` | 正文 + 位置 |
| `LogRow` 的 `HighlightedText` | `trim().toLowerCase()` | 正文分片 |
| `RgthreeBodies` | `trim().toLowerCase()` | 组标题 |
| `multi-mode-select` | `trim().toLowerCase()` | code / label / subCategory / fullName |
| `app/api/materials/route.ts` + `server/api/routers/material.ts` | `trim().toLowerCase()` | 素材名 |

**差别不是风格，是一个语义决定 —— 且有一处判错了：**

`AttributeMultiSelect` 只写了 `trim()`，没折小写。这看起来「也对」（那批候选值
绝大多数是中文），直到候选里出现**含拉丁字母**的项 —— 而它们**真在数据里**：
`COSTUME_OPTIONS` 有 `JK制服`、`T恤`；`APPEARANCE_OPTIONS` 有 `3D`。用户输 `jk`
**一条也搜不到**。这就是**同一个决定散在多处就不会被统一说出来**：
`includes` 与 `toLowerCase().includes` 都编译、都运行、类型都对，
差别只在这一个字符上。

另一处同源问题：`AttributeMultiSelect` 的「分组过滤」只在**全空**时给
「未找到匹配项」，中间的空标题仍会渲染 —— 搜「旗袍」时「中式」下面一条结果、
紧跟着的「日韩」下面什么都没有，却还是留着一个小标题。

#### 出口：`~/lib/list-filter`

| 导出 | 承载的口径 |
| --- | --- |
| `normalizeNeedle(raw)` | **同时**去两侧空白 + 折小写。只做一半就是上面那处缺陷 |
| `matchesNeedle(needle, haystack)` | 子串命中；空关键字恒命中（不搜 = 全留）。**两侧都折小写** —— 只折 haystack 不够（`matchesNeedle("T恤", "t恤")` 会 false） |
| `filterGroups(groups, needle, field, hit?)` | **保组序 + 丢空组**。`field` 可配（`OptionGroup` 叫 `options`，其余叫 `items`）—— 硬性统一改名会牵动 `character-options.ts` 的 300+ 行数据 |
| `filterGroupsByKeyword(...)` | 一步式：先归一化再分组过滤。**合成一个调用点，是因为分开写就有人只写一半** |

**保组序**（不按命中数重排）与**丢空组**这两条各有一条反例作证 —— 前者是
「同一个关键字连输两次、分组顺序会跳」（那是界面在动，不是结果在变），
后者就是上面 `AttributeMultiSelect` 那个空标题。

**「可搜哪些字段」是域判据，留在调用处**：`filterModels` 命中的是「名称 + 文件名」
拼接后的整串（所以搜 `model.safetensors` 也能中），`workflow-library-config`
只看 `name`，`RgthreeBodies` 只看 `group.title`。出口只做可机器判定的那一半。

#### 判据：P13（硬闸）

`check-ui-primitives.cjs` 新增 **P13**（`HARD_GATE_RULES`，不进基线）：
视图 / 逻辑层里的搜索关键字归一化（`<expr>.trim().toLowerCase()`）。

⚠️ **判据必须同时数「只 `trim()` 不折小写」那种写法** —— 它是这条账里
**更差**的那一种，而它**不含** `.trim().toLowerCase()`。判据漏掉更差的写法，
被拦下的就永远只是合规者。所以 P13 还数「变量名像搜索词
（`kw` / `needle` / `term` / `query` / `search` / `keyword` / `q`）且值只经
`trim()`」的形状；无关的去空白（`line.trim()`）不误伤。

豁免 `src/app/api/**`：服务端路由的查询参数归一化与「视图搜索框」不是同一件事
（没有 UI 归一化那层契约），与 P12 跳过 `app/api/**` 同款。

> 这两条是现成的落点：`AttributeMultiSelect` 与 REST 路由都在这批接上了出口，
> 但 P13 的两条形态**都记在规范里** —— 下一个人的搜索框若只写 `trim()`，
> 门禁会直接拦下，而不是等用户在候选里搜 `jk` 时才发现。

### 16.2.4.17 「一棵树的展开 / 收起」状态没有出口（P14 硬闸）

三个问法里的第二个：**「谁在把一棵树渲染成缩进列表」**。

`NodesTab`（自定义节点设置）一棵树用了**三份同形的 `Record<string, boolean>`**
（`expandedParents` / `expandedNodeList` / `nodeExpanded`），每份配一组
**逐字同形**的读写代码：

```tsx
/* 读：三处都是这个写法，`undefined` 与 `false` 分不出来 */
const isOpen = !!expandedParents[parent];
/* 写：三处逐字同形，只有键的来源不同 */
setExpandedParents((prev) => ({ ...prev, [parent]: !prev[parent] }));
```

三件事散在调用处，各自的缺陷都能对上号：

1. **「默认展开」那段逐字抄了两遍**（`use-custom-nodes-settings` 的冷 / 热两条
   路径各一份）：
   ```tsx
   setExpandedParents((prev) => {
     const out = { ...prev };
     for (const p of paths) if (!(p in out)) out[p] = true;
     return out;
   });
   ```
   它的语义是「**已经存在的那一项不许被覆盖**」——用户手动收起过的目录，
   在下一轮刷新后不该自己弹回来。这条语义在一段代码里，抄两遍就有两份会漂。
2. **`!!map[key]` 把「用户手动收起过」与「从没碰过」压成同一个 `false`** ——
   而上面那条判据恰恰要区分它们（那是 `in` 与取值两种判据，不是一个）。
3. **没有「全收起 / 全展开」这个动作**，于是每处需要时又各写一段
   `Object.fromEntries(...)`。

#### 出口：`~/components/ui/expansion-set` 的 `useExpansionSet`

| 成员 | 承载的口径 |
| --- | --- |
| `isExpanded(key)` | 缺键 = 未表态 = 折叠 |
| **`hasKey(key)`** | **该键有没有被表过态**（无论展开还是收起）—— 与 `isExpanded` 是两种判据，这正是上面第 2 条的修法 |
| `toggle(key)` / `set(key, open)` | 函数式 updater（连点两次回到原态，不吃闭包里的旧值） |
| **`seedDefaults(keys, open?)`** | 为**尚未表态**的键补默认值，**不覆盖已有表态**；无变化时**返回原引用**（它在 effect 里被调，每次给新对象会让订阅者白渲染一轮） |
| `replace(map)` / `collapseAll()` | 整体替换（全展开 / 从持久化恢复）与全收起 |

**它是 hook，不是组件** —— 树的渲染由调用处决定。`Disclosure`（§16.2.4.13）
管的是「**一行**怎么折」，本模块管的是「**一棵树的哪些行折着**」，两者配合，
不互相替代。

#### 判据：P14（硬闸）

`check-ui-primitives.cjs` 新增 **P14**（`HARD_GATE_RULES`，不进基线）：视图里的
**展开集合翻转样板** —— 形态取「`{ ...src, [key]: !src[key] }`，**同一个标识符**
既被展开、又是翻转的取值源」。

参数名**故意不写死**（`prev` / `state` / `parents` / `nodeList` / `expanded`
各种都有 —— 收口前那三处的形参名就是三种）。双条件（展开 + 翻转同源）是必须的：
只数 `[k]: !x[k]` 会把「在跑标记」这类**不是折叠语义**的映射误判成展开集合。

⚠️ 这条边界有反面用例：`use-workflow-library` 的 `pendingLoading` 写的是
`{ ...state, [id]: true }` —— 它是**落位中**标记，没有「翻转」，也不该走
`ExpansionSet`（那会给出一个错误的语义）。

### 16.2.4.18 「面板的加宽档」在三处各写一遍（P15 硬闸）

第三个问法：**「谁在给一个抽屉 / 面板做『收起 → 窄条』形态」**（宽度拖拽 +
折叠态 + 记忆）。

按形态扫下来，画布侧栏（`CanvasPanelToolbar` 的工具栏 / 面板切换）与三个日志
面板都有「档位」这件事，而**真正被各写一遍的是加宽档**：`LogPanel` /
`GlobalStepLogPanel` / `WorkflowRunLogModal` 三份**逐字同形**：

```tsx
/* 三份各写一遍 */
const [wide, setWide] = useState(false);
popupClassName={wide ? W.width : W.base}                       // ← ①
className={`…h-[85vh]… ${wide ? W.width : W.base}`}            // ← ② 同一文件里再来一遍
<Button onClick={() => setWide((w) => !w)} title={wide ? "收缩" : "加宽"}>
  {wide ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
</Button>
```

三份**共同欠着同一件事**：**「加宽」这个选择没有任何记忆**。用户把执行日志
加宽、关掉、再打开 —— 又变回窄档；三个面板都是如此。而这**不是「设计如此」**，
是三份实现都只写了 `useState`、**没有人负责持久化**。

> 与 `ui/dialog-width`（§16.2.4.11 那批）的分工：那个模块管的是**「宽度怎么写
> 才生效」**（`w-*` 而非 `max-w-*`，ISSUE #720 的静默失效）；本模块管的是
> **「加宽这个动作」**本身。两者相邻但不是同一件事 —— 前者是常量，后者是状态。

#### 出口：`~/components/ui/wide-panel` 的 `useWidePanel` / `WidePanelToggle`

- `useWidePanel(id, widths, defaultWide?)` → `{ wide, toggle, set, widthClass, toggleLabel }`；
  `id` 是**记忆的键**（必须跨挂载稳定：面板 id，不是组件实例）；
- `widthClass` 一处给出当前档位的宽度类 —— 同一文件里那两处三元从此不可能
  不一致（收口前它们是分开写的，改一处漏一处就是「弹窗外壳宽了、内容没宽」）；
- `toggleLabel` 一处给出文案，`title` 与 `aria-label` 同源（改名不会漏一处）；
- **记忆**按 `id` 落 `localStorage`，并走「模块级 store + `useSyncExternalStore`」
  —— 与 `useCanvasSettings` 同一套机制。不用纯 `useState`，是因为同一面板
  可能同时挂两份实例（按钮在标题栏、面板体在 Portal 里），纯 `useState`
  会让两边各有一份真相。storage 不可用时**静默降级**（记忆是增强，不是功能）。

#### 判据：P15（硬闸）

`check-ui-primitives.cjs` 新增 **P15**（`HARD_GATE_RULES`，不进基线）：视图里的
`<flag> ? <X>.wide : <X>.base` 三元。**不能数 `useState(false)`** ——
那会把正常的弹窗开关全算进来（反面用例钉住这一条）。

#### 画布侧栏那条账的现状（**结论对、理由要更正**）

「收起 → 窄条」这件事在画布侧栏**还没发生**：`ProjectCanvas` 的侧栏是
`CanvasPanelToolbar` + 两个固定宽面板（`MaterialLibraryPanel` /
`HistoryPanel` 都是 `w-[360px] shrink-0`），工具栏的「收起」是把它整体
`activePanel === null` 掉（浮回画布左侧）。**没有宽度拖拽、也没有折叠态记忆**。

所以这条的一半是**已经存在的重复**（上面三个日志面板的加宽档，本批已收口），
另一半是**尚未发生的选型**（侧栏的可变宽 + 折叠记忆）—— 后者不是「治理一份
重复实现」，而是「要不要给侧栏加一条可变宽交互」这个设计决定。写在这里，
免得下一轮再把它当成一个「重复实现」去找。

### 16.2.4.19 「给一段异步动作配进度」有十份写法（P16 硬闸）

§16.2.4.18 收尾时留了两个问法，第一个是**「谁在给一段异步动作配进度」**
（`useSimulatedProgress` 与 SSE 的进度条各自造一份「不确定 / 确定」的换算，
而 `ui/progress` 就在库里）。

按形态扫下来，全库有 **10 处**各写一遍「track + 内层 `width: X%` + 百分比文字」，
而**写法分四派**：

| 落点 | 写法 | 缺的是哪一条 |
| --- | --- | --- |
| `VideoStudio.parts` / `ShotStudio` / `WorkshopEncapsulationPanel` | `Math.max(4, progress)` | 一个**可见下限** |
| `StoryboardPlanner.parts` | `p?.pct ?? 0` | 「还没报进度」被压成 0% |
| `HistoryTaskCard` | 直接 `${progress}%` + `Math.floor` 另算一处 | 不夹取、算了两次 |
| `CustomNodesSettings/SettingsParts` | `Math.min(100, (done / total) * 100)` | 自己算比例、不确定态手写条纹 |
| `FilmStudio` / `TrainingStudio` ×2 / `WorkflowCanvasNodePreview` / `WorkshopHeader` | 直接 `${x}%` | 不夹取 |

四派都编译、都运行、类型都对 —— 差别只在几个**语义决定**上：

- **0% 要不要留一格**？`Math.max(4, 0)` 会把「还没开始」画成跑了 4%；
  而另外六处 0% 就是空条。两者各自看着都「没毛病」，全库一起才看得出
  是**同一个决定写了两遍相反答案**。
- **超量要不要夹取**？接口 / SSE 给的数不可信，`120` 会溢出容器（多出来的
  一截被 `overflow-hidden` 吃掉，看起来是满的；但 `-1` 会让宽度为负）。
- **总数未知算 0 还是算不确定**？`ParseProgressBanner` 那处是**唯一想清楚了的**
  —— 它用手写 CSS 条纹表达「在跑但不知道还剩多少」；其余各处的初态一律
  画成 0%，看起来像「卡住没动」。
- **a11y 语义谁给**？10 处里**只有 2 处**声明了 `role="progressbar"` 与
  `aria-valuenow`，其余 8 处对读屏器完全不可见。

#### 出口：数值侧 `~/lib/progress` + 形态侧 `~/components/ui/progress-bar`

这件事**必须分两个出口**，因为两半的消费方不同：

- **数值**（`~/lib/progress`）由视图层**与 `src/lib` 两侧共用** ——
  `comfyui/executor-ws` 落库、`project-canvas/canvas-api` 透传、
  `workshop/generation-client` 转发、`core/repository-lora` 写库都要
  「值 / 上限 → 百分比」。两侧口径不一致就会出现「界面卡在 100%
  而数据库还在涨」。所以它进 `DOMAIN_EXEMPT`（与 `format-bytes` /
  `display-value` / `list-filter` 同款：唯一持有者 + 任何域消费的顶层单例）。
- **形态**（`ProgressBar`）只服务视图，是 `ui/` 基元。

| 导出 | 承载的口径 |
| --- | --- |
| `clampPct(n)` | 夹取到 `[0, 100]` **并取整**；非有限数 → 0（此处是「确定值」语义） |
| `toPct(done, total)` | 比例 → 百分比；**分母不可用 / 分子非有限 → `null`（不确定态）**，不是 0 |
| `pctToWidth(pct, { minVisible })` | 百分比 → 宽度；**`minVisible` 只抬非零值**（0 恒为 0） |
| `PROGRESS_MAX` | 上限 100（唯一常量） |

`ProgressBar` 的 `value` 直接吃 `number | null`：`null` 渲染滑动条纹并
给 `aria-valuetext="进行中"`（**不给 `aria-valuenow`** —— 不确定的进度不该
被读成一个数），确定值则给 `role="progressbar"` + `aria-valuenow`。
填充观感的差异（品牌实心 / 渐变）走 `fillClassName`，不由调用处重画轨道。

> **与 `ui/water-fill-progress` 的分工**：那是「水逐渐装满」的**覆盖层**
> （`absolute inset-0`，水位是 `height` 而不是 `width`，还有正弦波水面），
> 是另一种视觉形态，不是同一条账。它自己也改用 `clampPct` 取数值。

#### 判据：P16（硬闸）

`check-ui-primitives.cjs` 新增 **P16**（`HARD_GATE_RULES`，不进基线）：视图里的
`style={{ width: \`${…}%\` }}`。

⚠️ **锚点取「自己按百分比摆宽度」这个动作本身**，不取 `rounded-full` / `bg-primary`
（那会把所有圆角元素与按钮都算进来），也不取 `role="progressbar"`（收口前
10 处里只有 2 处有它 —— 拿它当判据，被拦下的永远是合规者）。反面用例钉住
`style={{ width: "280px" }}`（定宽是布局，不是进度）。

### 16.2.4.20 「把一个对象渲染成键值行」有五份写法（P17 硬闸）

第二个问法：**「谁在把一个对象渲染成键值行」**
（`HistoryDetailModal` 的参数表、`WorkflowNodeJsonPopover` 的 JSON 视图、
`StepLogCache` 的字段块，三处各自拼「标签 + 值 + 空值占位」的行）。

按形态扫下来，全库有 **5 处**各写一遍这样的行，而**布局语言有四种**：

| 落点 | 形态 |
| --- | --- |
| `ProjectOutputs` 的参数表 | 行内左右分布 + 隔行底色 + 外层圆角边框 |
| `HistoryDetailModal` 的生成参数卡 | 网格卡片 + 标签在值左侧 + 行下 `hint` |
| `HistoryDetailModal` 的参数表 | HTML `<table>` 两列（左列等宽截断，但用的是 `<td>` —— **语义是空的**） |
| `TrainingStudio` 的 Metrics | 网格 + 标签在值**上方** |
| `BrowserStatusBar` 的显存 / 内存 | 行内 `标签 + 值 + 尾注`（三份逐字同形） |

`HistoryDetailModal` 两处还各写了一份**逐字相同**的「值怎么成文本」三元：
`typeof v === "string" || typeof v === "number" ? String(v) : JSON.stringify(v)`。

> **「空值显示什么」不在这条账里** —— 它早由 `~/lib/display-value` 的
> `displayValue` 收口（P8，见 §16.2.4.11）。也就是说剩下的只有**布局**这一层
> 没有被说出来：同一行键值有四种布局语言，改一处对齐/密度要改五遍。

#### 出口：`~/components/ui/key-value-rows` 的 `KeyValueRows`

`items: KeyValueItem[]` + `layout`（四种）：

- `rows`（缺省）：一行一对，标签左、值右，值走等宽字体；`bordered` 加外框、
  `striped` 加隔行底色。对应 `ProjectOutputs` 那张表。
- `stacked`：标签在值**上方**，多列网格（`columns`）；`hint` 落在值下面一行。
  传 `itemClassName="flex-row items-baseline"` 可改回「标签在值左侧」
  （`HistoryDetailModal` 的生成参数卡）。对应 `TrainingStudio` 的 Metrics。
- `table`：**真正的 `<table>`**，`<th scope="row">` 声明行表头（读屏器读得出
  「哪个标签对应哪个值」）。对应 `HistoryDetailModal` 的参数表。
- `inline`：`label value` 挤在一行不换行的内联项。对应 `BrowserStatusBar`。

`value` 与 `raw` 二选一：`value` 是已渲染节点（含徽章 / 链接），`raw` 交给
`displayValue` 处理缺值。`key` 也可以是节点（`WorkshopEncapsulationPanel`
的「口一览」行，键里带两个条件徽标）。**「取哪些字段」是域判据，留在调用处**
（如 `history-detail-derive` 的 `deriveParamRows`）—— 出口只做可机器判定的那一半。

顺带收掉一处同源重复：`HistoryDetailModal` 两处那份**逐字相同**的值 → 文本
三元，收进 `history-detail-derive` 的 `kvValueText`。

#### 判据：P17（硬闸）

`check-ui-primitives.cjs` 新增 **P17**（`HARD_GATE_RULES`，不进基线）：一个
muted / faint 色的**标签叶子元素**，紧随其后（160 字符内）出现**值的渲染器**
（`displayValue(` / `JSON.stringify(` / `typeof x === "string"`）。

⚠️ **两个条件必须同时成立**：只有标签 → 到处都有的小标题；只有值渲染器 →
JSON 气泡 / 预览。窗口取 160 字符 —— 实测 400 字符会把环形进度的
「进度」标签与下方 SVG 连上（误报）。

⚠️ **已用 `KeyValueRows` 的文件直接跳过**：它的标签 / 值节点是作为 `items`
传进去的，形态判据会把它们连起来误报（`WorkshopEncapsulationPanel` 的键
节点里有个 muted 色的口 id span）。与 P13「更差的那种写法也要数」是同一枚
硬币的两面 —— 判据要覆盖所有不合规的写法，也要**一个都不误伤**合规的。
反面用例钉住「只有小标题、没有值」的行。

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
