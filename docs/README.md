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
| 拉取更新后环境同步指南 | [guides/sync-after-pull.md](guides/sync-after-pull.md) | 远端改了 pnpm 配置/依赖后，本地拉取代码如何同步环境 | 配套 |
| 应用内「页面跑着旧代码」处置指南 | [guide-stale-code.md](guide-stale-code.md) | 应用长开期间拉到新代码后白屏/功能失效：怎么判断、怎么一次修好 | 配套 |
| API 文档 | [api/index.html](api/index.html) | typedoc 自动生成（`pnpm docs`） | 自动生成 |
| 设计规格 | [superpowers/specs/](superpowers/specs/) | 功能设计文档（如 wf-debug-mode 设计） | 归档参考 |
| 生成文档（原文） | [generated/](generated/) | 由 `pnpm doc:render` 从编辑文档自动生成，占位符已替换成真实值，供直接阅读；禁止手改。可双击 `tools/docs/generate-docs.ps1` 一键生成 | 自动生成 |
| 文档引用事实登记表 | [reference-facts.md](reference-facts.md) | 文档里硬编码值/路径的单一事实映射：占位符语义 + 权威来源 + 提取规则；由 `pnpm doc:check` 动态核对 | 配套 |
| 术语表 | [glossary.md](glossary.md) | 全项目统一领域词汇：术语 → 唯一所指 → 代码落点（含「三种画布」判别口诀与歧义词限定规则） | **强制口径**（沟通/文档/命名发生歧义时以本表为准） |
| 审计整改报告 | `docs/audits/`（当前为空） | 规范/代码审计发现的整改跟踪（逐项记录违规、规则、严重度与状态） | 过程跟踪（闭环后删除，见 §7） |

