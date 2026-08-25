# Comfy-APP-T3 商业级项目开发规范

> 版本：v1.0 ｜ 适用仓库：`F:\AI\Other\Comfy-APP-T3` ｜ 维护者：yuedu
> 本规范是项目开发、评审、提交的强制性基准；与既有《Comfy-APP-T3-命名规范》《Comfy-APP-T3-命名审计报告》《docs/TESTING.md》配套使用。

---

## 1. 项目总览与技术栈

| 维度 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js 16.3（App Router, Turbopack） | `next dev --turbo` 开发 |
| 语言 | TypeScript 7（strict） | `tsc --noEmit` 零错误为提交门槛 |
| 全栈类型安全 | tRPC 11 + @tanstack/react-query | superjson 序列化 |
| ORM | Prisma 6 + SQLite | generated client 在 `generated/prisma` |
| 认证 | better-auth 1.3 | 会话接入 tRPC context |
| 样式 | Tailwind CSS 4 | `@tailwindcss/postcss` |
| 画布 | @xyflow/react 12 | 工作流画布 + 项目画布 |
| 状态 | zustand 4 | 轻量全局状态（debug-store 等） |
| 校验 | zod 3 | 所有输入边界 |
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

### 4.3 样式

- 优先 Tailwind 原子类；复杂组件用 `cn()` 合并。
- 颜色/圆角/阴影从设计 tokens 取值，禁止散落魔法值（画布节点色表收敛为模块级 Map）。
- 全局样式只在 `src/styles` 与 `globals.css` 中维护。

### 4.4 文案与注释

- 面向用户的文案一律中文；代码注释中文或英文均可，同一文件内保持一致。
- 注释解释"为什么"，不解释"是什么"；性能/兼容性决策必须写注释说明动机。

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
- 提交前甄别无关文件（`.workbuddy/`、调试 html、临时脚本）移出暂存。
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
- 启动脚本统一走 `scripts/dev-launcher.ps1`（Job 对象管理进程树、按端口精准清理残留、日志落 `.workbuddy/log/`）。

---

## 7. 测试与质量规范

| 门禁 | 命令 | 要求 |
|---|---|---|
| 类型 | `pnpm typecheck`（tsc --noEmit） | 零错误 |
| Lint | `pnpm lint`（eslint 9） | 零 error |
| 格式 | `pnpm format:check`（prettier） | 零 diff |
| 单测 | `pnpm test`（vitest） | 全绿；纯函数必须覆盖 |
| 生产构建 | `pnpm build`（next build） | 涉及构建链改动时必跑 |

- 单测聚焦纯函数与可单元化的业务逻辑（见 `docs/TESTING.md`）；API 文档由 `pnpm docs`（typedoc）生成。
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
| 测试说明 | `docs/TESTING.md` | 测试体系变更时 |
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
4. 变更文档已同步。

---

*本文档随项目演进持续维护；任何与既有规范的冲突以本文档最新版本为准。*
