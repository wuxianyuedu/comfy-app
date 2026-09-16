<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/standards/13-提交与-code-review.md`。改动请回源文件，再重新生成。 -->

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

| 层 | 位置 | 拦什么 | 能绕过吗 |
|----|------|--------|---------|
| 本地 | `.githooks/pre-commit`（24 步） | 分支守卫 + 结构硬规则 + tsc + eslint + 各棘轮 | 只能 `--no-verify`（进历史，Review 可见） |
| 平台（push 保护） | CNB **分支保护设置** | `master` 的直接 push（放行 PR 合并） | 需管理员改设置 |

> **服务端形态的判据本身仍在**：`scripts/check-branch-guard.cjs` 的
> `--pr-check` / `--merge-commit` 两个服务端形态随 `.cnb.yml` 一起失去了调用方，
> 但判据本身保留 —— `tests/check-branch-guard.test.ts` 用真仓库跑三种拓扑，
> 日后重启平台侧直接可用（见 13.6.1）。其中 `--merge-commit` 必须认得 squash，
> 理由见上面 `⚠️` 那段。

```
本地提交前必须通过（.githooks/pre-commit，24 步）：
✅ node scripts/check-branch-guard.cjs     # 不在 master 上直接提交（见 13.6）
✅ node scripts/check-file-structure.cjs   # 命名/组织硬规则 R1-R4/R7-R12（见 §12.6/§12.8/§12.11）
✅ node scripts/check-react-updater-purity.cjs
✅ node scripts/check-title-bar-clearance.cjs
✅ pnpm exec tsc --noEmit
✅ pnpm exec eslint . --max-warnings 0
✅ node scripts/check-ui-logic-separation.cjs
✅ node scripts/check-changelog-fragments.cjs
✅ node scripts/check-app-port-vectors.cjs   # 端口推导跨语言一致性（见 launch-and-build §1.1）
✅ node scripts/check-theme-colors.cjs       # 主题色扫描棘轮（见 03 §3.6.1）
✅ node scripts/check-comfyui-port-contract.cjs # ComfyUI 端口口径一致性（见 launch-and-build §5）
✅ node scripts/check-inline-style.cjs       # 视图层不得动态注入 <style>（见 03 §3.5）
✅ node scripts/check-code-duplication.cjs   # 跨文件重复块棘轮（见 12 §12.12）
✅ node scripts/check-function-length.cjs    # 函数长度棘轮 TS/TSX（见 12 §12.13）
✅ node scripts/check-rust-function-length.cjs # 函数长度棘轮 Rust 壳（见 12 §12.13.1）
✅ vitest run tests/single-logger-channel.test.ts tests/container-single-access.test.ts
   tests/core-spine-single-source.test.ts   # core 骨架单一事实源（见 18 §18.8）