> 本文档集成的范围为：**主规范 + standards 文档集（README + 01~17 章，共 18 篇）**。两者共同构成项目开发规范的"总纲 + 细则"双层体系，其余 docs/api、superpowers 等为配套产物。

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
| §2.3 数据层规范（Drizzle） | [1.10 数据层规范](standards/01-架构与状态管理.md#110-数据层规范drizzle-对齐主规范-23) | 内容基本一致（历史重复）；主规范保留强制条款，文档集补充 `db:*` 命令与细节 |
| §2.4 better-auth 会话 | [1.9 认证与会话](standards/01-架构与状态管理.md#19-认证better-auth-会话与-trpc-context) | 内容基本一致（历史重复）；文档集补充受保护 procedure 示例 |
| §3 命名规范 | [12.6.1 变量命名硬约束](standards/12-代码组织与文件结构.md#1261-变量命名硬约束对齐主规范-3)、[14.4 C8](standards/14-反模式速查表.md#144-组件) | 主规范为命名总表；文档集细化变量级硬约束（禁单字母、事件参数语义化） |
| §4.1 TypeScript 规范 | [05 类型安全](standards/05-类型安全.md) | 主规范硬约束（strict/禁 any）；文档集展开 any/unknown/as/Zod/类型守卫 |
| §4.2 React 组件模式 | [04 组件设计](standards/04-组件设计.md)、[1.1 状态归属](standards/01-架构与状态管理.md#11-全局高频状态禁止用-react-context) | 文档集全面展开拆分阈值、事件隔离、memo 准则 |
| §4.2 UI/逻辑分离 | [16.2.1 四层范式](standards/16-shadcn-ui与表单校验.md#1621-落地范式controller-hook--纯展示视图)、[17 UI 与逻辑分离](standards/17-UI与逻辑分离.md) | 16 章讲单组件怎么拆；17 章讲全库分批推进与棘轮护栏（脚本已接入 pre-commit/CI） |
| §4.3 样式规范 | [03 样式与 Tailwind](standards/03-样式与-tailwind.md) | 文档集展开 Tailwind v4 透明度、Design Token、图标规范 |
| §4.4 UI/UX 生产级规范 | [03 样式](standards/03-样式与-tailwind.md)（Design Token）、[06 a11y](standards/06-无障碍访问-a11y.md)、[2.7 动画](standards/02-性能规范.md#27-动画用-transformopacity不动画-layout-属性) | 主规范为生产级底线；文档集逐项展开（对比度、焦点管理、晕动症） |
| §4.5 文案与注释 | [12.4 注释规范](standards/12-代码组织与文件结构.md#124-注释规范只写当前代码的-why) | 主规范总则；文档集给"为什么型注释"示例与"不写作者/日期流水"硬约束 |
| §4.6 React 19 严格 lint | [2.4 渲染期 setState](standards/02-性能规范.md#24-避免在-render-阶段调用-setstate)、[8.6 set-state-in-effect](standards/08-异步与副作用.md#86-避免-useeffect-内-setstate-触发循环)、[14.5 Y3](standards/14-反模式速查表.md#145-类型异步a11y错误) | 文档集提供两种规范写法与禁禁禁用声明 |
| §5 Git 工作流 | [13 提交与 Code Review](standards/13-提交与-code-review.md) | 文档集展开为完整流程：自查清单、PR 模板、Review 维度、CI 门禁、LF/git-lfs、CHANGELOG（13.10） |
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
| 5 | Drizzle 数据层 / better-auth | §2.3/§2.4 | 1.9/1.10（内容几乎逐字重复） | 保留双份（主规范强制条款 + 文档集示例与命令）；**今后增补须两处同步**，或只改文档集并在主规范保留引用 |
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
| 01 | [架构与状态管理](standards/01-架构与状态管理.md) | Context vs Zustand、状态归属、React Flow/tRPC/Drizzle/认证边界 |
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
| 12 | [代码组织与文件结构](standards/12-代码组织与文件结构.md) | 目录约定、barrel、命名、循环依赖预防、文件卫生与提交防线（12.8）、Next 代理约定（12.10）、**源码禁内嵌控制字符**（12.11） |
| 13 | [提交与 Code Review](standards/13-提交与-code-review.md) | 提交前自查、Commit Message、PR、Review 维度、CI、LF/git-lfs、CHANGELOG 记录规范与碎片化（13.10.5） |
| 14 | [反模式速查表](standards/14-反模式速查表.md) | 状态/性能/样式/组件/类型/异步/a11y/Git 反模式对照 |
| 15 | [附录](standards/15-附录.md) | 技术栈速查、组件评分、ADR、命令速查、新成员路径、疑难索引 |
| 16 | [shadcn/ui 与表单校验](standards/16-shadcn-ui与表单校验.md) | ui/ 定位、四层范式（controller hook + 纯展示）、表单方案 |
| 17 | [UI 与逻辑分离](standards/17-UI与逻辑分离.md) | 分离判定、棘轮护栏脚本、全库分批推进计划与落地记录 |

---

## 6. 使用路径

- **日常开发**：先读主规范对应章节（总纲约束）→ 再进文档集对应章节看代码示例（第 3 节映射）。
- **说术语/写 Issue/起 PR 标题**：先查 [术语表](glossary.md)——`画布`/`节点`/`运行`/`项目`/`视图` 这类一词多指的词必须带限定词（判别口诀见 glossary §2）。
- **提交前自查**：按 [13.1 提交前自查清单](standards/13-提交与-code-review.md#131-提交前自查清单) 逐条对照；换行符 LF 与 git-lfs 参数见 [13.7/13.8](standards/13-提交与-code-review.md#137-换行符与提交噪声lf)。
- **Code Review**：对照 [14 反模式速查表](standards/14-反模式速查表.md) + [13.4 Review 维度](standards/13-提交与-code-review.md#134-code-review-重点维度) 逐项检查。
- **新成员**：按 [15.5 新成员 10 分钟速读路径](standards/15-附录.md#155-新成员-10-分钟速读路径) 建立全局认知。
- **修订规范**：修改任一文档后，同步更新本索引（章节映射、冲突处理表），保持体系可索引、无矛盾。
*（内容由AI生成，仅供参考）*

---

## 7. 审计/整改/过程文件生命周期规则

> 针对 `docs/audits/` 下的整改跟踪文件及类似过程产物，统一以下处理规则：
> 台账的**周期性逐条复核**流程见 §8（季度巡检）。`docs/audits/` 目录可以**为空**
> （当前即空：2026-09-03 两份整改文件已全部闭环并按其生命周期删除），
> 新增审计文件时再建目录，不需要为「占位」保留空目录。

### 7.1 文件归宿

- **审计整改报告** → `docs/audits/`（单数复数统一用 **audits**）
- **Code Review 归档**（涉及可复用改进模式）→ 更新到 `docs/standards/` 对应章节（见 [13.9 优化点归档](standards/13-提交与-code-review.md#139-优化点归档强制)），过程性文件不长期保留
- **功能设计规格** → `docs/superpowers/specs/`

### 7.2 闭环判定

审计整改报告中的条目达到以下状态即为**闭环**，可删除文件：

| 状态 | 含义 | 处理 |
|---|---|---|
| ✅ 已整改 | 修复已提交并通过验证 | 无需保留过程记录（git history 已有） |
| 📝 已记录 | 有意保留（附理由），不计划变更 | 同上 |
| ⬜ 待整改 | 仍有未处理事项 | **不得删除**——要么先处理，要么转为 Issue 跟踪后删除 |

### 7.3 删除时机

- **全部闭环** → 直接从 `docs/audits/` 删除该文件。修复与决策历史已存于 git，无需长期保留过程文档。
- **有 ⬜ 待整改** → 保留文件作为跟踪记录；如需删除，先把未完成项转成 Issue 并链接后删除。
- **新增审计/整改文档** → 放入 `docs/audits/`，文件名以 `YYYY-MM-DD-` 为前缀（如 `2026-09-03-xxx.md`）。

### 7.4 目录命名约定

- `docs/` 下禁止出现仅差一个字母的相似目录（如 `audit` vs `audits`）。
- 目录名使用复数形式表"可容纳多份"语义：`audits`（不叫 `audit`）、`guides`（不叫 `guide`）。
- 新建目录前先在 `docs/README.md` 的文档体系总览中登记，避免产生孤儿目录。

---

## 8. 台账季度巡检流程

> 起因（ISSUE #323）：`docs/guides/PRODUCTION-GAPS.md` 这类「未竟事项台账」过去没有巡检机制
> ——条目完成了没人勾、条目过时了没人清、结论沉在 Issue 里没回流成文档。本节把它变成**可重复、
> 可核验**的流程：谁负责、检查什么、闭环后如何处理、以及由哪个命令验证文档一致性。

### 8.1 巡检对象

| 台账 | 路径 | 性质 |
|---|---|---|
| 生产级缺口清单 | [guides/PRODUCTION-GAPS.md](guides/PRODUCTION-GAPS.md) | 未竟事项台账（P0~P3），**长期保留**，逐条勾销 |
| 规范文档集索引 | 本文件（`docs/README.md`） | 索引/映射/裁决链，随规范修订同步 |
| 审计整改报告 | `docs/audits/*.md` | 过程文件，闭环后删除（见 §7） |
| 文档引用事实登记表 | [reference-facts.md](reference-facts.md) | 硬编码值的单一事实映射，由 `pnpm doc:check` 动态核对 |
| 评审归档 | [guides/reviews/](guides/reviews/) | 一次性审查结论，历史快照 |
| 规范正文 | [standards/](standards/)（01~17 章） | 强制细则，随代码同步演进 |

> **不引入新的过程文件目录**：巡检结论写回上述**既有文件**（台账就地勾销 / 删除），
> 不新建 `docs/audits/2026-Qx-巡检.md` 之类的季度过程文件——那等于把问题换个地方沉底。

### 8.2 触发时机

- **常规**：每季度首月（1 / 4 / 7 / 10 月）第一个工作日，随「版本计划」Issue 一起排一轮。
- **触发式**（不等季度）：
  - 有新台账文件被创建时，创建者当轮先完成一次逐条复核；
  - 台账条目指向的代码/脚本被删除或改名时，当次提交内同步修正该条目；
  - `pnpm doc:check` 或结构检查报错指向某台账条目时，当即处理。
- **不引入 CI 定时任务**：本流程只建立人工流程与文档**判据**，自动化（如定时巡检流水线）另开任务。

### 8.3 责任人

| 角色 | 职责 |
|---|---|
| **台账所有者**（条目所属子系统的负责人） | 对自己名下条目给出「已完成 / 仍开放 / 已过时」判定，并提供**可核验证据**（命令输出或代码位置） |
| **当轮执行者**（季度首轮由「版本计划」Issue 的承接人担任） | 遍历 §8.1 全部台账逐条复核；产出差异表；就地修正文件；跑 §8.5 验证 |
| **评审人**（PR reviewer） | 核对差异表里的每条判定都有证据，不接受「看起来应该做了」这类无证据结论 |

单人项目时三角色可重叠，但**证据要求不放松**：没有可核验证据的条目一律按「仍开放」保留。

### 8.4 检查什么（逐条判定规则）

对台账里**每一条**，必须落到下列三种状态之一，不允许「无标注的遗留项」：

| 判定 | 判据 | 动作 |
|---|---|---|
| **已完成** | 能用命令 / 代码位置证明现状已满足条目诉求 | 勾掉（`[x]`）或改写为「已解决（证据）」；**修正条目里过期的事实**（命令、路径、行数、文件名） |
| **仍开放** | 现状确实不满足，且是本项目要做的 | 保留并**指向承接它的 Issue 编号**；无 Issue 的当场补开 |
| **已过时** | 触发条件已消失 / 前提被推翻 / 结论已不成立 | 改写成当前现状，或删除该条（在 PR 描述里说明删除理由） |

**事实性漂移专项**（每次巡检必查，这是台账最容易烂的地方）：

- 命令类：`npm run` / `npx` 一律改为 `pnpm`（AGENTS 硬规则 1；`npm run test:e2e` → `pnpm test:e2e`）；
- 路径类：条目里的文件/脚本是否还在（`git ls-files` 或 `ls` 验证）；
- 数字类：行数、覆盖率、用例数是否与实测一致（重新跑一次，不沿用旧数字）；
- 状态类：条目说的「未做」是否其实已经在 `docs/standards/` 或 Issue 里闭环了（反向核对 §8.1 前两张表）。

### 8.5 闭环判据（巡检算不算做完）

一轮巡检**同时**满足以下全部条件才算闭环，否则整轮视为未完成：

1. §8.1 每份台账的**每条**都有 ✅ / 仍开放（带 Issue）/ 已过时 三态之一，PR 描述给出**差异表**（复核前 → 复核后 + 证据）；
2. 已闭环的 `docs/audits/` 文件按其自身生命周期处理完（删除或写明保留理由，见 §7.3）；
3. 台账中不再出现 `npm run` / `npx` 一类违反 AGENTS 硬规则 1 的命令；
4. `pnpm run doc:check` 通过——涉及 `docs/standards/**`、`docs/guides/**` 的改动属 `SCOPED_DOCS` 范围，裸值（exe 名 / splash / 端口）与失效路径都会被拦下；
5. `pnpm check` 零错误零警告；`node scripts/check-file-structure.cjs` 通过；
6. **未引入新的过程文件目录或固定名过程文件**（讨论结论写回既有台账）。

### 8.6 由哪个脚本验证文档一致性

| 命令 | 验证什么 | 何时跑 |
|---|---|---|
| `pnpm doc:check` | 文档里的硬编码值/路径与权威源（源码/配置）一致；新增规范文档未登记进 `SCOPED_DOCS` 或豁免名单即报错（ISSUE #316 守卫） | 巡检收尾必跑；改 `docs/standards/**`、`docs/guides/**` 时 |
| `pnpm doc:render` | 把编辑态的占位符渲染成原文，产出 `docs/generated/` | 改含占位符文档后 |
| `node scripts/check-file-structure.cjs` | 结构/命名/注释流水硬规则（R1~R10），在 pre-commit 强制 | 每次提交 |
| `pnpm check` | `eslint .`（零警告）+ `tsc --noEmit` | 每次提交 |

> `doc:check` 的校验范围与豁免名单定义在 `scripts/doc-facts.cjs`
> （`SCOPED_DOCS` / `SCOPED_DOC_DIRS` / `SCOPED_DOC_EXEMPTIONS`），
> 人类可读映射见 [reference-facts.md](reference-facts.md)。

### 8.7 巡检记录

不做季度过程文件。**历史结论靠 git history + 本条目的「上次巡检」标注**：

- `docs/guides/PRODUCTION-GAPS.md` 头部有「上次巡检：YYYY-MM-DD」行，每轮更新；
- 每轮的差异表写进当轮 PR 描述（复核前 → 复核后 + 证据），PR 合并即永久留档；
- 本轮（2026-09-10，ISSUE #323）为制度建立后的**第一次巡检**：
  - 修正 `PRODUCTION-GAPS.md` 的 `npm run test:e2e` → `pnpm test:e2e`（事实性漂移）；
  - 勾销/改写了 P0 两条（`parse_custom_nodes.py` + `src/generated/` 实为已解决；LLM `provider` 已收紧为 enum）、
    P2 一条（`errorSuggestion` 规则表已外置）、P3 一条（`model-library` 撞车确认为职责不同、不合并）；
  - 删除 `docs/audits/` 两份整改文件（条目全部闭环，按 §7.3 删除）。
