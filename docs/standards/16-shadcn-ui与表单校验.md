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
