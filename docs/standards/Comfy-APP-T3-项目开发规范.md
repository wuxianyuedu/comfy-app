# Comfy-APP-T3 商业级项目开发规范

> 版本：v1.0 ｜ 适用仓库：`F:\AI\Other\Comfy-APP-T3` ｜ 维护者：yuedu
> 本规范是项目开发、评审、提交的强制性基准；与既有《Comfy-APP-T3-命名规范》《Comfy-APP-T3-命名审计报告》《docs/guides/TESTING.md》配套使用。
> 前端工程深度细则见《前端工程规范文档集》（docs/standards/，README + 01~15 章）；与文档集的章节映射、冲突处理见统一索引 [docs/README.md](../README.md)。

---

## 1. 项目总览与技术栈

| 维度 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 16.3（App Router, Turbopack） | `next dev --turbo` 开发 |
| 语言 | TypeScript 7（strict） | `tsc --noEmit` 零错误为提交门槛 |
| 全栈类型安全 | tRPC 11 + @tanstack/react-query | superjson 序列化 |
| ORM | Drizzle ORM + better-sqlite3 | schema 在 `src/server/db/schema.ts`，数据访问收敛到 `src/lib/core/repository*` |
| 认证 | better-auth 1.3 | 会话接入 tRPC context |
| 样式 | Tailwind CSS 4 | `@tailwindcss/postcss` |
| 画布 | @xyflow/react 12 | 工作流画布 + 项目画布 |
| 状态 | zustand 5 | 轻量全局状态（debug-store 等） |
| 校验 | zod 4 | 所有输入边界 |
| 桌面壳 | Tauri 2 | 套壳 WebView2 |
| 日志 | pino + pino-pretty | 服务端结构化日志 |

**开发端口**：dev server `:3000`；本地 ComfyUI `:8188`。

---

## 2. 架构规范

### 2.1 目录结构约定

```
src/
├── app/            # Next.js App Router 路由层（页面/路由处理器，不写业务逻辑）
├── components/     # React 组件层
│   └── studio/     # 画布/工作流/项目编辑相关（本项目核心域）
│       ├── project-canvas/   # 项目画布节点组件
│       └── ui/               # 通用 UI 组件
├── config/         # 常量与静态配置
├── lib/            # 纯工具函数（无 React、无服务端依赖）
├── server/         # 服务端逻辑（db 客户端、repository、服务）
├── styles/         # 全局样式
└── trpc/           # tRPC router 定义（router 聚合、context）
```

**分层职责（单向依赖，禁止反向）**：

```
app（路由） → components（UI） → trpc（API 调用）
server（数据/业务） ← trpc（router 实现）
lib（纯函数） ← 任意层
```

### 2.2 tRPC router 组织

- 每个业务域一个独立 router 文件，在 `src/trpc` 聚合导出 root router。
- **受保护 procedure**：凡涉及用户数据的查询/变更，必须使用接入 better-auth session 的受保护 procedure，禁止裸 public procedure 暴露私有数据。
- 所有 procedure 入参必须用 zod 定义 schema 并在 `input()` 中声明，禁止手写 `any` 解析。
- 返回类型由 `output()` / 推断得出，禁止 `as any` 逃逸类型检查。

### 2.3 Prisma 数据层规范

- schema 变更走 `prisma migrate dev` 生成迁移；生产部署走 `prisma migrate deploy`。
- 查询热点（外键、过滤列）必须建立索引：`@@index` / `@@unique`。
- **禁止 N+1**：repository 层循环内调用 `prisma.findMany` 必须改为批量查询 + 内存映射。
- 敏感字段（密码哈希、token）禁止 select 到客户端；`bcryptjs` 哈希仅在服务端使用。

### 2.4 better-auth 会话

- 会话校验集中在 tRPC context；组件侧使用 hook 获取用户，禁止组件直接访问服务端 session 对象。
- 登录/注册/退出走 better-auth 标准流程，禁止自建凭据存储。

