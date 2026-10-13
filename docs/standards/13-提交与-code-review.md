## 13. 提交与 Code Review

> 规范落地靠流程保障。本章给出提交前自查、PR 描述、Review 重点维度的可执行清单。

### 13.1 提交前自查清单

提交前快速扫一遍，能拦住 80% 的问题：

- [ ] **反模式速查表**（见 [14](14-反模式速查表.md)）逐条对照，无命中
- [ ] 工作区换行符为 **LF**（CRLF 文件在本次提交一并转 LF，禁止增量混用，见 [13.7](#137-换行符与提交噪声lf)）
- [ ] `tsc --noEmit` 通过（类型检查零错误）- 跑门禁前先确认依赖在：`pnpm check:toolchain`；`node_modules` 缺失 = **先装**
      （`pnpm install --frozen-lockfile`，冷装约 8 分钟），**不是**「本机跑不了门禁」。
      禁止以此为由跳过本清单里任何一条，见 [13.6.3](#1363-环境里跑不到门禁不是结论--先-pnpm-installissue-1568)
- [ ] `pnpm run lint` 零错误零警告（`--max-warnings 0`；扫描范围是白名单，见 `eslint.config.js` 顶部）；无 `set-state-in-effect` 违规（React 19，见 [8.6](08-异步与副作用.md#86-避免-useeffect-内-setstate-触发循环)）
- [ ] 新增/修改的组件有对应测试或手动验证记录
- [ ] 无 `console.log` 遗留（生产代码；`LogProvider` 拦截的 `console` 除外）
- [ ] 无 `eslint-disable` 新增（确需禁用须单行 + 原因注释）
- [ ] 无 `any` / `as Record<string, any>` 新增（确需用 `unknown` + 类型守卫）
- [ ] 无单字母变量新增（循环索引 i/j/k、catch 参数 e、占位 _ 除外）
- [ ] 新写的逻辑确认过全库无等价实现；属通用能力的已落到地基（`src/lib/<domain>` / `core`）而非埋在 feature 目录，也没为「这次不一样」复制粘贴（见 [12.18](12-代码组织与文件结构.md#1218-复用优先写之前先查缺能力补地基不造第二轮子)）
- [ ] 注释无作者 / 日期 / 版本流水，只写「当前代码的 Why」（见 [12.4](12-代码组织与文件结构.md#124-注释规范只写当前代码的-why)）
- [ ] 新增 / 改动的注释是**中文**（只有 `reference-facts` 登记的「纯 ASCII 模块」写英文；由 `node scripts/check-comment-language.cjs` 在 pre-commit 的「注释语言棘轮」一步强制，见 [12.4.6](12-代码组织与文件结构.md#1246-注释语言一律中文只有纯-ascii-模块例外issue-678机器强制)）
- [ ] 用户可感知的变更已写入 `changelog.d/<issue号>-<slug>.md` 碎片（内部重构/文档修订除外）——**不直接改 `CHANGELOG.md`**，见 [13.10.5](#13105-碎片化落地改-changelogd不改-changelogmd)
- [ ] 碎片名 / commit message 里那个 **ISSUE 号确实对应本次改动的诉求**（动手前读过那张单的正文）——号不对等于把改动挂到别人的账上，查那张单的人只会读到无关内容；**没有对应单时走 `0-<slug>.md`**，不许拿一个「看起来相关」的号凑，见 [13.10.7](#13107-issue-号是改动与诉求之间的唯一接线写错比不写更贵issue-1693)
- [ ] 新组件 200 行以内；超过则已拆分（见 [4.1](04-组件设计.md#41-单一职责一个组件干一件事)）
- [ ] 列表/日志有内存上限（见 [2.1](02-性能规范.md#21-列表日志必须有上限)）
- [ ] 高频状态用 Zustand 而非 Context（见 [1.1](01-架构与状态管理.md#11-全局高频状态禁止用-react-context)）
- [ ] 图标用 `lucide-react`，无新增内联 SVG（装饰性除外）
- [ ] 可交互元素有 `aria-label`；模态/抽屉有焦点管理；**非原生元素（`div` / `li` / `span`）上的 `onClick` 有键等价物**（换原生可交互元素，或补 `simpleKeyHandler`；由 `node scripts/check-click-keyboard.cjs` 在 pre-commit 强制，见 [06 §6.11](06-无障碍访问-a11y.md#611-非原生元素上的点击必须有键等价物check-click-keyboardcjs)）
- [ ] `jsx-a11y` 的规则没有被**悄悄**关掉，也没有**没人决定过**的规则（关一条 / 官方两份配置谁都没提到的非废弃规则，都要在 `scripts/.a11y-rule-ledger.json` 登记「为什么 + 谁在守它」，由 `node scripts/check-a11y-rules.cjs` 双核，见 [06](06-无障碍访问-a11y.md#612-jsx-a11y-的规则开关官方-recommended-全开方言逐条登记check-a11y-rulescjs)）
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

| type       | 含义                   |
| ---------- | ---------------------- |
| `feat`     | 新功能                 |
| `fix`      | 修复 bug               |
| `refactor` | 重构（不改变外部行为） |
| `perf`     | 性能优化               |
| `docs`     | 仅文档                 |
| `test`     | 新增/修改测试          |
| `chore`    | 构建/工具/依赖         |
| `style`    | 代码格式（不影响逻辑） |

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

| 维度              | 检查要点                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| **正确性**        | 逻辑是否符合需求；边界/异常/空态是否处理；竞态是否防护                                 |
| **类型安全**      | 有无 `any`/不当 `as`；API 响应是否 Zod 校验                                            |
| **性能**          | 是否触发不必要重渲染；大列表是否虚拟滚动；动画是否用 transform/opacity                 |
| **状态归属**      | 状态放对层（Zustand/tRPC/useState）；无双写/重复存储                                   |
| **组件拆分**      | 单文件不超过 200 行；职责单一；子组件可独立测试                                        |
| **a11y**          | 可交互元素有 label；模态焦点管理；颜色对比度                                           |
| **样式一致性**    | 用 Design Token/语义色；图标用 lucide；无魔法值散落                                    |
| **错误处理**      | 异步失败有 toast/降级；ErrorBoundary 隔离关键区域                                      |
| **测试**          | 关键逻辑有测试；行为断言而非实现细节                                                   |
| **可读性**        | 命名清晰；注释只解释「当前 Why」、无作者/日期/版本流水；无内联 IIFE 逻辑；无单字母变量 |
| **安全**          | 无敏感信息进埋点/日志；用户输入校验（前后端双重）；受保护 procedure 覆盖               |
| **React 19 lint** | 无 `set-state-in-effect` 违规；无文件级 eslint-disable 掩盖                            |
| **提交卫生**      | 换行符 LF 无增量混用；无 git-lfs 挂起残留；单 PR 单语义，无混入无关文件                |

### 13.5 CI 门禁（平台侧**当前未启用**）

**`.cnb.yml` 已删除，平台侧不跑任何流水线**（ISSUE #623）。这不是「门禁没了」，
而是「门禁只剩本地那一层」——请连带读完 13.5.3 的代价说明再动手。

> **为什么删**：社区版云原生构建免费额度 **160 核时/月**，计量口径是
> 「节点规格 × 运行时长」。本流水线声明 `cpus: 8`，一次 PR（门禁 + 合并复核）
> 实测量级接近 1 核时，几十次 PR 就把额度吃光 —— 属于**用不起**，
> 而不是「跑得慢」。删除是恢复「提交不再花额度」的**唯一**零成本做法。
>
> **删前走过的降配路径**（都留在历史里，别再走一遍）：把门禁拆成
> 「只挂 `pull_request`、`push` 只留合并形态复核」，并把 `test` 与
> `test:coverage` 合成一步 —— 每次 PR 的核时约减半，但**额度仍然不够**。
> 三条降配口径与「不要用的路子」保留在 13.5.3，供日后额度充裕时参考。
>
> **删前修出的一条判据（留作记录，日后重启时直接用）**：`push` 侧的合并形态复核
> （`node scripts/check-branch-guard.cjs --merge-commit`）**必须认得 Squash Merge**
> ——squash 落到 `master` 的提交只有 **1 个父**，与「本地直连主干提交」在拓扑上
> 同形。此前判据是「父提交数 > 1 才算合并」，后果是 `master` 的 push 复核**每一次
> 都是红的**（`611150b`…`8a9efb3` 全部命中），却一次真正的绕过都没抓到。现在判据是
> 「合并提交 **或** 提交信息带 PR 关联（平台 squash 时写下的 `PR-URL: #NNN`）」，
> 两者都不满足时**保守放行**；服务端形态随 `.cnb.yml` 一同保留（见 13.6.1）。

**现状（唯一的一层）**

| 层                | 位置                                        | 拦什么                                        | 能绕过吗                                  |
| ----------------- | ------------------------------------------- | --------------------------------------------- | ----------------------------------------- |
| 本地              | `.githooks/pre-commit`（判据分 4 组并行跑） | 分支守卫 + 结构硬规则 + tsc + eslint + 各棘轮 | 只能 `--no-verify`（进历史，Review 可见） |
| 平台（push 保护） | CNB **分支保护设置**                        | `master` 的直接 push（放行 PR 合并）          | 需管理员改设置                            |

> **服务端形态的判据本身仍在**：`scripts/check-branch-guard.cjs` 的
> `--pr-check` / `--merge-commit` 两个服务端形态随 `.cnb.yml` 一起失去了调用方，
> 但判据本身保留 —— `tests/check-branch-guard.test.ts` 用真仓库跑三种拓扑，
> 日后重启平台侧直接可用（见 13.6.1）。其中 `--merge-commit` 必须认得 squash，
> 理由见上面 `⚠️` 那段。

```
本地提交前必须通过（.githooks/pre-commit；判据按互不依赖分 4 组并行：
A=tsc、B=eslint、C=一次 vitest、D=其余静态检查）：
✅ node scripts/check-branch-guard.cjs     # 不在 master 上直接提交（见 13.6）
✅ node scripts/check-file-structure.cjs --strict   # 命名/组织硬规则 R1-R12 + R5 棘轮硬闸（见 §12.6/§12.8/§12.11）
✅ node scripts/check-ps1-consistency.mjs  # 跨平台动作对照表：.ps1⇄.mjs 两侧齐全、会静默失效的清单只定义一次、入口清单与磁盘/package.json 三向对齐（见 launch-and-build §9.5）
✅ node scripts/run-ast-gates.cjs --staged  # **AST 判据聚合档**：6 条判据（updater 纯净性 / 非空断言 / void 悬空 / TS 重复属性 / FormField 接线 / 点击键等价物）共享**一次解析**，省 ≈1.9s（见下 13.5.8.2「第四笔账」）。共享的是解析产物，遍历与判定各归各条；人的动作仍跑单条脚本
✅ node scripts/check-title-bar-clearance.cjs --staged # 输入面跳过（见下 13.5.8.2）
✅ pnpm exec tsc --noEmit
✅ pnpm run lint
✅ node scripts/check-ui-logic-separation.cjs   # 视图层 IO 硬闸（命中即阻断，见 17）
✅ node scripts/check-changelog-fragments.cjs
✅ node scripts/check-changelog-versions.cjs # 待发段落的**来源锚** ⇄ 条目归属：锚写歪了 / 解析不出提交 / 同一 ISSUE 号跨锚分裂（见 §13.10.6）
✅ node scripts/check-import-alias.cjs --staged # import 别名只有一种前缀 `~`（R13，见 §12.8.0）；`--staged` 见下 13.5.8.2
✅ node scripts/check-app-port-vectors.cjs   # 端口推导跨语言一致性（见 launch-and-build §1.1）
✅ node scripts/check-ui-primitives.cjs --staged # UI 基元复用棘轮（见 16 §16.2.3；`--staged` = 只碰了 `src/` 下的扫描根才扫，见下 13.5.8.2）
✅ node scripts/check-overlay-z.cjs --staged # 浮层层级刻度硬闸（见 16 §16.2.5）；`--staged` 见下 13.5.8.2
✅ node scripts/check-theme-colors.cjs       # 主题色扫描**硬闸**：豁免（类型色例外 / 固定暗色清单）之外不得有未 token 化的写死色值（见 03 §3.6.1）
✅ node scripts/check-comfyui-port-contract.cjs # ComfyUI 端口口径一致性（见 launch-and-build §5）
✅ node scripts/check-inline-style.cjs --staged # 视图层不得动态注入 <style>（见 03 §3.5）；`--staged` 见下 13.5.8.2
✅ node scripts/check-code-duplication.cjs --staged # 跨文件重复块硬闸（见 12 §12.12）；`--staged` 见下 13.5.8.2
✅ node scripts/check-function-length.cjs --staged # 函数长度硬闸 TS/TSX（见 12 §12.13）；`--staged` 见下 13.5.8.2
✅ node scripts/check-rust-function-length.cjs # 函数长度硬闸 Rust 壳（见 12 §12.13.1）
✅ node scripts/check-infra-file-size.cjs --staged # 基础设施层文件长度**硬闸**：`scripts/**` 的 .cjs/.mjs 与 `tools/**` 的 .ps1，与 R5 同阈值同口径、另立一档（见 12 §12.8 R5 姊妹档）；`--staged` 见下 13.5.8.2
✅ node scripts/shell-gate.mjs               # 桌面壳门禁：**只在暂存命中 src-tauri 四类壳输入时**
   # 才做事 —— 有 .rs 改动就跑 `cargo test`（壳里 37 条 #[test] 唯一的执行者），并复用
   # `dev-launcher.mjs` 的 `shellStaleWarning` 把硬规则 5「改了壳必须重编」升成阻断（见 11 §11.10.4）
✅ node scripts/freshness-gate.mjs           # 每一档都有主（**三份同形的账**，见 11 §11.8）：
   # **全量 e2e**（`scripts/.e2e-freshness.json`）、**全量单测 + 覆盖率**
   # （`scripts/.full-suite-freshness.json`）、**产物级护栏**（`scripts/.artifact-freshness.json`）
   # —— 判「每一档都有一条新鲜度记录，且写清谁 / 什么时候 / 按哪条命令复核的」。
   # 三档**都判一条「今天自证过没有」**，口径按 `track.dirty` 分两味（数据，不是分支）：
   # 全量 e2e 按**本地日历日**（每天只拦第一次提交）；另两档按「**改了就当天跑**」（当天动过输入面
   # 就必须今天自证，没动过以 `graceMs` 为宽限）。出路：跑一次（跑绿即记）/ `--skip "<理由>"`
   # （今天故意不跑）/ `--dirty "<理由>"`（这次改动不吃这一档）；账文件还没入库时只提醒、不阻断。
   # 判决面由 `FRESHNESS_TRACKS` **现算**（`trackScopes()`），不手抄档名清单。钩子里**不跑**这四档
   # （起 webServer / 十分钟量级），记账走各自的跑法脚本（见 §13.5.4 那张「谁在什么时候跑它」表）。
✅ node scripts/run-affected-tests.mjs       # C 组：结构守护固定清单 + 本次改动
   # 牵扯到的用例，一次 vite（固定清单唯一出处是 `affected-tests.mjs` 里的
   # FIXED_STRUCTURAL_TESTS，见下 13.5.8）。**启动这一步单独有脚本**：清单是位置参数，
   # 直接拼进 `pnpm exec vitest run $files` 会在 Windows 上顶穿 cmd.exe 的 8191 字符
   # 命令行上限 —— 表现是「组 C 红、一条用例没跑、原因是一行 GBK 乱码」。
   # 面大时它还会在起 vitest **之前**打一段读数（这次多大 / 哪一刀最值 / 拆开估算剩多少），
   # 那是「把大改动拆小」那条建议的执行者；**纯提示、不改变退出码**（见下 13.5.8.2 第七笔账）
✅ node scripts/check-circular-deps.cjs --staged # 模块循环依赖硬闸（见 12 §12.7）；`--staged` 见下 13.5.8.2
✅ node scripts/check-barrel-heavy-deps.cjs   # 入口静态图上不许有重依赖（见 12 §12.19 / 02 §2.9）
✅ node scripts/check-format.cjs --staged    # prettier 格式硬闸（见下 13.5.1；`--staged` = 只碰了扫描面（`src/**` / `.storybook/**`）才扫，见下 13.5.8.2）
✅ node scripts/check-reformat-only.cjs      # 格式化提交与行为改动分离（见下 13.5.2）
✅ node scripts/check-dead-exports.cjs --staged # src/lib + src/trpc 零消费导出硬闸（见 12 §12.16）；`--staged` 见下 13.5.8.2
✅ node scripts/render-doc-placeholders.cjs --check # 生成态 docs/generated 与源一致（见下 13.5.5）
✅ node scripts/check-docs-api.cjs --staged  # API 文档生成物 docs/api 与源一致（见下 13.5.5.1；--staged = 只碰了 typedoc 输入面才重生成）
✅ node scripts/check-ui-customizations.cjs  # ui/ 定制标记与台账（见 16 §16.8）
✅ node scripts/check-doc-references.cjs     # 文档引用与权威源一致（= `pnpm doc:check`；序号那条判据见下 13.5.10）
✅ node scripts/storybook-check.mjs --changed # 故事枚举来源（cva 返回值 / 漏档）+ 组件覆盖率棘轮 + 故事面（见 16 §16.2.3.4 / §16.2.3.8）
✅ node scripts/check-comment-language.cjs   # 注释语言硬闸：注释一律中文，只有「纯 ASCII 模块」例外（见 12 §12.4.6；§12.4.6 早写着它在钩子里报红，而它一直不在，ISSUE #1451 补齐）
✅ node scripts/check-gate-executors.cjs     # 判据 ⇄ 执行者双向判据：判定型脚本无执行者即红（除非登记按需召唤台账）、报告型自称供 pre-commit 调用即红（见下 13.5.12）
✅ node scripts/check-declaration-readers.cjs # 声明 ⇄ 读者索引：本仓库每一种「声明」（判据自称在跑 / 条件性 skip / 已知基线失败登记 / 环境归属 / 并发隔离 / 类型断言执行者 / 软断言语义 / 新鲜度档…）都必须答出「谁在读它 + 执行者在哪」——读者丢了、执行者从门禁链里被摘掉、索引自己静默降级，都红（见 11 §11.23）
✅ node scripts/check-on-demand-duties.cjs   # 「不进钩子」的按需档 ⇄ 执行者索引：每一行的机器事实仍在（新鲜度档键 / 门禁 run:false / 按需召唤条目，全部现算）+ 每一个机器事实都被登记（新增一档忘了登记 ⇒ 那一档谁都不判）（见 13.5.4）
✅ node scripts/check-test-environment.cjs   # 用例的环境档：环境早退（绿但一条断言没跑）+ 目录档与文件头矛盾 + 冗余文件头（见 11 §11.17）
✅ node scripts/check-soft-assertions.cjs    # 软断言（expect.soft）只许用在循环体里（一张清单逐项判）；落在循环外会把真正的原因吞掉（见 11 §11.18）
✅ node scripts/check-test-concurrency.cjs  # 并发档位（it.concurrent）用在哪：不许与 expect.poll 同文件、且必须有隔离声明（见 11 §11.19）
✅ node scripts/check-test-sleep.cjs        # 测试层裸 sleep 硬闸：`await new Promise(r => setTimeout(r, N))` 一处即阻断（正当形态逐站点声明 `sleep-ok`；见 11 §11.14）
✅ node scripts/check-test-waitfor.cjs      # 测试层 `waitFor` 的边界：只有「等 DOM」与「假定时器窗口内」两种形态该留 `waitFor`，其余等值的一律 `expect.poll`（见 11 §11.14.3）
✅ node scripts/check-test-it-each.cjs     # 参数化用例 `it.for` ⇄ `it.each`（**硬闸**：站点须为 0）；`it/test/describe.each` 一视同仁（本地同名 helper 不看、夹具字符串不算；见 11 §11.15.1）
✅ node scripts/check-gate-repo-boilerplate.cjs # 门禁自测**别再手搓临时仓库样板**：`tmpdir()` + 从 `workdir` 拉判据脚本 + 没 import 共享件 —— 三条同时成立即红。用 `tests/helpers/gate-repo.ts` 的 `defineGateRepo`（见 11 §11.16.1）
✅ node scripts/check-type-assertion-executor.cjs # 类型层断言（expectTypeOf/assertType）的执行者在场：站点必须在 tsconfig 的 include 面里 —— 它在 vitest 里没有牙，唯一执行者是 tsc（见 11 §11.20）
✅ node scripts/check-annotate-consumer.cjs # `ctx.annotate` 的消费方在场：有站点就必须登记「谁读、怎么读」—— 它写下的注释只有失败时可见、JSON 报告里没有（见 11 §11.21）
✅ node scripts/check-task-meta-consumer.cjs # `ctx.task.meta` 的消费方在场：它是唯一能从 CLI 那侧读到的通道，但门禁链没带 `--reporter=json` —— 有站点就必须登记「谁读、怎么读」（见 11 §11.22）
✅ node scripts/check-test-todo.cjs        # `test.todo` 的消费方在场：退出码 0、不进失败计数，而门禁链只看退出码 —— 一份零成本、没人读的声明；有站点就必须登记「谁读、怎么读」（见 11 §11.24）
✅ node scripts/check-known-failed-stale.mjs  # 已知基线失败登记过期：登记项必须指向真实文件、且真的还红着（见 11 §11.12；清单为空时零耗时）
✅ node scripts/known-failed-selftest-gate.mjs # 上一条的自证档执行者：**只在暂存命中这套机制
   # （登记表 / 判据本体 / 钩子接线）时**才做事，跑一次 `--self-test`（红侧 + 绿侧对照组）。
   # 上一条「清单为空 ⇒ 零耗时」是代价的正确取舍，但它留下的空档是「真跑那一档在干净仓库
   # 上从没被执行过、自证入口一个执行者都没有」（见 11 §11.12.1）
✅ node scripts/check-deps-freshness.mjs --staged # 依赖新鲜度（ISSUE #1569）：远端改过库的
   # 版本而本地还停在旧的那套上 —— 只在**本次暂存动了依赖面**时判（否则退 0 零输出），
   # 判据自身不做网络请求，远端引用陈旧只打 [未校验]、不阻断（见下 13.5.13）
✅ node scripts/check-allow-builds.cjs --staged # 依赖构建脚本 ⇄ allowBuilds 对账（AGENTS 硬规则 8）：
   # 每个已安装且带 preinstall/install/postinstall 的包都必须在 `pnpm-workspace.yaml` 的
   # `allowBuilds` 里有一条显式条目 —— `true`（批准）与 `false`（显式拒绝）都算回答过，
   # 漏答才红。反向（名单里有无脚本的条目）刻意不判。读不到扫描面判红、不静默放行。
   # `--staged` = 只在本次提交动了**依赖面**（`package.json` / `pnpm-lock.yaml` /
   # `pnpm-workspace.yaml`，清单 import 自 `dependency-face.mjs` 的导出）时才扫全树，
   # 未命中打印「未触及依赖面」而不是冒充结论（见下 13.5.15）
✅ node scripts/check-tsc-diagnostic-executors.cjs # 类型层声明 ⇄ 执行者（见下 13.5.14）：19 条 tsc 错
   # 落进 master 的共同根因是「声明（JSDoc / 类型注解）落后于实现」，而 tsc 那条判据缺的是
   # 「什么时候被敲」。本步不跑第二遍 tsc（合并前那一跳归 §13.6.2 的 check:base:batch），
   # 判的是那条判据自己的执行者：每条登记项的执行者在场 + 与声明 ⇄ 读者索引逐行同源 +
   # **声明行计数零增量**（新写一处就红，直到你回答「它谁在执行」）
✅ node scripts/check-app-version.cjs        # 产品版本号三处同步（D7，ISSUE #1611）：package.json /
   # src-tauri/tauri.conf.json / src-tauri/Cargo.toml 三处逐字相等 + 形态合法（见 launch-and-build §7.1.1）。
   # 只判相等，刻意不判「该不该升」——那是发布判断
✅ node scripts/check-a11y-rules.cjs         # jsx-a11y 的规则开关 ⇄ 判据（见 06 §6.12）：
   # 官方 recommended 集合全开（从插件自己的数据算，不手抄规则表）、本仓与官方默认的
   # 每一处不同都在 scripts/.a11y-rule-ledger.json 登记（关掉一条 / 就地豁免一个文件，
   # 都要答出「为什么」+「谁在守它」）；**官方两份配置谁都没提到、又没被标记废弃的**
   # 规则也要有一笔裁决（开着、或登记为不开）—— 台账双向拦
```

> **本地钩子没接、也不打算接的判据**（`test:coverage` / `build` /
> `check-standalone-contents.cjs` / E2E `@critical` / `db:push`）：
> 它们是「按需召唤」那一层 —— 由人 @ 评审 NPC 唤起，或在改动命中对应范围时手动跑，
> 逐条登记在 13.5.4。**不要**把它们塞回每次 commit。
> **R5 的 `--strict` 原来在这份名单里，现已翻档接进钩子**（ISSUE #1404，见上面清单与 13.5 的表）：
> 它当时的理由是「被拦下的动作要求拆分文件，不适合每次提交都挡一次」，而那一档挂着 11 个存量；
> 基线归零之后这条前提不再成立，且 #623 之后它一个自动执行者都没有。
> **`tw4-canonical-report` / `tw4-spacing-canonical` 也不在这份清单里，但它们「不进钩子」不再等于
> 「没人管」**（ISSUE #1451 要求 2，见下 13.5.12）：两者各带 `--check` 棘轮判定档
> （基线两份都 `total: 0`），并按「按需召唤」登记在 `scripts/.gate-executor-ledger.json` 里 ——
> 那份台账本身由 `check-gate-executors.cjs` 在 D 组强制，**登记了却其实有执行者**同样拦。

**平台侧仍需一步人工动作**：把 `master` 配成**保护分支**（禁直接 push + 要求 PR）。
**别用** `git create-branch-lock` —— 它锁整分支写入，会把 PR 合并一起拦死（见 13.6.1）。

**规则**：

- 门禁清单只在 `.githooks/pre-commit` 一处（上面那份清单就是全文）。`package.json`
  里的单项脚本（`pnpm run typecheck` / `test:coverage` / `build` 等）是「本地怎么
  手动跑一遍全套」的入口；新增 / 修改门禁脚本时**同时**加进钩子 —— 平台侧已经不会再
  兜底，「只在 CI 里跑」的脚本等于没有任何机器判据在维护它。
  **钩子由 `pnpm install` 自动接上**（`package.json` 的 postinstall →
  `scripts/install-git-hooks.mjs` 写 `core.hooksPath=.githooks`，幂等）；装了依赖但
  `git config core.hooksPath` 仍为空时手动执行一次即可。
- 任一步失败即阻断提交；紧急绕过用 `git commit --no-verify`（会留在历史上，慎用）。
- **一律 pnpm，禁止 npm/npx**（AGENTS.md 硬规则 1）：npm 在本项目解析 typescript
  别名链会崩溃（`Class extends value undefined`）。
- **E2E 用 `@critical` tag 圈定关键流程**：新增冒烟用例若属于「必须验证的主流程」，
  标题带上 `@critical`（平台侧已无 CI，E2E 由本地按需跑：
  `pnpm exec playwright test --grep @critical`）。
- **prettier 走「棘轮」而不是「全库必须过」**：见下面 13.5.1 / 13.5.2。
- 新增含 postinstall 构建脚本的依赖，同步 `pnpm-workspace.yaml` 的 `allowBuilds`
  （AGENTS.md 硬规则 7），否则非交互 `pnpm install` 会 exit 1。
- 历史口径：`.github/workflows/ci.yml`（27 步）在 CNB 上**从未被触发过一次**，已删；
  `.cnb.yml`（30 步）曾经跑起来过，现已按额度约束删除。两份配置都不在仓库里，
  **不要再从它们复制门禁清单**。

#### 13.5.1 prettier 格式判据（ISSUE #575 第 9 项 / #1811 收尾翻硬闸）

`format:check` 是**唯一长期没有纳入门禁**的既有质量命令。原因很实在：全库
**576 个文件**未过 prettier，一次性 `--write` 会产生与本次改动无关的全文件 diff
（违反 [13.7](#137-换行符与提交噪声lf)，评审无法从 diff 里看出改了什么）。
但「等基线整改完再接入」的代价是**每个新文件都可以带着任意格式进来**，存量只增
不减，那一天永远不会到。

判据因此**先**改为「基线 + 只许下降」（`scripts/check-format.cjs`，与重复块 /
函数长度 / 文件行数 / 环依赖同口径）；存量清零之后（ISSUE #1811 收尾）**再翻成硬闸**：

| 情形                       | 结果                                                     |
| -------------------------- | -------------------------------------------------------- |
| 未过 prettier 的文件（无论新增还是原本干净后被弄脏） | **阻断**（硬闸：命中即退 1） |
| `--update` / `--strict`    | **不存在**（翻闸时删掉，只留 `--report` 作清零后的自证） |

**为什么清零后必须翻闸**：棘轮的两个动作这时候都无事可做（`--update` 无余地、
`--strict` 恒绿），留下的却是一条「手改那份 JSON 就能把新违规登记成已知存量」的通道
—— 硬闸类本来没有那个中间态（§13.6.2 的两类对照）。

刻意的设计：

- **命令没跑成不能被读成「全库干净」（fail-closed，台账 E11）。** 本门禁过去经
  `pnpm exec prettier` 起进程，而 `--list-different` 的退出码 1 含义是「有差异，
  清单在 stdout」——`pnpm exec` 找不到 prettier 时（沙箱、依赖没装、pnpm 形态选错）
  同样是退出 1 且 **stdout 为空**，旧代码把空清单当成「0 个文件未过」并打
  `[format] OK`，门禁当场瞎掉而全绿。现在三条出路全部 fail-closed：入口解析不到 →
  exit 2；子进程被信号终止 → exit 2；**退出 1 却一行都没列出来** → exit 2。
  prettier 也不再经 pnpm 层起（`node <本地入口>`，口径同台账 E10：平台 shim 那一层
  正是这类「起不来却被读成没问题」的藏身处），缓存从机器全局的 `os.tmpdir()` 路径
  改到本次检出的 `node_modules/.cache/prettier-gate.json` —— 门禁用例会并发搭临时
  沙箱，共用一份缓存时读数不可信，且跟着用户走的缓存无法按检出隔离。
  同族两处已核过、形态本来就是安全的：`check-reformat-only.cjs`
  （`status !== 0` 一律当失败并退回逐文件兜底）与 `run-tests.mjs`（透传退出码）。
- **判据落在「文件」这一层，不记全局计数。** 计数只约束总量 —— 修好 3 个、弄坏 4 个，
  总数变大才失败，弄坏的那 3 个无人知晓。文件级判定下「把干净的文件弄脏」当场失败，
  而「这个文件此前是干净的」本身就是一个可断言的事实（棘轮时代这条记账方式是
  §13.5.1 的原设计，翻硬闸后仍然成立：判据点名的就是文件）。
- **白名单是形态（glob），不是文件列表。** 第一类是**高频 churn 路径** ——
  `scripts/**`、`tests/**`、`e2e/**`、根级配置（每次排障都要改一遍），把它们纳入
  判定会让每一次排障提交都顺带产生格式 diff。第二类是**非源码产物** ——
  `src-tauri/target/**`（`cargo build` 输出，由嵌套的 `src-tauri/.gitignore`
  忽略）：prettier 只按仓库根读 `.gitignore`，看不到嵌套忽略文件，构建过一次的
  检出会拿 `target/**/out/__global-api-script.js` 阻断每一次提交。用 glob 表达
  「这类文件暂不纳入」不会漂移，且新增这类文件时**自动**落在白名单里。

**存量文件怎么治理**（棘轮时代的 SOP，留作历史）：单独立项、单独一个 PR，对一批文件跑
`pnpm exec prettier --write <文件>`，再收紧基线。**禁止**在功能提交里顺手做（见 13.5.2）。

#### 13.5.2 格式化提交与行为改动分离（同批）

格式判据只判「文件干不干净」，管不住「顺手全库 `format:write`」—— 后者会把一次
真实改动埋在几百个文件的重排里，`git blame` 当场失效、评审看不出改了什么。
`scripts/check-reformat-only.cjs` 判**这次提交的形态**：

- 某文件的改动若「把改动前的**整份文件**交给 prettier 重排，结果逐字等于改动后」，
  即记为**纯格式化文件**；
- 一次提交里纯格式化文件 ≥ **10** 个 → 阻断，并打印可照抄的拆分命令。

四个实现上的硬口径（都踩过）：

1. **必须比整份文件，不能比 `git diff` 的 hunk 片段**。片段不是完整的语法单元，
   单独交给 prettier 会 `SyntaxError` —— 那样每个文件都「无法判定」，门禁静默失效
   （实测：`<p className=...>` 片段报 `'>' expected`）。
2. **判据必须用真 formatter，不能是「抹掉空白后比对」**。前者覆盖 prettier 的
   **重新断行**（超宽对象拆成多行）与 `prettier-plugin-tailwindcss` 的**类名重排**
   （`mt-1 text-sm` → `text-sm mt-1`），后两类在抹空白口径下都看不见（实测漏报）。
3. **阈值取 10 而不是 1**。改一行时顺手格式化同文件是正常操作，拦在 1 会让门禁
   变成「每次提交都要拆两次」的噪声源 —— 那样的门禁活不过一周。10 个以上文件
   同时「只动格式」已经不是顺手，而是一次全库 / 全目录格式化。
4. **`--write <临时目录>` 的逐行输出就是判据，而且它有三档不同语义 ——
   「没被改写」不等于「没有结论」**。批量口径是性能要求：逐文件起 prettier 的
   成本在改动文件数上线性叠加，12 个文件就约 5s，正好顶穿当时那套默认超时
   （现场是别的门禁用例报 `Test timed out in 5000ms`，看起来像「测试写得慢」；
   该默认值后来按实测抬到了 20s，见 §11.13，但这条教训本身不变 —— 慢的是子进程
   冷启动，不是断言）。而批量输出分三档，只有中档能推出「不是纯格式化」：

   | stdout 那一行长什么样       | 真结论                                 | 判据                   |
   | --------------------------- | -------------------------------------- | ---------------------- |
   | `<path> <ms>ms`             | prettier **改写了它**                  | 回读它拿规范形态       |
   | `<path> <ms>ms (unchanged)` | prettier 看过它、它**本来就规范**      | 不是纯格式化（是结论） |
   | **没有这一行**              | **没有结论**（无 parser / 被忽略跳过） | 必须退回逐文件 stdin   |

   第三档（真的没有那一行）必须退回 stdin。忽略规则**以 cwd 为根读
   `.gitignore`**，而且命中目录名时连**显式点名**的路径也一并跳过
   （`--write <file>` 静默返回空输出、退出码 0）——实测三档的分别：忽略路径下的
   `probe.ts` 在「整目录」与「显式点名」两档**都没有输出行**，`.foo` 这类没有
   parser 的路径同样没有，而 stdin 两档都给出格式化后的正文。`git check-ignore`
   **不能**代判：实测它对**已跟踪**的路径报「未被忽略」，而 prettier 照样跳过 ——
   两者语义不同，借用它等于换了一套判据。真实先例：`.workbuddy/skills/build-guard/
guard.js` 被格式化后，在 #619 的合并提交里落成了「纯格式化」（该目录后来随
   #623/#636 删除）。**批量失败**（prettier 起不来 / 配置写错）同样是「没有结论」，
   退回兜底而不是把结论改写成「没格式化」。

   **第二档必须被当成结论，不许退回 stdin**：实际提交里绝大多数文件本来就是规范的
   （实测 59 个改动文件里 49 个 `(unchanged)`），旧口径把它们全部退回 stdin ——
   D 组那 14.8s 里 ~13s 就是这一批白跑的（ISSUE #1610）。读成结论之后，第二个档位
   的规模从「改动文件数」降到「prettier 不认识的路径数」（正常提交里是 0）：59 个
   改动文件 15.2s → 2.0s，真钩子档该步 28.1s → 5.7s，**结论一个字没变**。

   顺带两条实现口径：**颜色码要先剥**（`(unchanged)` 那行整段被涂灰，带色时
   `/ \(unchanged\)$/` 永远匹配不上，那一档会被误判成「改写过的」，49 个文件
   当场全被判成纯格式化）；**耗时标记从行尾剥**而不是按固定列取路径，否则含空格的
   路径会被截断。

   兜底的代价只在「prettier 真的没给结论」时付出，所以这条既没有放宽判据、也没有把
   成本放回去。`tests/check-reformat-only.test.ts` 的「批量输出的三档语义」一组
   用真 prettier 锁住它，判据是**prettier 起了几次**（次数确定、耗时不确定），
   三档各一条（反向验证：把 `(unchanged)` 当没有结论 / 拿掉 stdin 兜底 / 不剥颜色码,
   三条各有一到两条用例变红）。

判据是**保守**的：重排后只要有一个字符不同就当成真实改动 —— 宁可漏报（放行一次
没拆开的提交）也不误伤（把真实改动判成格式化而阻断）。

**这道判据此前只在 CI 上跑**（平台侧现已删除，见 13.5）：squash 合并后 `master` 上
只剩一个提交，「拆成两次提交」在本地不做就再没有机会补，而它造成的后果
（blame 失真）是永久性的。现在它排在 `.githooks/pre-commit` 里，提交那一刻就拦住。

#### 13.5.3 核时预算与「为什么平台侧被关掉」（ISSUE #623）

**结论：本仓库用不起平台侧流水线，`.cnb.yml` 已删除。** 这一节留的是**决策记录**——
日后额度问题时别再从头推一遍，也**不要**再把配置贴回去。

计量口径：社区版云原生构建免费额度 **160 核时/月**，按「每 5 分钟冻结一次，
冻结量 = 5 min × 节点规格」计（`docs.cnb.cool/zh/pricing`）。本仓库是
`vitest（3200+ 用例）+ next build + Playwright` 串行，节点规格写死 `cpus: 8`，
跑满一小时就是 8 核时 —— **一个月约二十次 PR 就能把额度吃光**。

**曾经做到的降配（已随删除一同废止，仅作记录）**

| 做法                                                      | 省什么                     | 代价                               |
| --------------------------------------------------------- | -------------------------- | ---------------------------------- |
| 门禁只挂 `pull_request`，`push` 只留合并形态复核          | 砍掉「同一份代码的第二遍」 | 无（合并提交不引入新代码）         |
| `test` 与 `test:coverage` 合并成 `pnpm run test:coverage` | 全量 vitest 从两遍变一遍   | 无（覆盖率本来就跟着这一次运行出） |

> **服务端那两层随 `.cnb.yml` 一起下线了**（ISSUE #623，理由见 13.5.3）。
> `scripts/check-branch-guard.cjs` 仍保留 `--pr-check` / `--merge-commit` 两个
> 服务端形态 —— 它们是**判据本身**（`tests/check-branch-guard.test.ts` 用真仓库
> 跑三种拓扑），日后重启平台侧流水线时直接用，不必重写。`--merge-commit` 判的是
> 「落到 `master` 的能不能被认定为 PR 合并的形态」（合并提交 **或** 提交信息带
> `PR-URL: #NNN`），两者都不满足时保守放行 —— 为什么不能只判「父提交数 > 1」见 13.5。

- **不要调小 `runner.cpus` 省额度** —— 核时 = 核数 × 时长，核数减半时长通常翻倍，
  净效果接近零；还会拉长墙钟时间、放大超时风险。
- **不要靠 `pull_request.target` / `ifModify` 之类的 write 过滤跳步**：本仓库改动
  边界跨目录（`src/lib` 牵动 `scripts` / `tests` / 文档），任何过滤都制造
  「这次没跑、但看起来跑了」的静默盲区 —— 正是 AGENTS 硬规则最反对的形态。
- **不要 commit 一个「依赖预热镜像」的 Dockerfile 换缓存**：那会把 `pnpm install`
  的语义改成「交给缓存镜像」，而缓存镜像的版本键与 `pnpm-lock.yaml` 之间没有任何
  判据会在漂移时报警。

**关掉之后谁来守门禁**：`.githooks/pre-commit`（判据清单见 13.5）。它与平台侧那套
**大部分同源**（同一批 `scripts/check-*.cjs` 与契约测试），差别有两层：

1. **它只保护「启用了钩子、且没加 `--no-verify`」的检出** ——
   别的检出直推 `master` 不再有任何服务端复核，只能靠平台的分支保护设置拦。
2. **原来只在 CI 上跑的那几步，现在没有执行者**（逐条登记，别让它们静默消失）。
   下表**按职责写、不写序号**：`​.cnb.yml` 已随 ISSUE #623 删除，那份流水线里的步骤序号
   在今天没有任何主人，写出来只会指到不存在的东西上（详见 13.5.3）。

| 判据                                                                 | 原来的落点（流水线已删，按职责记）                          | 现状                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------------------------- | ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 全量单测 + 覆盖率门槛（`pnpm run test:coverage`，3000+ 用例）        | 平台流水线的「全量单测 + 覆盖率」那一步                     | **逐日自证 + 改了就当天跑**（`pnpm run test:coverage` 走 `scripts/full-suite-run.mjs`，账在 `scripts/.full-suite-freshness.json`，钩子 D 组「每档都有主」那一步判；见 13.5.4 与 11 §11.8）。提交门槛里仍只有固定清单 + 受影响用例（见 13.5 的 C 组与 13.5.8）                                                                                 |
| `pnpm run build` + `check-standalone-contents.cjs`（产物级护栏）     | 平台流水线的「构建」+「数产物」那两步                       | **逐日自证 + 改了就当天跑**（`pnpm run build` 走 `scripts/artifact-run.mjs`，账在 `scripts/.artifact-freshness.json`；同样由钩子那一步判。`pnpm run build` 内部已经串了 `next build` → 剥私有输入 → 数产物 → 冒烟，不另拼一遍）                                                                                                               |
| E2E `playwright test --grep @critical`                               | 平台流水线的「E2E @critical」那一步                         | **被全量 e2e 那一档覆盖**：`--grep @critical` 走的是 `scripts/e2e-run.mjs`（同一入口），而那一档有「每天首次自证」判据（账在 `scripts/.e2e-freshness.json`，钩子 D 组「每档都有主」）。它是全量 e2e 的**子集**，所以子集不另立一档（旧口径「无自动执行者」已作废）。它证明的是功能链路 |
| `db:push` 建库                                                       | 平台流水线的「建库」那一步                                  | 只在手动跑 E2E 前需要；启动链路本身由 `ensureSchemaCurrent` 自动建表（§9.1），所以它**不是**一条独立的人为纪律                                                                                                                                                                                                                                |
| R5 超 900 行文件棘轮（`check-file-structure.cjs --strict` 的那一半） | 平台流水线里带 `--strict` 跑结构检查的那一步                | **已在本地钩子里**（D 组「文件结构硬规则(R1-R12，R5 棘轮硬闸)」这一步带 `--strict`，ISSUE #1404 翻档；旧口径「本地只提醒」的前提「挂着 11 个存量」已不成立，基线现在 `total: 0`）                                                                                                                                                             |
| `pnpm doc:check`（文档引用与权威源一致）                             | 平台侧从不跑；`pnpm doc:gen` 内部的第一步                   | **已在本地钩子里**（D 组「文档引用与权威源一致」，ISSUE #1371 翻掉了旧的「手动档」签字）。旧口径是「改了文档后需手动跑」，而 AGENTS 规定的必跑口令是 `doc:render`（只渲染不校验），空档即由此来                                                                                                                                               |
| `docs/api/**` 生成物与源同步（`check-docs-api.cjs`）                 | **平台侧与本地都从不跑**（此前是纯空白）                    | **已在本地钩子里**（D 组「API 文档生成物与源同步」，带 `--staged` 条件触发，详见 §13.5.5.1）。翻档前实测 2627 个文件差异、留着指向已删模块的 `lib_comfyui_markdown.html`（ISSUE #1329 收尾）                                                                                                                                                  |
| `tw4-canonical-report` / `tw4-spacing-canonical`（CSS 等价改写汇总） | 从不跑（03 章只写着「按需跑一次」，那句话没有任何东西在守） | **按需召唤 + 棘轮**：两者都起 Tailwind 引擎（~6s）、判的是「CSS 等价改写」而非正确性，故不进钩子；各带 `--check` 判定档与「零候选起步」基线，并登记 `scripts/.gate-executor-ledger.json`（详见 §13.5.12）                                                                                                                                     |
| `report-ts-duplicate-keys`（同一属性指定两次）                       | 从不跑（此前是报告型、零判定档）                            | **已收成判定档**：`check-ts-duplicate-keys.cjs` 接进 D 组「TS 重复属性判定」。落地时实测 0 处，按硬闸落、不走棘轮（ISSUE #1451）                                                                                                                                                                                                              |

> 这张表是**有意留下的欠账**，不是遗漏：把全量 3000+ 用例塞进每次 commit 会让本地
> 提交慢到没人愿意用，而那正是当初把它放去 CI 的原因。**去处不是把配置贴回去**，
> 而是 13.5.4 的「按需召唤」：在 PR / Issue 里 `@` 对应 NPC 唤起一轮，不 `@` 就不跑。

#### 13.5.4 「按需召唤」的那一层（ISSUE #656）

13.5.3 那张表登记的是「**没有自动执行者**」的判据。没有执行者不等于没有出路 ——
出路是**把它们从「没人跑」改成「有人按需跑」**，用平台自带的 NPC 触发机制，
而不是把 `.cnb.yml` 贴回去。

**结论：这一层不写任何配置，因此不花核时。**「PR 评审」不是一条流水线，而是
**按需召唤的 NPC**：在 Issue / PR 里 `@` 对应 NPC 即触发一轮评审，不 `@` 就一次都不跑。

**为什么这比 `.cnb.yml` 更值**（ISSUE #623 的结论仍然成立、没有被推翻）：

|          | 平台流水线（已删）              | 按需召唤 NPC（本节）       |
| -------- | ------------------------------- | -------------------------- |
| 谁能触发 | 任何 push / PR 事件，**无条件** | 人 `@` 哪一个 NPC          |
| 核时     | 每次事件 ≈ 1 核时 × `cpus: 8`   | 只在 `@` 时消耗；平时为 0  |
| 代价     | 一个月几十次 PR 就吃光 160 核时 | 无配置、无事件、无必然消耗 |

**机制**：平台把 Issue / PR 评论里的 `@npc/<slug>(<name>)` 解析成
`issue.comment@npc` 事件并召唤该 NPC —— 仓库里**不需要**任何文件承载它。
本仓库的 `.cnb.yml` 删除后仍能被 `@CodeBuddy` 唤起跑本轮任务，就是这个机制在生效
（构建历史里 `issue.comment@npc` 一直是唯一被真实触发过的形态）。因此在
**不新增仓库根配置、不注册任何事件**的前提下，本仓库就已经有了一条「按需 CI」：

| 想验证什么            | 怎么做                                                                                                   | 对应 13.5 清单里的哪一步                       |
| --------------------- | -------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| 代码评审（语义判断）  | 在 PR / Issue 里 `@` 评审 NPC                                                                            | 不在机器清单里，是**人**的那一层               |
| 全量单测 + 覆盖率门槛 | `pnpm run test:coverage`（跑绿即记）—— **且「改了就当天跑」有判据**（见下面那条）                        | 13.5.3 欠账条目 1                              |
| 产物级护栏            | `pnpm run build`（跑绿即记；两步都在它里面）—— 同上                                                      | 13.5.3 欠账条目 2                              |
| E2E 关键流程          | `@` 跑 `pnpm exec playwright test --grep @critical`，或 `pnpm test:e2e --grep @critical`（先 `db:push`） | 欠账条目 3/4                                   |
| 全量 E2E（§11.8）     | `pnpm test:e2e`（跑绿即记一笔新鲜度账，见下面那条）                                                      | 不进钩子，但有**每天首次的自证**               |
| 页面级运行时读数（§11.8.1） | 搭上面那一档：`e2e/runtime-budget.spec.ts` 随 `pnpm test:e2e` 一起跑                                                     | **不新增档** —— 与全量 e2e 同一笔开销（起 webServer + 浏览器），因此被同一条「每档都有主」守着；不进钩子的理由同 §11.8.1 |
| 其余按需档的去向      | 逐条答「不进钩子，那谁在什么时候跑它」——答不出就不许留在这张表里                                         | 见下面「**「不进钩子」不等于「没人管」**」那条 |

**「不进钩子」不等于「没人管」：每一条按需档都要答出执行者**（ISSUE #1282 续）。这张表
此前有一条隐形的缝：判据「不进钩子」是**代价判据**（起 webServer / 十分钟量级 / 网络请求），
而它**不回答「那谁在什么时候跑它」**。缝里漏掉的正是代价最高的那几条 —— 它们曾经只有一句
「按需手动跑」，而那句话没有任何东西在守（同 §13.5.12 的立案现场）。现在每一条都答得出：

**这张表现在是机器判的**（ISSUE #1569 收尾）：它的机器可读形态是
`scripts/.on-demand-duties.json`，由 `scripts/check-on-demand-duties.cjs` 在 pre-commit
的 D 组**双向**核对 —— 上一轮补的是**散文**，而写进文档的表格不会自己响：

- **每一行点名的机器事实仍然存在**（档被删 / 改名 / 已接进 `check:all` ⇒ 过期承诺）；
- **每一个机器事实都被本索引登记**（新增一个新鲜度档却忘了登记 ⇒ **那一档谁都不判** ——
  判据的覆盖面与它自称的不符，正是 §13.5.12 的立案现场）。

事实**从既有出处现算**、不抄第二份清单：新鲜度档键取 `FRESHNESS_TRACKS`、
「不进 `all`」取 `quality-gate.mjs` 的 `run: false`、按需召唤条目取
`scripts/.gate-executor-ledger.json`、**「挂在 `--base` 链上」取 `base-check.mjs` 的
`scripts/base-check/chained-steps.mjs` 的 `CHAINED_STEPS`**（第四类事实，`fact.kind = base-check-chained`，ISSUE #1605 —— 它登记
的是「**有执行者、但执行者不是钩子步骤**」那一格，与上面那条「没有执行者、只能人手召唤」
是两件事，别混）。这条纪律与 §13.5.4 那句「判决面由 `FRESHNESS_TRACKS` 现算，
不另抄一份档名清单」同源。

| 档                                               | 不进钩子的理由（代价）                                                       | 谁在什么时候跑它                                                          | 机器事实的出处                                                |
| ------------------------------------------------ | ---------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 全量 e2e（`pnpm test:e2e`）                      | 起 webServer + 浏览器，十几分钟量级                                          | 钩子 D 组「每档都有主」判**每天首次自证**（`track.daily` + `dirty` 为空） | `FRESHNESS_TRACKS.e2e`                                        |
| 全量单测 + 覆盖率（`pnpm run test:coverage`）    | 十分钟量级；覆盖率门槛只在全量档判（§11.7）                                  | 同上，判**改了就当天跑**（吃 `src/`+`tests/`，`graceMs` 兜底）            | `FRESHNESS_TRACKS.full`                                       |
| 产物级护栏（`pnpm run build`）                   | 分钟量级（`next build` + 起 sidecar 冒烟）                                   | 同上，判**改了就当天跑**（吃产物链那几个文件）                            | `FRESHNESS_TRACKS.artifact`                                   |
| 依赖漏洞扫描（`check-dependency-audit.mjs`）     | 网络请求（离线 / registry 抖动不该变成提交失败）                             | `pnpm check:all` 的默认档（`quality-gate.mjs` 的 `dependencyAudit`）      | `quality-gate.mjs` 的 `dependencyAudit`                       |
| `tw4-canonical-report` / `tw4-spacing-canonical` | 起 Tailwind 引擎（~6s），判的是 CSS 等价改写而非正确性                       | 按需召唤 + `--check` 棘轮                                                 | `.gate-executor-ledger.json` 的 `onDemand`                    |
| 提交信息里的声明 ⇄ 事实（§11.23.5）              | **本地钩子连形态都看不到**（丢失发生在平台侧 squash）                        | `pnpm check:base:batch` 的 `CHAINED_STEPS`（合并前 / 事后盘点，人点一次） | `base-check/chained-steps.mjs` 的 `CHAINED_STEPS`             |
| **合并前的固定动作**（`pnpm check:premerge`）    | 平台侧 squash 合并**不跑本地钩子**、本地看不到那次合并；单次分钟级（钩子内三次实测 116 / 84 / 83 秒、单独跑 336 秒，见 §13.6.2.1），挂进每次提交是拿它换一个不会天天变的结论（§13.6.2 / §11.23.5） | `.githooks/pre-push` 在 HEAD 或上游引用变动时自动跑（§13.6.2.1）；人仍可手工敲一次，或在 PR 里 `@` 评审 NPC 唤起一轮 | `quality-gate.mjs` 的 `GATES.premerge`（`run: false`）+ `scripts/premerge-proof.mjs` |

| **bundle 体积预算**（`pnpm check:bundle`）       | 测量对象是 `next build` 的产物（`.next/static/chunks`），判据在一次构建之后才有结论，而构建是半分钟级（实测 26–33s）—— 把它塞进每次提交是拿半分钟换一个不会天天变的结论（成本判据同本节，另见 §13.5.3）。**注意**：ISSUE #1781 原稿把 `next build` 记成「分钟级」，实测是半分钟级；这条**不影响**「不该进每次提交」的取向 | 按需召唤（`pnpm check:bundle`）+ 棘轮（`scripts/.bundle-budget-baseline.json`）；同一脚本也挂在 `pnpm build` 收尾（形态 C 兜底，见 §13.5.3 欠账条目 2） | `quality-gate.mjs` 的 `GATES.bundleBudget`（`run: false`，+ 本节下面「测量口径」那四条） |

三档「每天首次自证」的口径不同、判据一份（`FRESHNESS_TRACKS` 的 `daily` / `dirty` /
`graceMs`）：全量 e2e 按本地日历日；另两档按「当天动过输入面没有」。**理由**：前者人人
跑得动、结论与改了哪几个文件无关；后两档十分钟量级、**没必要每天都跑**，真正要的是
「改了就当天跑」—— 没碰 `src/` 的一天跑一遍全量，换来的是一个不会变的结论。
两条出路都要留下能复核的事实：`--skip "<理由>"`（今天故意不跑）/ `--dirty "<理由>"`
（这次改动不吃这一档），占位理由一律被拦。四条边界见 §11.8。

**像素回归那一行已经撤掉**（见 §11.8）：这一档连同 `pnpm check:visual` / `GATES.visual` /
`.githooks/pre-commit` 那两步一起删除，理由是「结论只在录过基线的那台机器上成立」+ 字体栈
+ 每屏输入面登记 + 每次过期都要人工定性，收益比不成立。**界面有没有变形**这件事现在
**没有任何自动判据**，靠 review 看图 —— 这是有意的空白，不是漏了（§11.8 写清了这段）。

**「全量 E2E」这一行为什么需要一条账**（ISSUE #1545 / #1547）：`pnpm test:e2e` 此前是
「人记得就跑」，而**没有任何东西守它上一次是绿的** —— 实测的形态是靠人手动把这条入口跑了
一遍才发现它已经红了两天。现在它走 `scripts/e2e-run.mjs`，跑绿即记
`scripts/.e2e-freshness.json`（与另两档**同形而不同键**，见 §13.5.12 的同款纪律与
§11.8 的对照表），并由钩子那一步在每一次提交里把它的日期打出来 ——
「这一档上次真跑绿是什么时候」从此是被看见的读数。

**为什么三档都有「每天首次」这条判据**（ISSUE #1282）：这三档缺的只是「有人跑」
（不是「只有少数人跑得动」），所以除「有主、写清」之外多判一条：
全量 e2e（**人人都跑得动**、结论与改了哪几个文件无关）按本地日历日 —— 当天的第一次提交
必须伴着一次自证；全量单测 + 覆盖率与产物级护栏（**十分钟量级**、没必要每天都跑）按
「**改了就当天跑**」—— 当天动过输入面就必须今天自证，没动过以七天为宽限。三条出路都要
留下能复核的事实：跑一次（跑绿即记）/ `--skip "<理由>"` / `--dirty "<理由>"`（占位理由
一律被拦，豁免不是绕过）。账文件还没入库时**只提醒、不阻断**（平台侧 squash 合并不跑
本地钩子，硬规则 6）。三档的形状见 §11.8 的对照表。

**bundle 体积预算：形态、测量口径与例外流程**（ISSUE #1781，从 #1777「性能优化」清单里分出来的真缺口）

清单原稿写的是「在 CI 里加 bundle size budget」——**方向对，但本仓没有 CI**（`.cnb.yml`
随 ISSUE #623 删除、`tests/no-platform-ci-config.test.ts` 守着它不许回来），所以这条判据的
落点不是「阈值定多少」，而是「挂在哪、谁来跑」。三种形态里选定的是 **B + C 组合**：

- **B（按需档）**：`pnpm check:bundle` —— 明确入口，给「发布前 / 大改动后 / 改依赖后」；
- **C（产物层兜底）**：挂在 `pnpm build` 收尾 —— 构建已经发生，不额外买成本（它现在是全链
  里最便宜的一步）。

**不进 pre-commit（形态 A）的理由**是代价判据：`next build` 实测 26–33s（冷 / 热都一样），
半分钟 × 每次提交仍然不值，且会把「`--no-verify` 绕过」的动机推高（最坏的失效形态）。
这与 §13.5.3「下沉不等于无条件塞进提交」是同一逻辑的两面。

**测量口径**（ISSUE 第 2 问那四条，逐条有实测答案）：

1. **测哪个数**：`.next/static/chunks` 下所有 `.js` chunk 的 **gzip 后字节数之和**，外加
   **文件数**（两档都记）。ISSUE 给的另一候选（`app-build-manifest.json` 的每路由 chunk 集合）
   在**当前 Next 版本上已经不存在** —— `.next/` 下根本没有这个文件，最接近的
   `build-manifest.json` 也已空心化，所以「按路由量」当前没有数据源、口径没得选。
   **文件数比总量更敏感**：Turbopack 会把新依赖拆成上百个 chunk（实测 shiki 探针：
   gzip +49.6% 的同一次，文件数 +193）。
2. **抖动怎么判**：**不用判 —— 它不抖**。Turbopack 的 chunk 名**就是内容哈希**，实测同环境
   连续两次构建、乃至 `rm -rf .next` 后的**全冷构建**，215 个 chunk 的**文件名与 sha256
   全部一致**（新增 0 / 消失 0）。唯一会变的是 `.next/static/<BUILD_ID>/` 下那 3 个 manifest
   （随机目录名、合计 gzip 0.5 KB），它们**不在测量面内**（只量 `chunks/`）。

   **第一版口径在这里是错的**（ISSUE #1781 的第二轮实测订正）：它按 **basename** 逐文件对账，
   并声称「唯一的抖动是 BUILD_ID」。实测把这条推翻了两次 —— ① `chunks/` **里也有**名字随
   构建变化的内容（不是 manifest 那三个）；② 更根本的是，**名字不是易抖的旁支信息，它就是
   内容本身**，所以逐文件按名字对账在基线过期时产出的是一串**无法复核的行**：源码动过之后，
   旧名字既不在新产物里、又没有留下可对照的内容，读者拿到的「新增 N 个 / 变大 M 个」
   既推不出「谁真的变大了」、也推不出「哪个只是换了名」。
3. **放哪个基准**：与 `scripts/.file-size-baseline.json` 那批棘轮**同构**，独立一份
   `scripts/.bundle-budget-baseline.json`（头部记 raw / gzip / 文件数三个**实测初值**，
   不是估的）。**基线里另存一份逐文件内容指纹（`name` + `sha256`）——它只服务诊断、
   不参与判定**：判定只看 `gzip` 与 `文件数` 两个总量。这条分工是上面第 2 条的直接后果：
   既然名字就是内容哈希，「按内容对齐」才是唯一能区分「换了名」与「真的变了」的口径，
   而它只有在基线**存了指纹**时才可能成立。

   **基线还要记 `baselineRev`**（`--update` 写入，与 `check-file-structure.cjs` 同口径，
   见 §12.13.3）：判红时先说出「这批读数取自基线之后的源码还是同一版」——
   实测现场就是这一格漏了会走错路。`086e16a0` 落的那份基线是**诚实读数**，
   之后 `50c1845f` 改了 17 个组件文件、体积真涨 1074 字节；而没有归因时，
   判红那句话只有「涨了 493 字节 gzip」，读者的第一反应必然是「抖动 / 量错了」，
   于是动作落在**压回去**上，而正确动作是「先分清这 1074 字节是不是那次改动想要的」
   （例外流程的第一步）。三档输出各有明确写法：`其后本检出上有 N 次提交`（这批读数
   取自基线之后的源码）/ `就是本检出的 HEAD`（上涨来自未提交的改动）/
   `取不到`（旧格式基线 / 不在 git 检出里 / 修订号已不可达 —— 说清取不到，不拿猜测顶替，
   同 §12.13.3.1 对 `baselineRev` 不可达的处置）。

   **`raw` 量、打、但不判**：`gzip` 才是「用户要下载多少」，raw 是磁盘/内存形态。两者会
   分叉（往 chunk 末尾塞可压缩冗余：raw 明显涨、gzip 几乎不动），拿 raw 判红只会制造误报。
4. **新依赖怎么算**：预算是**棘轮**（只许降不许升），加一个大依赖会当场红 —— 这是想要的
   （正是防劣化）。**例外流程**见下一条。

**逐文件账降级为诊断**（口径订正的落点）：判定只看两个总量，逐文件账**没有删** ——
它以 `sha256` 对齐后进 `--report` 与判红时的输出，分三类：**同内容换名**（指纹相同、
名字不同 ⇒ **不计变化**）、**新增内容**（指纹在基线里找不到）、**同名且变大**（名字恰好
没变、能直接点名到文件）。基线若是旧格式（没指纹），诊断这一段会**明确打出它为什么缺**
（而不是静默换口径 —— 那会让读者拿两种语义的账互相印证）。

**例外流程**（ISSUE 第 4 问，必须写清否则第一次撞上就会被当成「挡住正常需求」而放宽掉）：

- 判据红了先读它是**总量上升**还是**文件数上升**（两档读数都在输出里）；
- 再读诊断那几行：**先分清「涨了」与「换了名」**。诊断按内容指纹对齐，「同内容换名」
  那一类**不计变化**；它对不上号的才是真涨。**基线的 `generatedAt` 也要看** ——
  一份几天前的基线在源码动过之后报红，先想「这涨是不是就是那几次改动换来的」，
  而不是当抖动放过去（实测过这一幕：涨的 1074 字节正好来自那几天合的组件改动）；
- 若确认这个体积值得，在 **PR 里贴 before/after 两档读数 + 说明为什么值这个体积**，
  由评审确认后带 `--allow-increase` 重跑 `--update`（**不许**默默 `--update` 放水：
  不带 `--allow-increase` 时 `--update` 会**拒绝抬高**，与 `check-void-floats.cjs` 那批仍在棘轮车道的判据同口径）；
- 否则先把它压回去（拆动态 import / 回到 PR #1778 那条「重依赖入口静态图」的修法）。

**与 `pnpm analyze` 的分工**：那份起 `@next/bundle-analyzer`（**强制 `--webpack`**）生成
HTML 报告给人看、退出码恒 0；本判据是**机器判定档**、量**默认 Turbopack 链**的产物 ——
两条构建链的产物形状不同，**别拿一边的读数去比另一边**。

**bundle 体积预算的右半边：页面级运行时读数**（ISSUE #1781 的另一半 / §11.8.1）

体积预算判的是**首屏要下载多少**，运行时断言判的是**下载完之后跑得多快** —— 两者无
替换关系（实测：客户端同步循环让 `loadEventEnd` 稳态 `min` 从 318 抬到 349ms，而 bundle
一个字节没变）。它的落点**不是新开一档**，而是搭「全量 e2e」那班车
（`e2e/runtime-budget.spec.ts`）：运行时断言要起 webServer + 浏览器，与全量 e2e 是同一笔
开销，另开一条同形状的账正是 §12.12 / §12.18 要拦的。于是它天然被「每档都有主」那条判据
守着，**不新增档、不新增账、不新增 `pnpm` 入口**。

**不进 pre-commit** 这条比上面那条 bundle 预算更硬：它比 `next build` 还贵，且冷启动抖幅
会直接变成提交时的随机红（实测形态见 §11.8.1 的斜坡那一栏）。取数口径、阈值来源与边界
（它只抓主线程侧、抓不到 SSR）全在 §11.8.1，本节不重述。

这张表里**原本还有一行**「canonical 候选 → `@` 跑 `tw4-canonical-report.mjs`」，
随 ISSUE #1451 摘掉：它们不再靠「人记得跑」，而是各带 `--check` 判定档，并登记在
`scripts/.gate-executor-ledger.json` 的按需召唤台账里 —— **「按需」从此是有判据的**
（详见 §13.5.12），不再是一句谁都能忘的人为提醒。判定档的形态在 ISSUE #1811 的 tw4 项
里又收了一步：从「基线 `total: 0` 的棘轮」翻成**硬闸**（删基线、删 `--update`，
`--check` 命中即退 1）。

这张表里**原本还有一行**「R5 行数棘轮 → `@` 跑 `check-file-structure.cjs --strict`」，随
ISSUE #1404 摘掉：基线 `total: 0`（那句「本地保持只提醒」的前提「挂着 11 个存量」不再成立）之后，
带 `--strict` 的这一档就写在 pre-commit 的 D 组「文件结构硬规则(R1-R12，R5 棘轮硬闸)」里，
每次提交都执行 —— **不再需要召唤**（13.5 的清单同步改了这一行）。

**边界（不要做过头）**：

- **这不是把门禁从本地搬回平台**。机器判据仍然只在 `.githooks/pre-commit`
  （13.5 的清单）；按需召唤给的是**另一次运行的机会**，不是新的唯一事实源。
- **不要为它写 `.cnb.yml`**。`pull_request` / `push` 类事件是**无条件执行**的，
  写下去就又回到 13.5.3 的额度结论；「每天只跑一次」这种节流平台也不支持
  （无「今天跑过就跳过」的判据，见 13.5.3）。
- **不要在自动触发的流水线里 `@` NPC**：`@` 是**人的动作**。把它写进流水线
  等于按事件触发，绕回被删掉的形态。

#### 13.5.5 生成态文档与源同步（`node scripts/render-doc-placeholders.cjs --check`）

`docs/generated/**` 是**提交进 git** 的原文文档（把 `{{…}}` 占位符替换成真实值，供直接
阅读），由 `pnpm doc:render` 从编辑态重渲染。**读者看的是它，而它此前没有任何判据**：
改了编辑文档却忘了重渲染，生成物就静默过期 —— 实测 5 份落后于源、缺整节内容
（如 `12-代码组织与文件结构.md` 的 §12.4.6），而这类差异在 `pnpm doc:check` 眼里是
「编辑态文档一切正确」，两个判据管的不是同一件事。

判据排在 `.githooks/pre-commit` 的 D 组（静态判据；浮层刻度棘轮紧随其后），与写入模式**共用同一份「源 → 生成物」计算**
（`scripts/render-doc-placeholders.cjs` 的 `renderDocContent()`，只比对不写入）。
报三个方向 —— 少报任何一个，漏掉的那类都会静默留在产物目录里：

| 方向     | 含义                                 | 典型来因                         |
| -------- | ------------------------------------ | -------------------------------- |
| **落后** | 生成物 ≠ 用当前源渲染出的内容        | 改了编辑文档却没重渲染（最常见） |
| **缺失** | 源在 `SCOPED_DOCS` 里、生成物不存在  | 新登记文档忘了生成               |
| **多余** | 生成物在、对应源已不在 `SCOPED_DOCS` | 源被删 / 改名后留下的孤儿        |

修法：`pnpm doc:render` 后把重渲染结果**一并提交**（不要手改生成物）。比对前把换行
归一到 LF —— 这条判据问的是「内容是否一致」，行尾由 `.gitattributes` 与 §13.7 负责，
两件事不混在一处。

##### 13.5.5.1 同族第二处：`docs/api/**` 生成物与源同步（`node scripts/check-docs-api.cjs`）

上一节管的是 `docs/generated/**`（**编辑文档**的渲染产物）。这里管的是另一份**同样
提交进 git** 的生成物：`docs/api/**`（TypeDoc 产物，2443 个文件），它的源是**代码**。

**为什么它此前是零判据的过期面**：AGENTS 与主规范 §9 都写着它「随构建链更新」，
而实测**构建链里没有任何一处调用 `pnpm docs`**；`docs/reference-facts.md` 又把它作为
「TypeDoc 自动生成」显式豁免出文档引用核对；`doc:check` / `doc:render` 只管
`docs/generated/`；钩子也不跑 typedoc。四条理由叠起来 = 「进 git + 谁都不看」，
于是产物停在最开始那两次提交上（`ab12a551` / `b2c32994`），之后所有
`src/lib/**` 增删都没再重生成。ISSUE #1329 收尾时实测：**2627 个文件差异**
（214 删 / 2229 新增 / 184 改），其中 `docs/api/modules/lib_comfyui_markdown.html`
指向一个**已不存在**的模块，而新域 `src/lib/markdown/**` 的五个模块零产物。

**它和 #1436「文档里的数字没有判据」是同一族，但更靠里一层**：不是**引用**过期，
是**生成物本身**过期 —— 下次还会有人照着 `lib_comfyui_markdown` 这个不存在的模块
去理解代码。

| 方向     | 含义                             | 典型来因                   |
| -------- | -------------------------------- | -------------------------- |
| **落后** | 同名文件 ≠ 用当前源重生成的字节  | 改了 `src/lib/**` 没重生成 |
| **缺失** | 重生成产出了、`docs/api/` 里没有 | 新增模块忘了重生成         |
| **多余** | `docs/api/` 里有、重生成不再产出 | 模块删了 / 改名留下的孤儿  |

修法：`pnpm run docs` 后把 `docs/api/**` 的重生成结果**一并提交**（不要手改生成物）。
⚠️ 入口是 `pnpm run docs` 而不是 `pnpm docs` —— 后者是 pnpm 的内建命令
（`pnpm docs <PACKAGE>`），会抢在脚本前面，typedoc 根本不跑。

**三个实现口径，都不是可有可无的**：

1. **只比对不写入**（重生成到临时目录）。判据不许污染工作区 —— 否则「跑一次判据」
   自己就产生一份需要提交的 diff，把提交者逼向 `--no-verify`。这与 13.5.5 的
   `--check` 同款口径。
2. **按输入面条件触发**（钩子里带 `--staged`）。重生成实测 **31s**，无条件挂上会给
   **每个**前端提交加这 31s。触发面 = typedoc `entryPoints` 三条 glob 的直接映射
   （`src/lib/**` / `src/server/**` / `src/trpc/**`）+ `typedoc.json` + 依赖声明
   （`package.json` / `pnpm-lock.yaml`：typedoc 与 TS 版本会改变产物形态）——
   **这不是启发式收窄**，是「产物只由这些输入决定」的同义反复：输入没变产物不可能漂。
   同款先例见 `scripts/shell-gate.mjs`（只碰了壳才付 Rust 编译那笔钱）。
   单元用例把两条边界都钉住（宽了会拖慢所有人，窄了判据白挂），见
   `tests/check-docs-api.test.ts`。
3. **重生成这一步按产物判，不按 typedoc 的退出码判**（`scripts/typedoc-run.mjs`，
   `pnpm run docs` 与 `pnpm docs:check` 共用同一份，跨平台动作见规范 §9.5 的
   对照表）。typedoc **写出失败时照样退 0**、日志照样收在
   `[info] html generated at …` 上 —— 现场是「退出码 0 + 说生成了 + 产物一个没更新」
   三件套同时出现，而「跑没跑成功」在当时没有任何一个环节在判。落到本判据里的形状
   更糟：重生成的临时目录是空的 ⇒ 仓库里的产物被**全报成多余**（源已不再产出），
   照那条提示去修就是把 `docs/api` 删掉。所以判据落在产物上 —— 探针文件
   （`index.html`，HTML 渲染器每一次必然重写）的 mtime 早于本次开始时刻 =
   这一轮没写 ⇒ 判失败并**重试**（Windows 上目录里某个文件仍被占用是瞬时失败，
   等 1s / 3s 再试通常就过去了），全部尝试都失败才退非零，并带上 out 目录绝对路径、
   跑前后文件数与探针 mtime（「产物没更新」这种事没有这些数只能靠猜）。
   用例见 `tests/typedoc-run.test.ts`：注入缝把「起了但没写」的现场直接喂进来，
   钉住「会重试」与「救回来算成功」两条（typedoc 冷跑 31s，真跑不起）。

**比对口径**：比内容不比行尾（CRLF 检出不许报两千处假红，行尾归 `.gitattributes`
与 §13.7）；递归收集**不穿符号链接**（同 §7.3 的减法口径）。

**判据成立的前提是「重生成是确定性的」**，这一点实测过：同源两次重生成逐字节相同；
在**另一个路径**的 worktree 里重生成，与仓库内结果逐字节相同（产物不含绝对路径、
不含生成时间戳）—— 所以「重生成到临时目录再比对」才成立。

#### 13.5.6 src 非空断言 `!` 硬闸（`node scripts/check-non-null-assertions.cjs`）

**须为 0**。判据走 TypeScript AST 的 `ts.isNonNullExpression`（不用正则——
正则会把 `!==` / `!x` / 注释里的 `!` 全误伤），扫描 src 下的 .ts/.tsx
非测试文件（测试里 `expect(x!.field)` 是常见形态，`.d.ts` 是类型声明，
一并豁免）。

**为什么不是 eslint `@typescript-eslint/no-non-null-assertion`**：lib 侧 102 处
`!` 分两族——13 处「filter/map 不 narrow 病灶」与 ~89 处 `arr[i]!` /
`match[N]!`（`noUncheckedIndexedAccess` 打开后的惯用法）。直接开规则一次报
100+ 处，评审看下来全是"这里其实合理"的噪声；不开规则又挡不住下一轮病灶
长出。**扫描范围是整个 src**：只挡 lib 等于给病灶留一条**漂移通道**——写视图
侧的 `!` 门不会响（v1 的 102 只算 lib，v2 首跑落到 225 处 / 85 文件）。

**为什么先棘轮、后翻硬闸**（ISSUE #1811）：160 处存量一次清不干净，所以先以
基线棘轮（与 §12.12 / §12.13 同构）逐批治理；**归零之后翻成硬闸**——棘轮在
0 上只剩坏处：`--update`（收紧）与 `--strict`（要求下降）两个动作都无事可做，
留下的却是一条「手改那份 JSON 就能把新违规登记成已知存量」的通道，而硬闸类
**本来没有**这个中间态（§13.6.2 的两类对照）。

**合法例外走 `LEGIT_SITES`，逐条登记理由**——这是这条判据**唯一**的例外车道
（与 `check-click-keyboard` 的 `EXEMPT_SITES` 同构）。登记的靶子是
`RegExpExecArray` 的捕获组（`m[2]!`、`match[1]!`）与 drizzle 的判据构造
（`or(...)!`）：它们的下标/返回值**在结构上必然存在**，`!` 不是省略判据，而是
唯一准确的表达（写 `?? ""` 会把「匹配到了但组是空」也吞掉）。键是
**「文件 + 变量名 + 组下标」而不是行号**——行号会随无关改动漂移，漂了就等于
没登记。

新登记一条的门槛：必须能指着代码说出「这个下标/返回值在**结构上**必然存在」
（正则组的定义、被调方的返回契约），而不是「跑起来没出过问题」。

`RULE_VERSION` 常量：目前只认 `NonNullExpression` 一种形态；将来若把
`<T>x!` / `x?.y!` 之类扩展形态纳入，或**再一次调整扫描范围**，必须同步改这
个常数。v1 → v2 = 扫描范围从 lib 扩到 src；v2 → v3 = 存量清零后翻硬闸。
判据排在 `.githooks/pre-commit` 的 D 组步（浮层刻度是 27）。

#### 13.5.7 src/lib `void someFn(...)` 悬空棘轮（`node scripts/check-void-floats.cjs`）

类型安全审查 src/lib 报告 **H-6** 的机器化收口。PR-4b 加了 `fireAndForget(task, onError)`
作为「刻意不 await、失败必须落到显式 onError」的地基；PR-10 逐个审了 lib 里
30+ 处 `void fn()`、把 10 处真漏改走 fireAndForget。但**人工审计会漂**——下一
位写下 `void persistLogs(taskId)`（若被调方没有内部 catch）就是一颗未来的
unhandledRejection，pre-commit 不会响。

**为什么不直接开 eslint `@typescript-eslint/no-floating-promises`**：那条判据
覆盖面大得多——除了 `void someFn()`，还会把「裸 `someFn()`（无 await 无 void
无 catch）」「`await someFn()` 后没接住 rejection 的写法」「Promise.all 未
await」等一并揪出来，一次报几百处、评审看下来全是"这里合理"的噪声。合理
路径是**基线棘轮**（与 §12.12 / §12.13 / §13.5.6 同构）：判据走 TypeScript AST，
**只认**「ExpressionStatement 的表达式是 `VoidExpression` 且操作数是
`CallExpression`」这一形状；`.catch(...)` 链尾（`void someFn().catch(...)`）
视为**显式**接管了 rejection、跳过；`await someFn()` / 裸 `someFn()` 也不在
本判据里（前者显式等待、后者是 no-floating-promises 完整版的活，未来若真要
覆盖，把 RULE_VERSION 升到 2 并扩判据即可）。

**为什么只扫 src/lib 不扫视图**：`void fetch(...)`、`void setState(fn())`
这一族在 React 事件处理器里是**表现层职责**——用户点了按钮触发的异步动作
不需要 UI 层的 await，`void` 前缀在这里是"我知道我在悬空、lint 请闭嘴"的
标记。视图层的悬空靠 §17 UI/逻辑分离那一条去治理（业务逻辑下沉 hooks/，
`void` 的取舍变成 hook 内部的事）。**lib 侧**是地基、被跨端共同消费，悬空
一次可能污染整条链，值得单独收口。

基线 `scripts/.void-floats-baseline.json` 首建 14 处 / 5 文件（`enqueue.ts` 4、
`executor-scheduler.ts` 3、`runner-state.ts` 3、`reaper.ts` 2、
`canvas-store.ts` 2）；`--update` 需伴随下降、`--strict` 强制下降同批收紧。
判据排在 `.githooks/pre-commit` 的 D 组末尾。

#### 13.5.8 提交前增量测试层：改到哪、测到哪（`node scripts/affected-tests.mjs`）

`.githooks/pre-commit` 的 C 组从「写死几个结构守护用例」升级成**固定清单 + 本次
改动牵扯到的用例**，仍然只起一次 vite（§13.5 的口径：需要 vite 的测试并入同一行
`vitest run`，别新起一次冷启）。固定清单的**唯一出处**是
`scripts/fixed-structural-tests.mjs` 里的 `FIXED_STRUCTURAL_TESTS`（它原先嵌在
`scripts/affected-tests.mjs` 里，拆出来是因为「登记一条守卫要写四五行理由」会把判据代码
本身写长到撞 §12.6 的长度棘轮 —— 数据与编排分档，两边才都写得清楚），钩子不再抄一份 ——
抄的那份在用例改名后会变成
「一条都不跑、钩子却全绿」。固定清单守的是**全库级不变量**（不会因为
「本次没改到」而变得安全）：

| 用例                                         | 守的东西                                      |
| -------------------------------------------- | --------------------------------------------- |
| `tests/single-logger-channel.test.ts`        | 日志实现只有一处（§7）                        |
| `tests/container-single-access.test.ts`      | 仓储只有一种取用法（§18）                     |
| `tests/core-spine-single-source.test.ts`     | core 骨架的三处「唯一事实源」（§18.8）        |
| `tests/lib-node-only-declarations.test.ts`   | `src/lib` 的 Node-only 声明唯一口径（§18.4）  |
| `tests/core-barrel-entry-discipline.test.ts` | `src/lib/core/index.ts` 的出口纪律（§18.8）   |
| `tests/test-mock-targets.test.ts`            | `vi.mock` 的说明符解析到真实存在的模块        |
| `tests/repository-base-purity.test.ts`       | `repository-base` 保持纯机械 CRUD 基类（§18） |
| `tests/affected-tests.test.ts`               | 本层自己的判据（见本节末尾）                  |

**四条命中判据**（方向一律是「宁可多跑，不许漏跑」）：

| 判据             | 抓住的是什么                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 自身             | 改测试就跑它                                                                                                                                                                                                                                                                                         |
| 同名兄弟 / 快照  | 改 `x.ts` 跑 `x.test.ts(x)`；改 `__snapshots__/x.test.tsx.snap` 跑宿主                                                                                                                                                                                                                               |
| 反向 import 闭包 | 谁 import 了改动文件、谁又 import 了那些文件……沿 import 图走到测试为止。静态 `from`、副作用 import、动态 `import()`、`require`、`vi.mock` 都算；别名 `~/` `@/`、相对说明符按**引用方位置**解析；目录 import 命中 `dir/index.*`，所以 barrel 的转出口天然在图里（**没有**「同目录就算消费」那种放宽） |
| 按路径引用       | 改动路径以字面量出现在测试里（门禁 `execFileSync` 起被测脚本、主题用例按路径读 CSS），另含 `scripts/<name>` ⇄ `tests/<name>.test.ts` 的同名配对                                                                                                                                                      |

闭包为什么必须走满：视图层的常态是 `X.test → Panel → X.tsx`，只走一跳时改 `X.tsx`
解析出来是「受影响 0 个用例」（实测撞到过），那「改到哪、测到哪」就是空话。
图按**说明符候选**建键、不按「目标文件是否存在」过滤 —— 暂存删除之后路径已经不在
索引里，而「谁还 import 着它」正是这次改动最直接的破坏面。

**别线的基线红从增量面里剔掉，但必须留痕**：闭包会把无关的测试拉进来，其中有的在
master 上本来就红（属别线），于是「一笔无关改动」会被别人的红拦住 —— 那是这一层第一次
真撞上就有的形态。处理方式是复用 `scripts/quality-gate-shared.mjs` 的
`KNOWN_FAILED_FILES`（与 `run-tests.mjs` / 一键门禁**同一份**清单，不另立第二份），
只从**增量**面剔除，钩子的 stderr 打印跳过了哪几条与清单在哪。**固定清单不参与剔除**
（那几条是全库不变量的唯一执行者）。粒度是文件，所以一条红会连同一文件里其他断言一起
放行 —— 登记前先确认那条门禁在别处还有没有更强的执行者（清单里每条都注了归属与该句）。
修好后**立刻删登记**：留着 = 永久静默跳过，退化不会再被发现（§11.12 第 3、4 条）。

**这一层仍然抓不到的**（写清楚，不要当成已完成）：运行时拼出来的路径
（`import(base + name)`、`path.join(dir, …)`）与解析目录（`src` / `tests` /
`scripts` / `tools`）之外的消费方。所以它**不是全量的替代**，全量仍由 `pnpm test` /
`pnpm check:all` 负责。

**公共地基被改时是「放弃收窄」而不是「猜一个子集」**：`vitest.config.ts`、
`tests/setup.ts`、`package.json` / lockfile、`tsconfig.json`、`.githooks/**` 命中时
只跑固定清单，并把放弃的理由打到 stderr（钩子的组日志里看得见）。
**兜底刻意不是「跑全量」**，但**理由不是**「全量带着别线的基线红」—— 那句是假前提，
已在 master `9392a88f` 上重测推翻：`pnpm test`（`maxWorkers: 8`）559 份里只红 1 条，
而那条是 `Test timed out in 30000ms`、`--no-file-parallelism` 隔离重跑 65/65 绿，
**真断言红 = 0**，`KNOWN_FAILED_FILES` 也是空数组。今天真正拦着的是两条别的东西（ISSUE #1393 签字口径）：

1. **耗时**：wide 那一档改成跑全量，就是给「动 lockfile / `vitest.config.ts` / `tests/setup.ts` /
   `tsconfig.json` / `.githooks/**`」的每次提交收 **32m35s**（同一台机器、
   `--maxWorkers=4`、560 files / 6887 passed 全绿的实测墙钟）。本节上面那句
   「那种闸活不过一周」今天仍然成立 —— 只是理由换了。
2. **没有全量通道**：这一层的形态是「把筛出来的清单当位置参数交给 vitest」，
   而钩子刻意**拒绝空参数**（空参数 = 谁都没筛过，红了也归不到本次提交头上），
   把 559 个路径拼进 argv 在 Windows 上还要撞命令行上限。翻兜底的前置是先造一条
   **显式的全量通道** —— **这一格已经补上了**，见下节。

⇒ 要重开这件事的条件因此是「愿意付那半小时 + 通道建好」，**不是**「等基线红清零」——
后面那个条件已经满足了，别拿它当还没做完的理由。**通道那一半现在也在场了**
（ISSUE #1393 的签字），所以 wide 那一档要不要真改跑全量，**只剩「愿不愿意付那半小时」
一个决定**，不再有「没有出口」这个借口 —— 当前口径仍是**不自动跑全量**（耗时不值），
而出口是一条人按需要的具名命令。

**显式全量档：`node scripts/run-affected-tests.mjs --full`**（ISSUE #1393 写下的前置，承接 #1679 的「增量 / 全量两档」一问）

- **它是「按名字要全量」**，与上面那条空清单守卫是**相反方向**的两件事：`--full`
  跳过暂存区解析、**不拼位置参数**（`vitest run` 不带位置参数即全量收集），由调用方
  明确点名；「谁都没筛过」的意外空集**仍然阻断**（`return 1`），话术里指出另一档是它 ——
  两者在退出码与日志上必须可分辨，否则这一档就成了「静默放行全体」的后门。
- **它复用同一条判决链**：走 `runChunk([], …)`，所以「超时形态 ⇒ 等负载回落 +
  `--no-file-parallelism` 隔离复跑」那一套照样生效，`COMFY_PRECOMMIT_MAX_WORKERS` 也照样认
  —— 全量档不该成为「机器太满」的结论出口。
- **它不接进钩子**：钩子只有增量档。埋进每次提交就是把门禁变成半小时的仪式；
  它与 `pnpm test:full`（`run-tests.mjs --full`，保留 `KNOWN_FAILED_FILES` 那一档，
  用来复现基线失败）是**两件事**，不要互相替代。
- **wide 话术指名它**：`wideFallbackNote()` 的文本里写着这条命令，由
  `tests/hook-affected-launch.test.ts` 两半一起钉（话术里有这条出口 **且** 入口认这个旗标）。

**连带要求：守「钩子自身内容」的判据必须进固定清单**。`.githooks/**` 被改时固定清单是
唯一的执行者，所以这类判据留在「按路径/按字面量引用才会被拉起」的那份用例里 = 零执行者，
而它要拦的动作恰恰就是那次改动。实测（ISSUE #1371）：收录 `tests/doc-check-hook-wiring.test.ts`
之前，`node scripts/affected-tests.mjs --changed .githooks/pre-commit` 给出 17 个用例，
里面**没有**「`doc:check` 这一步还在不在钩子里」那组断言 —— 同一份断言写在
`tests/check-doc-references.test.ts` 里时，改钩子的那次提交一条都不会跑到。
同族先例：`tests/no-platform-ci-config.test.ts`（平台侧有没有兜底）、
`tests/conditional-skip-registry.test.ts`（每个暗掉的站点都有人登记）。

**在场判据要解析、不要 `toContain`**：把钩子里那一行前面加 `# ` 注掉，行内仍含同一段
字面量，`toContain` 照样命中（实测只有「计数陈述」那条会红）。判据按行首锚定解析 D 组的
`  run "<标签>" <命令>` 行、再断言目标命令在其中 ——「把这一步静音」正是这一族要拦的动作
（同台账 F13「对编译器按下静音键」）。

**代价实测**（16 逻辑核的开发机）：建图 + 解析约 **1.0–1.1s**（读 1.2k 个源码文件、
6.4k 条说明符）。解析出来的面按改动半径线性放大 —— 改一个基元
（`ui/tooltip.tsx`）52 个用例、钩子那批实测 1m40s；改一条链路
（`lib/comfyui/reaper.ts`）83 个用例；改一个只被一块面板消费的筛选条 10 个。
不按耗时取舍：跑多少由**改动的影响面**决定，这正是这一层的定义；嫌慢的出口是把
大改动拆小（本来就该拆），而不是给解析加天花板。
**钩子那一档另配并发**：C 组跑 `--maxWorkers=4`（不是配置里的 8）—— 钩子里
A(tsc)、B(eslint)、D(组内串行的静态判据) 与它并行，再按 8 起 forks 就会抢不过来，
现场不是用例红而是 `Failed to start forks worker / Timeout waiting for worker to
respond`（几百条全过、退出码非零）。全量 `pnpm test` 仍走配置里的 8。这个常数现在
写在启动器 `scripts/run-affected-tests.mjs` 里，不在钩子的那行 shell 上。

**启动面自己也是一条判据面**（`tests/hook-affected-launch.test.ts`，固定清单成员）：
清单是**位置参数**，长度随改动面线性增长。原先钩子直接 `pnpm exec vitest run $files`，
而 `pnpm exec <bin>` 在 Windows 上经 `.cmd` shim —— cmd.exe 的命令行上限是
**8191 字符**。实测一次改 22 个文件的提交算出 229 个用例 / **10840 字符**：vitest
根本没起，stdout 只有一行 GBK 乱码（「文件名或扩展名太长」），钩子的表现是
「组 C 失败」而看不见任何用例名。它的危害不是「提交被拦」，而是**它长得像任何别的
东西**——判据在场、跑的是 0 个用例、退出码非零但原因读不出，与本仓库反复在收的
「绿 ≠ 跑过」是同一族的两面（**红也 ≠ 跑过**）。改法：启动那一步交给
`run-affected-tests.mjs`，用 `spawnSync(process.execPath, [vitest 的 ESM 入口, …])`
直接起（不经 cmd 层，上限回到 Win32 的 32767），并按 24000 字符的预算**分块** ——
**宁可多起一次 vite 也不许丢用例**，因为「少跑几条」的表现正是这一条事故本身。
入口按 `require.resolve("vitest/package.json")` + `bin.vitest` 解析，不写死
`node_modules/vitest/…`：pnpm 布局下真身在 `.pnpm/vitest@<ver>…/`，顶层只是链接。
判据钉四件事：分块后并集等于输入且顺序不变、每块都在预算内（单条路径超预算则**点名红**，
不许静默跳过）、启动器没有 `shell: true` 也不出现 `pnpm exec vitest` / `npx vitest` 形态、
钩子里 C 组确实指向这个入口。最后那条按 `run_group C … sh -c '<body>'` **解析出实调用体**
再断言并剔掉行首是 `#` 的行 —— 就是上一条「在场判据要解析、不要 `toContain`」在本判据上的
落地：机制说明里也写着那个文件名，只看整份文本时「执行行已被静音」与「接得好好的」长得一样。

**这个入口现在还兼一职：负载自适应**（ISSUE #1657 / §13.6.4.1）。本块失败、**且输出带
超时指纹**时，它会先等负载回落、再 `--no-file-parallelism` 复跑同一份清单一次 ——
绿的算过、红的照拦，**不抬任何预算**。所以「带超时指纹的红」不再等于「提交被拦」，
而「真断言红」一次都不复跑（这是这一档最该守住的方向）。返回值形状也据此变了：
`spawnVitest` 把输出**抓在手里**（`encoding: "utf8"`）再原样回吐，而不是 `stdio: "inherit"`
—— 抓不到输出就没有任何东西能区分「真断言红」与「机器太满」。判据由同一个测试文件
（现 27 条）钉住，其中「整条判决链」那一节用**注入的假 spawn / 假负载**把五条路径各跑一遍
（两向都断退出码），不是只断源码形状。

判据由 `tests/affected-tests.test.ts` 钉住（20 条，实测 `pnpm exec vitest run` 的读数；
这个数没有判据核，改完数量要顺手同步这里）：四条判据各一组夹具、**两跳
传递**与 barrel 转出口（含「没转出去的 sibling 不算消费」这条反面）、被删文件的
消费方仍被拉起、公共地基的放弃收窄、**结果永不为空**（空参数会让 `vitest run`
跑成全量）、固定清单每个文件真实存在、`isTestPath` 与 `vitest.config.ts` 的
`include` 不漂移。

##### 13.5.8.1 共享机上 C 组为什么慢、慢多少、杠杆在哪（ISSUE #1648）

**结论先说**：C 组在共享机上「吃并发」是**墙钟**问题，不是「预算被顶穿」问题 ——
它的重型用例都带显式预算（§11.13 的口径：按实测登记，不撞默认档），实测到
**16 倍核超订都没有一条红**。这张表是同一份 C 组（67 文件 / 685 例）在同一台
8 逻辑核机器上、只改机器负载的读数：

| 机器负载 | C 组墙钟 | 判定 | 单条最慢（非预算档）           |
| -------- | -------- | ---- | ------------------------------ |
| ≈0       | 19.7s    | 全绿 | `tw4-canonical` 拒涨 8.2s      |
| ≈16      | 114.5s   | 全绿 | 同上 69.3s（`CLI_BUDGET` 120s） |
| ≈65      | 214s     | 全绿 | 同上 69.3s · `--report` 36.6s  |
| ≈128     | 229s     | 全绿 | 同上 69.3s                     |

两点值得记住：① **慢是成比例的，不是某个用例坏了** —— 门禁用例普遍真起子进程
（Node / git / prettier / Tailwind 引擎 / tsc），它们与 A/B/D 争的是同一样东西：
核；② **占用率最高的一格是 `tests/ratchet-update-guards.test.ts`**（load ≈65 下
210s，占 C 组总墙钟约一半），它的 tw4 那一对每次提交要起 8 次 Tailwind 引擎
（每次约 2s 的首次 class list 构建，按进程付，跨不了进程）。

**杠杆：降预算不行、降并发也不行（都实测过）。**

| 动作                                | 读数                                                       | 结论           |
| ----------------------------------- | ---------------------------------------------------------- | -------------- |
| 抬预算                              | §11.13 / §13.6.4 明写不许                                   | 不做           |
| C 组 `--maxWorkers=2`（负载 ≈20）   | 120.0s vs `=4` 的 **73.2s**                                 | **更慢**，不做 |
| 整条钩子四组改串行（负载 ≈25）      | 全部完成但 ≈460s（不是零收益，但也没换来「不超时」）        | 不做           |
| 降**绝对成本**（本条与 §13.5.8.2 共同的杠杆） | 找不到语义等价的减法（tw4 两格各自都要真跑，§11.25 的六步） | 见下           |

**那共享机上的人怎么办**：钩子的并发此前**写死 4、没有覆盖口** —— 文件头那句
「机器紧张把 C/D 也挪成串行即可」只是一句话，没有执行者，于是唯一的出路变成改钩子
或 `--no-verify`（两条都不该是常态）。现在 `scripts/run-affected-tests.mjs` 认一个
**只调并发、不碰任何判据**的环境变量：

```sh
COMFY_PRECOMMIT_MAX_WORKERS=1 git commit …   # 机器被别的东西占着时
```

缺省仍是 4，非法值（非整数 / <1）按默认办并打一行提醒 —— **不静默降级成 0**
（那会让 vitest 报一个与真因无关的错）。⚠️ 它**不是「让慢用例过关的旋钮」**：
候选清单、每条预算、退出码口径一个字不变，调小只会更慢；它解决的场景是
「机器已经被别的进程占满、连 4 份 forks 都排不进调度」，那时把它压到 1
至少让**每一条自己**跑得完（口径同 §13.6.4：降负载的杠杆是并发，不是预算）。

**为什么不把 tw4 那一对搬出固定清单**（本轮量过、结论是「不搬」）：固定清单的门槛
是「**全库级不变量**」（§13.5.8），而 `tests/ratchet-update-guards.test.ts` 里
**廉价的那一半**（`discoveredBaselines()` 的三表双向核对、文本判据）确实是全库级
不变量；**贵的那一半**（每家的六步行为证明，含 tw4 的 8 次引擎启动）守的是**某一家的
实现**，看起来该走 `COVERED_LOCALLY`。但搬过去只是把成本挪到另一份固定清单成员上
（`tests/tw4-canonical-ratchet.test.ts` 故意只做**静态**事实、文件头写明「真跑红/绿的
现场在 ratchet-update-guards」），总墙钟不减、判据覆盖面反而多一处接缝 —— 所以不动它。
**那一刀后来去量了，结论是「不存在」，这里把账留下**（ISSUE #1679）：上面那句
「让两格共用一次引擎启动」是**当时没量时的方向**，实测不成立。它假设那 8 次里有
可摊平的部分，而真相是 **8 × 一个不可摊平的常数**：

| 量的是                        | 读数                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------- |
| `import "tailwindcss"` + `loadDesignSystem()` | **17–19ms**（引擎**不**随 import 或建 ds 预热）                          |
| 第一次 `canonicalizeCandidates([…])`           | **1.83–1.88s**（全量类名表在这一步才建）                                 |
| 之后同实例再问                                 | **0ms**                                                                  |
| 空沙箱（`src/` 里只有 1 个 token 的一条违规）  | 单次 `--check` 仍 **1.85s** —— 那 1.85s 与「问了多少条」无关 |

两格的每一次（`--update` / `--check` / `--update`）都**必须**问引擎，没有一次是
空跑；而每格用 `createGateRepo()` 搭一份**新沙箱**、起一个**新进程** —— 引擎的状态
跨不了进程，也跨不了沙箱（`4.3.3` 的 `lazy` 是模块级 `new WeakMap()`）。所以
「共用一次启动」在一格**内部**无对象可共（同一格自己就起 4 次进程）。

**本轮逐条试过、逐条被实测否决的三个方向**（都别再走一遍）：

| 方向                                       | 实测                                                                                                                       | 为什么否决                       |
| ------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------- |
| 按「形状」把 token 收窄后再问引擎           | 18914 → 2570 条过引擎，**总时长 4.0s vs 3.9s**（无收益）；且对抗性探针证明任何「值形状」判据都是假的：`rotate-[45deg]` / `delay-[200ms]` / `bg-[#fff]` / `w-[var(--x)]` 全都能被改写 | 判据不完备 ⇒ 静默漏报，收益≈0     |
| 批量化 `canonicalizeCandidates`             | 快 700×，但返回数组会因**去重**而整体错位（18914 条进、18913 条出，从第 3388 项起把 `z-200` 配给了 `hover:z-50`）           | 按索引 zip = 凭空建议（该文件已记过这条） |
| 预热候选（「把 1.6s 挪到扫描前」）          | 总时长不变 —— 那 1.6s 是**绕不过的工作**，只是换了位置                                                                       | 无收益                           |

**结论**：这一格的绝对成本**降不动**，它买的是「21 个棘轮的 `--update` 都真拒涨」
（台账 E5 那条横切判据）。要动它就得动判据强度 —— 那是 §11.25 六步里过不去的一步，
所以维持现状。**共享机上唯一的杠杆仍是上面那个环境变量**（降并发，别抬预算）。

**C 组的墙钟不由任何单份决定 —— 它是「总 CPU 时间 ÷ worker 数 + 调度空洞」（ISSUE #1747「C 组第五笔账」）**

上面那张表回答了「为什么慢、慢多少」，但**没有回答「降单份有没有用」**。本轮把这个问题
量到了底，结论是反直觉的：**降任何单份的时长都不会改变 C 组墙钟，除非那份同时降低了
总 CPU 时间**。实测（8 核、热缓存、固定清单 77 份 / 867 例）：

| 口径                                          | 读数                                                          |
| --------------------------------------------- | ------------------------------------------------------------- |
| 总 CPU 时间（`--maxWorkers=1`，近似纯计算量） | **66.8s**                                                     |
| 4 worker 的**理论下界**（66.8 ÷ 4）           | **16.7s**                                                     |
| 钩子档实测墙钟（`--maxWorkers=4`）            | **21.5–23.4s** ⇒ **调度空洞 ≈6.5s（约 30%）**                 |
| 未改前的 `ratchet-update-guards`（单份）      | 21.8s，**0.0s 开始、21.8s 结束 —— 独占一个 worker 到底**     |

**两个实测反例**（都做过、都留账，别重复走）：

1. **降单份的绝对值，墙钟不动**：`tests/ast-gates-aggregate.test.ts` 把「全量 `src/`
   逐字节对拍」换成「临时仓库 + 违规探针」之后，这一份 **6.6s → 2.6s（省 4s CPU）**，
   而 C 组墙钟 **23.4s → 23.2s**（噪声级）。原因就是上面那行下界公式 —— 省掉的是
   某一份的时长，不是总 CPU 时间里那份**空闲 worker**。
2. **拆文件只换分配，不换总量**：把 `ratchet-update-guards`（21.8s）按「tw4 那一家
   ≈16.6s vs 其余 13 家 ≈5.2s」拆成两份文件、甚至把 tw4 两格再拆成两份，
   **单跑确实各降**（两格同文件 13.2s → 两文件并行 8.0s），而 C 组墙钟
   **拆前 22.4s ≈ 拆后 22.5s**（三组读数各自取中位数）。
   拆开的收益被「剩下的用例少了一个 worker 可排」精确抵消 —— 与 §13.5.8.2 那句
   「并发只是把同一批核重新分配一次」是同一件事的另一个面。
   **所以那一轮拆分没有落地**（3 个新文件换 0 收益 = 纯复杂度）。

⇒ **C 组剩下的杠杆只有两条**，且都已经被量过：

- **降总 CPU 时间**（66.8s 这个分母）：§13.5.8.1 已逐条证明 tw4 那 12.9s 是
  **不可摊平的真工作**，这一格「降不动」；
- **抹平调度空洞**（6.5s）：它来自**长尾** —— 最长的几份（`ratchet-update-guards`
  21.8s、`ast-gates-aggregate` 6.6s、`a11y-axe-stories` 5.9s）在末尾占不满 4 个
  worker。**提高并发解不了**（实测 `--maxWorkers` 4/5/6 → 23.8/23.3/24.3s，
  与 §13.5.8.2 的结论一致：核就那么多，多开只是重新分配）。

**共享机上唯一还能兑现的仍是那个环境变量**（`COMFY_PRECOMMIT_MAX_WORKERS`，
降并发让「每一条自己」跑得完），以及——**把大改动拆小**：C 组的时长由改动面决定，
一次改一个基元（142 份 / 1705 例 / 实测 44.2s）和只加一个 changelog 碎片
（77 份 / 867 例 / 实测 23.4s）不是一回事（§13.5.8 末尾那句同源）。

**「拆小」这条后来补上了执行者与一组可复核的读数**（ISSUE #1747 的第七笔账）。
在此之前它只是一句话：提交的人拿不到「这次多大、哪一刀最值、拆完能省多少」，
而**没有这三件的建议不会有人照做**。

先把「改动面 → 墙钟」这条关系坐实（8 核、热缓存、机器空闲、同一份检出，
`--maxWorkers=4`，固定清单 77 份是每档共有的底）：

| 改动面 | 清单份数（固定 + 受影响） | C 组墙钟 |
| --- | --- | --- |
| 只加一个 changelog 碎片 | 77 + 0 | **28.3s** |
| `sheet.tsx`（只被几处消费） | 77 + 10 | ≈30s |
| `tooltip.tsx`（一个基元） | 77 + 65 | **57.7s** |
| `button.tsx` | 77 + 106 | **71.2s** |
| `core/repository.ts` | 77 + 134 | **63.1s** |
| 5 个枢纽文件 | 77 + 227 | **90.1s** |

分界很清楚：**受影响份数 60 以上的那一档全部翻倍**（28s → 55s+），而 60 以下与
「没改代码」没有区别。这个 60 因此是仓库**自己的数据**划出来的，不是拍的整数。

**归因是这条建议的实质**：改动面不是一个数，它是一组**贡献极不均衡**的数 ——
上表最后一行那 227 份里，`src/lib/endpoints.ts` 一个就占 173，另外四个加起来不到
四分之一。不知道这件事，「拆小」就是盲拆。所以 C 组跑之前会打一段读数，逐条点名
「哪个改动文件把面撑大了」、标出最大的一刀，并给出「拆开之后剩多少」的**估算**。

**这条建议的四条口径**（都由 `tests/commit-scope-advice.test.ts` 逐条钉住）：

1. **只提示、不阻断**。大改动有时**不可分**（一次接口重命名天然横跨几十个文件）——
   这是**代价**问题，不是正确性问题，把代价伪装成结论就错了（同 §13.5.8.1 对
   「抬预算 / 抬并发」的边界）。
2. **只在面大时打**。阈值是上面那个 60；面小时一次都不该出现，否则它变成每次提交
   都刷的噪声，而噪声不会被读。
3. **「剩下多少」必须自认是估算**。归因给的是「单独改它一个会跑多少份」，同一份测试
   常被多个改动文件共同拉到，所以 `总受影响 − 最大那个` **只会偏大**。说成精确值就是
   给一条对不上的账（同 §13.5.8.2「不伪造绿」）。
4. **在起 vitest 之前打**。它讲的是「这次的代价」，而一条真断言红会把收尾段整个截断
   —— **真红的时候恰恰更该看到这个数**（本轮实测踩到过：探针触发一条真门禁，
   放在收尾的建议一次都没印出来）。

**归因的数与主链必须同源**，这是这条链最容易做坏的一格：第一版另写了一份「这个文件
拉到哪些测试」的判定，实测 `--attribute` 报 180 / 67 / 3，而主链报 173 / 65 / 2 ——
差在「按路径引用」那一档（主链只对增量面里尚未被其他原因选中的测试做字面量匹配）。
多报几份看着无害，实际是给了一条**对不上账**的建议。现在的做法是：归因**逐文件调用
同一条判定链**（`resolveAffectedTests`，图通过参数注入、只建一次），所以它的数
**结构性地**与真正要跑的清单一致 —— 用两条用例钉：一条拿夹具逐文件与主链对拍
（拦「两处漂开」），一条拿能手算的夹具把期望值写死（拦「两边同时错」—— 只对拍的话
后者是瞎的，实测把「按路径引用」整体跳过时对拍照样全绿）。

**「tw4 那两格降频」与「55 份小用例合并」这两个方向后来也各量了一次，两条都被实测否决**
（ISSUE #1747 的第六笔账，见下 §13.5.8.2 末尾）：tw4 的 `canonical` 那一格 7.5s 是
**每进程 1.6–1.8s 的引擎冷启**（与问了多少条无关），降频等于废掉 §11.25 的六步行为证明；
55 份小用例合计只值 **≈1.5s**，且它们本来就被长尾（`ratchet-update-guards` 16.8s）
留下的**空闲 worker** 吃掉，**合并到 8 份实测墙钟零变化**。

##### 13.5.8.2 D 组**不并发** —— 结论与账（ISSUE #1610 / #1619）

**结论：不做。** D 组（其余静态判据）组内**保持串行**，这条是有意取舍、量过之后定的，不是没想过的直觉。

| 场景                                | wall     | 峰值 RSS               |
| ----------------------------------- | -------- | ---------------------- |
| D 组**隔离**跑（判据串行）          | 20.3s    | 484MB                  |
| D 组在**真钩子**里（与 A/B/C 并行） | **≈44s** | —                      |
| 整条钩子热跑                        | 69～73s  | **5.27GB**（16G 机器） |

**为什么隔离档的 20s 在真钩子里变成 44s**：那 20s 是「8 核闲着、并发吃掉 idle 核」时的读数。真钩子里 C（4 个 vitest worker）+ A（`tsc`）+ B（eslint）**已经把核占满**，D 再并发只是把同一批核重新分配一次 —— 实测四组数字（44.7 / 43.6 / 44.1 / 43.6s）对 44.3s，**wall 净零**，而峰值照涨 0.3GB。

**并发的收益为什么在这里兑现不了**：钩子时刻表上 `C vitest 0→67.5s` 与 `D 判据 0→69s` 是**并列的两堵墙**。只并发 D ⇒ 墙切到 C、≈0 收益；只降 C ⇒ 墙切到 D、≈0 收益。**只有两者一起降才兑现** —— 而这条结论只负责 D 这一半。

**那 D 组的成本靠什么降**：靠「每条判据自己别做无用功」，不靠并发编排。本轮的实际例子是 `check-reformat-only.cjs`（§13.5.9 之前那一节）：它此前把 prettier 说 `(unchanged)` 的文件**全部**退回逐文件 `stdin` 兜底，59 个改动文件里 49 个是这一档 —— 白跑的 ~13s 正是 D 组最大头。把 `(unchanged)` 读成**结论**之后该步 28.1s → 5.7s，**结论一个字没变**（ISSUE #1633）。

**共享可写路径不是这一格的拦路石**（#1619 §2 点名的两条，实测只有一条是真的）：

| 判据 | 真相 |
| --- | --- |
| `check-known-failed-stale.mjs --self-test` | **真实竞态** —— 往仓库根 `tests/` 写**固定文件名**探针（实测共存 1.8 秒），而 `tests/**/*.test.ts` 正在 C 组 vitest 的 `include` 面里。当前没炸只是因为时间窗够窄 |
| `check-reformat-only.cjs` | 用 `mkdtempSync`，**本来就隔离**，不需要动 |
| 其余 20 余条 | 写盘**全在 `--update` 档**（人的动作，不在钩子里），check 档一条都不写 |

⇒ 真要做也只该按 #1608 给 `check-a11y-rules.cjs` 加 `--ledger <path>` 的**同一招**（临时路径入参），而不是先造一套并发编排。**但结论仍是「不做」** —— 并发的收益本来就不在这堵墙上兑现。

**给下一个人的话**：`隔离跑 / 本地体检`可以并发（4 是实测最优档，8 更慢更占内存），但**不要**为了「让 D 看起来快」去动钩子里的串行 —— 那样只会把同一批核重新分配一次。真要再降 D，先问「这条判据有没有在白付」，而不是「它能不并发跑」。

**上面那句「每条判据自己别做无用功」的第二笔账（ISSUE #1747）**：D 组里最贵的两步
都是**全库扫描**（实测热缓存，8 核，56 步合计 ≈18.9s）：

| 判据                                    | 热跑（全库） | 扫描面（实测）                                    | 加 `--staged` 后（不在面内） |
| --------------------------------------- | ------------ | ------------------------------------------------- | ---------------------------- |
| `check-ui-primitives.cjs`（D 组最贵）   | **3.6s**     | 五条扫描根全在 `src/` 下（`SCAN_DIRS`）           | **~30ms**（只读 git）        |
| `check-format.cjs`                      | **2.9s**     | `src/**` 1586 份 + `.storybook/**` 10 份（=1596） | **~30ms**                    |
| （该步冷缓存）                          | 17.6s        | 同上                                              | 同上                         |

两步合计**占 D 组的 34%**。而它们的扫描面都**只是全库的一个子集**：`check-format.cjs`
的 `GLOBS` 连 `.md` 都不收、`IGNORE_GLOBS` 又剔掉 `scripts/` `tests/` `tools/` `e2e/`
`public/` `docs/{api,generated}` `src-tauri/target/**` 与根级 `*.js` / `*.config.*`
（`git ls-files` 跟踪 5940 份，落在面内的只有 1596 份）。于是「只加 changelog 碎片 /
只改文档 / 只动 `scripts/` 或 `tests/`」这一大类高频提交，在这两步上**白付 6.5s**。

**改法与三条口径**（与 `check-docs-api.cjs --staged` / `check-deps-freshness.mjs --staged`
同源）：

1. **判据面由既有配置现算，不抄第二份目录清单**。`check-format.cjs` 过
   `GLOB_RES` + `IGNORE_RES`（就是 `GLOBS` / `IGNORE_GLOBS` 的两条正则）、
   `check-ui-primitives.cjs` 把 `SCAN_DIRS` 交给共享件。抄一份就会漂，而漂移的形态是
   静默的：抄的那份多收一个目录，那类文件的违规从此没人查（§12.12 / §12.18）。
   「读暂存清单 + 判前缀 + 跳过话术 + fail-closed」这套四件套收进
   **`scripts/gate-scan-read.cjs` 的 `skipUnlessStagedTouches()`**（与 `walk()` 当年
   收进同一处同一个理由）—— 实测全仓有 9 处各自手写 `git diff --cached --name-only`，
   这一层是它们的共同地基。
2. **跳过是结论，不是沉默放行**。两步都打印「本次提交未触及扫描面，跳过」，与扫过
   之后的输出在形态上可分辨（§11.23 的「声明 ⇄ 读者」）。
3. **只跳过 check 档**。`--report` / `--update` 是人的动作，照旧全库 —— 否则收紧基线
   会按残缺清单记账。

**实测两端**（同一份检出、同一台 8 核机）：两步合计在「暂存里没有扫描面内文件」时
**7.1–7.3s → 0.4s**（省 ≈6.8s）；「暂存里有 `src/` 文件」时 **7.2–8.1s ≈ 7.2–8.1s**
（多一次 `git diff --cached` 的读，噪声级，无回归）。判据强度一个字不放松 ——
触发面就是「有文件落在扫描面内」，而**只要有一个**就照旧扫全库。

**第三笔账：第二梯队 14 步也各扫一个固定子集（ISSUE #1747 续）**。上面两步是「最贵的
两步」，但它们不是唯一「扫全库的一个子集」的判据 —— 第二梯队 14 步的扫描面全是**固定
前缀**，单项 0.27–1.85s，合计 **≈8.5s**（实测热缓存，8 核）：

| 判据                                          | 扫描面                                              | 热跑（全库） |
| --------------------------------------------- | --------------------------------------------------- | ------------ |
| `check-a11y-rules.cjs`                        | 读 eslint 配置（不进这一轮）                        | 1.85s        |
| `check-ts-duplicate-keys.cjs`                 | `src/**`                                            | 1.23s        |
| `check-non-null-assertions.cjs`               | `src/**`                                            | 1.09s        |
| `check-react-updater-purity.cjs`              | `src/**`                                            | 1.02s        |
| `check-click-keyboard.cjs`                    | `src/**`（`.tsx`）                                  | 0.78s        |
| `check-code-duplication.cjs`                  | `src/**`                                            | 0.72s        |
| `check-form-field-wiring.cjs`                 | `src/**`（`.tsx`）                                  | 0.71s        |
| `check-dead-exports.cjs`                      | `src/lib` + `src/trpc` + 语料 `src`/`scripts`/`e2e` | 0.36s        |
| `check-void-floats.cjs`                       | `src/lib/**`                                        | 0.59s        |
| `check-function-length.cjs`                   | `src/**`                                            | 0.35s        |
| `check-overlay-z.cjs` / `check-title-bar-clearance.cjs` | `src/components` + `src/app`               | 0.27 / 0.09s |
| `check-import-alias.cjs`                      | `src` + `e2e`                                       | 0.17s        |
| `check-circular-deps.cjs`                     | `src/**`                                            | 0.15s        |
| `check-inline-style.cjs`                      | `src/**`                                            | 0.09s        |

它们的扫描面**都只是全库的一个子集**（`git ls-files` 跟踪 5952 份、`src/**` 的
`.ts/.tsx` 只有 1078 份），而**只加 changelog 碎片 / 只改文档 / 只动 `scripts/` 或
`tests/`** 这一大类提交根本不在靶子里 —— 实测占最近 60 次提交的 **57%（34/60）**。
14 步各加一档 `--staged`（同一个 `skipUnlessStagedTouches()`，同一个口径），
这一大类提交在它们上面省的 **≈8.0s** 是白拿的。

**这一步实测过、也确实踩到的两个坑（都写进接线判据了）**：

1. **短路点必须在重活之前**。第一版把 `skipUnlessStagedTouches()` 放进 `main()`，
   实测「跳过」档仍要 **211–342ms** —— `require("typescript")` 的模块加载 ≈180ms、
   `check-dead-exports.cjs` 的语料预加载 IIFE ≈340ms 都发生在 `main()` 之前。
   把短路提到它们**前面**之后降到 **32–40ms**。退出码看不出这个差别（两边都是 0），
   所以只能钉在接线判据上：短路行号必须小于该脚本里第一条真 `require("typescript")`。
2. **扫描根常量会被 TDZ 卡住**。「把短路提到 `require("typescript")` 之前」意味着
   它也要提到 `const SCAN_DIR = "src"` 之前 —— 第一版有一半脚本在跳过档直接
   `ReferenceError: Cannot access 'SCAN_DIR' before initialization`。修法是把扫描根
   常量一并上提（它们本来就是配置，没有依赖）。

**实测两端**（同一份检出、8 核、热缓存）：这 14 步在「暂存里没有扫描面内文件」时
**8.5s → 0.5s**（含进程启动，每步 ≈35ms）；「暂存里有 `src/` 文件」时逐条复核
**14/14 照旧真扫**（其中 `check-overlay-z` / `check-title-bar-clearance` 只认
`src/components` + `src/app` —— 只改 `src/lib` 的文件跳过它们是对的，用 `src/app/**`
的探针复核过确实真扫）。判据强度一个字不放松，`--report` / `--update` 照旧全库。

**接线判据**（`tests/doc-check-hook-wiring.test.ts`）：14 步逐条钉「钩子里带
`--staged`」+「脚本真的实现了它」+「短路在重活之前」。抹掉任意一条，
**没有任何别的判据**会看见差异 —— 它只会让每次提交慢一点，慢不会让任何人报错。

**第四笔账：6 份 AST 判据各自把 `src/` 全量解析一遍（ISSUE #1747 续）**。上面两笔账
治的是「扫描面只是全库一个子集」⇒ 输入面跳过（`--staged`）。**这一笔性质不同**：改到
`src/` 的提交里文件**真在面内**，`--staged` 对它完全无效；而 6 份判据判的是**同一批
文件**（`src/**` 的 `.ts`/`.tsx`，实测 1082 份 / 7.3MB），每份各自
`require("typescript")` + `walk` + `readFileSync` + `createSourceFile` 全量走一遍。
省的是**计算重复**，不是代码重复。

实测（8 核，热缓存，同一份检出）：

| 口径 | 读数 |
| --- | --- |
| 6 个独立进程（改前） | `681+629+627+451+462+348` = **3198ms** |
| 一次 `walk`+`read` | 35ms |
| 一次 `createSourceFile` 全量（1082 份） | **≈550–800ms** ← 大头 |
| 各判据自己的 AST 遍历（62 万节点） | **≈52ms / 遍**，6 遍 ≈318ms |
| 聚合档（一次解析 + 6×遍历） | **≈1.3s** |

**共享颗粒度：只共享解析产物（`SourceFile`），不共享遍历、更不共享判定。**

- **共享**：`SourceFile` 是 `createSourceFile(fileName, text, target, kind)` 的**纯函数
  产物** —— 同一份文本 + 同一个 `ScriptTarget`/`ScriptKind` ⇒ 逐位相同，共享它
  **不引入跨判据的状态耦合**。
- **不共享遍历 / 判定**：`visit` 是每条判据自己的规则语义。把它一起共享，六条规则就
  混进一个遍历器 ——**改一条的豁免要重读另外五条**（与 §13.5.8.2 那句「缓存的是纯函数、
  不是『某条规则的计数』」是同一条边界）。实测全遍历只 52ms/遍，**不值得动**。

**落点是单进程聚合，不是磁盘缓存**：`SourceFile` 是不可序列化的大对象（1082 份 /
62 万节点），落盘 + 反序列化比重新解析更贵。

**形状：两条腿，判据强度一个字不放松。**

1. **6 份判据仍是独立可跑的脚本**（`node scripts/check-*.cjs`）——黑盒契约、单独退出码、
   单独 `--report` / `--update` / `--staged` **逐字节不变**（用改前脚本对拍过：默认 /
   `--json` / `--with-tests` / `--report` / `--staged` 五档 stdout 相同、退出码相同）。
   每份拆成「**规则本体**（吃已解析的 `SourceFile`）」+「判定」两半，规则本体供聚合档用。
2. **新增聚合档 `scripts/run-ast-gates.cjs`**：一个进程里 `walk`+`read`+`parse` 一次，
   注入给 6 条判据各自的 `main(parsed)`。钩子 D 组那 6 行换成这 1 行（D 组 56 → 51 步，
   计数陈述同步）。

**判定代码一行都不重写**（这是本档最容易做坏的一格）：聚合档用
`captureProcessExit()` 接住各判据的 `process.exit`、`captureOutput()` 接住它的
stdout/stderr，于是**它的判定代码原样执行、打印的每一个字也由它自己写**。重写一遍就是
孪生实现（§12.12），而漂开的形态是静默的：聚合档说绿、单条脚本说红（或反过来），
**没有任何判据会看见**。

**三条不许松的口径**：

1. **每条判据都必须真跑**：任一条红 ⇒ 聚合档 rc 1 且**继续跑完其余各条**（不被第一处
   `process.exit` 打死 —— 那会让后面几条一条都不跑，而「少跑几条」没有任何判据会看见），
   并逐条点名 + 给单条复验命令。
2. **人的动作不走聚合档**：`--report` / `--update` / `--json` / `--with-tests` 一律仍跑
   **单条脚本**（rc 2 拒绝）—— 收紧基线要按单条记账，混在一起会写错账。
3. **`--staged` 短路仍按条判**：6 条的扫描面不同（`check-void-floats` 只认 `src/lib`、
   其余认 `src`）。`loadGate()` 在 **argv 里没有 `--staged` 时** `require` 各判据 ——
   否则判据模块层的 `skipUnlessStagedTouches()` 会在 `require` 当场 `process.exit(0)`，
   把整个聚合档打死。短路判断提升到聚合档按条算；**全不命中则一次解析都不做**
   （不先解析再跳过，与原 `--staged` 同一条口径）。

**实测两端**（8 核、热缓存）：改到 `src/` 时 **6 条单跑合计 3198–3913ms（随机器负载浮动）
→ 聚合档 ≈1.2–1.3s**（省 ≈1.9–2.7s）；暂存全不在面内时 **≈40ms**（一次解析都不做）；
`src/app/**` 在面内、`src/lib` 不在时 **只跑 5 条 + 1 条打「未触及扫描面」**（逐条复核过）。

**接线判据**（`tests/ast-gates-aggregate.test.ts`，8 条）：`--list` 清单与 GATES 表一致、
**聚合档输出与 6 条单跑各自输出逐字节相同**、6 条逐条真跑（不是数个数）、有红时继续跑完
其余各条、抛异常按红算、`--staged` 全不命中则零解析、人的动作被拒、**钩子里 6 条单条脚本
不再各占一行**（否则等于跑两遍）。变异实测：从 GATES 表删一条 ⇒ 3 条用例红；
把 `--staged` 短路写坏 ⇒ 1 条用例红。

**第六笔账：两个「看起来能省」的方向都被实测否决 —— tw4 那两格不能降频，48（现 55）
份 <300ms 小用例不能靠合并省墙钟（ISSUE #1747 续）**。这两个方向是上一轮结尾「我有两个
方向可选、按规矩该您拍板」的那两条，本轮把它们量到了底，**两条都不落地**，账留在这里。

**（一）tw4 报告的拒涨两格：必须每次提交都真跑 —— 它降不了频，只能降成本（降不动）**

先分清**两格的成本根本不对称**（同一个 `RATCHETS` 表里，三格读数差 30 倍）：

| 格 | 四次 spawn 的读数（8 核，热缓存） | 为什么 |
| --- | --- | --- |
| `tw4-canonical-report.mjs` 第一格（六步里的 ①–④） | `1928 + 1865 + 1940 + 1817` = **7553ms** | 违规样本 `!bg-subtle` 真问引擎 ⇒ **首次 `canonicalizeCandidates` 付 1.6–1.8s** |
| `tw4-canonical-report.mjs` 第二格（基线清到 0） | （上表两次） | 同上 |
| `tw4-spacing-canonical.mjs` 两格 | `56 + 52 + 50 + 45` = **206ms**（第二格 `220+180`） | 沙箱里**没有任何 px 任意值候选** ⇒ `TOKEN`/`PX_VALUE` 正则当场早退，**一行都没问过引擎** |

**那个 1.6–1.8s 是本轮的实测根因，且与「问了多少条」无关**：`import "tailwindcss"` 只
**8ms**、`__unstable__loadDesignSystem()` 只 **15–26ms**（引擎**不**随 import 或建 ds 预热）；
第一次 `ds.canonicalizeCandidates([…])` 或 `ds.candidatesToCss([…])` **1.6–1.8s**（全量类名表
在这一步才建），**之后同实例 0ms**。空沙箱（`src/` 里只有一个 token）单次 `--check` 仍 **1.9s**
—— 那 1.9s 与问了多少条、有没有违规**都无关**（干净沙箱实测 `1992/1799/1934ms`）。

所以两格的每一次运行**都**必须起一个**新进程**（每格 `createGateRepo()` 搭新沙箱）、
**都**要问引擎、**都**付那 1.8s —— 引擎状态跨不了进程，也跨不了沙箱。**「共用一次启动」
在一格内部无对象可共**（同一格自己就起 4 次进程）。这一格「降不动」与 §13.5.8.1 那句
「tw4 那 12.9s 是不可摊平的真工作」是同一件事的第二次取证。

**为什么降频（搬出固定清单 / 只跑一次）不成立**：这六步守的是**全库级不变量里最贵的那条**
—— 「21 个带 `--update` 的棘轮**都**真拒涨」（§11.25 / 台账 E5）。六步里 ①–④ 是**行为证明**
（夹具不是空转 / 退出码含义 / 真在计数 / 拦下且不落盘），⑤ 是「基线清到 0 时也不许放宽」
（`if (before && …)` 的短路失效），⑥ 是「拒涨那句话给出可执行的下一步」。**五步缺一不可、
且每一步都只在「下一次有人改这个脚本」时才拦得住** —— 降频 = 把「回潮就响」变成「下次
想起来了才响」，而那正是 §13.5.12 立案的那一族（`check-comment-language.cjs` 自称在跑、
一个执行者都没有）。**搬去 `COVERED_LOCALLY` 只是把成本挪到另一份固定清单成员上**
（`tests/tw4-canonical-ratchet.test.ts` 故意只做静态事实），总墙钟不减。⇒ **维持现状。**

**（二）55 份 <300ms 的小用例：合并省不出墙钟 —— 它们被长尾的**空闲 worker**吃掉了**

先纠正一个读数：**不是 48 份，是 55 份**（清单会长，别在文档里写死，以判据现算为准）。
固定清单 77 份 / 854 例的分布（`--maxWorkers=1` 逐份 time 实测）：

| 分档 | 份数 | 例数 | 逐份时长之和 |
| --- | --- | --- | --- |
| **<300ms** | **55** | 543 | **4.8s** |
| ≥300ms | 22 | 311 | 40.6s（其中 `ratchet-update-guards` **单份 16.8s**） |

**合并在「隔离跑」里确实很快**（受控探针，40 份合成 8 份）：`1.6s → 0.52s`，**3 倍**。
vitest 自己也算得出来那笔账：「`40 workers spawned · ~90ms startup each (spawn + environment,
per file)`」并建议 `isolate: false`。**但它在真 C 组里一分不省**，因为 C 组有长尾：

| 受控探针（同一份 vitest，4 worker） | 墙钟 |
| --- | --- |
| 40 份独立 + 一个 16s 长尾 | **16.5s** |
| 8 份合并（同样 40 例）+ 同一长尾 | **16.5s** |
| 20 份独立 + 长尾 | 16.9 / 16.4s |
| 4 份合并 + 长尾 | 16.4 / 16.4s |
| 20 份独立 + 长尾 + `isolate: false` | 16.4 / 16.4s |

**真仓库上同向复核**（固定清单 77 份，`--maxWorkers=4`）：全量 **22.0 / 22.1s**，
**只留 22 份大用例 20.3 / 20.7s** —— 那 55 份小用例**合计只值 ≈1.5s（≈7%）**，
而合并后能兑现的**还不到这 1.5s**（合并省的是「文件调度」，而那批本来就排在长尾的
**空闲 worker** 上：`ratchet-update-guards` 一个人占满一个 worker 16.8s，其余 3 个 worker
把 55 份小用例全部吃完还有余）。⇒ **合并 = 3 个新文件换 ≈0 收益 = 纯复杂度**，
与 §13.5.8.1「拆文件只换分配、不换总量」是同一件事的另一个面。

**附带说一句 `isolate: false`**：探针里它也一分没省（16.4s = 16.4s），**且它是判据强度问题
而不是性能问题** —— 复用 worker 会让**文件之间的模块状态与副作用互相可见**，本仓库大量
门禁用例读真仓库文本、起子进程、写临时目录，跨文件共享 state 的失效形态是静默的
（某一份的副作用让另一份「碰巧绿」）。**不在这里开这个口子。**

**结论**：真正能让「每次提交更快」的仍只有 §13.5.8.1 末尾那两条 —— **把大改动拆小**
（改一个基元 142 份 / 1705 例 / 44.2s vs 只加一个 changelog 碎片 77 份 / 867 例 / 23.4s），
以及机器被占满时的 `COMFY_PRECOMMIT_MAX_WORKERS`（降并发）。**这一格的墙钟由长尾决定，
不由那 55 份决定。**

**第七笔账：上面那条「拆小」被补上了执行者 —— 它此前一直是一句没有读者的建议**
（ISSUE #1747 续）。前六笔账治的都是「同一批工作被重复做」，这一笔治的是**另一类洞**：
一条**写在规范里、却被所有机器路径忽略**的出路（§11.23「声明 ⇄ 读者」那一族的典型）。

**「怎么算拆小」的答案不是「少改文件」，而是「让总 CPU 时间小下来」** —— 而这两件事
在数字上是可分辨的：C 组的墙钟由清单份数决定，清单份数由**受影响面**决定，受影响面
又由「改动的文件被多少测试（直接或间接）消费」决定。实测（8 核、热缓存、机器空闲、
`--maxWorkers=4`）：

| 改动面 | 受影响份数 | C 组墙钟 |
| --- | --- | --- |
| 只加一个 changelog 碎片 | 0 | **28.3s** |
| `sheet.tsx` | 10 | ≈30s |
| `tooltip.tsx`（一个基元） | 65 | **57.7s** |
| `button.tsx` | 106 | **71.2s** |
| `core/repository.ts` | 134 | **63.1s** |
| 5 个枢纽文件 | 227 | **90.1s** |

⇒ **分界落在「受影响 60 份」这个量级上**：往下与「不改代码」没区别，往上立刻翻倍。
60 因此是**本仓库自己的数据**划出来的（见 `SCOPE_ADVICE_MIN` 的文档），不是拍的整数。

**归因（`scripts/affected-tests.mjs --attribute`）才是这条建议的实质**：改动面不是
一个数，而是一组**贡献极不均衡**的数 —— 最后那行 227 份里，`src/lib/endpoints.ts`
一个就占 173，另外四个加起来不到它的一半。**不知道这件事，「拆小」就是盲拆。**

**落点与三条口径**（判据在 `tests/commit-scope-advice.test.ts`，从
`tests/hook-affected-launch.test.ts` 拆出来 —— 两者守的是不同的东西）：

1. **只提示、不阻断**。大改动有时**不可分**（一次接口重命名天然横跨几十个文件），
   这是代价问题不是正确性问题 —— 同 §13.5.8.1「抬预算 / 抬并发」那条边界：
   **代价不许伪装成结论**。判据按源码结构钉住建议那一段里**没有任何 `return`**。
2. **只在面大时打**。判定读的是**已经拿到**的清单份数（不额外起一次 git），
   面小时连归因都不去算 —— 否则每次提交白付一次约 220ms 的图构建。
3. **「剩下多少」必须自认是估算**。归因不可加（同一份测试常被多个改动文件共同拉到），
   所以 `总受影响 − 最大那个` **只会偏大**。说成精确值就是给一条对不上的账
   （同上一节「不伪造绿」）。
4. **在起 vitest 之前打**。它讲的是「这次的代价」，而真断言红会把收尾段整个截断 ——
   **真红时恰恰更该看到这个数**（本轮实测踩到过：探针触发一条真门禁，放在收尾的
   建议一次都没印出来）。

**归因必须与主链同源，这是本档最容易做坏的一格**：第一版另写了一份判定，实测
`--attribute` 报 180 / 67 / 3 而主链报 173 / 65 / 2（差在「按路径引用」那一档 ——
主链只对增量面里尚未被其他原因选中的测试做字面量匹配）。多报几份看着无害，
实际是给了一条**对不上账**的建议。现在归因**逐文件调用同一条判定链**
（`resolveAffectedTests`，`importedBy` 图通过参数注入、只建一次），所以它的数
**结构性地**与真正要跑的清单一致。**钉它的用例要两条**：一条逐文件与主链对拍
（拦「两处漂开」），一条拿能手算的夹具把期望值写死（拦「两边同时错」—— 只对拍
的话后者是瞎的，实测把「按路径引用」整体跳过时对拍照样全绿）。

#### 13.5.9 依赖漏洞扫描棘轮（`node scripts/check-dependency-audit.mjs`，ISSUE #1331）

**它补的是「发现」这一步，不是「修」这一步。** 本仓此前没有任何依赖漏洞扫描（无
`pnpm audit` 门禁、无 dependabot/renovate），`pnpm-workspace.yaml` 里那几条
`overrides` 的注释就是证据：每一次都是「有人恰好发现了 → 手工查传递路径 → 手工写
override → 手工写注释解释为什么」，而**「这次忘了查」没有任何反馈**。实测开立时的
一个例子足够说明问题：`js-yaml` 的修复版 `4.3.2` 早已发布，仓库里躺着 `4.3.1` ——
没有任何机器路径会提醒这件事。

**判据形状三条，都是刻意的**（细则在脚本头，改判据前先读它）：

1. **按 `(包名, advisory id)` 记账，不按计数。** 计数口径下「修好 1 个、引入 2 个」
   要总量变大才失败，而引入的那 2 个无人知晓 —— 与 13.5.1 对「按文件判定」讲的是同一个道理。
   用 advisory id 做键还有个副作用是想要的：同一条漏洞换了引入路径**不算新增**。
2. **双向拦**（与 §12.12 那条台账型判据同口径）：基线外出现新条目 → 红；基线里的条目
   **已经不再命中** → 也红。只写「不许新增」的话，收敛掉一份却把条目留在台账里，
   这张表就失去记账能力。
3. **每条基线必须有 `reason`。** 空 reason 判红 ——「登记了但没人写为什么现在修不了」
   的条目没有记账价值，它只是把红换成沉默。

`--update` **只许降**：可以删掉不再命中的条目，**拒绝把新出现的条目写进基线**（否则
`--update` 就是放宽棘轮的后门，与 13.5.1 / 12.13 同口径）；唯一例外是基线文件不存在时
的首次记账，而它写下的 `reason` 一律为空、随后每一轮都会被判红，直到有人逐条补上原因。
`RULE_VERSION` 管的是「拦哪些严重级」这类**判据口径**变更 —— 旧台账与新判据不是同一个量。

**为什么它不在 `.githooks/pre-commit`，而在 `pnpm check:all`**：这是**网络请求**
（依赖 registry 可达性）。塞进每次提交会把「离线 / registry 抖动」变成提交失败，与
13.5.4「按需召唤」那一层的分层一致。同一条理由决定了脚本内部对三种形态的区分：

| 形态                           | 判定                                   | 为什么                                                         |
| ------------------------------ | -------------------------------------- | -------------------------------------------------------------- |
| 拿到可解析的 JSON              | 正常判定（有无漏洞由台账说）           | ——                                                             |
| 命令起来了但没有 JSON（离线）  | **未扫描**，退 0，话术禁止出现「干净」 | 离线不是「依赖干净」；把它印成绿会把下一次的真红一起吞掉       |
| stdout 不是 JSON / pnpm 没起来 | **判红**                               | 这是判据自身坏了，与网络抖动不同形；静默跳过的判据等于没有判据 |

跨平台侧照 §9.5 的口径三处同步：`scripts/quality-gate.mjs` 的 `GATES`、
`scripts/quality-gate.ps1` 的 `$Blocks` 与 `-Mode` 单选值、上面那张跨平台动作对照表的
一行（`check-ps1-consistency.mjs` 会核对登记的脚本真实存在）。顺带把 `quality-gate.mjs`
里「用 node 直跑门禁脚本」那条分支从只认 `.cjs` 扩到也认 `.mjs` —— 只认前者会把新的
ESM 门禁当成 pnpm 参数送出去。

**PS 侧的既有缺陷（① 本刀修、② 由 #1338 收口、运行器层另立 #1345），记清楚形状**：① `quality-gate.ps1`
**整份脚本此前解析失败** —— 第 56 行那个正则写在双引号串里用了 `\"`，而 PowerShell 的转义符是
反引号不是反斜杠，于是字符串被提前结束；`[Parser]::ParseFile` 在 PS 5.1 与 pwsh 7 上**各报
3 个错**（本机实测），`-Mode` 给什么都进不了脚本体。它由 `fbabbc25` 引入，而**当时没有任何
自动化执行者会去解析 `.ps1` 的语法**，所以这件事一直红不出来。本刀为了验证「两侧清单一致」
这句必须先修它（改单引号串）；现在两宿主都是 0 个 ParserError，且**这类失效有了执行者**
（`tests/quality-gate-ps-precheck.test.ts` 扫 `scripts/` 与 `tools/` 下每份 `.ps1`）。
② 修完 ① 还剩一条挡在前面，已由 **ISSUE #1338** 收口：那条依赖一致性预检比的是
`pnpm-lock.yaml` 与 `node_modules/.pnpm/lock.yaml` 两个文件的 **SHA256 是否相等**，而这两份
文件**本就不同形**（实测 13068 行 vs 12910 行、顶层键顺序不同、根锁文件含 2 个 `---` 文档分隔
而 `.pnpm` 那份没有，且两者由同一次 install 写下、mtime 只差 1 秒）⇒ 预检**恒 FAIL**、
走不到 `$Blocks`；而它下面打印的差异明细用的正是 Node 侧那份语义比较器，结论恰好是
「实质一致」——**同一段里两个结论互相矛盾**。同一个坑 `prepare-local-run.ps1` 早就修对并把
理由写在注释里，只是没被复用到门禁这一处（AGENTS 硬规则 24「写之前先查有没有现成实现」的
反面教材）。现在判决与明细共用 `scripts/lockfile/diff-cli.mjs` 的退出码（0 一致 / 1 实质差异 /
2 判不了），并把**「判不了」与「不一致」分成两条话术**（`[DEP-JUDGE]` / `[DEP-DRIFT]`）——
判据自身跑不起来时 Node 默认退 1，不分开就会把「判据没了」报成「依赖陈旧、去重装」。
修完之后的实测读数：**预检这一半成立** —— 三态各自说话（`[DEP-JUDGE]` / `[DEP-DRIFT]` / 放行），
`-Mode dependencyAudit` 不再停在预检。

**但当时随本刀写下的那句「第一次真的跑到门禁本体」是错的，由 ISSUE #1345 订正。**
错因是证据选错了：`==>` 那行 label 是脚本在 `&` **之前**用 `Write-Host` 打的，进程起没起都会
出现，拿它当「跑到本体」的证据等于钉一个假绿（`tests/quality-gate-ps-precheck.test.ts` 当时
钉的就是同一个弱标记，所以用例跟着一起绿）。走进 `$Blocks` 之后 `Invoke-Check` 还叠着三条
通道，让 `Cmd = "node"` 那两条门禁（`format`、`dependencyAudit`）**不论子脚本做什么都是绿的**：

1. 它给 `^(pnpm|npm|node)$` 一律拼 `.cmd`（`ac62b64d` 引入的假设），而本机 `node` 是真
   `node.exe`、`node.cmd` 不存在（`Get-Command node.cmd` → NOT FOUND）⇒ `&` 连进程都没起。
   对 pnpm/npm 拼 `.cmd` 是对的（裸名会解析到同名 `.ps1`，受执行策略摆布）。
2. `&` 起不来时 PowerShell 只发一条非终止错误、**不写 `$LASTEXITCODE`**，于是下一步读到的是
   **预检那次成功调用留下的 0** ⇒ `[OK] ... passed`、整体退 0。定性证据：同一条命令直跑子脚本
   一定打得出 `[dep-audit]` / `[format]`，而这两行在 PS 侧一次都没出现过。
   （排除了另一种猜测：`$null -eq 0` 在 pwsh 7 是 False，所以那个 0 是陈旧值不是空值。）
3. 子进程的 stdout 默认进函数的输出流，和 `return $code` 拼成数组
   （实测 `Object[] ["child-marker-line", 0]`）⇒ 即便进程起来了，判决也不是纯退出码、
   输出还被吞进变量里看不见（旧形状下 pnpm 那几条门禁的输出同样是被吞掉的）。

现在的形状：命令按 `<name>.cmd` → `<name>` 候选解析，解析不到直接 `[FAIL][GATE-NOEXEC]` 退 127；
调用前 `$global:LASTEXITCODE = $null`（实测两宿主一致：失败启动后仍为 `$null`，成功启动必写
真实码），调用后仍为 `$null` 同样判 `[GATE-NOEXEC]`；子进程输出经 `| Out-Host` 落宿主，返回值
只剩退出码。**口径（可迁移到别的判据）：证明「某一步跑过了」只能拿那一步自己的输出当证据。**
Node 侧 `quality-gate.mjs` 不受这条影响（`result.error` + `status ?? 1`），已核对，不再写第二份。
回归用例见 `tests/quality-gate-ps-precheck.test.ts` 里「运行器真跑」那组。

**首批落地的读数**（2026-10-01 本机）：`pnpm audit --json` 当时报 **10 条
high/critical**（其中 1 条是 `next` 的 **critical**），**全部有同 major 的现成修复版**，
所以走的是「修掉」而不是「登记」：`next` 与 `eslint-config-next` 到 `16.3.8`，
`js-yaml` / `fast-uri` / `undici` / `brace-expansion` 按 major 加 `overrides`
（`brace-expansion` 有两条 major 同时中招，键上必须带 major，写一条全局 override 会把
1.x 的消费方顶到 5.x 的 API 上）。修完重数 **0 条**，台账为空。
**`moderate` / `low` 那 15 条本轮不纳入判据**，理由是台账噪声会淹没真新增 —— 要收窄这个
口径就改 `BLOCKED_SEVERITIES` 并同步 `RULE_VERSION`，别在调用点各写一份。

**`moderate` 那批的现状已由 ISSUE #1623 重收一版**（这是「口径也更新一版」那句的落点，
别只把包升掉就完事）。上一段那句「15 条不纳入判据」在案时**没有区分「修不了」与
「还没人去修」**，而 #1623 实测把它们分开了：

| 那批的构成                                    | 处理                                                                     | 读数                                    |
| --------------------------------------------- | ------------------------------------------------------------------------ | --------------------------------------- |
| **9 条有最小可达修复版**                      | 走 §13.5.9 出路①（`overrides` 升到 registry 给的 patched），**全部升掉** | `pnpm audit` 的 moderate 命中 **9 → 0** |
| 1 条 low（`elliptic`）+ 1 条 high（`braces`） | **无修复版**，留台账（各写了 reason）                                    | 不变                                    |

所以「moderate 不纳入判据」这条口径现在管的是**真的修不了的那一类**，不再是「整档不看」。
这个区分值得记下来：**噪声的来源不是严重级，是「登记了却没人写为什么修不了」** —— 那
9 条有修复版的留在「不判」里，等于让真实可收敛的存量躲在一条噪声论证后面（同 §11.23
那族：**声明写得出来不算数，有人去读、去修才算**）。

顺带量出一条更普遍的教训：`overrides` 的版本号**会被新 advisory 追上**。本批里
`fast-uri@3`（`3.1.7` → `3.1.8`）与 `brace-expansion@1`/`@5`（`1.1.20`/`5.0.11` →
`1.1.21`/`5.0.12`）三条**本来就是 #1331 那一轮填掉的**，而 advisory 库后来把同一个库的
**另一条** advisory 的 patched 提到更高 —— 于是「已修过」的 override 反而落回受影响区间。
**修完不是终点**：`pnpm audit` 每次跑都会重新问一遍，这正是它不进钩子（网络请求）却必须
在 `pnpm check:all` 里跑的理由。

判据由 `tests/dependency-audit.test.ts` 钉住：键的形状、严重级筛选、引入路径按 registry
的**真分隔符**切（裸 `>`，首段 `.` 是工作区根 —— 按 `" > "` 切会得到一整段没人看得懂的
字符串，这是本机跑真 `pnpm audit` 时量出来的）、双向拦、空 reason 判红、`--update` 拒绝
新增且**被拒之后基线文件没被动过**、以及三种 registry 不可用形态各一条。跑真脚本的那几组
用 `--fixture` 喂固定 JSON：把外部 registry 当测试依赖会让这盏灯随上游 advisory 自己变红，
那时红就不可归因了。

#### 13.5.10 引用门禁步骤：写标签，不写序号（ISSUE #1374，签字口径）

**口径**：引用 `.githooks/pre-commit`（或已删除的平台流水线）的某一步，一律写
**日志里打印的标签** —— `── check: <标签>` 那一行的 `<标签>` —— 或直接写那一步跑的脚本名。
**不写「第 N 步」**。

**为什么序号不能用**：钩子早已是「组 0 + A/B/C/D 四个并行组」，「第 N 步」在这份形状上
没有唯一解释。同一批文档里混着两种口径（「branch-guard 算第 1 步」与「判据从第 1 条起算」），
立案时实测的错位：`check-title-bar-clearance.cjs` 写作「第 3 步」而它是 D 组第 4 条、
`check-ui-logic-separation.cjs` 写作「第 3 步」而实际第 5 条、`check-app-port-vectors.cjs`
写作「第 11 步」而实际第 8 条、`check-ui-primitives.cjs` 写作「第 12 步」而实际第 9 条、
`check-overlay-z.cjs` 写作「第 27 步」而实际第 22 条、`render-doc-placeholders.cjs --check`
写作「第 26 步」而实际第 21 条；**另有三处（§12.17 / §18.8）把 C 组固定清单里的用例称作
「pre-commit 第 23 步」—— 那里根本没有序号可言**。序号也不属于任何现有事实核，
所以每给 D 组追加一步，文档里那批数字就整体错位一次 —— **表现不是红，是指到别的判据上**，
比找不到更糟。

**标签从哪来**：`grep -n '^  run "' .githooks/pre-commit` 逐字取，或跑一次提交看 `── check:`
那些行。D 组当前的标签里，`文件结构硬规则(R1-R12，R5 棘轮硬闸)`、
`UI/逻辑分离棘轮(--strict)`、`生成态文档与源同步`、`文档引用与权威源一致` 这几个是最常被引用的。

**判据**：`scripts/check-doc-references.cjs` 的 `checkGateStepIndexRefs()`（= `pnpm doc:check`，
已在 pre-commit 的 D 组「文档引用与权威源一致」这一步）。同一行既要出现 `第 N 步`，
也要出现 `pre-commit` / `.githooks` / `CI` 才报错；**有主人的过程序号**
（§2.2 的第 5 步、`prepare-local-run.ps1` 的第 3 步）不在此列，
描述这条口径本身的句子带纠正词即豁免。
**刻意不扫** `changelog.d/**` 与 `CHANGELOG.md`：碎片是当时那次变更的账本（13.10.5），
里面的序号是历史事实，回头改写等于伪造证据 —— 这条边界由用例「历史碎片不被扫」钉住。

**序号的近亲：门禁的步数也不要写（ISSUE #1407，签字口径 (a)）**。立案现场是 `docs/standards/11`
那节写着「`.githooks/pre-commit`（24 步）」（这个数字早已过期，别再照它数），外加抄了清单的前 6 行 ——
那一天钩子的真实形状是 **组 0 + A + B + C + D，D 组 27 条**（`grep -c '^  run "' .githooks/pre-commit` = 27，
这数字由 `tests/doc-check-hook-wiring.test.ts` 与钩子注释那句「D(N 个判据脚本)」逐字核对）。
所以那句不是「将来会过期」，是**当场就已经是错的**，而没有任何东西会变红：步数既不是序号、
也不属于任何事实核，与上面那条「不写第 N 步」是同一个失效机制。
**副本是另一半**：#1404 给「§13.1 清单 = 钩子 D 组」装判据时照出，那份**权威清单自己**都漂了 5 步 ——
抄一份的部分清单只会更难保持正确。所以 §11 现在只留指针（唯一出处 = §13.1 / `.githooks/pre-commit`），
不抄命令、也不写步数。
判据是 `checkGateStepCounts()`（同在 `pnpm doc:check` 里）：同一行出现裸计数（`24 步`）与
`pre-commit` / `.githooks` / `CI` 即报错；命中「第 N 步」的行交给上面那条报，**不双报**；
豁免集合与那条共用（新增 `不再` / `过期` 两个纠正词）。
两条边界用例钉着：§11 不许再出现 `✅ node scripts/check-*` 那种命令副本；
`prepare-local-run.ps1` 那种**有主人的过程计数**不误伤。

**顺带修掉的同族缺陷**（`tests/check-doc-references.test.ts`）：四处「已接入 main 流程」的老写法是 `expect(mainBody).toContain("checkX()")`，而把那一行前面加 `// ` 注掉之后
**它仍然绿**（注释行里也含同一段字面量）—— 也就是「接入判据」自己是假判据。
改成 `isCalledInMain()`：要求它是一行独立语句（行首只有缩进、行尾是分号），
并补一条「量具自己没坏」的对照用例（同一形状的 `wired` / `muted` 两段源码，前者真、后者假）。
这与 13.5.8 末尾那条「在场判据要解析、不要 `toContain`」是同一条纪律的第二个载体。

#### 13.5.11 eslint 增量缓存的依赖指纹失效（`scripts/eslint-cache-fingerprint.mjs`，ISSUE #1399）

**它补的是「缓存的已知边界由谁执行」这一步。** `pnpm run lint` 带
`--cache --cache-location node_modules/.cache/eslint --cache-strategy content`，而
eslint 的缓存键 =「**文件内容 + 解析后的 eslint 配置**」—— 既**不含装了哪些依赖**，
也不含 `tsconfig.json` 的解析口径。而 `@typescript-eslint/no-unsafe-*` 那一族是
**类型化规则**（判决要看 AST 上的类型）。于是依赖一变，旧判决被**整片重放**，
两个方向都会错：

| 方向     | 表现                                                      | 为什么它是最坏的一类                                                   |
| -------- | --------------------------------------------------------- | ---------------------------------------------------------------------- |
| **假红** | 那份红拦住从该缓存起的**所有**提交                        | #623 之后无 CI 兜底、`--no-verify` 又不许用 → 最容易被换掉的是判据本身 |
| **假绿** | 新依赖 / 新类型口径带进来的真违规被旧缓存洗掉，看起来全绿 | 它不制造任何摩擦，只在某次全量或线上暴露                               |

**实测现场**（用户报告）：依赖已装好，`pnpm run lint` 仍报 3 条
`no-unsafe-assignment`（`src/components/ui/{badge,button,empty-state}.stories.tsx`）；
同一批文件加 `--no-cache` 是 **0 条**，删掉缓存目录后全仓冷跑也是 **0 条**。差的
就是那份缓存。

**此前的处理为什么不够**：`.githooks/pre-commit` 里那句
⚠️「升级 eslint / typescript-eslint **之后**先手动删该缓存目录 —— 插件实现变更不在
缓存键里（这是 `--cache` 的已知边界，不是本仓的判据问题）」三处都错：

1. **触发面写窄了** —— 不只是升 eslint，**任何依赖变化**都触发（本期就是
   `pnpm install` 补上 storybook）；
2. 「不是判据问题」这句被事实推翻 —— 它同时造出假红（拦死提交）与假绿（洗掉违规）；
3. **靠人记得删 = 没有执行者**。

**机制**：记一份指纹，变了就删缓存目录，没变就留着。指纹进三份输入 ——
少任何一份都会让某个方向的旧判决被重放：

| 输入                           | 代表什么       | 为什么要它                                                                                                          |
| ------------------------------ | -------------- | ------------------------------------------------------------------------------------------------------------------- |
| `pnpm-lock.yaml`               | 声明要装什么   | 增删依赖首先落在这里                                                                                                |
| `node_modules/.pnpm/lock.yaml` | 实际装上了什么 | 与上面那份**不同形**（实测 13068 vs 12910 行，见 13.5.9）—— 只比一份会把「lockfile 改了但没重装」读成「依赖已更新」 |
| `tsconfig.json`                | 类型解析口径   | 口径变了，同一份源码的类型判决就该重算                                                                              |

**刻意不含 `eslint.config.js`**：它在 eslint 自己的缓存键里，重复登记等于给
「改了配置却删不掉缓存」这种假象留口子。缺失的文件记成 `<missing>` 而**不是跳过** ——
跳过会让「lockfile 被删掉」这种拓扑变化哈希不变，正好是「依赖树变了但判决被重放」
的极端形态。指纹**要落盘**（`node_modules/.cache/eslint-fingerprint.json`）：只在内存里
算、或拿缓存目录 mtime 当判据，都答不了「这次 install 之后依赖到底比上次变没变」。

**执行者：`postinstall`。** 它逐字是 `node scripts/install-git-hooks.mjs`（跨平台同一
入口，契约见 `launcher-core/node-runner.mjs::checkPostinstall()`，AGENTS 硬规则 7）。
指纹这一步**并进那个入口内部**，而不是往 `postinstall` 再挂一条命令 —— 后者会被上述
契约拦下，且那正是 #636 的事故形态（拼接命令在 Windows 的 cmd.exe 语义下直接崩）。
同理，入口里原有的两条提前 `process.exit(0)`（「不在 git 检出里」「`core.hooksPath`
已指向」）都改成了不退出：它们恰好是**最常见**的两种 install 形态，提前退出等于让这一步
在最常见路径上静默跳过。

**失败语义**：任何一步异常（算不出指纹、删不掉、写不进去）都只提示、退 0 ——
`postinstall` 非零会带走整次 `pnpm install`。`--cache-location` 与失效器盯的目录必须
**逐字同源**（改了参数而失效器还盯着老路径 = 白清），这条由用例钉住；跑真入口那条用例
用临时根目录（`COMFYAPP_LINT_CACHE_ROOT`）注入，否则一个测试会在别人机器上清掉热缓存
—— 有副作用的用例不许碰全局状态。

**代价实测**（同一台机器、全仓）：冷跑 / 无缓存 `real 5m16.890s`（316s）；稳态热跑
28.8–46.3s（取自 `.githooks/pre-commit` 组 B 里那组已量过的数）。⇒ 真装完依赖后的第一次
提交多等约 **4.5 分钟**，买回「判决来自当前依赖树」而不是「上一次碰巧看到什么」；日常
`pnpm install`（lockfile 没动）不触发。**一次冷跑的墙钟曾不可用**（跑期间机器休眠、
计时成了 537 分钟）—— 上面那个 316s 取自随后一次 `--no-cache` 全仓跑，不是取自那次冷跑。

**自查入口**：`node scripts/eslint-cache-fingerprint.mjs --check` 只报结论、不动缓存
（不落指纹），供「这盏灯现在是什么颜色」的定位用。判据由
`tests/eslint-cache-fingerprint.test.ts` 钉住（两个方向各一组：**变了 → 真删**、
**没变 → 保留**；反向验证：把 `runFingerprint` 改成永远不删，前一组的「缓存已消失」
即失败），并登记在 `scripts/affected-tests.mjs` 的固定清单里 —— 改 `.githooks/**`
会让增量层放弃收窄，而「接线断掉」正是它要拦的动作。

#### 13.5.12 判据 ⇄ 执行者的双向判据（`node scripts/check-gate-executors.cjs`，ISSUE #1451 要求 2）

`scripts/check-comment-language.cjs` 头部自称「提交门槛脚本，供 `.githooks/pre-commit`
调用」、§12.4.6 也写着它在钩子里报红 —— 而 `grep -c comment-language .githooks/pre-commit`
一直是 **0**，CI 又随 ISSUE #623 删除：**一条基线为 0 的硬闸一个执行者都没有，而文档
说它在执行**。这类事故比漏报更难发现 —— 漏报只是判据不响，「自称在跑」会让所有人
以为有人在守。所以「判据有没有执行者」这件事本身要有机器判据。

**「这类」分两种，别再混成一句「没有自动执行者」**：

| 形态                              | 含义                         | 失效表现                                           |
| --------------------------------- | ---------------------------- | -------------------------------------------------- |
| **报告档**（0 处 `process.exit`） | 只出清单、不判失败           | 接进钩子 = 接一个恒 `exit(0)` 的东西（接了个寂寞） |
| **判定档**（有 `process.exit`）   | 有能力以非零退出阻断某次运行 | 判据在场、没人敲它，文档却可能说它在跑             |

判定档**没有执行者**才是真空白；报告档按定义不该有判定者。`check-gate-executors.cjs`
只对**判定型**要求「要么有执行者、要么登记按需召唤」，对报告型只拦「自称在跑」。

**扫描面 = 门禁链事实 ∪ 名字族**（ISSUE #1444 残活 A）。旧口径只看名字前缀
（`check-` / `tw4-` / `report-` / …），于是 **`shell-gate.mjs` / `storybook-check.mjs` /
另两份真在门禁链里跑的判定型判据（如 `shell-gate.mjs`）不在盘点里** ——
判据自报「40 份」而真值是 44（现读数由判据自己每次打印，**别在文档里写死** ——
`check-soft-assertions.cjs` 落地后就变成 45 了），漏掉的恰是「最容易被摘掉又没人发现」
的那类（`storybook-check.mjs` 连 `pnpm check:all` 那一档都在跑）。现在主口径换成**事实**：

| 来源                              | 取哪个位置                                         |
| --------------------------------- | -------------------------------------------------- |
| `.githooks/pre-commit`            | `run "<标签>" <命令>` 的**步骤行**（不是文件全文） |
| `scripts/quality-gate.mjs`        | gate 表的 `args: ["../scripts/<x>"]`               |
| `scripts/quality-gate.ps1`        | `$Blocks` 的 `Args = @("scripts\<x>")`             |
| 名字前缀（`check-` / `tw4-` / …） | 兜底：保证「新写的 `check-*` 还没接钩子」当场可见  |

**为什么主口径不能只留事实**：那样「新写一个判定型脚本、没接钩子也没登记」永远不会
被看见 —— 判据的扫描面本身就只含「有执行者的东西」，而问题出在没有执行者的那些。
**为什么不能只留名字**：以上四份漏报就是答案。「判据的覆盖面与它自称的不符」正是
本节（#1451）的立案现场，所以这条判据自己的覆盖面必须由事实算出来。
**只读步骤位置、不读文件全文**同样是实测撞出来的：全文匹配会把散文里的占位符
（`x.cjs` / `xxx.cjs`）与被注释提到 / 被 import 的脚本（`affected-tests.mjs` /
`install-git-hooks.mjs` / `quality-gate-shared.mjs`）一起打进 —— 凭空多出三份不是判据的
东西（当时 44 涨到 47）。

**这条判据的契约用例也栽过同一个坑**（ISSUE #1444）：`tests/gate-executors.test.ts`
原先把这个份数写成 `.toBe(44)`，于是 **#1485 新增 `check-soft-assertions.cjs` 时它红了
—— 而红的原因与「散文举例被误认成判据」毫无关系**（用例本意守的是那个差，不是数字）。
它是 `FIXED_STRUCTURAL_TESTS` 成员、每次提交都跑，`master` 从那以后一直红着
（`git worktree` 到 `09aca6df` 复算：基线 12 条全绿 ⇒ 红是 #1485 带进来的）。
现在份数改成与「名字族 ∪ 门禁链事实」**独立数一遍**来对：新增一份 `check-*` 用例仍绿，
而口径一旦退化成全文匹配（实测 45 → 48）当场红 —— **两向都咬**。
**会漂的读数不写死**这条纪律（§12.14）对判据自己的用例同样适用。

**判据（三向，都由本脚本强制）**：

1. **判定型脚本无执行者** ⇒ 红，除非显式登记在 `scripts/.gate-executor-ledger.json`
   的「按需召唤」台账里（每条含「为什么不能进钩子」+「谁按需跑」）。
2. **报告型脚本自称「供 pre-commit 调用」** ⇒ 红。报告档恒 `exit(0)`，那句承诺必然
   是假的（`check-comment-language.cjs` 的事故就是这句话本身）。判定面只看脚本
   **文件头 20 行** —— 那是脚本自我介绍的位置，也避开正文里「不要接 pre-commit」这类
   否定句被误读成自白。
3. **台账双向拦**：登记了却其实有执行者 ⇒ 红（台账是负债，不是赦免名单）；
   登记了一个不存在的脚本 ⇒ 红（改名 / 删除后留下的孤儿条目）。

**「执行者」的口径**（只认直接调用，不做跨文件传递闭包推断 —— 闭包会把
「A 调用 B、B 调用 C」的间接链一路上溯，误报一片、也会随重构静默失效）：
`.githooks/pre-commit`、`scripts/quality-gate.mjs`、`package.json` 的 `scripts`、
`scripts/build-desktop.mjs`、`scripts/standalone-private-inputs.mjs`、`tests/**`。
把 `tests/**` 算执行者，因为本仓库多条判据的**唯一**执行者就是契约测试
（`lib-node-only-scan.mjs` 由 `tests/lib-node-only-declarations.test.ts` 跑），而它们在
C 组的固定清单里、每次提交都执行 —— 那是真的执行者，不是「文档里写着」。

**两类来源的取证宽度不同**（判据自身踩过的坑）：命令型来源「出现脚本名即算」；
测试型来源**必须同一文件里既有该脚本名、又有子进程调用 API**
（`execFileSync` / `spawnSync` / `execFile` / `spawn`）。理由是「读它的文本」与
「跑它」是两件事 —— 新增一份只 `readFileSync` 判据源码、断言 `--check` 分支还在的
形态用例之后，那两个 canonical 棘轮一度被判成「有执行者」，于是台账双向判定把
两条正当的按需召唤登记报成负债。

**当前台账（两条，都是 canonical 组合）**：`tw4-canonical-report.mjs` 与
`tw4-spacing-canonical.mjs` 都起 Tailwind 引擎、单次约 6s，判的是「CSS 等价改写」
而非正确性（成本判据同 §13.5.4 给 `doc:check` 翻档那条）。它们不进钩子，但**「按需」
不再是人为提醒**：各自带一个**硬闸判定档** `--check`（源文件候选数 / 待改写处数须为
**0**，命中即退 1），红了就 `--write` 落盘。两份基线
（`scripts/.tw4-canonical-baseline.json` / `scripts/.tw4-spacing-baseline.json`）
已随 ISSUE #1811 的 tw4 项**删掉** —— 存量清零后棘轮只留下「手改那份 JSON 就能把新候选
登记成已知存量」这一条通道，而那是硬闸类本来没有的中间态（§13.6.2）。形态由
`tests/tw4-canonical-ratchet.test.ts` 钉住（判定档在位 + 放宽通道没被加回来 +
扫描走共享内核 + 台账登记，四向各一组），行为另由
`tests/tw4-hardgate-behaviour.test.ts` 钉住（真候选即退 1、注释里的示例不算候选、
`--update` 已不存在）——**形状守不住行为**：一个把判定档写成永远退 0 的版本同样
满足「有 `--check`、有 `process.exit(1)` 字样」。

**姊妹维度：声明 ⇄ 读者（`scripts/check-declaration-readers.cjs`，规范 §11.23）。**
本节判的是**脚本**有没有执行者（`process.exit` 那条线）；它不覆盖另一种同样常见的
声明 —— 「我在读某份数据 / 我声明了某个契约」。后者的索引是
`scripts/.declaration-readers.json`：每一种声明都必须答出「谁在读它 + 执行者在哪」，
读者丢了、执行者从门禁链里被摘掉、或索引自己静默降级，都红。两节维度不同、**互不替代**
（本节判「判据在场 ≠ 判据在跑」里的**脚本**那一半，§11.23 判**声明**那一半）。

**还有一条**：`scripts/check-ts-duplicate-keys.cjs` 此前是报告型
（`scripts/report-ts-duplicate-keys.mjs`，0 处 `process.exit`）、**零判定档** ——
而它判的正是「命令行全绿、编辑器标红」那一族（项目钉的 `typescript6` 对重复属性不报，
editor 的 TS 服务报 `ts(2783)`），判据只能落在源码形态上。收成判定档的前提是
**实测量产为 0**（落地时全仓 0 处；读数由它自己每次打印，见上），所以按**硬闸**落、不走棘轮，
并接进 D 组「TS 重复属性判定」。`--with-tests` 不进判定档：测试里的重复多半是有意夹具。

**同一族的第二条教训：几条同形的账必须能被分开**（ISSUE #1547）。`freshness-gate.mjs` 现在判
**三份同形的账**（全量 e2e / 全量单测 + 覆盖率 / 产物级护栏，见 §11.8 的对照表），而「同形」这件事
本身带来了一个新的静默失效面：把 A 档的绿抄进 B 档的账，**账面上完全正常** —— 日期合法、人名合法、
命令是一条真命令，只有「这条记录由哪个跑法证出来」这一件事被搞错了。所以记录多了一栏 `trackedBy`，
判据逐条比对它；几份账的读写（`readFreshnessLedgerAt` / `writeFreshness`）与记录形状
（`freshnessRecord`）收在 `scripts/freshness-ledger.mjs` **一份实现**里，各跑法脚本只留
「怎么算口径 / 什么时候不记」（§12.12）。

**这条纪律与前一条同源**：`check-gate-executors.cjs` 判的是「判据有没有执行者」，
而本族判的是「账有没有**说清自己是哪一档的账**」。两者都在收同一个形状的洞 ——
**一份看着正常的记录，指的却是另一件事**。

#### 13.5.13 依赖新鲜度：远端改过库的版本，本地还在旧的上面干活（`node scripts/check-deps-freshness.mjs`，ISSUE #1569）

远端 `master` 上别人升过依赖，而本地检出还停在旧的那一套上 —— 这时在旧依赖树上
改代码、跑门禁，结论**看起来一切正常**，其实判据的版本已经不是远端那份了。这一格
此前**没有任何执行者**，而它的知识本身早就写下来了（`docs/guides/sync-after-pull.md`
整篇在讲「拉取更新后本地还要做什么」）——「想起来去读它」这件事没人守。

**既有机制盖不住它，别把两层合并**（这是本节的立案现场）：

| 层                                      | 判据                                               | 回答的问题                       | 此前      |
| --------------------------------------- | -------------------------------------------------- | -------------------------------- | --------- |
| 装了没装对（`node_modules` ⇄ lockfile） | `lockfileDrift` / 启动器 1.5 步 / `check:all` 预检 | 「我的安装与当前检出一致吗」     | ✅ 有     |
| **该装的是不是远端那一套**              | `check-deps-freshness.mjs` ②                       | 「远端改过依赖、而我还没同步？」 | ❌ **无** |

**判据三层，各自独立**（合并会把「没看」读成「没问题」）：

| 层                | 比较对象                                                    | 漂移的含义                           |
| ----------------- | ----------------------------------------------------------- | ------------------------------------ |
| ① 远端引用新鲜度  | `refs/remotes/origin/master` **自己的 reflog** 时间         | ② 可信不可信（**不是**「你落后了」） |
| ② 基线依赖 ⇄ 远端 | 分叉点（`git merge-base`）的三份依赖文件 vs `origin/master` | 你分叉之后远端改过依赖，基线是旧的   |
| ③ 依赖安装 ⇄ 本地 | 仓库 lockfile vs `node_modules/.pnpm/lock.yaml`             | 装了，但装的不是当前检出声明的那套   |
| ③ 的**第二块**    | 声明里的关键包在 `node_modules` 里**解析得到吗**（ISSUE #1721） | 装了、文本也对得上，而某个包解析不到 |

**① 不判红**：远端引用陈旧只说明「这次校验看不见远端」，`git fetch` 就能解除；拿它
阻断提交等于让离线 / 久未 fetch 的检出寸步难行。但它**不许被静默吞掉** —— 脚本打的是
`[未校验]`，**话术里不许出现「已最新」**（同 §13.5.9 给 `dependencyAudit` 定的
「未扫描 ≠ 干净」口径：把「没看」与「看了且没有」在输出形态上分开）。

**② 的基准是分叉点，不是 `origin/master`**（本判据最容易写错的一处）：拿
`origin/master` 直接比工作区，在「你在 PR 分支上自己加了依赖」这种**正常**工作流里会
**反向误报**（远端没有你新加的包 ⇒ 报成「远端改过依赖」）。真正要问的是「**我分叉之后，
远端在依赖面上前进过吗**」，所以基准取 `git merge-base HEAD origin/master`。自己的工作区
改动不进 ② —— 那是你自己的改动，不是「忘了同步」。拿不到分叉点时 ② **判不了**，
按「未校验」处理，**不是**「无差异」。

**② 有一态是「没什么要查」而不是「判不了」：合并已解完、提交还没落地**（ISSUE #1587 的
解冲突现场）。`git commit` 落地之前 HEAD **还没动**，于是 `merge-base HEAD origin/master`
回的仍是**合并前那个分叉点**（合并只是多一个父提交，不移动分叉点），`--is-ancestor` 也看不见
「远端已经在我的历史里」—— 结果是：解冲突的人把 `origin/master` 合了进来、依赖面与远端
**逐字一致**，提交却被拦下，而出口让他做的事（「把 `origin/master` 合并进来」）他**刚做完**，
形成死循环。
判据取「本次提交是不是一个待落地的合并提交」= `$GIT_DIR/MERGE_HEAD` 在场（git 自己写的
状态文件，也是「这次提交将有两个父提交、第二个就是被合并的 rev」的唯一权威信号 —— 前面两条
近似都看不出来，而「暂存区里有 `package.json`」更是无关：自己改依赖也是这个形态）。
命中时 ② **不判**，且话术打的是 `[已合并]`（「远端那份依赖面就在这次合并里」）而**不是**
`[未校验]`（那是「没看」，两者读起来正好相反）。

**③ 走 `lockfileDrift`（`launcher-core/worktree.mjs`）这一个出处**，与启动器、
`quality-gate.mjs` 的依赖预检共用同一份「实质差异」口径。`quality-gate.mjs` 里那份
自己拼 `diffLockfiles` 的实现已在本条落地时收口 —— 三处边界（「直接读安装时 lockfile」
与「读不到时算不算漂移」）各写各的，正是 §12.12 说的那种会静默分叉的重复。

**③ 由两块拼成，因为它们对不上时是两种病、两种动作**（ISSUE #1721）：**文本层**
（上面那句，两份 lockfile 的实质 diff）判「你的安装记录与声明对得上吗」；**解析层**
（`unresolvableDeclaredDeps()`，同一个模块）判「声明里的关键包在这棵树上解析得到吗」。
只有文本层会漏掉立案现场：本地 `node_modules` 停在**装某个新直接依赖之前**时，那个包
只以**传递依赖的旧版本**落在**包自己的私有层**（实例：`node_modules/@storybook/
addon-a11y/node_modules/axe-core` 是 4.13.0，而声明要的是 4.14.0），顶层既没有提升出来
的那一份、也没有任何可解析路径 —— 而两份 lockfile 可以**逐字一致**。表现是
`tsc --noEmit` / `eslint` 报 `Cannot find module`（TS2307），`brokenKeyDeps()` 也判绿
（它只点名 typescript / next，新加的那个包不在清单上）。解析层红了**单独说一句话**
（「解析不到」而不是「装的不是你声明的那套」）：后者会把读的人送去核对一份本来就对的
文件。

解析层**只点名三条探针**（`RESOLVE_PROBES` = typescript / next / axe-core），刻意不扫
全部 `package.json`：这三条是跑门禁时无论如何都会解析到的包，多解析一次不产生新的工作，
而「把所有直接依赖都解析一遍」会让这份清单跟着依赖表一起长 —— 每次加依赖都要动判据，
那正是「会静默失效的清单」的成因（§12.18）。探针按**仓库根**解析
（`createRequire(<root>/package.json)`，与 `tsconfig` / eslint 同一个根），而不是
`import.meta.resolve`（那从判据模块自身出发，同一份判据在不同布局下会给出不同答案）。
**依赖从来没装过时不表态**（无 `.modules.yaml` ⇒ 归 `no-install`）：对着一棵不存在的树
报「这几个包解析不到」是准确的噪声，动作一样是重装、结论读起来却完全不同。

用户侧的现场、自测命令与「为什么删掉重装不是这里的处方」写在
[`../guides/sync-after-pull.md`](../guides/sync-after-pull.md) §3.1。

**lockfile 那一路走实质 diff（`diffLockfiles`）而不是字符串比**：注释、空行、条目顺序
会随 pnpm 版本漂移，字符串比会把「同一份解析结果」报成大改动 —— 而这条判据的每一次
误报都会教人去 skip 它。三个依赖文件（`package.json` / `pnpm-lock.yaml` /
`pnpm-workspace.yaml`）**逐个都判**：远端只改 `allowBuilds` 那一档（同一份 lockfile
装出来的东西都可能不同）正是最容易漏的。

**谁在什么时候跑它**（不写清就等于没有执行者，§13.5.12）：

| 场景                                   | 形态                                      | 判什么                |
| -------------------------------------- | ----------------------------------------- | --------------------- |
| 本次提交**动了依赖面**（钩子 D 组）    | `--staged`                                | ② + ③，任一命中即阻断 |
| 本次提交没碰依赖面（钩子 D 组）        | `--staged` 未触发 → 退 0、零输出          | 不给无关提交加时间    |
| AI / 人开工前、PR 评审前（**主场景**） | `pnpm check:deps-freshness`（无参数）     | ② + ③ 全判            |
| 完整验证那一档                         | `pnpm check:all`（`GATES.depsFreshness`） | 全判                  |

**为什么钩子那档只在「动了依赖面」时判**：在分支上开发时本地 HEAD 与 `origin/master`
不同步是**常态**（PR 流程本来就该如此），每次提交都拿它拦人 = 一条天天红的闸，人只会
去 skip 它（同 §13.5.4 的成本判据）。而「**你自己刚改过依赖**」不一样 —— 那时「我的
基线是不是旧的」是**必须回答**的问题：否则你会在旧依赖上解冲突，或把一份基于旧基线的
lockfile 推上去。判据的口径与代价都收在脚本文件头。

**判据自身不做网络请求**：`git fetch` 是人的动作。把网络塞进提交门槛会把「离线 / 远端
抖动 / 鉴权过期」变成提交失败 —— 与 §13.5.9 的 `dependencyAudit` 不进钩子是同一条理由。

**出口**（红了照做）：`git pull`（或把 `origin/master` 合并进来）→ 在项目根
`pnpm install` → 重跑一次本判据。要删 `node_modules` 重装的情形见
[`../guides/sync-after-pull.md`](../guides/sync-after-pull.md)。

**契约测试**：`tests/deps-freshness-gate.test.ts`（15 条）。它在真 git 仓库上跑
（「远端」就是一条引用加一条 reflog，不是可 mock 的模块），覆盖 ② 的正反两向
（远端改过 → 红 + 明细；远端只改注释 → 不报）、① 的两档（无引用 / 无 reflog 都打
`[未校验]` 且**不给**「一致」这个结论）、③、`--offline`、`--staged` 的触发面、
非 git 检出判 2、**基准那条**（分叉后自己在分支上加依赖不误报），以及**合并那一态**
（`MERGE_HEAD` 在场 → ② 不判、话术是 `[已合并]`；再补一条反向对照：不在合并时同一比对
照旧报红，证明放行的是那一态而不是把 ② 关掉了）。③ 的解析层另有三条：命中那一档
（两侧 lockfile 逐字一致、`axe-core` 解析不到 ⇒ `state: "unresolved"`，且话术**不含**
「装不是你声明的那套」）＋两条反向对照（无 `.modules.yaml` 仍走 `no-install`；三条探针
都在位时不误报 —— 少了这条，「探针永远返回缺失」这种失灵测不出来）。

#### 13.5.14 类型层声明 ⇄ 执行者：tsc 判的是哪份文件，谁在敲那条判据（ISSUE #1591）

**立案现场**：`master` 最近一次 `tsc` 红是 **19 条**（前一轮还有 17 条）。逐条扒下来，
**没有一行是行为改动**，共同根因只有一个 —— **声明（JSDoc / 类型注解）落后于实现**：

| 提交干了什么                                                                                                           | 后果                                                                    |
| ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| `FRESHNESS_TRACKS` 长出 `daily` / `skipHow`、`freshnessRecord` 接上 `skippedReason`、`checkFreshnessLedger` 接上 `now` | 三处 JSDoc 还停在旧的四栏形状 → 12 条                                   |
| `findCargo()` 用 `&&` 拼候选再 `filter`                                                                                | 数组是 `(string \| false)[]`，`.filter` 在这形状上**构不成收窄** → 4 条 |
| 用例里的期望对象仍是四栏                                                                                               | 3 条                                                                    |

**判据本来是现成的，缺的是「什么时候被敲」。** 这正是 §11.23 那一族的形态：
**声明写得对、没有人读**。`tsc --noEmit` 是真的在跑（钩子 A 组），但它只保护
「启用了钩子、且没加 `--no-verify`」的**那一次本地提交**；PR 在平台侧是 **squash 合并**、
那一步不跑钩子；`#623` 之后**已无 CI 兜底**。于是「本地绿」推不出「合并后绿」，
而那 12 条在干净仓库上长久**全绿**。

**这一档判什么 —— 不是再写一份 tsc。** 全仓**另一遍** `tsc` 是 §12.18 明令要避免的
第二轮子（§13.6.2 的 `pnpm check:base:batch` 已经把「合并前在干净快照上复算一遍」
做完了）。所以本判据判的是**那条判据自己的执行者**：

```bash
node scripts/check-tsc-diagnostic-executors.cjs            # 检查（D 组「类型层声明 ⇄ 执行者」）
node scripts/check-tsc-diagnostic-executors.cjs --report   # 只出清单不判失败（盘点用）
node scripts/check-tsc-diagnostic-executors.cjs --update   # 把基线收紧到当前实测（只许降）
```

三条口径（每一条不满足都会退化成「看着在守、其实没守」）：

| 口径                  | 做法                                                                              | 不做会怎样                                                     |
| --------------------- | --------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **执行者在场 + 同源** | 每条登记项与 `scripts/.declaration-readers.json` **逐行同源**（id / reader 双核） | 两处各记一份必然分叉，而分叉之后「哪一份是真的」没有判据能回答 |
| **零增量**            | 声明行计数（JSDoc 类型位 + TS 声明头）只许降不许升，`--update` **拒绝写入上涨**   | 新写一处声明没人问「它谁在执行」，这一档就成了事后补救         |
| **不许静默降级**      | 台账读不出 / 空表 / 对侧读不到 ⇒ **判失败**                                       | 与本判据要拦的病逐字同形：解析失灵 ⇒ 读出 0 条 ⇒ 全绿          |

**扫描面与 `tsconfig.include` 同口径**（`src/` + `scripts/` + `tests/`，含 `.mjs` / `.cjs`
且 `checkJs: true`）—— 这一点是前提之一：很多人以为「`.mjs` 是脚本、类型不收」，
而立案那 19 条里有 **12 条**正是 `scripts/freshness-ledger.mjs` 的三处 JSDoc。

**登记的意义**：把「声明 ⇄ 读者」（§11.23，判的是**声明**有没有人读）与
「判据 ⇄ 执行者」（§13.5.12，判的是**脚本**有没有人跑）这两个维度接到**类型层**这一格上。
台账 `scripts/.tsc-diagnostic-executors.json` 的每一条都要答出「这份文件里的声明行交给谁、
由谁来敲」，而 `id` 与姊妹索引逐行同源 —— 两个索引的**维度不同**（谁会被敲 vs 判据本身是谁），
**载体是同一个**。

**刻意不做的事**（都写进判据的文件头了）：

- **不跑第二遍 tsc** —— 那份钱由 `check:base:batch` 付（§13.6.2）。
- **不判「某处声明该不该有」** —— 收益判断，要实测（同 §11.23.4）。
- **不做「暂存里有 `scripts/*.mjs` 而没动台账 ⇒ 提示重新自证」** —— 改任何一个脚本都会命中，
  会立刻退化成一条天天响的提示，人只会去绕开它（§11.18.4「会误报的判据活不过一次评审」）。

规则自测：`tests/tsc-diagnostic-executors.test.ts`（进 C 组固定清单，19 条）——
该拦的（涨了 / 落点扫不到声明 / 关键词没了 / 姊妹索引缺 id / 两处 reader 不一致 /
字段不全 / 缺 baseline / id 重复 / 台账读不出 / 空表 / 对侧读不到 / `--update` 涨）与该放的
（降了只提示 / 声明行识别不吃夹具字符串 / 真仓判绿）每一档各一条执行者。

#### 13.5.15 依赖构建脚本 ⇄ `allowBuilds` 对账（`node scripts/check-allow-builds.cjs`）

**立案现场**：AGENTS 硬规则 8 写着「新增含 postinstall 构建脚本的依赖：同步更新
`pnpm-workspace.yaml` 的 `allowBuilds`，否则非交互模式 `pnpm install` 会 exit 1」，
而这条规则此前**一个执行者都没有**。`allowBuilds` 在仓库里只被当**输入**读两次 ——
`check-deps-freshness.mjs` 拿它判「远端只改了 `allowBuilds` 这一档」的新鲜度、
`check-type-assertion-executor.cjs` 在文件头解释为什么不引 `jsonc-parser`（理由正是
「多一条依赖就要给 `allowBuilds` 记账」）—— 没有任何一处判过
「某个带构建脚本的依赖到底在不在名单里」。

**为什么这条值得在提交时响**：它要防的故障形状是**改动点与故障点不同人，中间还隔一次安装**。

- 漏登记的人当场看不出来 —— 他自己的 `node_modules` 早就装好了，增量 install
  甚至直接 short-circuit；
- 第一次复现是在**下一个人**（或另一台检出、另一个容器、另一台 NPC 工作区）跑
  `pnpm install --frozen-lockfile` 的那一刻，`ERR_PNPM_IGNORED_BUILDS` 以 exit 1 中断；
- 表现是「这个仓库装不上依赖」，而按 §13.6.3 的口径这句话会被误读成
  「本机跑不了门禁」—— 一条登记疏漏升级成一次全场排查。

同族先例：`check-app-version.cjs` 守的也是「同一个事实抄在多份清单里、漏改一处时
当场看不出来」。那一处判「三处相等」，这一处判「名单覆盖齐全」。

**判什么**（三点都不是新增语义，而是照 pnpm 自己的判定口径抄：它按**包名**批准，
对名单里没有的构建脚本直接失败而不是警告）：

1. `pnpm-workspace.yaml` 在，且其中有 `allowBuilds:` 块 —— 块没了就是名单整档消失，
   正是本判据要拦的根状态；
2. `node_modules/.pnpm` 在 —— **缺依赖判红而不是跳过**：把「读不到扫描面」写成
   静默 `exit(0)`，判据会在一份依赖都没读的情况下报绿，那是 §13.5.12 那一族里最坏的
   一种。话术里直接给出那一条命令（`pnpm install --frozen-lockfile`），并按 §13.6.3
   写明「缺失只表示还没装，不表示本机装不了」；
3. 每一个**已安装且带 `preinstall` / `install` / `postinstall` 的包**，都必须在
   `allowBuilds` 里有一条显式条目 —— `true`（批准执行）与 `false`（显式拒绝）**都算
   回答过**，漏答才是问题。

**刻意不判的**（都写进判据的文件头）：

- **名单里多余的反向条目**（登记了、但当前没有构建脚本的包）。这一档在现状里是**多数**，
  且其中一半是故意的：`better-sqlite3` 显式 `false` 的理由写在 `pnpm-workspace.yaml` 里
  （v13 改成随包附带 `prebuilds/`，仍带 `gypfile` 会触发一次必然失败又毫无产物的
  `node-gyp rebuild`），`@prisma/*` 是给可选 peer 覆盖留的位。反向判红会把这两种
  正当形态一起打成违规 —— 那是「误报一片」，不是收紧判据（§11.18.4）。
- **该不该批准**（`true` 还是 `false`）：发布/构建判断，与「同步更新名单」不是同一件事
  （§12.18：不再为此写一个启发式扫描器）。
- **版本粒度**：pnpm 按名字批准，同名多版本共享一条条目是既定语义。

**为什么读 `node_modules` 而不是 lockfile 或 registry**：`pnpm-lock.yaml` 不带 `scripts`
字段（它记解析结果与完整性，不记生命周期），从它推「有没有 postinstall」要引第二份数据源；
问 registry 要网络，与本仓判定型入口的「零网络」口径相反（同 §13.5.13 那句
「判据自身不做网络请求」）。而 `node_modules/.pnpm/<条目>/node_modules/<包>/package.json`
是**已经装出来的事实**，与 pnpm 判定构建脚本时读的是同一份输入，不存在
「判据与工具看不同来源」那道缝。扫描复用 `gate-scan-read.cjs` 那层容错读取
（条目在扫描期间消失要计数并进结论行，不能崩、也不能静默跳过）。

**为什么是条件触发（`--staged`）而不是每次提交都扫**：一次全树扫描实测 4.5s、零网络、
零子进程，与 `check-non-null-assertions.cjs` / `check-ui-primitives.cjs` 同档（同为全树扫描
那一类），而能让「带构建脚本的依赖」发生变化的输入**只有那三个文件** —— `package.json`
（直接依赖）、`pnpm-lock.yaml`（解析结果；传递依赖的新版本可能新带一个 postinstall）、
`pnpm-workspace.yaml`（名单自己）。只加碎片 / 只改文档 / 只动 `src/` 的那一类提交根本不在
靶子里，扫多少遍结论都一样。这与 ISSUE #1747 给 D 组两步全库扫描定的口径同源，也是
§13.5.12 那句「无条件挂上昂贵的判据 ⇒ 所有人开始 `--no-verify` ⇒ 判据归零」的直接推论。
跳过时**打印「未触及依赖面」**（与「扫过之后没问题」在输出上可分，不伪造绿），
读不到暂存清单走 `exit 2` 而不是冒充跳过 —— 这两件事都由 `gate-scan-read.cjs` 的
`skipUnlessStagedTouches()` 一处实现，本判据不另写一份；依赖面清单的**唯一出处是
`scripts/dependency-face.mjs`**（`check-deps-freshness.mjs` 与 `check-allow-builds.cjs` 共用）。
为什么单独成件而不是从那份判据 import：它带着 `lockfile/lock-diff.mjs`、
`launcher-core/worktree.mjs` 一串下游，为一个三项常量拖进整条链，代价落在门禁自测的
临时工作区上（少拷一个就是 `ERR_MODULE_NOT_FOUND`，读起来像被测判据坏了）；就地抄第二份
则会在清单将来加第四项时静默漏判（§12.12「漂开的形态是静默的」）。

**「只在依赖面判」不是把判据松掉**：带构建脚本的包只能从那三个文件进来，触发条件与违规
的可能来源是同一批文件；且存量实测为 0（1377 个安装条目里只有 3 个带构建脚本、全部已登记），
没有历史欠账被留在跳过档里。

步数**不写在这里**（§13.5.10 与 ISSUE #1407 的口径：数字会静默过期，唯一出处是钩子里那句
`D(N 个判据脚本)`，由 `tests/doc-check-hook-wiring.test.ts` 核）。

规则自测：`tests/check-allow-builds.test.ts` 分三层 —— 判决面（登记 `true` 放行 /
显式 `false` 放行 / 漏登记判红且点名 / 作用域包按 `@scope/name` 认名字 / 空串脚本不算站点 /
同名多版本按去重后的名字计 / 反向条目不误报）、输入面（`allowBuilds` 块缺失 /
`pnpm-workspace.yaml` 缺失 / `node_modules/.pnpm` 缺失三档都必须红，且话术指路那一条命令）、
条件触发面（暂存不在依赖面 ⇒ 跳过且打印理由；暂存命中依赖面 ⇒ **照旧真扫、违规照样阻断**；
无暂存 ⇒ 跳过 —— 只看退出码不够，「跳过」与「扫过没问题」同码，把 `--staged` 实现成
「永远跳过」的改动会全绿通过）。接线那两条与 §13.5.12 那一族同形：解析 D 组步骤、
只认真调用，另钉一份 §13.1 清单在场；而断言里 `cmd` 逐字带 `--staged`，
所以「抹掉这个 flag」与「摘掉整步」在本文件里等价（同 §13.5.5.1 那条的理由）。

### 13.6 分支与合并策略

- 功能分支：`feat/<short-desc>`；修复分支：`fix/<issue-id>-<desc>`。
- 合并方式：优先 **Squash Merge**（保持主干线性、单 PR 单提交）；大型重构可 Rebase。
- 项目主分支为 **`master`**；禁止直接 push 到 `master`；所有变更走 PR + Review。
  **`master` 同样禁止直接 commit**（连「先提交到 master 再推」也不行）——
  本条的强制口径见下方 13.6.1。

#### 13.6.1 master 只接受「分支开发 → PR → 合并」（机器强制）

只用「禁止直接 push」约束不住主干：本地 `git commit` 到 `master` 完全不经过任何
检查，而 `--no-verify` 与「新克隆没启用钩子」都能让提交门槛形同虚设，等发现时
绕过评审的变更已经躺在所有人的基线里。因此本仓库把「不在 master 上提交」
做成三层防线（ISSUE #492）：

| 层   | 位置                                                                                    | 拦什么                                     | 能绕过吗                                  |
| ---- | --------------------------------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| 平台 | CNB **分支保护设置**（保护分支 + 禁止直接 push，要求 PR）                               | `master` 的**直接 push**，**放行 PR 合并** | 需管理员改设置（本身就要权限）            |
| 本地 | `.githooks/pre-commit` 开头的「master 分支提交守卫」跑 `scripts/check-branch-guard.cjs` | `master` 上的**每一次本地提交**            | 只能 `--no-verify`（进历史，Review 可见） |

> **服务端那两层随 `.cnb.yml` 一起下线了**（ISSUE #623，理由见 13.5.3）。
> `scripts/check-branch-guard.cjs` 仍保留 `--pr-check` / `--merge-commit` 两个
> 服务端形态 —— 它们是**判据本身**（`tests/check-branch-guard.test.ts` 用真仓库
> 跑三种拓扑），日后重启平台侧流水线时直接用，不必重写。`--merge-commit` 判的是
> 「落到 `master` 的能不能被认定为 PR 合并的形态」（合并提交 **或** 提交信息带
> `PR-URL: #NNN`），两者都不满足时保守放行 —— 为什么不能只判「父提交数 > 1」见 13.5。

**⚠️ 平台层必须用「分支保护」，不能用「分支锁」**：`git create-branch-lock`
（仓库设置里 `locked: true`）锁的是**整个分支的写入**——它连 **PR 合并**一起拦掉，
`master` 一旦被锁，任何 PR 都无法合并（实测：锁上后 PR 的 `mergeable_state` 虽然仍是
`mergeable`，平台侧合并动作直接失败）。想「禁直接 push、但要能合 PR」只有
**分支保护设置**这一条路：保护分支 + 禁止直接 push + 需要评审批准。
`create-branch-lock` 只适合「冻结分支，谁都不许动」的场景（如临时封版），
**不要**拿它当 PR 流程的守卫。

**判据（为什么不能只看分支名）**：pre-commit 在**合并提交**时 `HEAD` 也是 `master`，
只看 `git rev-parse --abbrev-ref HEAD` 会把「PR 合并」一起拦掉。可用的事实是
「本次提交有几个父」：合并提交有 2 个父（被合分支 + `master`），普通提交只有 1 个。
所以 `scripts/check-branch-guard.cjs` 的口径是：

- `HEAD` 不在 `master` 上 → 放行（正常的分支开发）；
- `HEAD` 在 `master` 上且父提交数 > 1 → 放行（PR 合并提交，在平台侧完成）；
- `HEAD` 在 `master` 上且父提交数 ≤ 1 → **阻断**（直连主干的提交）；
- 取不到分支名（非 git 目录 / detached）→ 放行并说明（判据无从命中，不该误报）。

**被拦下的自救**（提交已经在本地 `master` 上、还没 push）：

```bash
git branch feat/<简短描述>            # 用当前提交建分支，提交不丢
git reset --hard origin/master        # master 回退到远端状态
git checkout feat/<简短描述>          # 换到分支继续开发
git push origin HEAD                  # 推送并创建 PR
```

**为什么用「父提交数」而不是「HEAD 是否等于 origin/master」**：刚 `pull` 过、
或本地领先远端若干提交时，两者都不成立；父提交数是 git 里唯一稳定表达
「这次提交是不是合并」的事实，且与当前工作树位置无关。

> 规则自测：`tests/check-branch-guard.test.ts`（临时仓库跑真脚本：分支提交放行、
> master 直提阻断并给出搬迁出口、master 合并提交放行、非 git 目录不崩、
> 钩子里守卫排在最开头（组 0「master 分支提交守卫」）；另有 `--pr-check` 的三种拓扑与「取不到目标分支时保守放行」）。
>
> **分级口径**：本地钩子拦的是**提交**，平台层的分支保护拦的是**直接 push**
> —— 两者判据不同、不可互相替代：只有平台保护挡不住 `--no-verify` 的本地提交，
> 只有本地钩子挡不住别的检出直推（平台侧流水线已下线，见 13.5.3）。
>
> **服务端形态为什么还留着**：`pull_request` 类事件的流水线配置取自**源分支**，
> 属「不可信事件」——触发者本可以把那行 `check-branch-guard.cjs` 删掉。因此脚本里
> 的服务端判定**自持**（不读 `CNB_PULL_REQUEST`、不依赖任何外部事实），
> 日后重启平台侧时把它排在第一道即可，删掉就是当场失败而不是「静默不检查」。
>
> **服务端的判据与本地不是同一条**（踩过）：CNB 在 `pull_request` 事件上 checkout 的是
> **预合并提交**，容器里 `symbolic-ref HEAD` 恒等于**目标分支**——照搬本地那条
> 「HEAD 在 `master` 上 = 直连主干」会把**每一条正常 PR 都拦死**（PR #633 第一次跑就是这么红的）。
> 服务端因此判**提交拓扑**：`git rev-list --count origin/master..HEAD`
> —— `> 0` 说明源分支确有超出目标分支的提交（正常 PR）；`= 0` 说明源分支就是目标分支
> （平台允许创建 source=master 的 PR，正是要拦的场景）。判据与分支叫什么名字无关。
> 三种拓扑（领先 / 预合并 / 完全同步）由 `tests/check-branch-guard.test.ts` 用**真仓库**跑。

**第二个本地钩子：`prepare-commit-msg`（合并提交必须双亲，ISSUE #1594）**

13.6.1 守的是「**在哪儿**提交」，它不回答「这次提交**是不是**合并」。而这正是上一次
squash 合并把 `master` 上几批修复整体回退的现场：解冲突时 `git checkout`
（含 `checkout -b`、`branch -f` + `checkout`）会**静默清掉** `.git/MERGE_HEAD`
与 `.git/MERGE_MSG`（实测退出码 0、不留痕迹），此后 `git commit` 照常把合并结果落成
**单亲提交** —— 树是对的、拓扑是错的，平台侧认不出「已合并」，PR 一直显示冲突，
而本地钩子四组全绿。

所以补一条判据，落在 `.githooks/prepare-commit-msg`（入口）→
`node scripts/check-merge-parents.mjs`（判据本体）：

- **提交信息声明自己是合并**（首行是 git 会写的那几种：`Merge branch` /
  `Merge remote-tracking` / `Merge tag` / `Merge commit` / `Merge pull request`）
  **时，本次提交必须真的有两个父**。父数取自 git 自己的事实：`1 + MERGE_HEAD 行数`；
  `MERGE_HEAD` 不在而消息是合并信息 —— 那就是回退发生的形态，**当场阻断**并给出
  重建合并的出口（`git reset --soft HEAD^` → `git merge --no-commit <分支>` → `git commit`）。
- **为什么不在 `pre-commit`**：`pre-commit` **看不到本次的消息** —— 实测
  `COMMIT_EDITMSG` 在那一刻仍停在**上一条**提交的信息上（git 先跑钩子、后落盘消息）。
  `prepare-commit-msg` 收到 `$2`（source），能干净地把 `--amend` 排除在判据之外：
  amend 一个合并提交时消息照样是 `Merge …`、`MERGE_HEAD` 也照样不在，但父提交从
  `HEAD` **继承**（结果仍是双亲）—— 只看消息 + `MERGE_HEAD` 会把真正来修合并信息的
  人 100% 拦下。
- **边界**（都取保守放行，与 13.6.1 同口径：判据无从命中时不该误报）：
  source 是 `commit`（`--amend` / `-c` / `-C` / cherry-pick / revert）→ 放行；
  取不到消息 → 放行；非 git 目录 → 放行；合并字样只出现在正文（非首行）→ 放行。
- 规则自测：`tests/check-merge-parents.test.ts`（真仓库跑拓扑：普通提交放行、
  真合并提交放行、**声明是合并但单亲阻断并给出出口**、`--amend` 一个合并提交放行、
  正文提到 `Merge branch` 不算声明、非 git 目录放行，另加钩子入口的 `$1` / `$2` 透传）。

**同一入口的第二条判据：双亲在、内容丢了一侧（ISSUE #1618）**

上面那条判的是**形态**。而实测丢东西的那两次（`ad81a912` / `bdabd26f`）**形态全对**
—— 双亲在、消息也像样，只是某个文件**整份取了非 HEAD 那一侧**，把 HEAD 侧已合入的
改动一笔退回。所以 `.githooks/prepare-commit-msg` 里**一前一后**接了两条判据：

```sh
node scripts/check-merge-parents.mjs "$1" "$2" || exit 1     # ① 形态档（#1594）
exec node scripts/check-pending-merge-loss.mjs "$2"          # ② 内容档（#1618）
```

② 的三条合起来才算命中（缺一条都会误报）：结果版（索引里那一版）**不等于**
`HEAD` 侧那一版、**等于** `MERGE_HEAD` 侧历史上对那个文件出现过的某一版、
且 `HEAD` 侧在该文件上**确有还没被取代的改动**（`HEAD` 那一版 ≠ merge-base 那一版）。
只有「你动了它、对方也有一版、结果取了对方那版」才是整份取一侧；「只有对方动过那个
文件」是**正当**的，不报。阻断话术指名叫哪几份、并给出口（`git checkout HEAD -- <文件>`
或 `git checkout --merge <文件>` 重解一次，**别整份 goback**）。

**它与 1-1（事后复算档）共用内核** `scripts/merged-side-loss-core.mjs` 的
`findEarlierVersion` —— 两个执行者问的是同一件事：「结果里这一版的内容，是不是等于
某个更早版本的内容」。内核只接**已经取好的事实**（结果 blob、候选历史 sha 清单、
取某版本的函数），不认识「基线」「HEAD」「MERGE_HEAD」这些业务名词，也不含任何
传输层代码（§18.4 / §12.12 的分工）。

- **边界**（全取保守放行）：`source=commit`（`--amend` / cherry-pick / revert）→ 放行；
  **非合并提交 → 零输出、零耗时**（`MERGE_HEAD` 不在时第一行就返回，普通提交每次都
  会走到它，不能加噪声）；浅克隆 / 取不到 merge-base → 放行并说明；
  生成物（`docs/api/**`、`docs/generated/**`）→ 不判（退回即常态，同 1-1）。
- 规则自测：`tests/pending-merge-loss-gate.test.ts`（10 格，真仓库跑合并：整份取一侧
  → 拦并指名、正确保留两侧 → 放行、非合并 → 零输出、`--amend` → 放行、
  **只有对方动过那个文件 → 放行**（误报防线）、生成物 → 不报、非 git → 放行、
  混合 → 只报该报的那一份，另加两条钩子接线与「与 1-1 共用内核」）。

> **`.githooks` 下的两个钩子是两件事**：`pre-commit` 管「提交这一刻的门槛」，
> `prepare-commit-msg` 管「提交消息与拓扑是否自洽」。两者都由
> `core.hooksPath=.githooks` 覆盖调用，`scripts/install-git-hooks.mjs` 不必改 ——
> 但**判据执行者的口径要跟着长**：`scripts/check-gate-executors.cjs` 的
> `EXECUTOR_SOURCES` 已把 `prepare-commit-msg` 一并收进「谁在跑它」的来源
> （漏登记 = 那条判据被判成「无执行者」，方向正好反了）。

#### 13.6.2 master 基线可以带着硬闸红 —— 被拦先复算，别以为是自已改坏了

**机制缺口**：本地 `pre-commit` 拦的是**提交**，PR 在平台侧是 **squash 合并**，
那一步**不跑本地钩子**；而 #623 之后**已无 CI 兜底**（13.5.3）。两条合起来的后果是
**违规可以直接落进 `master`**，成为所有人接下来的基线。

为什么这比「测试基线红」严重一档：门禁分两类——

| 类型                         | 有无「带病通行」的中间态                 | 落到 master 的后果                                               |
| ---------------------------- | ---------------------------------------- | ---------------------------------------------------------------- |
| 棘轮类（有基线文件）         | 有：基线数字就是「已知存量」             | 下一个人照常提交，存量被记账、看得见                             |
| **硬闸类**（须为 0，无基线） | **没有**：设计上就不接受「冻结一个数字」 | **从那一刻起，凡是从 `master` 分出的提交都被拦住**，包括无关改动 |

实例（实测）：#1183 合并后的 `master`（8363f21）带着 1 处 P80（视图层 `w-N` 与 `h-N`
同值应换 `size-N`，`src/components/workshop/ShotStudio.tsx`）。P80 属 82 条硬闸之一，
没有基线可登记 → 后续**每一个**提交都在钩子 D 组被拦，而被拦的人第一反应会是
「我改坏了」。

**处置口径（按序做，不要跳）**：

1. **先复算基线，再怀疑自己**：把拦住你的那条门禁在干净的上游提交上再跑一遍——
   **这一条现在有执行者**（`node scripts/base-check.mjs`，ISSUE #1569 收尾）：

   ```bash
   node scripts/base-check.mjs check-ui-primitives          # 换成拦住你的那条（钩子标签 / 脚本名 / 整条命令都认）
   node scripts/base-check.mjs --fetch "UI 基元复用棘轮"     # 先 fetch 再复算
   node scripts/base-check.mjs --json node scripts/check-ui-primitives.cjs   # 机器可读（碎片里要贴的那句事实）
   ```

   它给你**五态之一**，每一态的下一动作不同（下面的口径就是它的话术）：

   | 结论            | 含义                                              | 动作                                                                                                                                                 |
   | --------------- | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
   | `baseline-red`  | 干净基线上**同样命中** ⇒ 别线的红，与你的改动无关 | 挡路的就地修掉；不挡路的按 §11.12 登记。**不许**为它放宽判据，也不许 `--no-verify`                                                                   |
   | `yours`         | 基线上绿、你的检出红 ⇒ 你的改动引入的             | 修你自己的代码，别去动基线                                                                                                                           |
   | `current-green` | 你的检出上已经不红了                              | 没什么可复算的（已修 / 判据只在别的输入面上触发）                                                                                                    |
   | `inconclusive`  | 命令在某一侧**没跑起来**（两条入口，见下）        | **不构成证据**。先让它真能跑再复算（两种形态的出口不同，见下）                                                                                        |
   | `load-flake`    | 两侧都红、且两侧输出**都是超时形态**              | **疑似负载假红**，不是别线的红、也不是你的红。先隔离复跑定性（见 §13.6.4），**不要**照 `baseline-red` 登记                                           |

   **为什么「没跑起来」要单独一态**：Node 找不到模块时的退出码是 **1**，与「判据跑了
   且红」逐字同形 —— 只读退出码必然把后者读成前者，而这两件事的下一动作完全相反
   （一个去修代码、一个去查命令/环境为什么不对）。所以这一档不能由退出码判。

   它有**两条入口**，都是实测撞出来的：

   | 入口                                   | 指纹                                                                                                            | 出口                                                                                                       |
   | -------------------------------------- | --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
   | **目标不存在**（静态）                 | `node <相对路径>` 那个文件不在快照里 ⇒ 判据自己造 127                                                            | 那条判据多半只存在本检出的未提交改动里 —— 先提交或修正命令（基线是干净的上游快照，看不到工作区，这是正确语义） |
   | **一条用例都没收集到**（动态，ISSUE #1652） | `Tests  no tests`、`Cannot find package` / `Cannot find module` / `ERR_MODULE_NOT_FOUND` / `MODULE_NOT_FOUND`   | 在基线 worktree 里跑一次 `pnpm install --frozen-lockfile`，或把 worktree 建到与目标侧**同一个盘 / 同一个根**下（`--keep` 会把路径打出来） |

   第二条入口的现场：被 C 组拦下一条 30s 超时，按 §13.6.4 复算，第一次报
   `inconclusive`、第二次却报了 `baseline-red` —— 依据是基线那一侧
   `Test Files  1 failed (1)` + **`Tests  no tests`**（`@testing-library/jest-dom`
   链到了链不上的 `@adobe/css-tools`）。**一个用例都没跑起来**，这不是「判据跑了且红」，
   而它退的是 1，静态那条「目标存不存在」也看不见它（目标在，是运行时依赖链断了）。
   走错这一档的下场不是「结论难看」：`baseline-red` 的下一动作是就地修 / 按 §11.12
   登记，而这次根本没有「一条有主的账」可登 —— 下一次它不红，那条登记从此就解释不清
   （同 §13.6.4 反对把负载假红读成 `baseline-red` 的理由，只是换了触发原因）。

   判据自己的话术会把命中的是**哪一侧、哪一种**打在 `没跑起来：…` 那一行里
   （退出码同形，只有输出里的指纹分得开）；而「收集到了用例」的**反向**也被钉住 ——
   `Test Files  1 failed (1)` + `Tests  3 failed | 5 passed` 必须仍判 `baseline-red`，
   不许把真红吞成 `inconclusive`。

   **为什么「负载假红」也要单独一态**（ISSUE #1641）：它同样与「真红」在退出码上同形，
   而它的归属**第三种** —— 「既不是别线的、也不是你的，是这一刻机器的」。四态里没有
   它时，两侧都红 ⇒ 报 `baseline-red` ⇒ 照那个动作**把一次调度抖动登记进
   `KNOWN_FAILED_FILES`**，而下一次它又不红 —— 那条登记从此就是一条会静默失效的账。
   判据是指纹（两侧输出都带 `Test timed out in …` / `Failed to start forks worker` /
   `超时（Ns）` 这类形态），**指纹不是结论**：命中只说明「值得再验一次」，
   放行仍由隔离复跑的结论定。完整口径见 **§13.6.4**。

   **档位高低**（`judge()` 逐条判的顺序，也是整批 `summarizeRows` 的优先级）：

   ```
   current-green  >  inconclusive  >  yours  >  load-flake  >  baseline-red
   ```

   即：绿压过一切；「没跑起来」压过一切红（127 与「一条用例都没收集到」都算）。

   **Windows 上的 `pnpm exec …` 形态**（ISSUE #1652 顺带）：`pnpm` 在那里是 `.cmd`
   垫片，`spawnSync` 不开 `shell` 就找不到它（`ENOENT` ⇒ 127 ⇒ `inconclusive`）。
   判据现在对 `pnpm` / `npm` 这两个命令开一层 shell，所以那一形态能跑；
   若仍看到 127，话术会直接点名「改用 `node node_modules/<pkg>/<bin>` 形态」，
   而不是让人以为是自己命令写错了。

   **它刻意不做的事**：不 `git fetch`（网络是人的动作）、不替你决定「挡不挡路」、
   不自动登记 `KNOWN_FAILED_FILES`、不自动改判据 —— 那是判断，判据只保证**事实**
   这一半可复算。临时 worktree 建在系统临时目录、跑完即删（`--keep` 保留人工排查）。

2. **判断它挡不挡路**：挡路（硬闸类，所有人都提交不了）就地修掉；不挡路（棘轮类、
   或测试基线红）按 §11.12 登记进 `KNOWN_FAILED_FILES` 并写清归属与「别处更强的执行者」。
3. **修了就写清归属**：硬闸红随本批一起修时，**单独一个 commit + 单独一条
   `changelog.d/` 碎片**，碎片里写明「这条不是本 PR 引入的」＋复算证据（哪个上游提交、
   命中几处）＋为什么顺手收掉。混进功能提交里会让人以为那是本次改动的附带调整。

**为什么允许「顺手修别线的一行」**：一行 class token 替换零业务语义，而它挡住的是
全仓库的提交能力 —— 代价不对称。**判据不是「谁的文件归谁」**：这条判据的成立条件是
「修法的机械性」＋「不修就没人能提交」。反例：别线的**测试断言红**不许这样处理
（那要判据的作者决定并档还是改判据，见 §11.12 的「每一条都写归属与谁来修」）。

**这条纪律的执行者在哪**（ISSUE #1569 收尾前它是「还没有机器判据」的）：

- **第 1 步（复算基线）**：`node scripts/base-check.mjs <被你拦下的那条>` —— 见上面
  那张四态表。它把「哪个上游提交、命中几处」这句碎片必须写的事实**算出来**，
  而不是让人凭记忆复述。
- **第 2 步（挡不挡路）**：仍由人判（硬闸类 vs 棘轮类），判据不代替这个判断。
- **第 3 步（修了写清归属）**：`check-changelog-fragments.cjs` 在钩子里守着碎片的
  形态；「这条不是本 PR 引入的」这句话本身没法机器判（它是叙述），但它引用的
  **复算证据**由 `base-check.mjs --json` 给出，可被复核。
- **合并前跑一遍 `pnpm check:premerge`**（= `node scripts/premerge-check.mjs`）：
  **这一条现在有执行者了**（ISSUE #1591 起立、#1611 拍板收成一条命令）。

  上面三步全是**事后**的（被拦下才知道基线红）。而「我的分支绿 → `master` 绿」之间
  那**一跳**此前没有任何判据 —— 平台侧 squash 合并**不跑本地钩子**，`#623` 之后
  **已无 CI 兜底**（13.5.3）。于是「本地绿」这个事实推不出「合并后绿」，实测代价是
  一批 `tsc` 错直接落进 `master`，然后拦住从它分出的**每一个**提交（硬闸形态）。

  `--base` 补的就是那一跳，且**不新开通道**：它复用「被拦下时复算一条」的同一套事实
  （干净快照 + 五态归属），只是把面从一条扩成一批 ——

  ```bash
  pnpm check:base:batch                    # 复算「钩子里那批全仓判据」
  pnpm check:base:batch --json             # 机器可读（逐条给归属）
  node scripts/base-check.mjs --base "tsc --noEmit"   # 只复算点名的那几条
  ```

  四条设计口径（决定它是不是「看着在守、其实没守」）：

  | 口径             | 做法                                                                                                        | 不做会怎样                                                                         |
  | ---------------- | ----------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
  | **面从哪来**     | 从 `.githooks/pre-commit` 的步骤里**现算**（`run` 与单行 `run_group` 两种形态都收）                         | 抄第二份清单 → 漂；只读 `run` → **漏掉 A/B 两条**（tsc 与 eslint，正是立案那两条） |
  | **哪些能进这批** | 有 `--staged` / `--changed` 的、或只在改动命中某目录时才做事的（`shell-gate`）**一律不收**                  | 问一个它们回答不了的问题（干净快照里没有暂存区）⇒ 一行**假绿**                     |
  | **整批结论**     | 任一条「没跑起来」（127 / 一条用例都没收集到）**压过**「有红」⇒ `inconclusive`；混着 `baseline-red` 与 `yours` 时报更严重的 `yours` | 拿一个无法归因的读数下判决（两者与「跑了且红」在退出码上同形）                     |
  | **快照里的依赖** | `git worktree` 快照里**链上本检出的 `node_modules`**（符号链接、只读方向）                                  | 近一半判据以「红」的形态报错（实测 9 条），结论被污染                              |

  两条环境口径（都是实测撞出来的）：

  - **钩子从被复算的那份检出读**，不锚在脚本安装位置 —— 锚错时在两个不同检出上跑
    同一条命令会各自拿到**对方那份钩子**，而输出看起来完全正常（实测：临时仓库里报
    「50 条判据」，那 50 条来自另一个检出、在临时仓库里一条都跑不起来 ⇒ 整批假红）。
  - **基线引用只认「要并进去的那条」**（各 remote 的 `master` / 本地 `master`），
    **不退回 `@{u}`**。后者是「我这份检出从哪来」，在 PR 分支上就是**你自己的分支**
    —— 拿它当基线等于自己跟自己比，输出「50 条全绿」、看起来一切正常，却一个字节
    都没回答「并进去会怎样」。取不到就判失败让人显式给一条，不拿错的基充数
    （同 §13.6.2 第 1 步那句「取不到上游引用即判复算失败」）。

  它不需要 CI、不花核时、零事件：人点合并前跑一次，或在 PR 里 `@` 评审 NPC 唤起一轮
  （§13.5.4 的「按需召唤」那一层，不 `@` 就不跑）。`pnpm check:all` 仍是**更宽**的那一档
  （它另外跑全量单测 + 覆盖率 + 依赖漏洞扫描），两者不互相替代：`--base` 判的是
  「**这批全仓判据**在合并后会不会红」，`check:all` 判的是「整条质量面」。

  **这批判据的第二个来源：`CHAINED_STEPS`**（ISSUE #1605）。上面那一段说的是「面从
  钩子步骤现算」—— 而有一族判据**天然进不了钩子、却同样属于「合并前该算一遍」**：
  首发成员是 `scripts/check-commit-claims.mjs`（提交信息里的声明 ⇄ 那次提交的事实，
  口径见 11 §11.23.5）。理由是**本地看不到那个形态**：声明说的是某一次提交的树
  （「§x.y 照旧保留」），而丢失发生在**平台侧 squash** 那一刻 —— 实测 `ad81a912` /
  `bdabd26f` / `b9bedd37` 在 `master` 上都是**单亲**，信息里却带 `Merge origin/master
into …` 字样，所以 `check-merge-parents`（§13.6.1）在 squash 之后判不出来（单亲
  是它的**正常形态**）。硬塞进钩子只会让人学会绕开它。

  这一族的成员表在 **`scripts/base-check/chained-steps.mjs` 的 `CHAINED_STEPS`**
  （**事实从它现算**，不在这里抄第二份清单）；它单独成模块有一条具体的理由：
  `scripts/.tsc-diagnostic-executors.json` 把 `base-check.mjs` 的**声明行数**当零增量
  棘轮管（§13.5.14），而这一族的答案在 `--base` 那条链上 —— 写在同目录的这份模块里，
  **棘轮的对象与答案才落在同一个地方**。两条口径：

  - **`baseSide: false`** —— 它**不在基线那一侧跑**：它的对象是本检出这条线上的提交
    对象，而基线快照里没有那些提交（两侧问的不是同一问题）。不排除的后果实测过：
    新判据在基线上必然 `MODULE_NOT_FOUND` ⇒ 127 ⇒ `summarizeRows` 把**整批**压成
    `inconclusive`，而这一批里其它几十条的读数本来是好的。它红的时候只可能是
    「这次提交的声明与它自己的树矛盾」⇒ 纯粹的 `yours`，故另给了 `judgeOneSide`，
    不硬塞进四态的 `judge`（`baseCode === null` 在 `judge` 里会被读成 `baseline-red`，
    也就是**把这条红甩给别线**）。
  - **判的是「本检出相对基线的那些提交」**（`<ref>..HEAD`）—— 与 `--base` 问的
    「并进去之后会不会红」同源；没有待并提交时给空，不报假红。

  新增这一族的成员时，`scripts/.on-demand-duties.json` 里那行也同批加（`fact.kind`
  是 `base-check-chained`，`check-on-demand-duties.cjs` 双向核对会当场发现漏登记）。

  **与「提交信息里的声明 ⇄ diff 的事实」的分工**（ISSUE #1605）：`--base` 自带的
  那批判据复算的是**代码**在合并后会不会红，它读不出「提交信息里那句话是不是真的」。
  那一半归 `scripts/check-commit-claims.mjs`（§11.23.5）—— 立案现场 `ad81a912` 的
  文字自称保留了两节、而那次提交的树里两节都不在，`--base` 原生的那批对这一句无话可说。
  **两者都不进本地钩子**（平台侧 squash 本地看不到形态），但差别在**谁在敲**：
  原生那批由**钩子步骤**现算（人在合并前点一次 `--base` 就跑），而声明那一族是
  **`CHAINED_STEPS`** 收上来的第二个来源 —— 同一个入口、同一次敲击，多算一条事实。

  ##### 13.6.2.1 「合并前的固定动作」是**一条命令**，不是三条纪律（ISSUE #1611）

  这一跳此前有三条**都天然跑不进 `pre-commit`** 的判据（本地钩子面前根本没有那次
  squash 合并）：

  | 判据                    | 核什么                                    | 落点                                |
  | ----------------------- | ----------------------------------------- | ----------------------------------- |
  | `--base` 复算（#1591）  | 钩子里那批全仓判据在**干净快照**上红不红  | `base-check.mjs` 的 `baseCheckMany` |
  | `check:claims`（#1605） | 提交信息里那句「§x.y 照旧保留」是不是真的 | `check-commit-claims.mjs`           |
  | 合并面（#1617）         | 合并有没有把**一侧整份覆盖掉**            | `check-merged-side-loss.mjs`        |

  三条各自的判据都不缺，缺的是**「记住跑全」这件事本身**。把它写成文档里的三条命令
  等于把执行者交给纪律，而纪律的三种漏法（漏跑一步 / 顺序反了 / 只跑了自己记得的那条）
  **都不报错** —— 这正是 §9.2 第 3 条禁止的静默失败，也是本仓库反复踩的那一族
  （「声明写得出来不算数，读的人在跑才算」，§11.23）。

  ```bash
  pnpm check:premerge                 # 三段全跑，人眼看的报告
  pnpm check:premerge --json          # 机器可读（逐段给结论）
  pnpm check:premerge --skip-claims   # PR 里还没写合并信息时
  pnpm check:premerge --only=base     # 只跑一段（排查用）
  ```

  **执行者不再是「人的记性」：这一跳现在挂在 push 上**（`.githooks/pre-push` →
  `scripts/premerge-proof.mjs`）。本地看不到平台侧那次 squash 合并，而 push 是本地最后一个
  紧贴「这条分支要被合」的事件，所以触发点选它。代价实测过四次（同一台机器、同样的
  53–54 条判据红 0）：钩子内三次 **116 / 84 / 83 秒**（第一次 dry-run、后两次真 push，
  每次都完整走过「为什么要跑 → 复算 → 记证明」那条链），单独跑那次 **336 秒**。下界一直在往下走，说明这是
  缓存与机器负载的函数，不是常数 —— 所以**这一串数只写在这一个位置**：AGENTS.md 硬规则 6 与
  钩子打印那句都只说「分钟级」并指回这里。理由与本节立案的那族同源：同一个会漂的量抄到
  三处，就会有三处各自过期的机会（本轮刚在硬规则 5 那条上修过一次「壳里 37 条 `#[test]`」，
  实测已经是 52）。
  —— 每次 push 都跑它，按本仓库的节奏（一天几十次提交）换来的是每人十几分钟墙钟，
  而那不会让人更严谨，只会让人 `git push --no-verify`。所以它只在**两个输入之一变了**时跑：

  ```bash
  # 过期判定（两颗引用 + 一条本机记录）：
  #   本检出的 HEAD  · 上次 fetch 看到的 refs/remotes/origin/master
  git rev-parse HEAD                                # 证明里记的那颗不一样 ⇒ 跑
  git rev-parse --verify --quiet refs/remotes/origin/master   # 前移了 ⇒ 跑
  ```

  证明写在 **`.git/comfy-premerge-proof.json`**，不入库。理由是它记的是「**这台检出**在某个
  上游引用位置上复算过某一颗 HEAD」：放进版本库就会让同仓的并行检出互相作证（A 跑过、B
  直接免检），而假证正是这一族最坏的形态。它也**没有**登记成第四档新鲜度账 ——
  `FRESHNESS_TRACKS` 那三档的语义是「仓库级、今天有人自证过」，与本条的「这台检出对这两颗
  引用复算过」不是同一件事；登记了就会被 pre-commit 判成「每天必须跑一次五分钟」，那是另一
  种仪式。

  四条口径要说清，否则这条线会变成新的说谎源：① 上游引用来自**上次 fetch**，判据不做网络
  请求，所以话术里不许出现「已最新」（与 §13.5.13 同一条口径）；② 取不到上游引用时
  **退 2 拦住 push**，不许读成「没必要跑」—— 那会让没 fetch 过的检出静默免检；③ 红按
  **归属**决定拦不拦，不按「有没有红」决定：`yours` / `load-flake` / `inconclusive` 一律拦，
  逐条全是 `baseline-red`（master 上本来就红）时放行、但把每一条念出来并随证明记下 ——
  「不挡路」不等于「不说」。立案现场：这条线接上不到十分钟就撞上一条红，上游刚加的
  「基础设施层文件长度棘轮」在**干净的 origin/master 上就已经命中**（那条文件 957 行、
  基线登记 952），若照「有红就拦」，等于把别人的库存红变成每个人每次 push 的墙钟，
  而这一族最终的结局只有一个：学会用 `--no-verify`。归属由 `base-check --base --json` 的
  逐条 `verdict` 给出（只在 base 段报红的稀有路径上多问一次，绿路径仍只跑一次）；
  别的段（提交信息里的声明 / 合并丢一侧）红了不查归属，按构造就是本分支的事；④ 证明只在
  **没有引入新的红**时写（全绿一条干净的，`baseline-red` 那条带名单），红着不记 ——
  「跑过」与「跑绿过」是两件事（与 §11.8 同形）。
  钩子那侧只负责调用与 stdin 的分配（pre-push 的 stdin 只能读一次，LFS 与复算都要它），
  判据与编排一律不重抄（§12.12）。这条接线由 `tests/premerge-push-trigger.test.ts` 守着，
  并登记在 `scripts/affected-tests.mjs` 的固定清单里 —— 改 `.githooks/**` 会让增量层放弃收窄，
  守接线的那条如果只跟着改动走，恰好会在「有人把这一行注掉」那一次一条都不跑。

  **它不发明第二套编排**（§12.18 / §12.12）：`base` 段**直接 import** 既有实现的
  `baseCheckMany` + `resolveMergeBatch`（连「面从钩子里现算」这条都不再抄一份），
  另外两段是**子进程 + 退出码原样透传**。本入口只做两件事：**筛段**与**合成总码**。

  | 口径         | 做法                                                                          | 不做会怎样                                                   |
  | ------------ | ----------------------------------------------------------------------------- | ------------------------------------------------------------ |
  | **总码合成** | **「没跑起来」(2) 压过「红了」(1)**                                           | 拿一个无法归因的读数下判决 —— 正是 §13.6.2 第 1 步那条实测   |
  | **四态折算** | `current-green`=0 / `yours`·`baseline-red`=1 / `inconclusive`=2，只在**一处** | 两处各折算一遍 → 漂，且「同一个事实在两条入口上说成两回事」  |
  | **筛空**     | 三段全被跳过 ⇒ **退 2**，不许报全绿                                           | 「什么都没复算」被读成「复算过且全绿」（静默的绿比没有更坏） |

  **第三段的锚点由入口自己算**（`resolveLossBaseline()`）：`check-merged-side-loss.mjs`
  需要一个 `--baseline`，而它在「合并前」这一刻**是算得出来的** —— 就是那条线的
  **分叉点**：

  ```bash
  git merge-base <要并进去的那条> HEAD      # = 锚点
  ```

  语义与判据本身对得上：它问的是「结果版是不是退回了**基线之前**的某一版」，所以
  「基线」是分叉点，**不是上游的尖端** —— 拿尖端会把分支侧自己的正当改动整片读成
  差异（那个方向上的误报会让这条判据被学会绕开）。这与 `.githooks/prepare-commit-msg`
  那条提交前档（#1618）同源，那边用的是 `MERGE_HEAD` + merge-base。

  这一格**不是**「让判据自己算锚点」：那正是 #1605 §4 判过的天真形态（推「被丢的
  那一侧是谁」，而它在 squash 之后常已不可达，实测 `ad81a912` 上 128 份改动 → 0 命中）。
  分叉点是另一个问题，由 `merge-base` 直接给出。**算不出时退 2 并说清原因**
  （无上游引用 / 浅克隆），绝不静默退 0。

  **它回答「不是合并」这种正常形态**：「合并有没有丢一侧」那一格在 HEAD 不是合并时
  （日常、以及平台侧 squash 出来的提交）**跳过并退 0**，但**要说话**（打印「跳过：…」
  与原因）—— 这个 0 由「确实没有合并可判」担保，不由「判据没跑」担保。
  它与「取不到提交 / 浅克隆」是**两档**：后者退 2，绝不与前者混成一档（混了以后
  「这个动作天天报不构成证据」，真正的故障反而被噪声淹没）。

  > **这一格踩过一次坑，值得记下**：第三段最初写成裸 `script` + `args: []`，于是它
  > **恒退 2**（缺 `--baseline`）、整个入口**恒报「不构成证据」** —— 一次事实都没
  > 复算过，而输出看起来像「环境问题」。这正是本仓库反复踩的那一族：**判据在场、
  > 却什么都不做**。修法不是把判据降级，是把锚点补齐（见上）。

  **它不替代 `pnpm check:all`**：后者是更宽的那一档（另外跑全量单测 + 覆盖率 +
  依赖漏洞扫描）。`--base` / `premerge` 判的是「这一跳会不会把红带进 `master`」，
  `check:all` 判的是「整条质量面」。

  跨平台侧照 §9.5 的口径两处同步：`quality-gate.mjs` 的 `GATES.premerge`（`run: false`）
  与 `quality-gate.ps1` 的 `$Blocks` + `-Mode` 单选值（`check-ps1-consistency.mjs` 在
  pre-commit 核对）。**登记**：`scripts/.on-demand-duties.json` 的 `premerge-fixed-action`
  行（机器事实取 `GATES.premerge` 的 `run: false`）+ §11.23.3 索引里的 `premerge-fixed-action`。

#### 13.6.3 「环境里跑不到门禁」不是结论 —— 先 `pnpm install`（ISSUE #1568）

13.6.2 说的是「**别人的红**怎么处置」。这一节说的是它**怎么进来的**里最隐蔽的一条：
**把「还没装依赖」读成「本机跑不了门禁」，据此跳过校验，再把这件事写进提交信息。**

**为什么这个读法是错的**：本仓库依赖**全部来自公开 registry** —— `pnpm-workspace.yaml`
里没有任何私有源配置，`minimumReleaseAge: 0` 也已关掉发布年龄门槛。所以**任何**检出、
**任何**容器 / NPC 工作区 / CI 镜像都把依赖装得上。`node_modules` 缺失只表示
「**还没装**」，与「本机不支持校验」是两件完全不同的事。

**实测读数**（无依赖容器冷启，实测口径供参考，不要在文档里当承诺写死）：

| 动作                                | 结果                                              |
| ----------------------------------- | ------------------------------------------------- |
| `pnpm install --frozen-lockfile`    | exit 0，冷装约 8 分钟（无私有源、无额外构建工具） |
| `pnpm exec tsc --noEmit`            | exit 0，零行输出                                  |
| `pnpm run lint`                     | exit 0（`--max-warnings 0`，零警告）              |
| `pnpm exec vitest run <受影响文件>` | 全绿                                              |

**代价不对称**：装一次依赖是八分钟；而「跳过 tsc / eslint / vitest + 在提交信息里
写一句『走不到门禁』」的代价，实测是 **25 条 `tsc` 错落进 `master`**，然后拦住从它
分出的**每一个**提交（13.6.2 的硬闸形态）。前面那八分钟是为了不付后面那份账。

**判据入口**：`pnpm check:toolchain`（`scripts/check-pnpm-available.mjs`）。它现在正面
回答那个被误判的问题 —— 依赖未装时分三行给「能不能装 / 装多久 / 装完能跑什么」，
并且显式点名「不得以本容器无 node_modules 为由跳过门禁」。它的 `node_modules` 判据
**直接 import 启动器的 `checkNodeModules()`**（`scripts/launcher-core/worktree.mjs`），
不再维护一份「只查 `.modules.yaml`」的弱化副本 —— 两份口径并存时，自检说 OK、启动器
说残缺（或反过来）是必然的，而那正是「同一个判断两个实现各自漂移」的老形状。

**答「跑不到」的唯一合法情形**：`node` / `pnpm` **本身**不可用（且 `corepack` 也修不
回来）。那时 `pnpm check:toolchain` 报的是**工具链**（非零退出 + 修复动作，见 §2.1.1–2.1.4），
**不是**依赖。分清这两件事就够了：依赖能装，工具链才可能真的没有。

**允许的最小动作**：`pnpm install --frozen-lockfile`（首次上手先 `pnpm env:init` 生成 `.env`，
否则 `.env` 预检会在起服务前拦下，见 launch-and-build §9.1）。装依赖期间**不要**跑
`pnpm dev`（原生模块被进程锁定会 EPERM，AGENTS 硬规则 9）。

#### 13.6.4 时间型判据在 CPU 高负载下容易误红 —— 先隔离复跑，别抬预算（ISSUE #1641）

**判据一句话**：一条门禁/用例的红**如果带着超时形态**（`Test timed out in …`、
`Hook timed out in …`、`Failed to start forks worker`、`Timeout waiting for worker to
respond`、本项目 `with-timeout` 出口的 `超时（Ns）`），那它**首先是一个负载读数**，
不是一条结论 —— 先用 `--no-file-parallelism` 隔离复跑定性，再决定它是什么。

**为什么这件事在本仓库特别容易发生**：门禁用例普遍要**真起子进程**（Node / git /
prettier / vitest worker），而它们与「等资源」争的是同一样东西 —— 核。于是同一条
用例的墙钟与机器有多满**成正比**。实测（8 核容器，全量 66 个结构判据 = 钩子 C 组那一批）：

| 机器负载                            | C 组墙钟 | 结果                                                                                  |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------- |
| 8 核空闲（load ≈ 0）                | 31.9s    | 662/662 全绿                                                                          |
| 压到 load ≈ 16                      | 124.5s   | 662/662 全绿（慢 3.9×）                                                               |
| 压到 load ≈ 26                      | 182.8s   | 662/662 **仍全绿**（慢 5.7×）                                                         |
| 压到 load ≈ 42（再叠 60+ 自旋进程） | 230.8s   | `tests/check-a11y-rules.test.ts` 报 `Test timed out in 30000ms`，**隔离重跑立刻全绿** |

最后一行是这一节的现场：**同一份代码、同一个提交**，红的只是「那一刻机器有多满」。
`--no-file-parallelism` 单跑那份文件 4.0s 全绿。

**为什么四态不够用**（ISSUE #1641 的机制缺口）：负载假红**两侧都会红**，于是
`base-check` 的 `judge()` 会把它读成 `baseline-red`（「别线的红」）—— 而它既不是别线
的红、也不是你的红，是**这一台机器这一时刻的**红。照 `baseline-red` 的动作走
（就地修 / 按 §11.12 登记 `KNOWN_FAILED_FILES`）等于**把一次调度抖动记进历史**，
而下一次它又不红 —— 那条登记从此就是一条会静默失效的账。

所以 `base-check` 补了**第五态 `load-flake`**：两侧都红、且**两侧输出都带超时指纹**时
报它（只在单侧超时形态**不**降这一档 —— 那更像「你的改动让它变慢了」，归 `yours`；
`inconclusive` 仍然压过它）。整批的优先级是 `inconclusive` > `yours` > `load-flake` >
`baseline-red`。

##### 13.6.4.1 钩子自己会做这件事 —— 超时形态自动「等负载回落 + 隔离复跑」（ISSUE #1657）

上面那节写的下一动作「隔离复跑定性」在一段时间里**只有人能跑**：被拦下的人得先想到
`base-check`、再手敲 `--no-file-parallelism`，才知道那是不是假红。于是「无论机器多忙，
提交都能正常走下去」这件事**在钩子这一侧没有执行者** —— 超时就是终局。

现在有了，落在 C 组的启动器 `scripts/run-affected-tests.mjs` 里（口径一个字没改，
只把「重测一次」这一步机器化）：

| 情形                                             | 动作                                                                                  |
| ------------------------------------------------ | ------------------------------------------------------------------------------------- |
| 第一遍绿                                         | 照旧通过（不等、不复跑 —— 绿的那一档不付这份钱）                                      |
| 红、**不带**超时指纹（`AssertionError` 等）      | 一次都不复跑，直接阻断（**不把真回归洗成负载假红**，这是这一档最该守住的方向）         |
| 红、**带**超时指纹                               | 等机器喘口气，再 `--no-file-parallelism` 复跑**同一份清单**一次                       |
| 复跑**绿**                                       | 放过 —— 负载假红                                                                      |
| 复跑仍红、**指纹已消失**（真断言 / 真挂死）      | 阻断（真红），指向 `base-check` 复算归属                                              |
| 复跑仍红、**指纹仍在**（连单进程串行都排不上）   | **未校验**：放行 + 逐条点名「哪几份这次没被校验过」+ 复验命令 —— **不是绿、也不是红** |

三条**刻意**的形状：

1. **触发面窄**：只有带超时指纹时才复跑。真断言红不带指纹，一次都不复跑 ——
   放宽成「是红就复跑」等于放行一切（`tests/hook-affected-launch.test.ts` 用注入的假
   `spawn` 把五个方向各变异一次，全部被拦）。
2. **复跑只能更隔离，不能更松**：串行单进程 + 同一份清单，**不抬任何预算**
   （这条是上一节那句「不要把预算再抬一档」的机器形态）。指纹清单与 `base-check.mjs`
   的 `TIMEOUT_SIGNATURES` **逐条同源**，由用例比对，防两份判别式漂移。
3. **判据只看「两遍测量各自的形态」，不看机器负载**（ISSUE #1747）：
   指纹在**第一遍**只说明「值得再测」，在**第二遍**才说明「给不出可信读数」。
   实测（8 核容器，同一份代码）——

   | 机器负载                     | 结果                                                    |
   | ---------------------------- | ------------------------------------------------------- |
   | 空闲                         | 21s，691/691 全绿                                       |
   | load ≈ 67                    | 205s，全绿                                              |
   | load ≈ 182                   | 4 条 `Test timed out`（30s ×2、120s ×2），自动复跑启动  |
   | **load ≈ 300，串行复跑**     | **仍有 1 条 30s 超时**（同一文件、另一条用例）          |
   | 负载归零后单跑那份文件       | 19s，32/32 全绿                                         |

   最后两行说明「串行是一剂药，但不是万能药」：负载到 300 时连单进程都排不上，
   而复跑那一刻机器还是满的。

   **这一档曾经因此判错**（ISSUE #1747，实测现场）：它拿 `os.loadavg()` 当判据 ——
   高于阈值就有界地等（5 分钟），等不到就「按真红上报」。三处都是病：

   ① `loadavg` 是**全局**读数，分不清「机器被别人占着」与「钩子自己就是负载来源」。
   钩子自己就吃掉约 1.0–1.2/核，阈值 1.5 只留一点点余量 ⇒ 共享机上永远落不下来；
   ② 等不到就把「**拿不到测量**」读成「测量结果不好」⇒ 阻断，而提交者没有任何代码可修
   —— 这正是「因为负载导致的红」本身；
   ③ 预算**逐块**计，块一多就是 5 分钟 × N。实测 8 块压到 load≈300 时：
   **`rc=1`、墙钟 1867197ms（约 31 分钟）**，红的全是同一份文件
   `tests/ratchet-update-guards.test.ts`（`Test timed out in 30000ms` / `120000ms`），
   中间刷了 66 行「每核负载 37.5（阈值 1.5）—— 等它回落再复跑」，最后以
   「这次的红**归不到代码上**，但它也不是绿」结尾 —— **然后照样阻断**。

   现在的判据换成**用第二遍测量的形态说话**，不再看 `loadavg`：第一遍带指纹只说明
   「值得再测」；第二遍**也**带指纹才说明「这台机器此刻给不出可信读数」⇒ 记
   **未校验**（放行 + 点名，且明说「它等价于这次没测」）。理由：失败的形态是调度
   （`Test timed out` / `Failed to start forks worker`），**没有任何一条断言报错** ——
   那既不是「通过」的证据，也不是「失败」的证据。等待那一层降级成**纯优化**
   （让机器喘口气、提高第二遍出可信读数的概率），预算收成**整次提交一份**。

   ⚠️ 这一档**不是放行**：真断言红一次都不复跑、照旧阻断；第二遍指纹消失（真断言 /
   真挂死）也照旧阻断。只有「隔离复跑之后仍然拿不到可信读数」才放行，且必须点名。

   ⚠️ **Windows 上 `os.loadavg()` 恒为 `[0,0,0]`**（Node 的既定行为）：等待那一层
   退化成「不等」，而判据本身与 `loadavg` **已经无关**，所以两平台同结论。

**这条纪律与「顺手修别线一行」的边界**（原节结论不变）：`load-flake` **不适用**
§13.6.2 那条「就地修别线的红」的豁免 —— 它没有文件可修，修它等于改机器。也**不许**
把它登记成 `KNOWN_FAILED_FILES`。自动化只是把「重测」这件事做了，**归属判定与登记口径
一个字没变**。

**⚠️ 指纹不是结论**：命中只说明「值得再验一次」。真回归也可能恰好卡在超时上 ——
所以 `load-flake` **不许**当作放行依据，放行的判据是隔离复跑的结论：

1. **隔离复跑**：`pnpm exec vitest run --no-file-parallelism <那份文件>`（单个脚本类判据
   直接 `node scripts/<那条>.cjs` 再跑一次就够）；
2. **仍红、指纹已消失**（真断言 / 真挂死）⇒ 按真回归处置 —— 这时它是 `yours` 或
   `baseline-red`，重跑一次 `base-check` 即可复算（负载没了，两侧的差异就露出来了）；
3. **绿** ⇒ 就是负载假红：**为它降负载或直接放过**，并在提交说明里点名
   「这次是负载假红」（写清是哪条、隔离跑多快 —— 下一个人才知道他看到的红是不是同一种）；
4. **仍红、指纹仍在** ⇒ **未校验**（钩子那一档的行为，见上）：这一遍给不出可信读数，
   既不能说它过、也不能说它错。**不许**把它读成 `baseline-red` 登记、**不许**写进提交
   说明充当「已通过」—— 它的正确读数是「这次没测」，下一动作是等机器空下来自己复验。

**不许做的事（这一节的主要敌人）**：**不要把预算再抬一档**。看到
`Test timed out in 30000ms` 就把 `testTimeout` 改成 60s，是把「真挂死」的检出时间
一起放大，而且下一次没人知道这个数是怎么来的（§11.13 那句「看到 60s 都超时不要改成
120s」是同一件事）。**降负载的杠杆是并发，不是预算**：跑之前把 dev server / ComfyUI /
出图让开，或按 §13.5.8 核对 `--maxWorkers`（钩子 C 组是 4、全量是 8）。

**这条纪律与「顺手修别线一行」的边界**：`load-flake` **不适用** §13.6.2 那条「就地修
别线的红」的豁免 —— 它没有文件可修，修它等于改机器。也**不许**把它登记成
`KNOWN_FAILED_FILES`：那张表的每一条都要有「别处更强的执行者」，而负载假红没有归属，
登记进去只会让那张表多一条永远解释不清的账。

**同类的前例（同一族结论，处置各自不同）**：

- §11.13「并行变红不等于回归」—— 测试层的第一版口径（串行绿才是假红）；
- §11.19.1 档 E —— `check-a11y-rules` 的 10/10 超时：修法是**降成本**（共进程 + 一次性
  真加载），不是抬预算；
- §11.13 那条「量具在满载下不再发生竞态」的第三类红 —— 它报的是 `AssertionError`
  而不是 `timed out`，**别把「串行绿 = 预算」套上去**（失效的是前提不是预算）。

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
- 开发过程中沉淀的**工具、脚本、流程约定、规范缺口** likewise 必须归档（例如新的诊断脚本用法、换行符处理参数、CHANGELOG 维护方式），确保后续开发者能复用而不是重新踩坑。
- 归档时机：PR 合入前随代码一起提交（`docs` 类提交），保证"代码 + 规范"原子更新。

### 13.10 CHANGELOG 记录规范

`CHANGELOG.md`（仓库根目录）记录**两次发布之间用户可感知的差异**。它与注释、commit message
构成三层分工，**三者不要互相抄**：

| 层             | 记录什么                                                 | 读者               | 载体                                                                     |
| -------------- | -------------------------------------------------------- | ------------------ | ------------------------------------------------------------------------ |
| 代码注释       | **当前代码为什么是这样**（决策、被否决的方案、隐式契约） | 改这行代码的维护者 | 注释，见 [12.4](12-代码组织与文件结构.md#124-注释规范只写当前代码的-why) |
| Commit message | **这一次改了什么、为什么改**（含评审背景与取舍过程）     | Reviewer / 排障者  | `git log`，见 [13.2](#132-commit-message-规范)                           |
| CHANGELOG      | **两次发布之间用户能感知到的差异**                       | 使用者 / 升级方    | `CHANGELOG.md`                                                           |

#### 13.10.1 该记

- **破坏性变更**（数据结构 / API / 配置 / 依赖升级）——必须附迁移方式
- 新增用户可见功能
- **行为变更**：即使不是缺陷修复（默认值、UI 形态、交互路径变化）
- 影响升级或数据迁移的修复

#### 13.10.2 不该记

- 纯内部重构（不改变外部行为）
- 类型收紧 / lint 清理 / 失效 `eslint-disable` 回收
- 注释与文档修订（例外：规范变更直接影响开发流程时记入 `Changed`）
- 测试补充
- 单个内部函数 / 私有模块的改动

> **判据**：「升级方需要为这条改动做任何事，或会看到任何不同吗？」——都不会，就不进 CHANGELOG。

#### 13.10.3 与 commit type 的对应

| type                                | 是否进 CHANGELOG                                        |
| ----------------------------------- | ------------------------------------------------------- |
| `feat`                              | 通常进 `Added`                                          |
| `fix`                               | 通常进 `Fixed`                                          |
| `perf`                              | 进 `Changed`，**仅当**带来用户可感知的体感差异          |
| `refactor`                          | **不进**（定义即不改变外部行为）                        |
| `docs` / `chore` / `test` / `style` | **不进**（例外同上：影响开发者流程时在 `Changed` 注明） |

#### 13.10.4 格式与时机

- 格式遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，段落固定为
  `Added` / `Changed` / `Deprecated` / `Removed` / `Fixed` / `Security`；
  版本号遵循 [SemVer](https://semver.org/lang/zh-CN/)。
- 未发布条目放 `## [Unreleased]`；发版时改为版本号 + 日期（`## [0.2.0] - 2026-09-15`）。
- **维护时机**：PR 合入前随代码一起改（对齐 [13.9](#139-优化点归档强制) 的同提交原则）。
  **禁止发版前集中补写**——集中补写必然漏项且失真。

#### 13.10.5 碎片化落地：改 `changelog.d/`，不改 `CHANGELOG.md`

`CHANGELOG.md` 的 `[Unreleased]` 是**全仓库唯一「人人都改、且都改同一个地方」的文件**：
两条并行分支（或两个 agent 同时开工）往里追加条目时，必然落在同一行区间 ——
无论谁先合，另一方都要手工解一次冲突。这段冲突没有任何信息量：两边的条目都
该保留，没有真正的取舍，纯粹是把同一份文本排两遍（ISSUE #408）。

因此条目**先进碎片目录，由脚本并入**：

| 环节        | 载体                                                | 谁写                                         |
| ----------- | --------------------------------------------------- | -------------------------------------------- |
| 开发中      | `changelog.d/<issue号>-<slug>.md`，一件变更一个文件 | 改代码的人（随 PR 提交）                     |
| 发版 / 整理 | `CHANGELOG.md` 的待发段落（`[Unreleased]`）        | `node scripts/merge-changelog-fragments.mjs` |

**并入哪一段由「来源锚」决定**（见 [13.10.6](#13106-段落锚待发段落标来源并入时对账)）：
脚本挑**锚最早**的那个待发段落，并顺手把锚刷新成「本轮条目里最早的那个提交」
（`--anchor <commit>` 可显式覆盖）。

**碎片写法**（与原先写在 `CHANGELOG.md` 里完全一致，只是搬了地方）：

```
changelog.d/408-changelog-conflict-free.md
────────────────────────────────────────────
## Changed

- **更新日志改成一件变更一个文件，并行开发不再撞车（ISSUE #408）**：……
```

- **文件名**：`<issue号>-<slug>.md`（`408-changelog-conflict-free.md`）；
  无 ISSUE 号用 `0-`；slug 用小写英文与 `-`。
- **首行**：段落标题（`## Added` / `## Changed` / `## Fixed` / …），它决定条目
  并入 `[Unreleased]` 的哪一节，**不能省**。
- **正文**：一条变更一行、以 `- ` 开头、写法同原 `CHANGELOG.md`。
- 一个 PR 里有多条**不同类型**的变更 → 建多个碎片文件（`Added` 一个、`Fixed` 一个），
  这本身就是「不同文件不冲突」的用法。

**门禁与工具**

```bash
node scripts/check-changelog-fragments.cjs            # 校验碎片形态(pre-commit 自动跑)
node scripts/check-changelog-versions.cjs             # 待发段落的来源锚 ⇄ 条目归属(pre-commit 自动跑)
node scripts/merge-changelog-fragments.mjs            # 并入带锚的待发段落并删除碎片
node scripts/merge-changelog-fragments.mjs --check    # 只预览,不落盘
node scripts/merge-changelog-fragments.mjs --anchor 9321411   # 显式指定本轮最早的那个提交
node scripts/merge-changelog-fragments.mjs --release 0.2.0    # 并入并把待发段落定版
```

**为什么不是「只在发版时统一写」**：那会退回「集中补写」，必然漏项失真
（[13.10.4](#13104-格式与时机) 已明令禁止）。碎片方案保住「随 PR 一起写」的时效性，
只把**文本冲突**改成**文件合并**。

> **与「一个提交只做一件事」的关系**：碎片文件使「同一 PR 内多人协作同一份
> 变更记录」成为 git 层面不可能冲突的操作，这是 [13.7](#137-换行符与提交噪声lf)
> 「禁止无关全文件变更」在 changelog 上的自然延伸 —— 每次改动只碰属于它的那个文件。

#### 13.10.6 段落锚：待发段落标来源、并入时对账

`[Unreleased]` 的边界此前**只是一句话**（「发版时把它改成版本号」）：条目一路往尾部
追加，而**没有任何东西记得住这一段从哪儿开始**。实测的现场是两个毛病叠在一起 ——

- `[Unreleased]` 里躺着 9 月 12 日（`9321411`）到 9 月 25 日以后的条目，而
  `## [0.1.0]` 顶着 **8 月 31 日**的日期、正文只有一句「首个版本基线」：**两个状态
  没有共同的时间轴**，读的人回答不了「这一条到底进没进 `0.1.0`」；
- `[Unreleased]` 里**至今写着**一条已被推翻的旧条目（「对外参数在画布上是可连线的
  节点（ISSUE #355）」，该能力早已由 `changelog.d/0-editor-canvas-no-param-cards.md`
  推翻，那份碎片自己还专门写了「本条**取代** `[Unreleased]` 里那一节」）——
  它是**「并入没走完」的残迹**：`0-` 开头的碎片不需要 ISSUE 号，也没有任何东西
  提醒它「该并入了」（`merge-changelog-fragments.mjs` 只在人敲它的时候跑）。

**做法**：**待发段落**（`## [Unreleased]`，含仓库自己写过的 `## [未发布]`）带一行
**来源锚**，写「这一段里最早的条目是哪个提交带进来的」。

```
## [Unreleased]
<!-- since: 9321411 — 对外参数那一批的最早一条 -->
```

三条边界（都不许省）：

1. **锚不是每段的必修项，但「歪了」与「没写」必须分开处置**。新开的待发段落会在
   **第一次并入时**由 `merge-changelog-fragments.mjs` 顺手上锚（它手上正好有那个事实），
   在此之前它本来就没有来源可言。反过来，**写歪的锚比不写更贵** —— 它看上去像一条
   来源记录，读的人不会再去想「这里为什么没有锚」，而实际一个字段都核不了。
   实测过这一格：把提交换成日期之后，识别锚的那条严格正则回 `null`、整份判据**照样
   全绿**。所以判据另有一条宽松形状（任何 `<!-- since:`），命中宽松、不命中严格 ⇒ 当场红。
2. **锚必须能在本仓库历史里解析成提交**（`git cat-file -e <rev>^{commit}`）。写一个
   日期、写一个分支名、写一个不存在的短哈希，都等于**没有锚** —— 锚是给别人复算用的。
   写入侧（`merge-changelog-fragments.mjs`）在落盘**之前**就用同一条判据拦一次：
   并进去之后再发现，账上已经多了一条查不到出处的记录。
3. **只拿它与源码归属对账**：判据核的是「同一个 ISSUE 号有没有**跨锚分裂**」——
   既出现在待发段落里、又出现在它**之前**（文件里排在它下面）的已发布段落里。那是最贵的
   失效形态：一条变更的归属被切成两半，而**两端都没写错**（现场就是同一条变更的两种
   说法同时留在账上）。**刻意不判**「锚是不是真的等于那一段最早条目的提交」—— 条目文本
   与提交信息之间没有稳定映射（条目是人写的散文，一条提交可能改多条、也可能一条都不进
   CHANGELOG），拿启发式去对会在第一次「一条提交里混着多个 ISSUE」时误报一片，
   而误报的判据活不过一次评审（§11.18.4）。

> ⚠️ **「哪些段落算待发」这条口径本身也有一个静默失效面**（同批实测撞到的）：
> 把带日期的版本段落（`## [x.y.z] - <日期>`）也算成待发，第 3 条那句「锚**之前**的
> 已发布段落」就**永远是空集** —— 判据会一直绿，而它什么都没核。所以待发段落**只**
> 是 `[Unreleased]` / `[未发布]`：`--release` 定版那一刻，这一版的条目就归属了那个日期。

**写法侧**（`merge-changelog-fragments.mjs`）：并入的位置**由锚决定**，不由「谁排在
文件最上面」决定 —— 它把碎片的条目放进**锚最早**的那个待发段落，并顺手把锚刷成
「本轮新增条目里最早的那一个」（缺省 = 当前 HEAD，`--anchor <commit>` 显式覆盖）。
于是锚总是「这些条目里最早的那个提交」，而不是写这条的人当时的 HEAD。段落的标题
在 `--release <版本>` 之外**不动**：`[Unreleased]` 不会因为并一次就长出版本号。

**判据**：`scripts/check-changelog-versions.cjs`（pre-commit 的 D 组「待发段落的来源
锚 ⇄ 条目归属」）三件事 —— 锚的形状（歪 ⇒ 红）、锚解析不解析得开、ISSUE 号有没有跨锚分裂；
外加「判据自己不许静默降级」（`CHANGELOG.md` 读不到 / 一个待发段落都解析不出 ⇒ 判失败，
不是「没有段落要查、于是放过」，§11.23.3 同款）。

**它刻意不做的事**：不判「该不该发版」（那是发布判断 —— 与 `check-app-version.cjs`
只判三处**逐字相等**、不判「该不该升」同款）、不建派生文件、不替谁决定条目属于哪个
版本（只保证「归属落下来之后**能被核验**」）。

#### 13.10.7 ISSUE 号是「改动 ⇄ 诉求」之间的唯一接线：写错比不写更贵（ISSUE #1693）

碎片名里的那个号、commit message 末尾那个号、规范与脚本注释里的那个号，**是后来所有人
从「一张单」找到「一批改动」的唯一线索**。它一旦挂错，那张单的正文就再也接不上实现 ——
而**没有任何判据会红**（号本来就是个字符串，谁都能填）。

真实事故（ISSUE #1693 的由来）：一张**页头标题重复**的 UI 单，被挂上了「`[Unreleased]`
补来源锚」那一批改动的号 —— commit、碎片名、`.githooks/pre-commit`、三个脚本、规范
§13.10.6 里全是 `ISSUE #1693`。结果是两头都坏：

- 那张 UI 单的实现**一行没动**，看单的人以为「做完了」（PR 都合并了）；
- 那批 changelog 改动**反过来占了别人的号** —— 谁查 #1693 都只会读到一堆 changelog
  术语，原意被彻底盖掉。

**口径**：

1. **动手前先读那张单的正文**（标题够不够不看），确认诉求与要做的事是同一件；
2. **没有对应单，就走 `0-` 前缀**（`changelog.d/0-<slug>.md`，同目录里无号碎片一直
   是这个形态）—— 规范与 commit 说明里也**不写**任何号。**「不写」是可核的，
   「写错」不可核**；
3. 已经挂错了：改 commit 说明够不着的（已合并的历史）由**当次 PR** 把尚在仓库里的
   引用一并摘干净（碎片改名、脚本 / 钩子 / 规范 / 生成物同批），并在碎片里写一条
   `## Fixed` 说明这次摘了什么 —— 与 §13.5.5 的「生成物与源同批」同一条动作。

### 13.11 随手改与 TODO 记录规范

浏览、修改代码时，如果发现不符合本规范、可优化或设计不合理的地方：

1. **5 分钟内能顺手修**的（命名、单字母变量、注释 Why、简单重复代码、失效禁用指令、
   类型收紧等）：直接改，与当前改动一起提交。
2. **超出现有 PR 范围、需要单独设计或改动较大**的：必须留下记录，禁止「先堆债再说」。

#### 13.11.1 记录方式

- **代码内 TODO**：在问题最近的位置加 `// TODO: <原因> · <建议方案或指向的 issue/文档>`。
  - ❌ `// TODO: fix`（无原因、无方案）
  - ✅ `// TODO: 该循环 O(n²)，节点数 >500 时卡顿；建议改为 Map 索引`
- **文档归档**：可复用的模式、工具链约定、规范缺口，归档到本套文档或主规范
  （见 [13.9](#139-优化点归档强制)）。
- **Issue / 任务单**：涉及跨模块、需要排期的，建 issue 并在 TODO 中引用编号。

#### 13.11.2 Review 时的债务拦截

Reviewer 在 Code Review 中发现未记录的新债务时，应要求：

- 要么顺手修；
- 要么在该 PR 内留下 TODO / issue；
- 要么明确说明为什么现在不能修（并入
  [13.4 Code Review 重点维度](13-提交与-code-review.md#134-code-review-重点维度) 的可维护性检查）。

---
