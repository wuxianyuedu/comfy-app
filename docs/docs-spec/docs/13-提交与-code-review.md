## 13. 提交与 Code Review

> 规范落地靠流程保障。本章给出提交前自查、PR 描述、Review 重点维度的可执行清单。

### 13.1 提交前自查清单

提交前快速扫一遍，能拦住 80% 的问题：

- [ ] **反模式速查表**（见 [14](14-反模式速查表.md)）逐条对照，无命中
- [ ] `tsc --noEmit` 通过（类型检查零错误）
- [ ] `eslint .` 零警告（`--max-warnings 0`）
- [ ] 新增/修改的组件有对应测试或手动验证记录
- [ ] 无 `console.log` 遗留（生产代码；`LogProvider` 拦截的 `console` 除外）
- [ ] 无 `eslint-disable` 新增（确需禁用须单行 + 原因注释）
- [ ] 无 `any` / `as Record<string, any>` 新增（确需用 `unknown` + 类型守卫）
- [ ] 新组件 200 行以内；超过则已拆分（见 [4.1](04-组件设计.md#41-单一职责一个组件干一件事)）
- [ ] 列表/日志有内存上限（见 [2.1](02-性能规范.md#21-列表日志必须有上限)）
- [ ] 高频状态用 Zustand 而非 Context（见 [1.1](01-架构与状态管理.md#11-全局高频状态禁止用-react-context)）
- [ ] 图标用 `lucide-react`，无新增内联 SVG（装饰性除外）
- [ ] 可交互元素有 `aria-label`；模态/抽屉有焦点管理
- [ ] 无 monkey-patch（`history.pushState` 等）→ 改用 `usePathname`（见 [8.4](08-异步与副作用.md#84-禁止-monkey-patch-全局-api)）

### 13.2 Commit Message 规范

采用 [Conventional Commits](https://www.conventionalcommits.org/)：

```
<type>(<scope>): <subject>

<body>

<footer>
```

| type | 含义 |
|------|------|
| `feat` | 新功能 |
| `fix` | 修复 bug |
| `refactor` | 重构（不改变外部行为） |
| `perf` | 性能优化 |
| `docs` | 仅文档 |
| `test` | 新增/修改测试 |
| `chore` | 构建/工具/依赖 |
| `style` | 代码格式（不影响逻辑） |

示例：
```
feat(history): 任务详情支持下载 workflow.json

- 新增 downloadWorkflow 按钮（detail 头部）
- 空态说明工作流未暴露参数时引导文案
- 关联: #123
```

### 13.3 PR 描述模板

```markdown
## 变更说明
<!-- 一句话概括 + 关键变更点 -->

## 动机 / 关联 Issue
<!-- 为什么改、解决什么问题、关联 #issue -->

## 变更类型
- [ ] feat / [ ] fix / [ ] refactor / [ ] perf / [ ] docs

## 影响范围
<!-- 涉及哪些模块/页面；是否有 breaking change -->

## 验证方式
<!-- 手动测试步骤 / 新增测试 / 截图 -->

## 自查
- [ ] tsc / eslint 通过
- [ ] 无 any / eslint-disable 新增
- [ ] a11y / 性能自查
```

### 13.4 Code Review 重点维度

Reviewer 按以下维度逐项检查，而非只"看能不能跑"：

| 维度 | 检查要点 |
|------|---------|
| **正确性** | 逻辑是否符合需求；边界/异常/空态是否处理；竞态是否防护 |
| **类型安全** | 有无 `any`/不当 `as`；API 响应是否 Zod 校验 |
| **性能** | 是否触发不必要重渲染；大列表是否虚拟滚动；动画是否用 transform/opacity |
| **状态归属** | 状态放对层（Zustand/tRPC/useState）；无双写/重复存储 |
| **组件拆分** | 单文件不超过 200 行；职责单一；子组件可独立测试 |
| **a11y** | 可交互元素有 label；模态焦点管理；颜色对比度 |
| **样式一致性** | 用 Design Token/语义色；图标用 lucide；无魔法值散落 |
| **错误处理** | 异步失败有 toast/降级；ErrorBoundary 隔离关键区域 |
| **测试** | 关键逻辑有测试；行为断言而非实现细节 |
| **可读性** | 命名清晰；注释解释"为什么"；无内联 IIFE 逻辑 |
| **安全** | 无敏感信息进埋点/日志；用户输入校验（前后端双重） |

### 13.5 CI 门禁

```
PR 合并前必须通过：
✅ tsc --noEmit
✅ eslint . --max-warnings 0
✅ vitest run
✅ playwright test（关键 E2E 流程）
```

**规则**：CI 失败阻断合并；本地 pre-commit（lint-staged）做轻量 lint + typecheck，快速反馈。

### 13.6 分支与合并策略

- 功能分支：`feat/<short-desc>`；修复分支：`fix/<issue-id>-<desc>`。
- 合并方式：优先 **Squash Merge**（保持主干线性、单 PR 单提交）；大型重构可 Rebase。
- 禁止直接 push 到 `main`/`master`；所有变更走 PR + Review。

---
