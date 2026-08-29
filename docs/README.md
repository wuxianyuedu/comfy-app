---
AIGC:
    Label: "1"
    ContentProducer: 001191440300708461136T1XGW3
    ProduceID: 04b5474aa852c5c0d1326b763e831d7b_f2c88df6a1f311f192a2525400287e28
    ReservedCode1: WDbp/5f0mg4Hl6//abdwRFRwyW2eCWRnEBR2FUOplbjyLMS5or6w+U3aMhydhUQuhM+fjvNa6Mef90Ft98WuktczY97fr0L8YyYho1LXcTboQ6rJ+OsS+Lt9/cNCnT/4qiEJPaRtr7X5s8+7IQxzApwPy24l2enxSOnX/f+SJXZx4oRt+KsCR40hk/w=
    ContentPropagator: 001191440300708461136T1XGW3
    PropagateID: 04b5474aa852c5c0d1326b763e831d7b_f2c88df6a1f311f192a2525400287e28
    ReservedCode2: WDbp/5f0mg4Hl6//abdwRFRwyW2eCWRnEBR2FUOplbjyLMS5or6w+U3aMhydhUQuhM+fjvNa6Mef90Ft98WuktczY97fr0L8YyYho1LXcTboQ6rJ+OsS+Lt9/cNCnT/4qiEJPaRtr7X5s8+7IQxzApwPy24l2enxSOnX/f+SJXZx4oRt+KsCR40hk/w=
---

# Comfy-APP-T3 文档中心（统一索引）

> 仓库：`F:\AI\Other\Comfy-APP-T3` ｜ 索引维护日期：2026-08-27
> 本文件是 `docs/` 目录的**统一索引入口**：从这里可导航至主规范《Comfy-APP-T3-项目开发规范》与《前端工程规范文档集》（standards，README + 01~15 章）全部章节，并标注两份文档的分工关系与冲突处理方式。

---

## 1. 文档体系总览

| 文档 | 路径 | 定位 | 强制级别 |
|---|---|---|---|
| 项目开发规范（主规范 v1.0） | [Comfy-APP-T3-项目开发规范.md](standards/Comfy-APP-T3-项目开发规范.md) | 高层强制基准：技术栈选型、架构分层、命名硬约束、Git 工作流、性能总则、测试门禁、安全、文档、构建发布、疑难排查 | **强制总纲**（与文档集冲突时以主规范最新版为准） |
| 前端工程规范文档集（standards v1.2） | [standards/README.md](standards/README.md) | 前端工程深度细则：状态管理、性能、样式、组件设计、类型安全、a11y、日志、异步、路由、错误处理、测试、代码组织、提交与 Code Review、反模式、附录 | **强制细则**（与主规范冲突时以主规范为准） |
| 测试说明 | [TESTING.md](guides/TESTING.md) | 单测聚焦范围与测试体系说明 | 配套 |
| API 文档 | [api/index.html](api/index.html) | typedoc 自动生成（`pnpm docs`） | 自动生成 |
| 设计规格 | [superpowers/specs/](superpowers/specs/) | 功能设计文档（如 wf-debug-mode 设计） | 归档参考 |

> 本文档集成的范围为：**主规范 + standards 文档集（README + 01~15 章，共 16 篇）**。两者共同构成项目开发规范的"总纲 + 细则"双层体系，其余 docs/api、superpowers 等为配套产物。

---

## 2. 定位与分工原则

1. **主规范 = 总纲（What & Why）**：保留高层强制基准与已沉淀的落地决策。凡属"必须/禁止/统一"级别的硬约束（技术栈、架构分层、命名、Git 流程、安全、构建）在主规范中保持权威表述，不做过度展开。
2. **standards = 细则（How）**：保留深度细则、代码示例、速查表与反模式对照。每个细则主题在其对应章节给出可执行写法与反面教材，供日常开发、Review、提交前逐条对照。
3. **分层引用**：主规范对细则主题给出"完整细则见文档集对应章节"的指引；文档集各章开头或正文标注"对齐主规范 §x.x"。本索引第 3 节是两者间的完整映射。
4. **冲突裁决**：两份文档同时覆盖同一主题时，以**主规范最新版本**为准；本索引第 4 节对已知重叠/差异给出处理结论，后续修订需同步本索引。

