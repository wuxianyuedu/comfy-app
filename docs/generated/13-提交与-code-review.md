<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/standards/13-提交与-code-review.md`。改动请回源文件，再重新生成。 -->

## 13. 提交与 Code Review

> 规范落地靠流程保障。本章给出提交前自查、PR 描述、Review 重点维度的可执行清单。

### 13.1 提交前自查清单

提交前快速扫一遍，能拦住 80% 的问题：

- [ ] **反模式速查表**（见 [14](14-反模式速查表.md)）逐条对照，无命中
- [ ] 工作区换行符为 **LF**（CRLF 文件在本次提交一并转 LF，禁止增量混用，见 [13.7](#137-换行符与提交噪声lf)）
- [ ] `tsc --noEmit` 通过（类型检查零错误）
- [ ] `pnpm run lint` 零错误零警告（`--max-warnings 0`；扫描范围是白名单，见 `eslint.config.js` 顶部）；无 `set-state-in-effect` 违规（React 19，见 [8.6](08-异步与副作用.md#86-避免-useeffect-内-setstate-触发循环)）
- [ ] 新增/修改的组件有对应测试或手动验证记录
- [ ] 无 `console.log` 遗留（生产代码；`LogProvider` 拦截的 `console` 除外）
- [ ] 无 `eslint-disable` 新增（确需禁用须单行 + 原因注释）
- [ ] 无 `any` / `as Record<string, any>` 新增（确需用 `unknown` + 类型守卫）
- [ ] 无单字母变量新增（循环索引 i/j/k、catch 参数 e、占位 _ 除外）
- [ ] 新写的逻辑确认过全库无等价实现；属通用能力的已落到地基（`src/lib/<domain>` / `core`）而非埋在 feature 目录，也没为「这次不一样」复制粘贴（见 [12.18](12-代码组织与文件结构.md#1218-复用优先写之前先查缺能力补地基不造第二轮子)）
- [ ] 注释无作者 / 日期 / 版本流水，只写「当前代码的 Why」（见 [12.4](12-代码组织与文件结构.md#124-注释规范只写当前代码的-why)）
- [ ] 用户可感知的变更已写入 `changelog.d/<issue号>-<slug>.md` 碎片（内部重构/文档修订除外）——**不直接改 `CHANGELOG.md`**，见 [13.10.5](#13105-碎片化落地改-changelogd不改-changelogmd)
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
✅ node scripts/check-file-structure.cjs   # 命名/组织硬规则 R1-R4/R7-R12（见 §12.6/§12.8/§12.11）
✅ node scripts/check-react-updater-purity.cjs
✅ node scripts/check-title-bar-clearance.cjs
✅ pnpm exec tsc --noEmit
✅ pnpm run lint
✅ node scripts/check-ui-logic-separation.cjs
✅ node scripts/check-changelog-fragments.cjs
✅ node scripts/check-app-port-vectors.cjs   # 端口推导跨语言一致性（见 launch-and-build §1.1）
✅ node scripts/check-ui-primitives.cjs      # UI 基元复用棘轮（见 16 §16.2.3）
✅ node scripts/check-overlay-z.cjs          # 浮层层级刻度棘轮（见 16 §16.2.5）
✅ node scripts/check-theme-colors.cjs       # 主题色扫描棘轮（见 03 §3.6.1）
✅ node scripts/check-comfyui-port-contract.cjs # ComfyUI 端口口径一致性（见 launch-and-build §5）
✅ node scripts/check-inline-style.cjs       # 视图层不得动态注入 <style>（见 03 §3.5）
✅ node scripts/check-code-duplication.cjs   # 跨文件重复块棘轮（见 12 §12.12）
✅ node scripts/check-function-length.cjs    # 函数长度棘轮 TS/TSX（见 12 §12.13）
✅ node scripts/check-rust-function-length.cjs # 函数长度棘轮 Rust 壳（见 12 §12.13.1）
✅ node scripts/shell-gate.mjs               # 桌面壳门禁：**只在暂存命中 src-tauri 四类壳输入时**
   # 才做事 —— 有 .rs 改动就跑 `cargo test`（壳里 37 条 #[test] 唯一的执行者），并复用
   # `dev-launcher.mjs` 的 `shellStaleWarning` 把硬规则 5「改了壳必须重编」升成阻断（见 11 §11.10.4）
✅ vitest run $(node scripts/affected-tests.mjs)  # C 组：结构守护固定清单 + 本次改动
   # 牵扯到的用例，一次 vite（固定清单唯一出处是脚本里的 FIXED_STRUCTURAL_TESTS，见下 13.5.8）
✅ node scripts/check-circular-deps.cjs      # 模块循环依赖棘轮（见 12 §12.7）
✅ node scripts/check-format.cjs             # prettier 格式棘轮（见下 13.5.1）
✅ node scripts/check-reformat-only.cjs      # 格式化提交与行为改动分离（见下 13.5.2）
✅ node scripts/check-dead-exports.cjs       # src/lib + src/trpc 零消费导出棘轮（见 12 §12.16）
✅ node scripts/render-doc-placeholders.cjs --check # 生成态 docs/generated 与源一致（见下 13.5.5）
✅ node scripts/check-non-null-assertions.cjs # src `!` 计数棘轮（见下 13.5.6 / 18 §18.6）
✅ node scripts/check-void-floats.cjs         # src/lib `void someFn(...)` 悬空棘轮（见下 13.5.7）
```

