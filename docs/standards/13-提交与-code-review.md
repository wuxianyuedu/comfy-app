## 13. 提交与 Code Review

> 规范落地靠流程保障。本章给出提交前自查、PR 描述、Review 重点维度的可执行清单。

### 13.1 提交前自查清单

提交前快速扫一遍，能拦住 80% 的问题：

- [ ] **反模式速查表**（见 [14](14-反模式速查表.md)）逐条对照，无命中
- [ ] 工作区换行符为 **LF**（CRLF 文件在本次提交一并转 LF，禁止增量混用，见 [13.7](#137-换行符与提交噪声lf)）
- [ ] `tsc --noEmit` 通过（类型检查零错误）
- [ ] `eslint .` 零错误零警告（`--max-warnings 0`）；无 `set-state-in-effect` 违规（React 19，见 [8.6](08-异步与副作用.md#86-避免-useeffect-内-setstate-触发循环)）
- [ ] 新增/修改的组件有对应测试或手动验证记录
- [ ] 无 `console.log` 遗留（生产代码；`LogProvider` 拦截的 `console` 除外）
- [ ] 无 `eslint-disable` 新增（确需禁用须单行 + 原因注释）
- [ ] 无 `any` / `as Record<string, any>` 新增（确需用 `unknown` + 类型守卫）
- [ ] 无单字母变量新增（循环索引 i/j/k、catch 参数 e、占位 _ 除外）
- [ ] 注释无作者 / 日期 / 版本流水，只写「当前代码的 Why」（见 [12.4](12-代码组织与文件结构.md#124-注释规范只写当前代码的-why)）
- [ ] 新组件 200 行以内；超过则已拆分（见 [4.1](04-组件设计.md#41-单一职责一个组件干一件事)）
- [ ] 列表/日志有内存上限（见 [2.1](02-性能规范.md#21-列表日志必须有上限)）
- [ ] 高频状态用 Zustand 而非 Context（见 [1.1](01-架构与状态管理.md#11-全局高频状态禁止用-react-context)）
- [ ] 图标用 `lucide-react`，无新增内联 SVG（装饰性除外）
- [ ] 可交互元素有 `aria-label`；模态/抽屉有焦点管理
- [ ] 无 monkey-patch（`history.pushState` 等）→ 改用 `usePathname`（见 [8.4](08-异步与副作用.md#84-禁止-monkey-patch-全局-api)）
- [ ] 代码行为变更已同步文档（文档与代码同提交，见主规范 §9）
- [ ] Review 中发现的**可复用改进模式已归档**（见 [13.9](#139-优化点归档强制)）

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
| **可读性** | 命名清晰；注释只解释「当前 Why」、无作者/日期/版本流水；无内联 IIFE 逻辑；无单字母变量 |
| **安全** | 无敏感信息进埋点/日志；用户输入校验（前后端双重）；受保护 procedure 覆盖 |
| **React 19 lint** | 无 `set-state-in-effect` 违规；无文件级 eslint-disable 掩盖 |
| **提交卫生** | 换行符 LF 无增量混用；无 git-lfs 挂起残留；单 PR 单语义，无混入无关文件 |

### 13.5 CI 门禁

```
PR 合并前必须通过：
✅ tsc --noEmit
✅ eslint . --max-warnings 0
✅ vitest run
✅ playwright test（关键 E2E 流程）
```

**规则**：CI 失败阻断合并；**本地提交门槛已实装**——`.githooks/pre-commit`（经
`git config core.hooksPath .githooks` 启用）依次跑：

```
✅ node scripts/check-file-structure.cjs   # 命名/组织硬规则（见 §12.8、12 §12.6）
✅ npx tsc --noEmit
✅ npx eslint .
```

任一步失败即阻断提交；紧急绕过用 `git commit --no-verify`（会留在历史上，慎用）。
新克隆仓库后需重设一次：`git config core.hooksPath .githooks`。

### 13.6 分支与合并策略

- 功能分支：`feat/<short-desc>`；修复分支：`fix/<issue-id>-<desc>`。
- 合并方式：优先 **Squash Merge**（保持主干线性、单 PR 单提交）；大型重构可 Rebase。
- 项目主分支为 **`master`**；禁止直接 push 到 `master`；所有变更走 PR + Review。

### 13.7 换行符与提交噪声（LF，对齐主规范 §11.2）

- **仓库统一 LF**（2026-08-27 起）。历史 CRLF 文件随下次改动一并转 LF，禁止增量混用（同一文件部分行 CRLF、部分 LF）。
- 本地提交用 `git -c core.autocrlf=false add`，避免 autocrlf 改写换行造成全文件 diff 噪声。
- 提交前检查：`git diff --stat` 若出现与功能无关的全文件变更，先核对换行符。

### 13.8 Windows git-lfs 提交（对齐主规范 §5.2）

Windows 环境提交时 git-lfs 可能挂起（`filter.lfs` 卡住）。统一加绕过参数：

```bash
git -c filter.lfs.process= -c filter.lfs.required=false -c filter.lfs.smudge= -c filter.lfs.clean= add -A
git -c filter.lfs.process= -c filter.lfs.required=false commit -m "type(scope): subject"
```

无 lfs 文件时亦可使用；避免无谓超时重试。

### 13.9 优化点归档（强制，对齐主规范 §6.4）

- Review/排查中发现**可复用的改进模式**（如某类性能瓶颈、某种错误处理套路）必须归档到本套文档或主规范，禁止只口头同步。
- 归档时机：PR 合入前随代码一起提交（`docs` 类提交），保证"代码 + 规范"原子更新。

---
