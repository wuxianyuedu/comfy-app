---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 04b5474aa852c5c0d1326b763e831d7b_3aeabfcb9de511f1a413525400287e28
    ReservedCode1: Vvh6v3bSX9NzNdlEKu1L+9rt2TvSKXcFID8dqabzsCugw83yc4j3nKexim/Rk2pUcsfpNiSd0rReRVToLE1w1WNyOyjvsFHywz14fQNJ47ZXcZ4xMvHImULWs6ptdQ+iXTeIlIZAduz3vW/+WSP+wlsCLZTqTOVfYYuPuLtq89cw8P95ogK+rvYVy3c=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 04b5474aa852c5c0d1326b763e831d7b_3aeabfcb9de511f1a413525400287e28
    ReservedCode2: Vvh6v3bSX9NzNdlEKu1L+9rt2TvSKXcFID8dqabzsCugw83yc4j3nKexim/Rk2pUcsfpNiSd0rReRVToLE1w1WNyOyjvsFHywz14fQNJ47ZXcZ4xMvHImULWs6ptdQ+iXTeIlIZAduz3vW/+WSP+wlsCLZTqTOVfYYuPuLtq89cw8P95ogK+rvYVy3c=
---

# Comfy-APP-T3 测试与文档

## 快速开始

```bash
# 运行单元测试（Vitest）
npm test

# 生成 API 文档（TypeDoc → docs/api）
npm run docs

# 类型检查
npm run typecheck
```

## 单元测试（Vitest）

### 配置
- 配置文件：`vitest.config.ts`
- 环境：node（纯函数单测，不依赖浏览器/DB）
- 路径别名：`@/*` → `src/*`
- 测试文件与源码同目录放置，命名 `*.test.ts`

### 当前覆盖（41 用例 / 5 文件）

| 文件 | 覆盖模块 | 用例数 |
|---|---|---|
| `src/lib/workflow-types.test.ts` | 工作流类型映射（code→类型、类别、分类、边界值） | 7 |
| `src/lib/comfyui/markdown.test.ts` | Markdown 渲染（标题层级、列表、引用、XSS 转义、空输入） | 9 |
| `src/components/studio/workflow-utils.test.ts` | 画布颜色工具（hexToRgba、mixHex、lightenHex、hexToRgba 边界） | 12 |
| `src/server/api/middleware/rate-limit.test.ts` | 限流中间件（滑动窗口、独立 key、过期重置） | 5 |
| `src/components/studio/AgentPanel.test.tsx` | AgentPanel 组件（空态、四状态、回调、禁用态、头像兜底） | 8 |

### 新增测试指引
- 纯函数模块（lib 层、utils）优先补 `*.test.ts`
- 涉及 DOM/组件渲染的用例需为对应测试文件增加 `// @vitest-environment jsdom` 或迁移到独立环境
- 断言基于实现语义编写，禁止为"让测试通过"而弱化断言

### 组件测试（@testing-library/react）

- 依赖已装：`@testing-library/react` / `user-event` / `jest-dom`（匹配器在 `tests/setup.ts` 全局注册，`toBeInTheDocument`、`toBeDisabled` 等直接用）
- vitest 是 `globals: false`，RTL 不会自动 cleanup——测试文件里手动 `afterEach(cleanup)`
- 交互用 `userEvent.click`（比 `fireEvent` 更接近真实事件序列）
- 组件测试范例：`src/components/studio/AgentPanel.test.tsx`（空态、状态渲染、回调回传、禁用态、兜底渲染）

## API 文档（TypeDoc）

- 配置：`typedoc.json`
- 入口：`src/lib`、`src/server`、`src/trpc` 下非测试 TS 文件
- 输出：`docs/api`（HTML，428 文件）
- 排除：`*.test.ts`、`node_modules`、`workflows`

## 已知边界

- 当前单测不覆盖服务端路由/DB 交互层（依赖运行时环境，由阶段 4/5 的 Repository 收口保证可测性）
- `next build` 受 Prisma EPERM 环境 bug 影响（prisma#27555），完整构建验证需在 C 盘或调整 Prisma output 后进行
*（内容由AI生成，仅供参考）*