---

## 3. 主规范 ↔ 文档集 章节映射

| 主规范章节 | 文档集对应章节 | 关系说明 |
|---|---|---|
| §1 项目总览与技术栈 | [15.1 技术栈速查](standards/15-附录.md#151-技术栈速查) | 主规范为选型总纲；附录为速查表（版本/约定一致） |
| §2.1 目录结构约定 | [12.1 顶层目录约定](standards/12-代码组织与文件结构.md#121-顶层目录约定与主规范-21-一致) | 文档集细化（含 `(studio)` 分组路由、`api/`、`HistoryList` 拆目录、`ui/`） |
| §2.2 tRPC router 组织 | [1.9 认证与会话](standards/01-架构与状态管理.md#19-认证better-auth-会话与-trpc-context)、[1.7 tRPC/React Query/Zustand 分工](standards/01-架构与状态管理.md#17-trpc--react-query-与-zustand-的分工) | 主规范总则；文档集提供 context 接入代码与数据流示例 |
| §2.3 Prisma 数据层规范 | [1.10 数据层规范](standards/01-架构与状态管理.md#110-prisma-数据层) | 内容基本一致（历史重复）；主规范保留强制条款，文档集补充 `db:*` 命令与细节 |
| §2.4 better-auth 会话 | [1.9 认证与会话](standards/01-架构与状态管理.md#19-认证better-auth-会话与-trpc-context) | 内容基本一致（历史重复）；文档集补充受保护 procedure 示例 |
| §3 命名规范 | [12.6.1 变量命名硬约束](standards/12-代码组织与文件结构.md#1261-变量命名硬约束对齐主规范-3)、[14.4 C8](standards/14-反模式速查表.md#144-组件) | 主规范为命名总表；文档集细化变量级硬约束（禁单字母、事件参数语义化） |
| §4.1 TypeScript 规范 | [05 类型安全](standards/05-类型安全.md) | 主规范硬约束（strict/禁 any）；文档集展开 any/unknown/as/Zod/类型守卫 |
| §4.2 React 组件模式 | [04 组件设计](standards/04-组件设计.md)、[1.1 状态归属](standards/01-架构与状态管理.md#11-全局高频状态禁止用-react-context) | 文档集全面展开拆分阈值、事件隔离、memo 准则 |
| §4.3 样式规范 | [03 样式与 Tailwind](standards/03-样式与-tailwind.md) | 文档集展开 Tailwind v4 透明度、Design Token、图标规范 |
| §4.4 UI/UX 生产级规范 | [03 样式](standards/03-样式与-tailwind.md)（Design Token）、[06 a11y](standards/06-无障碍访问-a11y.md)、[2.7 动画](standards/02-性能规范.md#27-动画用-transformopacity不动画-layout-属性) | 主规范为生产级底线；文档集逐项展开（对比度、焦点管理、晕动症） |
| §4.5 文案与注释 | [12.4 注释规范](standards/12-代码组织与文件结构.md#124-注释要解释为什么不只是是什么) | 主规范总则；文档集给"为什么型注释"示例 |
| §4.6 React 19 严格 lint | [2.4 渲染期 setState](standards/02-性能规范.md#24-避免在-render-阶段调用-setstate)、[8.6 set-state-in-effect](standards/08-异步与副作用.md#86-避免-useeffect-内-setstate-触发循环)、[14.5 Y3](standards/14-反模式速查表.md#145-类型异步a11y错误) | 文档集提供两种规范写法与禁禁禁用声明 |
| §5 Git 工作流 | [13 提交与 Code Review](standards/13-提交与-code-review.md) | 文档集展开为完整流程：自查清单、PR 模板、Review 维度、CI 门禁、LF/git-lfs |
| §6 性能规范 | [02 性能规范](standards/02-性能规范.md) | 主规范沉淀已落地模式（画布/列表）；文档集全面展开（虚拟滚动、分片、动画、memo） |
| §7 测试与质量规范 | [11 测试与可观测性](standards/11-测试与可观测性.md) | 文档集展开测试分层、行为测试、埋点、CI 门禁 |
| §8 安全规范 | [5.5 API 响应 Zod 校验](standards/05-类型安全.md#55-api-响应一律-zod-校验)、[10 错误处理与降级](standards/10-错误处理与降级.md) | 主规范为安全基线；文档集落实输入校验、降级、敏感信息防护 |
| §9 文档规范 | [README 关系说明](standards/README.md)、[13.9 优化点归档](standards/13-提交与-code-review.md#139-优化点归档强制) | 主规范为文档维护总则；文档集落实"代码+规范"原子更新 |
| §10 构建与发布 | [15.4 常用命令速查](standards/15-附录.md#154-常用命令速查) | 配套 |
| §11 疑难排查记录 | [15.6 疑难排查记录](standards/15-附录.md#156-疑难排查记录随问题归档对齐主规范-11) | 主规范保留深度排查（子工作流卡死清单）；文档集 15.6 为索引与同步约定 |

---

## 4. 内容重叠与冲突处理

两份文档历史上由不同批次编写，存在主题重叠与少量表述差异。逐项核查后的处理结论如下（**已消除矛盾**）：

| # | 主题 | 主规范表述 | 文档集表述 | 处理结论 |
|---|---|---|---|---|
| 1 | lint 告警门槛 | §4.6/§7：errors 必须清零，warnings 另立任务跟踪 | 11.7/13.1/13.5：`--max-warnings 0`（零错误零警告） | **从严执行**：提交/CI 按文档集要求零错误零警告；主规范 §7 保留"零 error"最低门槛语义，两者不冲突，取更严格者 |
| 2 | commit type 表 | §5.1：feat/perf/refactor/fix/chore/docs/test（7 项，无 style） | 13.2：feat/fix/refactor/perf/docs/test/chore/style（8 项） | **以文档集 13.2 为完整 type 表**；主规范为子集，新增 `style` 类已纳入文档集 |
| 3 | 右侧面板动画 | §4.4.3：`transition-all + w-(--panel-right-width)` CSS 宽度过渡（已落地） | 2.7：通用规则避免动画 layout 属性；同节"与主规范调和"明确面板显隐为**面板级例外**；15.3 ADR 记录常驻 DOM + 列宽过渡 | **已调和**：元素级动画走 2.7（transform/opacity）；面板显隐走主规范 §4.4.3 特例。新增类似面板过渡须注释引用该例外 |
| 4 | 版本与裁决 | v1.0 强制基准 | README 声明 v1.2 细则、冲突以主规范最新版为准 | **冲突裁决链**：standards → 主规范 → 本索引；本索引为唯一入口，修订时须同步更新 |
| 5 | Prisma / better-auth | §2.3/§2.4 | 1.9/1.10（内容几乎逐字重复） | 保留双份（主规范强制条款 + 文档集示例与命令）；**今后增补须两处同步**，或只改文档集并在主规范保留引用 |
| 6 | 目录结构 | §2.1 简化版 | 12.1 细化版（含 `(studio)`、`api/`、组件拆目录） | 无矛盾：12.1 是 2.1 的实现细则；文档集 12.5 明确"无顶层 hooks/stores/types 目录"，与主规范一致 |
| 7 | 测试门禁命令 | §7：typecheck/lint/format:check/test/build | 11.7/13.5：typecheck/lint/test/build/playwright | 以 package.json 脚本为准，两者为同一套（文档集 11.7 已注明"避免两处重复维护"） |
| 8 | 命名规范 | §3 总表（引用《命名规范》v1.1）；§3 文件行 kebab-case 仅约束**非组件模块**，反例 `wfNode.tsx` 属域前缀违规 | 12.6 文件命名约定：**组件文件 PascalCase**、非组件模块 kebab-case；12.6.1 变量级硬约束（禁单字母、事件参数语义化） | 互补：命名总表在主规范，变量细则在文档集；文档集 C8 反向引用主规范 §3。**T13 裁决（2026-08-28）**：组件文件 PascalCase 合规，依据 §3 组件行"组件 PascalCase；文件与导出组件同名" + 文档集 12.6；与 §3 文件行 kebab-case 不构成字面冲突（该行仅针对非组件模块），**组件文件不改名**。存量 84 个非组件模块 `.ts` 为 PascalCase 属另一类问题，后续单列任务处理 |
| 9 | 疑难排查 | §11.1 子工作流卡死深度清单 | 15.6 疑难排查索引 + 同步约定 | 主规范保留深度排查；文档集 15.6 为"定位根因后归档"的同步机制 |
| 10 | 换行符 LF | §11.2 仓库统一 LF | 13.7 同（含 `core.autocrlf=false`） | 一致；本索引文件同样以 LF 提交 |

---

## 5. 文档集章节导航（standards，共 16 篇）

| 章节 | 文件 | 一句话定位 |
|---|---|---|
| 总览 | [README.md](standards/README.md) | 文档集用法、快速查阅、与主规范关系 |
| 01 | [架构与状态管理](standards/01-架构与状态管理.md) | Context vs Zustand、状态归属、React Flow/tRPC/Prisma/认证边界 |
| 02 | [性能规范](standards/02-性能规范.md) | 列表上限、虚拟滚动、动画 transform、分片、memo 准则、画布性能 |
| 03 | [样式与 Tailwind](standards/03-样式与-tailwind.md) | Tailwind v4 透明度、Design Token、图标、暗色模式 |
| 04 | [组件设计](standards/04-组件设计.md) | 单一职责、数组驱动、事件隔离、props、memo |
| 05 | [类型安全](standards/05-类型安全.md) | 禁 any、Zod 校验、类型守卫、union 替代 enum |
| 06 | [无障碍访问 a11y](standards/06-无障碍访问-a11y.md) | aria-label、焦点管理、对比度、晕动症 |
| 07 | [日志系统](standards/07-日志系统.md) | LogProvider、环形缓冲、console 拦截、Tauri 事件 |
| 08 | [异步与副作用](standards/08-异步与副作用.md) | 竞态防护、AbortController、乐观更新、React 19 set-state |
| 09 | [路由与导航](standards/09-路由与导航.md) | use client 边界、URL State vs Zustand、动态路由 |
| 10 | [错误处理与降级](standards/10-错误处理与降级.md) | 三级降级、ErrorBoundary、error.tsx、空状态 |
| 11 | [测试与可观测性](standards/11-测试与可观测性.md) | 测试分层、行为测试、埋点、CI 门禁 |
| 12 | [代码组织与文件结构](standards/12-代码组织与文件结构.md) | 目录约定、barrel、命名、循环依赖预防 |
| 13 | [提交与 Code Review](standards/13-提交与-code-review.md) | 提交前自查、Commit Message、PR、Review 维度、CI、LF/git-lfs |
| 14 | [反模式速查表](standards/14-反模式速查表.md) | 状态/性能/样式/组件/类型/异步/a11y/Git 反模式对照 |
| 15 | [附录](standards/15-附录.md) | 技术栈速查、组件评分、ADR、命令速查、新成员路径、疑难索引 |

---

## 6. 使用路径

- **日常开发**：先读主规范对应章节（总纲约束）→ 再进文档集对应章节看代码示例（第 3 节映射）。
- **提交前自查**：按 [13.1 提交前自查清单](standards/13-提交与-code-review.md#131-提交前自查清单) 逐条对照；换行符 LF 与 git-lfs 参数见 [13.7/13.8](standards/13-提交与-code-review.md#137-换行符与提交噪声lf)。
- **Code Review**：对照 [14 反模式速查表](standards/14-反模式速查表.md) + [13.4 Review 维度](standards/13-提交与-code-review.md#134-code-review-重点维度) 逐项检查。
- **新成员**：按 [15.5 新成员 10 分钟速读路径](standards/15-附录.md#155-新成员-10-分钟速读路径) 建立全局认知。
- **修订规范**：修改任一文档后，同步更新本索引（章节映射、冲突处理表），保持体系可索引、无矛盾。
*（内容由AI生成，仅供参考）*
