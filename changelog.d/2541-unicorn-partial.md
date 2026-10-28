## Fixed

**unicorn 信号按用户拍板保留：`eslint-plugin-unicorn` 部分收编（4/5 条），16 条现场清零**
（ISSUE #2541 第三批）。

### 决策（接 #2541 第五条评论）

oxlint 评估不采纳第二道 gate 后，用户选择保留 unicorn 信号。落地路径取本仓唯一的
eslint 门禁按需单条引入：`devDeps` 加 `eslint-plugin-unicorn@79`，只开 4 条、作用面与
core recommended 的 scripts 档一致（LINT_FILES + scripts js 面）——豁免体系只有一份，
规则随插件升级自动跟上游。

### `no-useless-fallback-in-spread` 不开（台账）

它拦的 `{...(x ?? {})}` / `{...(x || [])}` 在本仓是**刻意的防御兜底**——「这个来源
可能是 null/undefined」是写在现场的 self-documentation（22 条现场全在 workflow 参数
接线等判据-bearing 的业务代码里），删掉运行时等价但丢信息、降防御性。何时可开：
若本仓改用显式 `Array.isArray(x) ? x : []` 形态表达兜底，再评估。

### 现场清理（eslint 视角 16 条，与 oxlint 判定面不同以 eslint 为准）

- `prefer-string-starts-ends-with` ×6：锚定正则（`/^cnb-/`、`/^超时/`、`/^crontab:/`、
  `/^pull_request/`、`/^'/`）改 `startsWith()`，逐条核对无 `i`/`g` 等旗标、语义等价；
- `no-new-array` ×4：`new Array(n).fill(v)` 改 `Array.from({ length: n }, () => v)`；
- `no-useless-spread` ×3：`new Set([...set])`、`...[...hint(), ""]` 直收；
  **1 条是规则误报**——`executor-host.mjs` 的 `[...cliProcs.keys()]` 是**刻意快照**
  （循环体内 `cliProcs.delete`，直接迭代活 Map 会跳键），带台账的一行禁用；
- `no-useless-length-check` ×3：`length > 0 && some(...)` / `length === 0 || every(...)`
  / `if (arr.length > 0) for…of` —— 短路语义本就覆盖空数组，删冗余判。

### 验证

全量 `eslint --max-warnings 0` 清零；`tsc --noEmit` 绿；`oxfmt --check` 绿；
受影响测试 15 文件 344 条通过（base-check / check-commit-claims / ci-pr-failure-issue /
executor-host ×3 / gate-tier-summary / log-ansi / workflow-io 等）。