---

## 3. 命名规范

完整细则见《Comfy-APP-T3-命名规范》（v1.1），核心硬约束：

| 对象 | 规范 | 反例 |
|---|---|---|
| 文件 | kebab-case；域前缀按语义演进（`workflow-*` 取代 `wf-*`） | `wfNode.tsx` |
| 组件 | PascalCase；文件与导出组件同名 | `workflowNode` |
| 变量/函数 | camelCase，禁止单字母变量（循环索引除外） | `let x = ...` |
| 常量 | UPPER_SNAKE_CASE，模块级 | `const maxZoom` |
| CSS 类 | kebab-case，Tailwind 原子类优先 | `camelCaseClass` |
| 领域术语 | 统一术语表（workflow/project-canvas/studio 等），禁止混用近义词 | updream/canvas 混用 |

**验收**：`tsc --noEmit` 零错误 + 命名审计无高危项。

---

## 4. 代码风格规范

### 4.1 TypeScript

- 开启 strict 全部检查；`tsc --noEmit` 必须零错误。
- 禁止 `any`（确需时用 `unknown` + 窄化）；禁止 `@ts-ignore` / `@ts-expect-error` 无注释。
- 类型定义就近放置；跨文件共享类型放 `types` 或组件文件导出。
- 解构 props 时显式声明类型，禁止隐式 any。

### 4.2 React 组件模式

- **函数组件 + hooks**，禁止 class 组件。
- 高频重渲染组件（画布节点、列表项）用 `React.memo` 包裹；**列表容器传给子项的回调必须 `useCallback` 稳定，否则 memo 失效**。
- 稳定引用规则：
  - `nodeTypes` / `edgeTypes` / `defaultEdgeOptions` 保持**模块级常量**；
  - MiniMap `nodeColor` 等渲染回调用 `useCallback([])` + 模块级查找表；
  - 状态派生用 `useMemo`，依赖数组精确，禁止省略依赖（`react-hooks/exhaustive-deps`）。