> **本地钩子没接、也不打算接的判据**（`test:coverage` / `build` /
> `check-standalone-contents.cjs` / E2E `@critical` / `db:push` / R5 的 `--strict`）：
> 它们是「按需召唤」那一层 —— 由人 @ 评审 NPC 唤起，或在改动命中对应范围时手动跑，
> 逐条登记在 13.5.4。**不要**把它们塞回每次 commit。

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

#### 13.5.1 prettier 格式棘轮（ISSUE #575 第 9 项）

`format:check` 是**唯一长期没有纳入门禁**的既有质量命令。原因很实在：全库
**576 个文件**未过 prettier，一次性 `--write` 会产生与本次改动无关的全文件 diff
（违反 [13.7](#137-换行符与提交噪声lf)，评审无法从 diff 里看出改了什么）。
但「等基线整改完再接入」的代价是**每个新文件都可以带着任意格式进来**，存量只增
不减，那一天永远不会到。

判据因此改为**基线 + 只许下降**（`scripts/check-format.cjs`，与重复块 / 函数长度 /
文件行数 / 环依赖同口径）：

| 情形                                  | 结果                                                           |
| ------------------------------------- | -------------------------------------------------------------- |
| 新增未过 prettier 的文件              | **阻断**                                                       |
| 存量文件从干净变脏                    | **阻断**（它落在基线外）                                       |
| 治理有进展（未过文件变少）            | 提示执行 `--update` 收紧；门禁带 `--strict` 时**未收紧即失败** |
| `--update` 试图把新增的脏文件写进基线 | **拒绝**（棘轮只许收紧）                                       |

两个刻意的设计：

- **按文件记账，不记全局计数。** 计数只约束总量 —— 修好 3 个、弄坏 4 个，总数变大
  才失败，弄坏的那 3 个无人知晓。文件级记账下「把干净的文件弄脏」当场失败，而
  「这个文件此前是干净的」本身就是一个可断言的事实。
- **白名单是形态（glob），不是文件列表。** 第一类是**高频 churn 路径** ——
  `scripts/**`、`tests/**`、`e2e/**`、根级配置（每次排障都要改一遍），把它们纳入
  棘轮会让每一次排障提交都顺带产生格式 diff。第二类是**非源码产物** ——
  `src-tauri/target/**`（`cargo build` 输出，由嵌套的 `src-tauri/.gitignore`
  忽略）：prettier 只按仓库根读 `.gitignore`，看不到嵌套忽略文件，构建过一次的
  检出会拿 `target/**/out/__global-api-script.js` 阻断每一次提交。用 glob 表达
  「这类文件暂不纳入」不会漂移，且新增这类文件时**自动**落在白名单里。
  豁免不进棘轮计数。

**存量文件怎么治理**：单独立项、单独一个 PR，对一批文件跑
`pnpm exec prettier --write <文件>`，提交后 `node scripts/check-format.cjs --update`
收紧基线。**禁止**在功能提交里顺手做（见 13.5.2）。

#### 13.5.2 格式化提交与行为改动分离（同批）

格式棘轮只判「文件干不干净」，管不住「顺手全库 `format:write`」—— 后者会把一次
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
4. **「prettier 没改这个文件」与「prettier 跳过了这个文件」不是一回事，判据必须
   以后者能落到实处的那个口径为准**。批量口径（一次 `prettier --write <临时目录>`）
   是性能要求：逐文件起 prettier 的成本在改动文件数上线性叠加，12 个文件就约 5s，
   正好顶穿当时那套默认超时（现场是别的门禁用例报
   `Test timed out in 5000ms`，看起来像「测试写得慢」；该默认值后来按实测抬到了
   20s，见 §11.13，但这条教训本身不变 —— 慢的是子进程冷启动，不是断言）。但批量结果里「这个文件
   没出现在改写清单里」同时覆盖两件事，而只有前者能推出「这次提交不是纯格式化」：

   | 没出现在清单里             | 真结论       | 判据                      |
   | -------------------------- | ------------ | ------------------------- |
   | 内容本来就规范             | 不是纯格式化 | 「本来规范」也是结论      |
   | 被 prettier 的忽略规则跳过 | **没有结论** | 必须退回逐文件 stdin 再判 |

   忽略规则**以 cwd 为根读 `.gitignore`**，而且命中目录名时连**显式点名**的路径
   也一并跳过（`--write <file>` 静默返回空输出、退出码 0）。`git check-ignore`
   **不能**代判：实测它对**已跟踪**的路径报「未被忽略」，而 prettier 照样跳过 ——
   两者语义不同，借用它等于换了一套判据。真实先例：`.workbuddy/skills/build-guard/
guard.js` 被格式化后，在 #619 的合并提交里落成了「纯格式化」（该目录后来随
   #623/#636 删除）。**批量失败**（prettier 起不来 / 配置写错）同样是「没有结论」，
   退回兜底而不是把结论改写成「没格式化」。

   兜底的代价只在「批量确实没改写它」时付出（正常提交里一个文件都不会多起进程），
   所以这条既没有放宽判据、也没有把成本放回去。
   `tests/check-reformat-only.test.ts` 的「批量口径的缺项退回逐文件 stdin 判定」
   一组用真 prettier 锁住它（反向验证：拿掉兜底即失败）。

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
2. **原来只在 CI 上跑的那几步，现在没有执行者**（逐条登记，别让它们静默消失）：

| 判据                                                                 | 原来的落点                                        | 现状                                                                                          |
| -------------------------------------------------------------------- | ------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| 全量单测 + 覆盖率门槛（`pnpm run test:coverage`，3000+ 用例）        | CI 第 6 步                                        | **无自动执行者**。按需手动跑；提交门槛里只有固定清单 + 受影响用例（见 13.5 的 C 组与 13.5.8） |
| `pnpm run build` + `check-standalone-contents.cjs`（产物级护栏）     | CI 第 27/28 步                                    | **无自动执行者**。改构建 / 产物相关的东西后手动跑                                             |
| E2E `playwright test --grep @critical`                               | CI 第 30 步                                       | **无自动执行者**。按需手动跑                                                                  |
| `db:push` 建库                                                       | CI 第 3 步                                        | 只在手动跑 E2E 前需要                                                                         |
| R5 超 900 行文件棘轮（`check-file-structure.cjs --strict` 的那一半） | CI 第 8 步                                        | 本地这一步不带 `--strict`，**棘轮当前无执行者**（`.githooks/pre-commit` 里有 ⚠️ 标注）        |
| `pnpm doc:check`（文档引用与权威源一致）                             | 平台侧从不跑，仅在 `pnpm doc:gen` 内部作为第 1 步 | 本地钩子里没有它，**改了文档/权威源后需手动跑**（`pnpm doc:check` / `pnpm doc:gen`）          |

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

| 想验证什么            | 怎么做                                                                      | 对应 13.5 清单里的哪一步         |
| --------------------- | --------------------------------------------------------------------------- | -------------------------------- |
| 代码评审（语义判断）  | 在 PR / Issue 里 `@` 评审 NPC                                               | 不在机器清单里，是**人**的那一层 |
| 全量单测 + 覆盖率门槛 | `@` NPC 跑 `pnpm run test:coverage`                                         | C 组（13.5.8）之外的欠账         |
| 产物级护栏            | 改动构建 / 产物后 `@` 跑 `pnpm run build` + `check-standalone-contents.cjs` | 欠账条目 2                       |
| E2E 关键流程          | `@` 跑 `pnpm exec playwright test --grep @critical`（先 `db:push`）         | 欠账条目 3/4                     |
| R5 行数棘轮           | `@` 跑 `check-file-structure.cjs --strict`                                  | 欠账条目 5                       |

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

#### 13.5.6 src 非空断言 `!` 棘轮（`node scripts/check-non-null-assertions.cjs`）

本轮类型安全审查 src/lib 报告 Low 段收尾，v2 起扫描范围从 src/lib 扩到整个 src。
**为什么不直接开 eslint `@typescript-eslint/no-non-null-assertion`**：lib 侧
102 处 `!` 分两族——13 处「filter/map 不 narrow 病灶」（本轮 6 个 PR 已消化）
与 ~89 处 `arr[i]!` / `match[N]!`（`noUncheckedIndexedAccess` 打开后的**合法
惯用法**，把 `lines[i]` 从 `string | undefined` 收回到 `string`，配合外层长度
判据）。直接开规则一次会报 100+ 处，评审看下来全是"这里其实合理"的噪声；不
开规则又挡不住下一轮病灶长出。

**为什么扫描范围要扩到整个 src**：lib 侧立了基线、components / app / server
不管，等于给病灶留了一条**漂移通道**——写视图侧的 `!` 门不会响。v1 的 102 只
算 lib；v2 首跑覆盖到 `src/components` 里 `use-settings-page.ts` 之类热区，
一次落到 **225 处 / 85 文件** 的新基线。判据与语义完全一致，只是「量的定义」
变了，`RULE_VERSION` 从 1 升到 2；`--update` 会拒绝旧基线（版本对不上即拒），
必须显式承认「范围扩了、量重记」才能重建。

合理机制是**基线棘轮**（与 §12.12 代码重复、§12.13 函数长度同构）：判据走
TypeScript AST 的 `ts.isNonNullExpression`（不用正则——正则会把 `!==` / `!x`
/ 注释里的 `!` 全误伤），扫描 src 下的 .ts/.tsx 非测试文件（测试里
`expect(x!.field)` 是常见形态，`.d.ts` 是类型声明，一并豁免）；基线
`scripts/.non-null-assertions-baseline.json` 记**每文件**当前计数，**只挡**
**新增**、允许逐步下降。修完一批就 `--update` 收紧基线。

`RULE_VERSION` 常量：目前只认 `NonNullExpression` 一种形态；将来若把
`<T>x!` / `x?.y!` 之类扩展形态纳入，或**再一次调整扫描范围**，必须同步改这
个常数——旧基线与新计数**不是同一个量**，`--update` 会拒绝放宽（除非版本已
改），防止「顺手把基线调大」的后门。判据排在 `.githooks/pre-commit` 的 D 组
步（浮层刻度是 27）。

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
`vitest run`，别新起一次冷启）。固定清单的**唯一出处**是脚本里的
`FIXED_STRUCTURAL_TESTS`，钩子不再抄一份 —— 抄的那份在用例改名后会变成
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
**兜底刻意不是「跑全量」**：全量当前带着别线的基线红（§11.13 的三档实测：
`maxWorkers: 8` 后仍有 4 文件 / 14 用例为真断言失败），把全量塞进钩子等于把提交闸
变成不可用 —— 那种闸活不过一周。等那批基线红清零后，把脚本里 `mode === "all"`
那条分支改成跑全量，并删掉这段说明。

**代价实测**（16 逻辑核的开发机）：建图 + 解析约 **1.0–1.1s**（读 1.2k 个源码文件、
6.4k 条说明符）。解析出来的面按改动半径线性放大 —— 改一个基元
（`ui/tooltip.tsx`）52 个用例、钩子那批实测 1m40s；改一条链路
（`lib/comfyui/reaper.ts`）83 个用例；改一个只被一块面板消费的筛选条 10 个。
不按耗时取舍：跑多少由**改动的影响面**决定，这正是这一层的定义；嫌慢的出口是把
大改动拆小（本来就该拆），而不是给解析加天花板。
**钩子那一档另配并发**：C 组跑 `--maxWorkers=4`（不是配置里的 8）—— 钩子里
A(tsc)、B(eslint)、D(二十多个判据脚本) 与它并行，再按 8 起 forks 就会抢不过来，
现场不是用例红而是 `Failed to start forks worker / Timeout waiting for worker to
respond`（几百条全过、退出码非零）。全量 `pnpm test` 仍走配置里的 8。

判据由 `tests/affected-tests.test.ts` 钉住（17 条）：四条判据各一组夹具、**两跳
传递**与 barrel 转出口（含「没转出去的 sibling 不算消费」这条反面）、被删文件的
消费方仍被拉起、公共地基的放弃收窄、**结果永不为空**（空参数会让 `vitest run`
跑成全量）、固定清单每个文件真实存在、`isTestPath` 与 `vitest.config.ts` 的
`include` 不漂移。

#### 13.5.9 依赖漏洞扫描棘轮（`node scripts/check-dependency-audit.mjs`，ISSUE #1331）

**它补的是「发现」这一步，不是「修」这一步。** 本仓此前没有任何依赖漏洞扫描（无
`pnpm audit` 门禁、无 dependabot/renovate），`pnpm-workspace.yaml` 里那几条
`overrides` 的注释就是证据：每一次都是「有人恰好发现了 → 手工查传递路径 → 手工写
override → 手工写注释解释为什么」，而**「这次忘了查」没有任何反馈**。实测开立时的
一个例子足够说明问题：`js-yaml` 的修复版 `4.3.2` 早已发布，仓库里躺着 `4.3.1` ——
没有任何机器路径会提醒这件事。

**判据形状三条，都是刻意的**（细则在脚本头，改判据前先读它）：

1. **按 `(包名, advisory id)` 记账，不按计数。** 计数口径下「修好 1 个、引入 2 个」
   要总量变大才失败，而引入的那 2 个无人知晓 —— 与 13.5.1 对格式棘轮讲的是同一个道理。
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

| 形态                             | 判定                        | 为什么                                                                  
| -------------------------------- | --------------------------- | ---------------------------------------------------------------------- |
| 拿到可解析的 JSON                | 正常判定（有无漏洞由台账说） | ——                                                                     
| 命令起来了但没有 JSON（离线）    | **未扫描**，退 0，话术禁止出现「干净」 | 离线不是「依赖干净」；把它印成绿会把下一次的真红一起吞掉                
| stdout 不是 JSON / pnpm 没起来   | **判红**                    | 这是判据自身坏了，与网络抖动不同形；静默跳过的判据等于没有判据           |

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

判据由 `tests/dependency-audit.test.ts` 钉住：键的形状、严重级筛选、引入路径按 registry
的**真分隔符**切（裸 `>`，首段 `.` 是工作区根 —— 按 `" > "` 切会得到一整段没人看得懂的
字符串，这是本机跑真 `pnpm audit` 时量出来的）、双向拦、空 reason 判红、`--update` 拒绝
新增且**被拒之后基线文件没被动过**、以及三种 registry 不可用形态各一条。跑真脚本的那几组
用 `--fixture` 喂固定 JSON：把外部 registry 当测试依赖会让这盏灯随上游 advisory 自己变红，
那时红就不可归因了。

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

| 层   | 位置                                                              | 拦什么                                     | 能绕过吗                                  |
| ---- | ----------------------------------------------------------------- | ------------------------------------------ | ----------------------------------------- |
| 平台 | CNB **分支保护设置**（保护分支 + 禁止直接 push，要求 PR）         | `master` 的**直接 push**，**放行 PR 合并** | 需管理员改设置（本身就要权限）            |
| 本地 | `.githooks/pre-commit` 第 1 步跑 `scripts/check-branch-guard.cjs` | `master` 上的**每一次本地提交**            | 只能 `--no-verify`（进历史，Review 可见） |

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
> 钩子里守卫排在第 1 步；另有 `--pr-check` 的三种拓扑与「取不到目标分支时保守放行」）。
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

1. **先复算基线，再怀疑自己**：在干净的上游提交上开一个临时 worktree 跑同一条门禁——

   ```bash
   git fetch cnb --prune
   git worktree add ../.wt-base-check cnb/master
   (cd ../.wt-base-check && node scripts/check-ui-primitives.cjs)   # 换成拦住你的那条
   git worktree remove ../.wt-base-check --force
   ```

   干净基线上同样命中 = 别线的红，与你的改动无关（**不许**为它放宽判据、也不许
   `--no-verify` 换一条干净历史）。

2. **判断它挡不挡路**：挡路（硬闸类，所有人都提交不了）就地修掉；不挡路（棘轮类、
   或测试基线红）按 §11.12 登记进 `KNOWN_FAILED_FILES` 并写清归属与「别处更强的执行者」。
3. **修了就写清归属**：硬闸红随本批一起修时，**单独一个 commit + 单独一条
   `changelog.d/` 碎片**，碎片里写明「这条不是本 PR 引入的」＋复算证据（哪个上游提交、
   命中几处）＋为什么顺手收掉。混进功能提交里会让人以为那是本次改动的附带调整。

**为什么允许「顺手修别线的一行」**：一行 class token 替换零业务语义，而它挡住的是
全仓库的提交能力 —— 代价不对称。**判据不是「谁的文件归谁」**：这条判据的成立条件是
「修法的机械性」＋「不修就没人能提交」。反例：别线的**测试断言红**不许这样处理
（那要判据的作者决定并档还是改判据，见 §11.12 的「每一条都写归属与谁来修」）。

**这一条本身还没有机器判据**：能拦的只有「PR 合并前的服务端检查」，而平台侧流水线
已下线。所以现在的兜底是**流程**——合并前本地跑一遍 `pnpm check:all`（或至少跑
受影响的那条门禁）再点合并；重启 CI 时应把硬闸类排为合并前置（13.5.3）。

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
| 发版 / 整理 | `CHANGELOG.md` 的 `[Unreleased]` / 版本段落         | `node scripts/merge-changelog-fragments.mjs` |

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
node scripts/check-changelog-fragments.cjs          # 校验碎片形态(pre-commit 自动跑)
node scripts/merge-changelog-fragments.mjs          # 并入 [Unreleased] 并删除碎片
node scripts/merge-changelog-fragments.mjs --check  # 只预览,不落盘
node scripts/merge-changelog-fragments.mjs --release 0.2.0   # 并入并把 [Unreleased] 定版
```

**为什么不是「只在发版时统一写」**：那会退回「集中补写」，必然漏项失真
（[13.10.4](#13104-格式与时机) 已明令禁止）。碎片方案保住「随 PR 一起写」的时效性，
只把**文本冲突**改成**文件合并**。

> **与「一个提交只做一件事」的关系**：碎片文件使「同一 PR 内多人协作同一份
> 变更记录」成为 git 层面不可能冲突的操作，这是 [13.7](#137-换行符与提交噪声lf)
> 「禁止无关全文件变更」在 changelog 上的自然延伸 —— 每次改动只碰属于它的那个文件。

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