✅ node scripts/check-circular-deps.cjs      # 模块循环依赖棘轮（见 12 §12.7）
✅ vitest run tests/lib-node-only-declarations.test.ts # src/lib Node-only 声明（见 18 §18.4）
✅ node scripts/check-format.cjs             # prettier 格式棘轮（见下 13.5.1）
✅ node scripts/check-reformat-only.cjs      # 格式化提交与行为改动分离（见下 13.5.2）
```

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

| 情形 | 结果 |
|---|---|
| 新增未过 prettier 的文件 | **阻断** |
| 存量文件从干净变脏 | **阻断**（它落在基线外） |
| 治理有进展（未过文件变少） | 提示执行 `--update` 收紧；门禁带 `--strict` 时**未收紧即失败** |
| `--update` 试图把新增的脏文件写进基线 | **拒绝**（棘轮只许收紧） |

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
   正好顶穿 vitest 默认的 `testTimeout`（现场是别的门禁用例报
   `Test timed out in 5000ms`，看起来像「测试写得慢」）。但批量结果里「这个文件
   没出现在改写清单里」同时覆盖两件事，而只有前者能推出「这次提交不是纯格式化」：

   | 没出现在清单里 | 真结论 | 判据 |
   |---|---|---|
   | 内容本来就规范 | 不是纯格式化 | 「本来规范」也是结论 |
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

| 做法 | 省什么 | 代价 |
|---|---|---|
| 门禁只挂 `pull_request`，`push` 只留合并形态复核 | 砍掉「同一份代码的第二遍」 | 无（合并提交不引入新代码） |
| `test` 与 `test:coverage` 合并成 `pnpm run test:coverage` | 全量 vitest 从两遍变一遍 | 无（覆盖率本来就跟着这一次运行出） |

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

**关掉之后谁来守门禁**：`.githooks/pre-commit`（24 步，见 13.5）。它与平台侧那套
**大部分同源**（同一批 `scripts/check-*.cjs` 与契约测试），差别有两层：

1. **它只保护「启用了钩子、且没加 `--no-verify`」的检出** ——
   别的检出直推 `master` 不再有任何服务端复核，只能靠平台的分支保护设置拦。
2. **原来只在 CI 上跑的那几步，现在没有执行者**（逐条登记，别让它们静默消失）：

| 判据 | 原来的落点 | 现状 |
|---|---|---|
| 全量单测 + 覆盖率门槛（`pnpm run test:coverage`，3000+ 用例） | CI 第 6 步 | **无自动执行者**。按需手动跑；提交门槛里只有少量契约测试（见 13.5 清单第 16/18/20/24 步） |
| `pnpm run build` + `check-standalone-contents.cjs`（产物级护栏） | CI 第 27/28 步 | **无自动执行者**。改构建 / 产物相关的东西后手动跑 |
| E2E `playwright test --grep @critical` | CI 第 30 步 | **无自动执行者**。按需手动跑 |
| `db:push` 建库 | CI 第 3 步 | 只在手动跑 E2E 前需要 |
| R5 超 900 行文件棘轮（`check-file-structure.cjs --strict` 的那一半） | CI 第 8 步 | 本地这一步不带 `--strict`，**棘轮当前无执行者**（`.githooks/pre-commit` 里有 ⚠️ 标注） |
| `pnpm doc:check`（文档引用与权威源一致） | 平台侧从不跑，仅在 `pnpm doc:gen` 内部作为第 1 步 | 本地钩子里没有它，**改了文档/权威源后需手动跑**（`pnpm doc:check` / `pnpm doc:gen`） |

> 这张表是**有意留下的欠账**，不是遗漏：把全量 3000+ 用例塞进每次 commit 会让本地
> 提交慢到没人愿意用，而那正是当初把它放去 CI 的原因。要恢复哪一条，就按
> 「先把它做成可接受的耗时」再挂回 `.githooks/pre-commit`（或另设一个显式的
> `pnpm run check:all` 由人主动跑），**不要**只把配置贴回去。


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

| 层 | 位置 | 拦什么 | 能绕过吗 |
|----|------|--------|---------|
| 平台 | CNB **分支保护设置**（保护分支 + 禁止直接 push，要求 PR） | `master` 的**直接 push**，**放行 PR 合并** | 需管理员改设置（本身就要权限） |
| 本地 | `.githooks/pre-commit` 第 1 步跑 `scripts/check-branch-guard.cjs` | `master` 上的**每一次本地提交** | 只能 `--no-verify`（进历史，Review 可见） |

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

| 层 | 记录什么 | 读者 | 载体 |
|----|---------|------|------|
| 代码注释 | **当前代码为什么是这样**（决策、被否决的方案、隐式契约） | 改这行代码的维护者 | 注释，见 [12.4](12-代码组织与文件结构.md#124-注释规范只写当前代码的-why) |
| Commit message | **这一次改了什么、为什么改**（含评审背景与取舍过程） | Reviewer / 排障者 | `git log`，见 [13.2](#132-commit-message-规范) |
| CHANGELOG | **两次发布之间用户能感知到的差异** | 使用者 / 升级方 | `CHANGELOG.md` |

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

| type | 是否进 CHANGELOG |
|------|-----------------|
| `feat` | 通常进 `Added` |
| `fix` | 通常进 `Fixed` |
| `perf` | 进 `Changed`，**仅当**带来用户可感知的体感差异 |
| `refactor` | **不进**（定义即不改变外部行为） |
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

| 环节 | 载体 | 谁写 |
|------|------|------|
| 开发中 | `changelog.d/<issue号>-<slug>.md`，一件变更一个文件 | 改代码的人（随 PR 提交） |
| 发版 / 整理 | `CHANGELOG.md` 的 `[Unreleased]` / 版本段落 | `node scripts/merge-changelog-fragments.mjs` |

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