- zustand store 订阅必须**按需选择字段**：`useStore((s) => s.xxx)`，禁止无选择器订阅整个 store。
- 副作用（事件监听、定时器）必须在 cleanup 中释放。
- **UI 与逻辑分离（强制）**：视图层（`src/components/**`、`src/app/**`，Route Handler
  `src/app/api/**` 除外）**禁止新写** `fetch(`、`vanillaApi.*`、tRPC hook
  （`api.x.y.useQuery/useMutation`）——逻辑进 `<feature>/hooks/`，网络进
  `src/lib/<domain>-client.ts`（**网络层一律放 `src/lib/`，守卫只豁免
  `components/**/hooks/`，不放 `components/<feature>/*-api.ts`**）。
  四层范式见文档集
  [16.2.1](16-shadcn-ui与表单校验.md#1621-落地范式controller-hook--纯展示视图)，
  全库推进计划与棘轮护栏（已接入 pre-commit 与 CI）见
  [第 17 章](17-UI与逻辑分离.md)。当前棘轮基线 **16 处 / 10 文件**
  （P1–P4 已落地，104 → 16；剩余收尾项见 §17.4 批次表）。

### 4.3 样式

- 优先 Tailwind 原子类；复杂组件用 `cn()` 合并。
- 颜色/圆角/阴影从设计 tokens 取值，禁止散落魔法值（画布节点色表收敛为模块级 Map）。
- 全局样式只在 `src/styles` 与 `globals.css` 中维护。

### 4.4 UI/UX 生产级规范（2026-08-26 新增）

本规范依据 AppShell 生产级评审沉淀，后续所有组件必须遵守。

#### 4.4.1 Design Tokens（设计令牌）

所有颜色、尺寸、圆角、阴影必须从 `src/app/globals.css` 的 `@theme` 取值，禁止在组件里写死十六进制或像素值。

| 用途 | Token 示例 | 组件写法 |
|---|---|---|
| 背景 | `--color-surface-0` / `--color-surface-1` | `bg-surface-0` |
| 边框 | `--color-border-subtle` | `border-border-subtle` |
| 文字 | `--color-ink` / `--color-muted` | `text-ink` |
| 布局尺寸 | `--panel-right-width` | `w-(--panel-right-width)` |

反例：`bg-[#0a0a0f]`、`border-white/6`、`style={{ width: 360 }}`。

#### 4.4.2 可访问性（a11y）

- 布局区域必须加语义化标签与 `aria-label`：`<header>`、`<main>`、`<aside>`、`<nav>`。
- 可展开/收起面板必须提供 `aria-expanded`、`aria-hidden`、`role`。
- 按钮/链接必须可键盘聚焦；自定义焦点样式由 `*:focus-visible` 全局管理。

#### 4.4.3 面板/弹窗动画

优先使用 **CSS transition**（零依赖、性能好、不阻塞渲染）：

```tsx
<aside
  className={cn(
    "transition-all duration-300 ease-out",
    rightPanelOpen ? "w-(--panel-right-width) opacity-100" : "w-0 opacity-0 pointer-events-none"
  )}
>
  {rightPanel}
</aside>
```

- 需要进入/退出动画时，**始终保留 DOM**，用 `width`/`opacity`/`transform` 控制显隐；避免 `{open && <Panel />}` 导致硬切。
- 仅当项目已安装 `framer-motion` 且动画复杂度超出 CSS 能力时，才使用 `framer-motion`。

#### 4.4.4 字体加载

禁止在组件内联 `style={{ fontFamily: ... }}`（FOUC + 不可维护）。

正确做法：

1. Latin 字体通过 `next/font/google` 加载并导出 CSS 变量；
2. CJK 字体使用系统回退栈（`PingFang SC`、`Microsoft YaHei`、`Noto Sans SC` 等），避免下载超大中文字体文件；
3. 在 `src/app/globals.css` 的 `--font-sans` 中组合变量与系统字体；
4. `src/app/layout.tsx` 的 `<body>` 应用 `font-sans`。

#### 4.4.5 "use client" 位置

- **纯布局壳**（无 state/effect/事件）理论上应为 Server Component。
- 但本项目的画布/工作流页面都是 Client Component，且直接 import 布局壳，因此 `AppShell` 保留 `"use client"`。
- 新增纯布局组件时：若调用方是 Server Component，**必须去掉 `"use client"`**；若调用方是 Client Component，可保留或在外层套一个极薄的 Client Wrapper。

#### 4.4.6 className 合并

复杂组件使用 `cn()` 工具（`src/lib/utils.ts`）。

- 当前 `cn()` 为轻量实现：过滤 falsy + 展平一层数组。
- **后续应迁移到 `clsx` + `tailwind-merge`**，以正确处理冲突类名（如 `p-2` vs `p-4`）。
- 调用方传入 `className` 时，必须放到 `cn()` 最后，确保可覆盖默认样式。

### 4.5 文案与注释

- 面向用户的文案一律中文；代码注释中文或英文均可，同一文件内保持一致。
- 注释解释"为什么"，不解释"是什么"；性能/兼容性决策必须写注释说明动机。
- 注释**只写当前代码的 Why，不写代码的历史**：禁止作者 / 日期 / 版本流水 / changelog
  （如 `R-ardot122 (2026-08-31)`）—— 这些归 `git log` 与 commit message，写进代码会过期失真。
  最该写的是**被否决的方案及其原因**。细则见前端规范 [12.4](12-代码组织与文件结构.md#124-注释规范只写当前代码的-why)。

### 4.6 React 19 严格模式 lint 实践（2026-08-27 新增）

React 19 已移除 `setState-in-render` 豁免并新增严格 hooks 规则，`eslint errors` 必须清零（warnings 另立任务跟踪）。踩坑与规范写法：

- **set-state-in-effect 不再豁免**：禁止用文件级 `/* eslint-disable react-hooks/set-state-in-effect */` 掩盖违规；必须逐处改为规范写法。
- **规范写法一（渲染期对比 + 渲染期 setState）**：同一 render 内先读 `latestRef.current` 与本次值比较，不等才 `setState`（React 19 允许渲染期 setState，遇冲突自动重渲染）。
- **规范写法二（setTimeout 延迟提交）**：纯 effect 场景改用 `setTimeout(() => setState(...))` 延迟到 render 提交后，避免同步 setState 触发 lint。
- **已改造文件**：`settings/page.tsx`、`FilmStudio.tsx`、`ModelLibrary.tsx`、`ContentAssetNode.tsx`、`llm-context.tsx`、`CanvasNode.tsx`、`workflow-stores.tsx`、`workflow-editor-build-nodes.ts` 等；配套删除 5 个文件的文件级豁免。
- **提交粒度**：lint 修复与功能改动分开提交，便于回滚与 review。

---

## 5. Git 工作流

### 5.1 提交信息规范（Conventional Commits）

```
<type>(<scope>): <subject>

<body 说明动机与关键决策>
```

| type | 场景 |
|---|---|
| feat | 新功能 |
| perf | 性能优化 |
| refactor | 重构（行为不变） |
| fix | 缺陷修复 |
| chore | 构建/脚本/依赖/杂项 |
| docs | 文档 |
| test | 测试 |

**硬性要求**：
- 一个提交只做一件事；多语义改动**分提交**落库。
- 提交前甄别无关文件（`temp/`、`python-venv/`、调试 html、临时脚本）移出暂存。
- 相关配套文件（文档、辅助脚本）与代码改动同提交或紧随提交。

### 5.2 Windows + git-lfs 环境提交

本机全局 gitconfig 配置了 `filter.lfs.process`，直接 `git add` 会挂起超时。**必须使用绕过参数**：

```powershell
git -c core.autocrlf=false -c filter.lfs.process= -c filter.lfs.clean= -c filter.lfs.smudge= -c filter.lfs.required=false add <path>
git -c core.autocrlf=false -c filter.lfs.process= -c filter.lfs.clean= -c filter.lfs.smudge= -c filter.lfs.required=false commit -m "..."
```

遇 `index.lock` 残留：先 `Remove-Item .git\index.lock -Force` 再重试。

### 5.3 分支与合并

- 主分支 `master` 保持可构建、可运行。
- 大改动先建特性分支（`feat/<描述>` / `perf/<描述>`），验证通过后合回。
- 提交前自检清单：`tsc --noEmit` ✓ → `pnpm lint` ✓ → 相关测试 ✓ → `next build`（涉及构建链时）✓。

### 5.4 CHANGELOG 记录规范

仓库根目录 `CHANGELOG.md` 记录**两次发布之间用户可感知的差异**（Keep a Changelog + SemVer）。

- **该记**：破坏性变更（必须附迁移方式）、新增用户可见功能、行为变更（默认值 / UI 形态 /
  交互路径变化，即使不是缺陷）、影响升级或数据迁移的修复。
- **不该记**：内部重构、类型 / lint 清理、注释与文档修订、测试补充 —— 这些归 `git log`。
- **时机**：PR 合入前随代码一起改，条目先落 `[Unreleased]`；**禁止发版前集中补写**（必然漏项失真）。

三层分工，三者不互相抄：注释写**当前代码的 Why**，commit message 写**这一次改了什么**，
CHANGELOG 写**对外差异**。完整细则见
[文档集 13.10](13-提交与-code-review.md#1310-changelog-记录规范)。

---

## 6. 性能规范

### 6.1 画布性能模式（已落地，后续改动必须遵守）

| 手法 | 要求 |
|---|---|
| 视口裁剪 | 编辑画布必须开启 `onlyRenderVisibleElements`，禁止全量挂载节点 DOM |
| 节点 memo | 画布节点/边组件必须 `React.memo`；回调引用必须稳定 |
| 订阅收敛 | 全局/高频 store 订阅（如 `transform`）只在需要时挂载：弹层类交互拆出"仅打开时订阅"的子组件，关闭时零订阅 |
| 边惰性化 | `defaultEdgeOptions` 设 `deletable/reconnectable=false`，`onEdgeClick` 首访激活单条边；大图（>300 边）未触碰边零交互成本 |
| 颜色表 | MiniMap/节点配色使用模块级 Map + 稳定回调，禁止内联箭头导致的重渲染 |
| 模块级常量 | `nodeTypes`/`edgeTypes`/`defaultEdgeOptions` 一律模块级 |

### 6.2 列表与数据

- 长列表必须虚拟化（或分页/增量加载）；列表项 `React.memo`。
- 查询结果派生计算放 `useMemo`；禁止在 render 内联大对象/数组字面量传入子组件。

### 6.3 构建与缓存

- 指纹策略：清缓存仅依据构建配置（`next.config.js`/`tsconfig.json`/`package.json`/`pnpm-lock.yaml`），**禁止纳入源码目录 hash**——Turbopack 增量编译 + HMR 已处理源码改动，清缓存会导致每次改代码全量重编译慢 30~60s。
- 启动脚本统一走 `scripts/dev-launcher.ps1`（Job 对象管理进程树、按端口精准清理残留、日志落项目根目录 `log/`：本次运行写入 `log/dev-launcher.log`，完整追加到 `log/dev-launcher-YYYY-MM-DD.log`）。

### 6.4 优化点归档（强制）

**任何代码审查/优化过程中发现的可复用改进模式，必须整理进本文档后再提交代码**，避免产出代码后重新优化。归档格式：模式名 + 适用场景 + 落地方案（可引用已实现文件作为范例）。

已沉淀的可复用模式：

| 模式 | 适用场景 | 落地方案（范例） |
|---|---|---|
| 大组件拆分三件套 | 组件文件过大（>1000 行），混合编排、持久化、CRUD | 持久化 effect 抽 `useProjectPersistence` hook；纯函数逻辑抽 `canvas-helpers.ts`；CRUD 状态与方法抽 `useProjectManager` hook；容器只保留编排与 JSX（范例：`ProjectCanvas.tsx` 拆分） |
| 多形态节点类型洞 | 节点 data 形态随 type 变化，遍历时需按类型分派 | 必须用 discriminated union（`type` 字面量判别），禁止 `as unknown as` 双重断言；遍历先守卫窄化（`isCanvasNode`）再访问字段（范例：`canvas-types.ts` CanvasNodeType） |
| 节点 id 工厂 | 多处重复 `n_${Date.now()}_${random}` 生成节点 id | 收敛为单一工厂 `makeNodeId()`，禁止散落内联生成（范例：`canvas-helpers.ts`） |
| fitView 时序 | 依赖 setTimeout 魔法数字等待布局完成 | 用 `onInit` / `requestAnimationFrame` 双保险，禁止裸 setTimeout（范例：`makeFitViewScheduler`） |
| 渲染链路分组 | 调试标签平铺无层级，难以区分画布级/节点级模块 | `RenderChainModule.scope` 字段区分 `canvas`（容器/编排/状态）与 `node`（节点渲染/工具），DebugChainFooter 按组分行渲染（范例：`DebugChainFooter.tsx` + 各 `*-render-chain.ts`） |
| 弱元数据回退推断 | 元数据由外部服务富化、该服务不可达时字段为空（ComfyUI 离线 → `workflowIO` 无 `type`），下游按类型分派的功能**静默退化**（控件变纯文本框、组合选择器整块消失），用户只看到「组件不见了」而不报错 | 分派函数对空类型做**分级回退**：先按 `defaultValue` 实际类型，再按名称/标签关键词推断；同时放宽下游分组识别的类型约束，避免「上游认不出类型 → 下游永不命中」的连锁失效。回退逻辑是纯函数，**必须有单测锁定**，否则极易在下一次类型重构中静默回归（范例：`workflow-io.ts` 的 `inferControlFromName` + `inferDimensionGroup` 双形态，测试见 `workflow-io.test.ts`） |
| exhaustive-deps 三分类处置 | 清理 `react-hooks/exhaustive-deps` 时机械地照规则加减依赖，导致副作用被放大或功能回归 | 先判定属于哪一类再动手：**真缺失**（补上，往往顺带修复潜在 bug——fitView effect 缺 `nodes.length` 会让异步填充的画布永不 fit）、**不必要依赖**（模块级导出 / setState 等恒定引用，直接移除）、**规则静态盲区**（「重算触发器」「按 id 触发」这类无法被静态推断的意图，逐处 `eslint-disable-next-line` 并写明理由，禁止文件级 disable）。补依赖前一律先判断「该依赖每次渲染是否为新引用」（范例：`WorkflowEditorInner.tsx` fitView effect、`GlobalStepLogPanel.tsx` cachedIds） |
| 规则关闭后的失效指令回收 | 为消除某类告警而在配置层关闭规则后，代码里原有的行内 `eslint-disable` 变成「未使用的 disable 指令」，在 `reportUnusedDisableDirectives` 下又是一批新告警 | 关闭规则与回收失效指令必须**成对进行**：改完配置立刻 `eslint --fix`，否则只是把告警从一类搬到另一类（范例：关闭 `@next/next/no-img-element` 后回收 8 处失效 disable） |

**升级依赖前**：先 grep 全库 API 使用点评估破坏性变更（如 zod 4 移除 `z.string().url()` 等 format 方法、`z.record` 改双参、`.default({})` 类型收窄；zustand 5 迁移 `zustand/react/shallow`），改完必须 `tsc --noEmit` 零错误。

---

## 7. 测试与质量规范

| 门禁 | 命令 | 要求 |
|---|---|---|
| 类型 | `pnpm typecheck`（tsc --noEmit） | 零错误 |
| Lint | `pnpm lint`（eslint 9） | 零 error |
| 格式 | `pnpm format:check`（prettier） | 零 diff |
| 单测 | `pnpm test`（vitest） | 全绿；纯函数必须覆盖 |
| 生产构建 | `pnpm build`（next build） | 涉及构建链改动时必跑 |

- 单测聚焦纯函数与可单元化的业务逻辑（见 `docs/guides/TESTING.md`）；API 文档由 `pnpm docs`（typedoc）生成。
- 提交门槛最低要求：`typecheck` + 相关单测通过。

---

## 8. 安全规范

- **凭据零写入**：`.env`/API Key/Token 一律不入库；`server-only` 模块禁止被客户端导入。
- **输入校验**：所有 tRPC 入参 zod 校验；文件上传/URL 等外部输入做白名单校验。
- **会话**：受保护路由/API 必须校验 better-auth 会话；敏感操作（删除、支付、配置变更）二次确认。
- **依赖审计**：定期 `pnpm audit`；高危漏洞升级不拖延。
- 详细基线参考《OWASP-2025-审计报告》。

---

## 9. 文档规范

| 文档 | 位置 | 更新时机 |
|---|---|---|
| 项目开发规范（本文档） | `docs/` | 架构/规范变更时 |
| 命名规范 | 项目 docs 或 output 归档 | 命名规则变更时 |
| 测试说明 | `docs/guides/TESTING.md` | 测试体系变更时 |
| 更新日志 | `CHANGELOG.md`（仓库根目录） | 用户可感知的变更随 PR 落 `[Unreleased]`（见 §5.4） |
| API 文档 | `docs/api`（typedoc 生成） | `pnpm docs` 随构建链更新 |

- 代码行为变更必须同步相关文档；文档与代码同提交。
- 长文档用目录 + 表格 + 示例，禁止大段无结构文字。

---

## 10. 构建与发布规范

### 10.1 Web 构建

```bash
pnpm install        # postinstall 自动 prisma generate
pnpm dev            # 开发（Turbopack :3000）
pnpm build && pnpm start   # 生产预览
```

### 10.2 Tauri 桌面打包

- 版本迭代：`pnpm tauri build`（首次需验证 WebView2 环境）。
- 打包前必须：`tsc --noEmit` ✓ + `next build` ✓ + 版本号同步。
- `src-tauri/static/scripts/dev-launcher.ps1` 为未跟踪副本，**修改 `scripts/dev-launcher.ps1` 后必须手动同步**。

### 10.3 发布检查清单

1. 类型/Lint/单测/生产构建全绿；
2. 敏感信息（.env、密钥）未入库；
3. 无关文件未混入提交；
4. 变更文档已同步；
5. `CHANGELOG.md` 的 `[Unreleased]` 条目已归入本次版本段落（见 §5.4）。

---

*本文档随项目演进持续维护；任何与既有规范的冲突以本文档最新版本为准。*

---

## 11. 疑难排查记录

### 11.1 子工作流展开"卡死"排查（2026-08-27 沉淀）

**现象**：画布点击展开子工作流后，加载覆盖层长时间无恢复（实测约 10 分钟无响应后手动关闭）。

**排查链路**（按序）：
1. 前端下钻链路：`onEnterSubgraph → fetchDetail({subgraphUid}) → tRPC subgraph 接口`；`workflow-editor-detail-loader.ts` 有 sessionStorage 冷/热缓存 + `latestRequestIdRef` 竞态守卫。
2. 服务端：`src/lib/comfyui/workflow-detail.ts` 的 `buildSubgraphDetail` / `buildWorkflowDetailFull`，带 120s 内存缓存，无死锁路径。
3. 底层依赖：`raw.ts fetchObjectInfo` 请求 ComfyUI `object_info`（~4.7MB），超时 `AbortSignal.timeout(20s)`；**ComfyUI 不可达时每次请求都白等 20s 才返回 null**，是卡顿主因。

**加固方案**（commit `2715e7d`）：
- `fetchObjectInfo` 增加**失败负缓存**：失败后 30s 内直接返回 null，避免 ComfyUI 未启动时反复拖慢 20s。
- 详情加载冷路径增加 **60s 超时兜底**（`withTimeout` + `Promise.race`，vanilla tRPC client 不支持传 signal）：后端长时间不返回时抛错提示，不再无限转圈。

**经验**：排查"点 UI 后卡死"按 前端请求链路 → 服务端接口 → 外部依赖超时 三级排查；外部服务（ComfyUI）不可达时的超时等待是最常见隐性拖慢点，优先加失败负缓存与请求超时兜底。

### 11.2 Git 换行符（CRLF/LF）提交噪声处理

**规范（2026-08-27 起）**：本仓库换行符统一使用 **LF**。新提交的代码文件一律 LF；历史 CRLF 文件在涉及改动时随本次提交一并转为 LF，不做增量混用。

**现象**：外部工具（IDE/脚本）批量改写文件换行后，`git diff` 出现全文件行级噪声（如 818 insertions / 808 deletions，`-w` 后仅 22 行真实改动）。

**判定**：`git diff -w --numstat` 对比普通 diff，若行数骤减即为换行噪声；`git ls-files --eol` 查看 index/工作区换行状态。

**处理**：
- 工作区文件批量转为 LF：读取文件字节流，将 `\r\n` 替换为 `\n` 后写回（Python 脚本即可，注意二进制读写避免编码损坏）。
- 提交时使用 `git -c core.autocrlf=false add <file>` 让 LF 原样入库，避免 autocrlf 的 clean 过滤再次改写换行；`core.autocrlf=true` 时 clean 会把 CRLF 转 LF 入库、checkout 又转回 CRLF，造成工作区与 index 反复不一致。
- 提交前必须复查 `git diff HEAD~1 HEAD --numstat`，确认换行统一为 LF 后无异常噪声混入。
