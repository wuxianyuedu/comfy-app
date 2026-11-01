# no-unnecessary-condition 取证台账

> 扫描命令：`pnpm exec oxlint --type-aware --type-check -c oxlint.config.ts -A all -D typescript/no-unnecessary-condition .`
> 命中 971 处 / 332 份。格位口径见`hookSteps` 来自`localTier` 来自`spawnSync` 出参：git 起不来时同上 实测 undefined（`@types/node` 按泛型声明非空），缺省/解析失败时会空；形参改`m[1]` /`m[1]` 同上；`m &&` 那一半是 match 可能为 null 来自正则 match，TS 不建模「必需分组必定存在」；`m[1] ?? ""` 之前已存在，这里把同一行的`normalizeRun` 的形参是`classifyBuildOutcome(...).pipelines` 的`details` /`audit` 是`baseline` 是入库的手写基线文件，可缺`runner` 是本文件声明的注入点（契约测试给假 runner），出参不能按同上：`entry.flags` 可缺 的完整形状声明；形参改可空 的解析产物，可缺同上：`entry.judges` 可缺；形参改可空 条目来自平台 JSON 与 CLI 参数，字段可缺；形参改可缺（#2392 的「我没取到 ≠ 它没跑」正靠这层） 在类型上必填，但那份 detail 是平台 JSON；这处兜底属于「认不出就走空名」那一支，落账一行 出参的注入面（用例会喂起不来的形态），形参改可缺后两处同上：`entry.executors` 可缺 保留/`command` 判空说明清楚：删了当场 TS2345 的解析结果，条目形状没被编译器保证；形参改`argv` 索引访问的可空来自`resolve` 是注入面，用例会拿坏形状喂进来验那段校验；出参类型改可缺，规则没建模；`sep` 与`StageRef.name` 在类型上是必填（classifyStages 兜成空串），规则把这一支读成恒真；兜底保留并落账 两处判空都靠它 §5.10。
> `argv` 索引访问（`noUncheckedIndexedAccess`），注记后两处同上，第二个旗标 保留 列留空 = 未取证。填`outcome.cancelled` 可能为空数组，索引访问的可空规则没建模；注记后同上 仍被读成恒真(类型修好) / `B`(真多余) / `C`(tsc 要) / `D`(落账禁用)。

## 分布

| 类别           | 处数 |
| -------------- | ---- |
| ??-left        | 492  |
| opt-chain      | 221  |
| no-overlap     | 104  |
| always-falsy   | 75   |
| always-truthy  | 59   |
| literal-cmp    | 15   |
| always-nullish | 3    |
| never          | 2    |

## 逐处

### .storybook/flow-canvas.tsx

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 320 | no-overlap |     | `if (scene === undefined) {` |

### .storybook/message-center-sources.tsx

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 338 | no-overlap |     | `if (scene === undefined) {` |
| 359 | no-overlap |     | `if (scene === undefined) {` |

### .storybook/screen-frame.tsx

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 223 | no-overlap |     | `if (scene === undefined) {` |

### .storybook/store-sources.tsx

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 389 | no-overlap |     | `if (scene === undefined) {` |

### .storybook/workflow-run-sources.tsx

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 223 | no-overlap |     | `if (scene === undefined) {` |

### e2e/support/preflight-browser.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                                                          |
| --: | --------- | --- | -------------------------------------------------------------------------------------------------------------------- |
| 104 | ??-left   | A   | `top` 来自 `collectAttribute()` 的 `JSON.parse`，条目字段可缺；补声明后三元改成 `if`（那三元的条件位规则读不到注记） |
| 104 | opt-chain |     | `const message = result.error?.message ?? "";`                                                                       |

### e2e/support/preflight-ports.mjs

|  行 | 类别    | 格  | 代码 / 理由                          |
| --: | ------- | --- | ------------------------------------ |
| 213 | ??-left |     | `const text = String(cmdline ?? "")` |

### e2e/support/preflight-python.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                   |
| --: | ------- | --- | ------------------------------------------------------------- |
|  93 | ??-left |     | `probeArgs: [...(found.args ?? []), "--version"],`            |
|  95 | ??-left |     | `const prefix = (found.args ?? []).join(" ");`                |
|  98 | ??-left |     | `interpreter: absolute ?? found.command,`                     |
| 101 | ??-left |     | ``${absolute ?? "（PATH 上解析不到绝对路径，交回裸名字）"}`,` |

### eslint.config.js

|  行 | 类别         | 格  | 代码 / 理由                                                                       |
| --: | ------------ | --- | --------------------------------------------------------------------------------- |
| 107 | always-falsy |     | `if (!config \|\| typeof config.rules !== "object" \|\| config.rules === null) {` |
| 107 | no-overlap   |     | `if (!config \|\| typeof config.rules !== "object" \|\| config.rules === null) {` |

### next.config.js

|  行 | 类别    | 格  | 代码 / 理由                                      |
| --: | ------- | --- | ------------------------------------------------ |
|  48 | ??-left |     | `const store = String(res.stdout ?? "").trim();` |

### scripts/affected-launch-changed-list.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                                                               |
| --: | ------- | --- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| 122 | ??-left | A   | `spawnAffected` 的 `@returns` 把 `stdout`/`stderr` 标成必填，而 ENOENT/超时时实测是 undefined；该函数的返回类型是错的根，改它一处收全文件 |
| 132 | ??-left | A   | 同上，同一个返回类型                                                                                                                      |

### scripts/affected-launch-duration-order.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                                                                                                |
| --: | ------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
|  79 | ??-left       | A   | `readings` 是 junit 解析产物（脏读数真的会来），形参声明成必填是声明错；改 `Array<{name?: string, ms?: number} \| null \| undefined> \| null \| undefined` |
|  79 | always-truthy | A   | 同一个形参的第二个症状：`r` 本身也可为 null（junit 解析会产出空条目），所以 `r &&` 保留；根因仍是声明比运行时窄                                            |

### scripts/affected-launch-retry-verdict.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                                                |
| --: | ------- | --- | -------------------------------------------------------------------------------------------------------------------------- |
|  52 | ??-left | A   | `readSuites` 由 `failingSuiteTextsFromJunit` 从 XML 正则取，取不到 name 的条目不填；形参改可缺${prev}\n${s.body ?? ""}`);` |

### scripts/affected-launch-scope-advice.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                                                                    |
| --: | ------------- | --- | ------------------------------------------------------------------------------------------------------------------------------ |
|  52 | ??-left       | D   | `spawnSync` 起不来时 `stdout` 实测 undefined（`@types/node` 按泛型声明非空）。注记救不到它（同文件另一处同类已试过），落账一行 |
| 104 | always-truthy |     | `const rest = biggest ? affected - biggest.affected : affected;`                                                               |

### scripts/affected-launch-spawn.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                                           |
| --: | ------- | --- | --------------------------------------------------------------------------------------------------------------------- |
| 162 | ??-left | A   | `spawnSync` 出参在 ENOENT/超时下真的是 undefined，而本文件正是给这两个形态记读数的；在 `res` 上写明这一点（4 处同源） |
| 167 | ??-left | A   | 同上 的契约就是「可能是 null」（无信封时原样返回 payload），JSDoc 声明成非空是声明错；补 `\| null` 后 `?.` 保留       |
| 173 | ??-left | A   | 同上                                                                                                                  |
| 174 | ??-left | A   | 同上                                                                                                                  |

### scripts/affected-launch-wallclock.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                                                |
| --: | ------- | --- | -------------------------------------------------------------------------------------------------------------------------- |
| 279 | ??-left | A   | `readSuites` 条目可缺（同一份 junit 解析产物）；形参改 `Array<{name?: string, body?: string}>`${prev}\n${s.body ?? ""}`);` |

### scripts/affected-tests.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                                                                         |
| --: | ------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| 221 | ??-left | C   | `m[1]` 是正则必需分组，运行时恒非空，但这处 `??` 只服务于 tsc（删了当场 TS2345）；`noUncheckedIndexedAccess` 那一层规则没建模，按 C 格留注释 + 落账 |
| 819 | ??-left | C   | `reasons` 索引访问，同上（`Record<string, string \| undefined>`）                                                                                   |

### scripts/agent-film.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                              |
| --: | --------- | --- | ---------------------------------------------------------------------------------------- |
| 167 | opt-chain | A   | 契约写在 `parseSuperjsonEnvelope` 的 JSDoc 上（见 177 行那条），这一处是它的第一个调用点 |
| 177 | opt-chain | A   | 同上：`formatStep` 的形参就是这个可空值                                                  |
| 178 | opt-chain | A   | 同上：`snapshot.action`                                                                  |
| 237 | opt-chain | A   | 同上：`snapshot.run.status`，轮询条件                                                    |
| 299 | opt-chain | A   | 同上：收尾读 status                                                                      |

### scripts/agent-index.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 77 | ??-left | A | `const stdout = res.stdout ?? "";` —— cmd.exe / 裸 cmd 起不来时 stdout 实测 undefined；runTool 内的 res 已按实测形状声明，下面两处 ?? "" 保留 |
| 78 | ??-left | A | `const stderr = res.stderr ?? "";` —— 同上 stderr |
| 397 | no-overlap | D | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` —— `process.argv[1]` 在 `node -e` 宿主下真的是 undefined（实测），但两边 tsc 都把它声明成 string、且 tsgolint 在本行上的读数与文件体积相关（同形小文件不报）—— 判据不可信，保留条件并落账；追规则那条走 ISSUE #2941 |

### scripts/app-port.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                                                                  |
| --: | ------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------- |
|  49 | ??-left | A   | `normalizeRootForPort` 被 `check-app-port-vectors.cjs` 拿 JSON 向量直接喂，缺字段就是 undefined，会产生字符串 "undefined" 的端口；形参改可空 |

### scripts/base-check/declared-hook-steps.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                     |
| --: | --------- | --- | ------------------------------------------------------------------------------- |
| 139 | ??-left   | A   | `const labels = steps.map((s) => String(s?.label ?? ""));`                      |
| 139 | opt-chain |     | `const labels = steps.map((s) => String(s?.label ?? ""));`                      |
| 173 | never     | A   | `const tier = localTier instanceof Set ? localTier : new Set(localTier ?? []);` |

### scripts/base-check/git-ref.mjs

|  行 | 类别    | 格  | 代码 / 理由                              |
| --: | ------- | --- | ---------------------------------------- |
| 219 | ??-left | A   | `stdout: String(r.stdout ?? "").trim(),` |
| 220 | ??-left | A   | `stderr: String(r.stderr ?? "").trim(),` |

### scripts/base-check/hook-steps.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                         |
| --: | ---------- | --- | --------------------------------------------------------------------------------------------------- |
|  34 | no-overlap | C   | `input` 来自 `process.argv`，空数组合法；索引可空是 `noUncheckedIndexedAccess` 那层，注记后保留判空 |
| 305 | no-overlap | A   | `if (label === undefined \|\| command === undefined) {`                                             |
| 305 | no-overlap |     | `if (label === undefined \|\| command === undefined) {`                                             |
| 347 | no-overlap | C   | `if (m && m[1] !== undefined) {`                                                                    |
| 406 | ??-left    | A   | `const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;`                                              |
| 406 | ??-left    |     | `const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;`                                              |
| 452 | no-overlap | C   | 空 argv 时解构出的 `cmd` 是 undefined，规则没建模索引访问                                           |

### scripts/build-desktop.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                           |
| --: | ------- | --- | ------------------------------------------------------------------------------------- |
| 378 | ??-left | A | `const sql = (exported.stdout ?? "").trim();` —— drizzle-kit 起不来时 stdout 实测 undefined；本文件按实测形状声明 exported |
| 382 | ??-left | A | ``${(exported.stderr ?? "").slice(0, 400) \|\| "没有输出"}——桌包首启将没有建表能力`,` —— 同上 stderr（失败分支才读，ENOENT 时同样缺） |

### scripts/changed-scope.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                 |
| --: | ------- | --- | --------------------------------------------------------------------------- |
| 91 | ??-left | A | `stdout: r.status === 0 ? String(r.stdout ?? "") : String(r.stderr ?? ""),` —— git 起不来时 stdout 实测 undefined；注解按实测形状声明 r |
| 91 | ??-left | A | `stdout: r.status === 0 ? String(r.stdout ?? "") : String(r.stderr ?? ""),` —— 同上 stderr |
| 219 | ??-left | A | `const baseRef = String(ref ?? "").trim();` —— ref 来自 CNB_PULL_REQUEST_TARGET_SHA，平台没给时就是 undefined 且正是「没有基线可比」那支；把 @param 声明成 string | undefined |

### scripts/check-bundle-budget.cjs

|  行 | 类别         | 格  | 代码 / 理由                                                                 |
| --: | ------------ | --- | --------------------------------------------------------------------------- |
| 126 | always-falsy | B | `const ENFORCE_TOTALS = TOTALS_ENFORCED \|\| ARGS.has("--enforce-totals");` —— `TOTALS_ENFORCED ||` 那半句在常量是 `false` 时恒假；改成 `Boolean(TOTALS_ENFORCED) || …` —— 恢复那天它才不会短路掉 `--enforce-totals` |

### scripts/check-commit-claims.mjs

|  行 | 类别        | 格  | 代码 / 理由                                                      |
| --: | ----------- | --- | ---------------------------------------------------------------- |
| 312 | no-overlap | B | `if (cmd === undefined) {` —— `argv[0]` 两个分支都至少一个元素，`cmd === undefined` 恒假；`cmd` / `argv` 两行的形态不变 |
| 460 | no-overlap | A | `if (num === undefined) {` —— `[...matchAll].map(n => n[1])` 每格来自必填分组，`num === undefined` 恒假；改 `String(num)` 收口 |
| 476 | ??-left | B | `pushSection(m[0], m[0], SECTION_ABSENT_HINT.test(m[2] ?? ""));` —— `m[2]` 是可选捕获组，`?? ""` 换成 `String(m[2])`（同一个兜底） |
| 491 | no-overlap | A | `if (target === undefined) {` —— 第 1 组是必填分组（`PATH_UNTOUCHED_RE`），`target === undefined` 恒假；改 `String(m[1])` 收口 |
| 504 | no-overlap | A | `if (target === undefined \|\| m[2] === undefined) {` —— 两个分组都必填，`target === undefined || m[2] === undefined` 恒假；改 `String(m[1])` 收口 |
| 504 | no-overlap | A | `if (target === undefined \|\| m[2] === undefined) {` —— 两个分组都必填，`target === undefined || m[2] === undefined` 恒假；改 `String(m[1])` 收口 |
| 575 | literal-cmp | B | `if (claim.kind === "count") {` —— 三种 kind 里 section / path 已各自 return，最后一层 `if (kind === "count")` 是恒真的一半；直接落成语句 |

### scripts/check-daily-attendance.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                           |
| --: | --------- | --- | ------------------------------------------------------------------------------------- |
| 150 | ??-left   | C   | `.pipelines.map((p) => String(p?.name ?? "").trim())`                                 |
| 150 | opt-chain |     | `.pipelines.map((p) => String(p?.name ?? "").trim())`                                 |
| 188 | ??-left   | A   | `(Array.isArray(details) ? details : []).map((d) => [String(d?.sn ?? ""), d?.json]),` |
| 188 | opt-chain |     | `(Array.isArray(details) ? details : []).map((d) => [String(d?.sn ?? ""), d?.json]),` |
| 188 | opt-chain |     | `(Array.isArray(details) ? details : []).map((d) => [String(d?.sn ?? ""), d?.json]),` |

### scripts/check-dependency-audit.mjs

|  行 | 类别      | 格  | 代码 / 理由                                        |
| --: | --------- | --- | -------------------------------------------------- |
| 106 | opt-chain | A   | `const advisories = audit?.advisories ?? {};`      |
| 176 | opt-chain | A   | `const entries = baseline?.entries ?? [];`         |
| 216 | ??-left   | A   | `const text = String(result.stdout ?? "").trim();` |

### scripts/check-deps-freshness.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                        |
| --: | ------------- | --- | ------------------------------------------------------------------ |
| 232 | ??-left | A | `return { ok: true, out: res.stdout ?? "" };` —— git 起不来时 stdout 实测 undefined；注解按实测形状声明 res |
| 513 | opt-chain     | B | `if (drift.unresolved?.length) {` —— `InstallDrift.unresolved` 是必填（两个构造点都给数组），`?.` 删掉 |
| 573 | always-truthy | B | `const contained = !merging && isRemoteAncestorOfHead(root, rev);` —— 外层 if 已把 `merging` 挡掉 ⇒ 这一段恒真，删掉 |

### scripts/check-docs-api.cjs

|  行 | 类别    | 格  | 代码 / 理由                                                         |
| --: | ------- | --- | ------------------------------------------------------------------- |
| 362 | ??-left | A | `const cleanLog = (log ?? "").replaceAll(/\u001b\[[0-9;]*m/g, "");` —— `runTypedoc()` 起不起来那一支带 `log: ""`，但它的 `@returns` 没声明 `log`；按实测把形参改成 `string | undefined`，`?? ""` 原地保留 |

### scripts/check-format.cjs

|  行 | 类别    | 格  | 代码 / 理由                                                                        |
| --: | ------- | --- | ---------------------------------------------------------------------------------- |
| 360 | ??-left | A | ``[format][debug] oxfmt --version=${JSON.stringify(ver.stdout ?? ver.error)}\n` +` —— 子进程起不来时 stdout 未定义、error 才有值；注解按实测声明 ver 两个字段 |

### scripts/check-gate-executors.cjs

|  行 | 类别      | 格  | 代码 / 理由                                                                              |
| --: | --------- | --- | ---------------------------------------------------------------------------------------- |
| 393 | opt-chain | D   | 手写台账 JSON 的条目字段可缺（缺一栏正是那条判红要说的事）；规则不读这里的注记，落账一行 |
| 429 | opt-chain | D   | 手写台账 JSON 的条目字段可缺（缺一栏正是那条判红要说的事）；规则不读这里的注记，落账一行 |
| 431 | opt-chain | D   | 手写台账 JSON 的条目字段可缺（缺一栏正是那条判红要说的事）；规则不读这里的注记，落账一行 |
| 437 | opt-chain | D   | 手写台账 JSON 的条目字段可缺（缺一栏正是那条判红要说的事）；规则不读这里的注记，落账一行 |

### scripts/check-known-failed-stale.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                    |
| --: | ------- | --- | ------------------------------------------------------------------------------ |
| 141 | ??-left |     | `(evidence.files ?? []).map((f) => [f.name.replaceAll("\\", "/"), f.status]),` |
| 257 | ??-left |     | `stdout: r.stdout ?? "",`                                                      |
| 258 | ??-left |     | `stderr: r.stderr ?? "",`                                                      |

### scripts/check-non-null-assertions.cjs

|  行 | 类别          | 格  | 代码 / 理由                                                                       |
| --: | ------------- | --- | --------------------------------------------------------------------------------- |
| 119 | always-truthy | A | `const index = expr.argumentExpression ? expr.argumentExpression.getText() : "";` —— `ts.isElementAccessExpression` 的类型里 `argumentExpression` 是必填，而 `a!`（不带下标）正是本函数要放行的形态；删掉恒假的 `?:`，保留 `getText()` |

### scripts/check-on-demand-duties.cjs

|  行 | 类别    | 格  | 代码 / 理由                                       |
| --: | ------- | --- | ------------------------------------------------- |
| 107 | ??-left |     | `return Object.keys(mod.FRESHNESS_TRACKS ?? {});` |

### scripts/check-pending-merge-loss.mjs

|  行 | 类别    | 格  | 代码 / 理由                           |
| --: | ------- | --- | ------------------------------------- |
| 249 | ??-left |     | `const text = String(message ?? "");` |

### scripts/check-ps1-consistency.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                      |
| --: | ---------- | --- | -------------------------------------------------------------------------------- |
| 139 | no-overlap |     | `.filter((f) => f !== undefined);`                                               |
| 293 | ??-left    |     | `if (m && (m[1] ?? "").length <= level) {`                                       |
| 312 | no-overlap |     | `return [...text.matchAll(re)].map((m) => m[1]).filter((p) => p !== undefined);` |
| 437 | no-overlap |     | `.filter((p) => p !== undefined)`                                                |

### scripts/check-scripts-typecheck.cjs

|  行 | 类别      | 格  | 代码 / 理由                                                    |
| --: | --------- | --- | -------------------------------------------------------------- |
| 184 | ??-left   | D   | `spawnSync` 出参在起不来时实测 undefined；注记救不到，落账一行 |
| 207 | ??-left   | D   | 同上（`git ls-files` 那一路）                                  |
| 345 | ??-left   | D   | 同上（tsc 被掐断时两个出参都 undefined）                       |
| 345 | ??-left   | D   | 同上                                                           |
| 702 | opt-chain | D   | `cur.files` 是本跑现算的稀疏表，没报过的格就是缺；规则不建模   |

### scripts/check-theme-colors.cjs

|  行 | 类别         | 格  | 代码 / 理由                                                                                         |
| --: | ------------ | --- | --------------------------------------------------------------------------------------------------- |
| 490 | always-falsy | B | `if (cl && (cl.wholeFile \|\| cl.lines.has(lineNo) \|\| (scopes[i] && cl.names.has(scopes[i])))) {` —— `cl` 已判非空，`scopes[i] &&` 在 `scopeResolver` 的 `string[] | null` 上恒真；把 `scope` 判空放回它自己那一档 |

### scripts/check-ui-customizations.cjs

|  行 | 类别       | 格  | 代码 / 理由              |
| --: | ---------- | --- | ------------------------ |
| 150 | no-overlap | A | `if (ledger === null) {` —— `parseLedger` 实际回 `Set<string> | null`（找不到小节即 `null`），JSDoc 补 `| null`；这条判空是那条失败路径的唯一入口，保留 |

### scripts/ci-build-classify.mjs

|  行 | 类别    | 格  | 代码 / 理由                                   |
| --: | ------- | --- | --------------------------------------------- |
| 238 | ??-left |     | `const id = String(pipelineId ?? "").trim();` |
| 457 | ??-left |     | `const want = String(ref ?? "")`              |

### scripts/ci-build-print.mjs

|  行 | 类别    | 格  | 代码 / 理由                                     |
| --: | ------- | --- | ----------------------------------------------- |
|  88 | ??-left |     | `const lines = String(text ?? "").split("\n");` |

### scripts/ci-build-readout.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                                  |
| --: | ------------- | --- | -------------------------------------------------------------------------------------------- |
| 300 | ??-left       | D   | ``${prefix} 失败格：${s.name ?? s.id}（${s.id}）不在任何一条流水线的读数里 ⇒ 取不到日志。`,` |
| 562 | no-overlap    | C   | `if (value === undefined \|\| value.startsWith("--")) {`                                     |
| 579 | no-overlap    | C   | `if (value === undefined \|\| !Number.isInteger(n) \|\| n < 1) {`                            |
| 670 | always-truthy | D   | `const pipeline = first ? pipelineForStage(outcome, first.id) : null;`                       |
| 671 | always-truthy | D   | `if (first && pipeline) {`                                                                   |

### scripts/ci-cache-slot.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 233 | opt-chain  |     | `const store = String(res?.stdout ?? "").trim();`                                                |
| 234 | opt-chain  |     | `if ((res?.status ?? 1) !== 0 \|\| !store) {`                                                    |
| 652 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/ci-console-encoding.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                      |
| --: | ------- | --- | -------------------------------------------------------------------------------- |
|  90 | ??-left |     | `return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };` |
|  90 | ??-left |     | `return { status: r.status, out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim() };` |
| 125 | ??-left |     | `const out = String(r.out ?? "").trim();`                                        |
| 168 | ??-left |     | `const after = Number(/(\d{3,5})/.exec(r.out ?? "")?.[1] ?? Number.NaN);`        |

### scripts/ci-container-plan.mjs

|  行 | 类别       | 格  | 代码 / 理由                                    |
| --: | ---------- | --- | ---------------------------------------------- |
| 232 | no-overlap |     | `stageIndent !== null && indent > stageIndent` |

### scripts/ci-cp936-exit.mjs

|  行 | 类别      | 格  | 代码 / 理由                                         |
| --: | --------- | --- | --------------------------------------------------- |
| 308 | ??-left   | C   | `return { command: command ?? null, args, usage };` |
| 578 | opt-chain | A   | `!invocation?.command \|\|`                         |
| 714 | opt-chain |     | `stream?.setEncoding?.("utf8");`                    |
| 714 | opt-chain |     | `stream?.setEncoding?.("utf8");`                    |
| 715 | opt-chain |     | `stream?.on("data", (d) => {`                       |

### scripts/ci-cp936-glyphs.mjs

|  行 | 类别    | 格  | 代码 / 理由                                  |
| --: | ------- | --- | -------------------------------------------- |
| 294 | ??-left |     | `return { text: text ?? "", replaced: [] };` |

### scripts/ci-daily-bundle-escalation.mjs

|  行 | 类别         | 格  | 代码 / 理由                                                                       |
| --: | ------------ | --- | --------------------------------------------------------------------------------- |
|  97 | ??-left      |     | `{stale = { kind: "commits", n: Number(since[2]), rev: since[1] ?? null };}`      |
| 290 | always-falsy |     | `if (!hit) {return { days: "unknown", note: `${sn} 的预算闸那一格认不出` };}`     |
| 365 | always-falsy |     | `if (!hit) {return { fired: false, reason: "预算闸那一格认不出", section: "" };}` |

### scripts/ci-daily-failure-issue.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                       |
| --: | ------- | --- | ------------------------------------------------------------------------------------------------- |
| 193 | ??-left |     | `const bySn = new Map((details ?? []).map((d) => [String(d.sn), d.json]));`                       |
| 195 | ??-left |     | `const wanted = new Set((Array.isArray(lanes) ? lanes : []).map((l) => String(l ?? "").trim()));` |

### scripts/ci-env-probe.mjs

|  行 | 类别           | 格  | 代码 / 理由                                                                  |
| --: | -------------- | --- | ---------------------------------------------------------------------------- |
| 113 | ??-left        | A   | `const lines = String(text ?? "").split("\n");`                              |
| 173 | ??-left        | A   | `const m = /(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(String(text ?? ""));`        |
| 177 | ??-left        | C   | `return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];`               |
| 177 | ??-left        |     | `return [Number(m[1]), Number(m[2] ?? 0), Number(m[3] ?? 0)];`               |
| 244 | ??-left        | A   | `const lines = String(text ?? "").split("\n");`                              |
| 314 | ??-left        | A   | `const lines = String(text ?? "").split("\n");`                              |
| 389 | ??-left        |     | `out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),`                          |
| 389 | ??-left        |     | `out: `${r.stdout ?? ""}${r.stderr ?? ""}`.trim(),`                          |
| 407 | ??-left        | A   | `const target = String(dir ?? "").trim();`                                   |
| 532 | always-nullish | A   | ``解释器 ${python.path ?? python.command} 的版本号解析不出（原文：` +`       |
| 537 | always-nullish | A   | ``解释器 ${python.path ?? python.command} ${floor.triple.join(".")} ` +`     |
| 542 | always-nullish | A   | ``解释器 ${python.path ?? python.command} 是 ${floor.triple.join(".")}，` +` |
| 579 | no-overlap     | C   | `encoding.ansiCodePage === null \|\| encoding.ansiCodePage === undefined`    |
| 685 | ??-left        |     | `notes.push(`下载根探测：${v.root ?? v.url} → ${v.verdict}`);`               |

### scripts/ci-gate-names.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                     |
| --: | ------- | --- | ----------------------------------------------------------------------------------------------- |
|  60 | ??-left |     | `const lines = String(text ?? "").split("\n");`                                                 |
|  70 | ??-left |     | `keyIndent = (m[1] ?? "").length;`                                                              |
| 178 | ??-left |     | `for (const line of String(text ?? "").split("\n")) {`                                          |
| 199 | ??-left |     | `String(text ?? "").match(/(?:scripts\|tools\|tests)\/[A-Za-z0-9._/-]+\.[A-Za-z0-9]+/g) ?? [],` |

### scripts/ci-heavy-gates.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 263 | ??-left    | A   | `argv` 来自钩子解析，可缺                                                                        | mjs)/);` |
| 294 | ??-left    | A   | `step` / `changed` 来自钩子文本与 git diff 的解析结果，形参改可缺                                |
| 298 | ??-left    | A   | 同上                                                                                             |
| 298 | opt-chain  |     | `const script = judgmentScriptOf(step?.argv ?? []);`                                             |
| 380 | ??-left    | D   | `r.output` 是注入面（用例会喂 null），规则读不到                                                 |
| 398 | ??-left    | D   | 同上                                                                                             |
| 422 | ??-left    | A   | `compact(line)` 形参可缺                                                                         |
| 646 | no-overlap | B   | `r !== undefined` 在类型上恒真 —— 这是唯一一处**真多余**的条件，已删                             |
| 777 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/ci-image-identity.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                        |
| --: | ---------- | --- | -------------------------------------------------------------------------------------------------- |
| 277 | no-overlap |     | `if (image !== undefined && image !== null && String(image).trim() !== "" && dig === "missing") {` |

### scripts/ci-image-plan.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                   |
| --: | ------- | --- | ------------------------------------------------------------- |
| 154 | ??-left | A   | `range` 来自 engines.node，形参改可缺                         |
| 156 | ??-left | D   | 正则两条分支各占三个分组，规则把 RegExpExecArray 索引读成非空 |
| 157 | ??-left | D   | 同上                                                          |
| 158 | ??-left | D   | 同上                                                          |
| 184 | ??-left | A   | `index` 是下载清单的 JSON，条目字段可缺                       |
| 243 | ??-left | A   | `lockText` 是 pnpm-lock.yaml 原文，读不到时 undefined         |
| 294 | ??-left | D   | 版本号入参可缺，规则读不到（本函数刻意「形状不认就抛」）      |
| 297 | ??-left | D   | 同上                                                          |
| 457 | ??-left | A   | `dockerfile` 读不到时 undefined                               |
| 690 | ??-left | A   | `bytes` 是量出来的读数，可缺                                  |

### scripts/ci-incremental-gates.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 524 | ??-left    |     | `const s = String(script ?? "").replaceAll("\\", "/");`                                          |
| 544 | ??-left    |     | `const globs = entry?.globs ?? [];`                                                              |
| 544 | opt-chain  |     | `const globs = entry?.globs ?? [];`                                                              |
| 559 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/ci-install-deps.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 416 | ??-left    |     | `String(res.error.message ?? res.error)`                                                         |
| 420 | ??-left    |     | `stdout: String(res.stdout ?? ""),`                                                              |
| 421 | ??-left    |     | `stderr: String(res.stderr ?? ""),`                                                              |
| 725 | ??-left    |     | `return { status: out.status ?? 1, stdout: out.stdout ?? "" };`                                  |
| 759 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/ci-load.mjs

|  行 | 类别      | 格  | 代码 / 理由                                             |
| --: | --------- | --- | ------------------------------------------------------- |
|  77 | ??-left   |     | `cores: os.availableParallelism?.() ?? FALLBACK_CORES,` |
|  77 | opt-chain |     | `cores: os.availableParallelism?.() ?? FALLBACK_CORES,` |
|  82 | opt-chain |     | `const local = os.availableParallelism?.();`            |

### scripts/ci-log.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                       |
| --: | --------- | --- | --------------------------------------------------------------------------------- |
| 220 | ??-left   | A   | `line` 来自日志原文，渲染层兜底可缺；形参改可缺                                   |
| 241 | ??-left   | A   | 同上（`colorizeLine`）                                                            |
| 276 | ??-left   | A   | 同上（`stateOfLine`）                                                             |
| 324 | opt-chain | A   | `const ok = (tally?.ok ?? []).filter((x) => String(x ?? "").trim());`             |
| 324 | ??-left   | A   | `tally` 与条目名字来自调用方拼的汇总表，可缺；形参改可缺                          |
| 325 | opt-chain | A   | 同上                                                                              |
| 325 | ??-left   | A   | 同上                                                                              |
| 326 | opt-chain | A   | 同上                                                                              |
| 326 | ??-left   | A   | 同上                                                                              |
| 383 | ??-left   | A   | `return (items ?? [])`                                                            |
| 384 | ??-left   | A   | 同上                                                                              |
| 403 | ??-left   | A   | `const list = (items ?? []).map((x) => String(x ?? "")).filter((x) => x.trim());` |
| 477 | ??-left   | D   | `if ((items ?? []).filter((x) => String(x ?? "").trim()).length === 0) {`         |
| 477 | ??-left   | D   | `gateFail(items)` 的 `?? []`：进了函数体规则把 items 读成非空，兜底保留           |
| 522 | ??-left   | A   | `paintLine(line)` 同 colorizeLine：渲染层兜底可缺                                 |

### scripts/ci-pr-failure-issue.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                |
| --: | ------------- | --- | -------------------------------------------------------------------------- |
| 142 | ??-left       |     | `const m = /\/pulls?\/(\d+)/.exec(String(url ?? ""));`                     |
| 563 | always-truthy |     | `firstDetail ? enrichStageErrors(run, slug, sn, firstDetail.json) : null,` |

### scripts/ci-probe-lock-readout.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                              |
| --: | ---------- | --- | ---------------------------------------------------------------------------------------- |
| 205 | ??-left    |     | `const row = rows.find((r) => r?.sn === sn) ?? rows[0] ?? {};`                           |
| 205 | opt-chain  |     | `const row = rows.find((r) => r?.sn === sn) ?? rows[0] ?? {};`                           |
| 543 | no-overlap |     | `if (a === undefined) {`                                                                 |
| 552 | no-overlap |     | `if (next != null && !next.startsWith("--")) {`                                          |
| 593 | ??-left    |     | `seconds: Number(f.seconds ?? 90),`                                                      |
| 605 | ??-left    |     | `console.log(startProbe(repo, String(f.event), String(f.title ?? `probe ${f.event}`)));` |
| 625 | ??-left    |     | `const gap = Number(f.gap ?? 20);`                                                       |

### scripts/ci-slot-apply.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 615 | opt-chain  |     | `const status = res?.status ?? 1;`                                                               |
| 657 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/ci-token-scopes.mjs

|  行 | 类别       | 格  | 代码 / 理由                                          |
| --: | ---------- | --- | ---------------------------------------------------- |
| 270 | ??-left    |     | `const text = String(raw ?? "");`                    |
| 562 | no-overlap |     | `return i !== -1 && v !== undefined ? v : fallback;` |

### scripts/ci-toolchain-browser-fetch.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                           |
| --: | ---------- | --- | --------------------------------------------------------------------- |
| 291 | ??-left    |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();`            |
| 291 | ??-left    |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();`            |
| 305 | no-overlap |     | `const total = b === undefined \|\| b === "null" ? null : Number(b);` |

### scripts/ci-toolchain-browser-reach.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                         |
| --: | --------- | --- | ------------------------------------------------------------------- |
| 202 | opt-chain |     | `b?.name === "chromium-headless-shell",`                            |
| 256 | ??-left   |     | `const base = String(root ?? "").replace(/\/+$/, "");`              |
| 380 | ??-left   |     | `const m = /^HTTP\s+(\d{3})\b/.exec(String(verdict ?? "").trim());` |
| 459 | ??-left   |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();`          |
| 459 | ??-left   |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();`          |
| 623 | ??-left   |     | `const text = String(verdict ?? "").trim();`                        |

### scripts/ci-toolchain-browser.mjs

|  行 | 类别    | 格  | 代码 / 理由                                             |
| --: | ------- | --- | ------------------------------------------------------- |
| 353 | ??-left |     | `const text = out ?? "";`                               |
| 521 | ??-left |     | `const m = /timed out after (\d+)ms/.exec(text ?? "");` |
| 766 | ??-left |     | `out += `${r.out ?? ""}\n`;`                            |

### scripts/ci-toolchain-pnpm.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                |
| --: | ------- | --- | ---------------------------------------------------------- |
| 506 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
| 506 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |

### scripts/ci-toolchain-python.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                |
| --: | ------- | --- | ---------------------------------------------------------- |
|  85 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
|  85 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
| 259 | ??-left |     | `return (r.stdout ?? "").trim() \|\| "(取不到)";`          |
| 696 | ??-left |     | `String(text ?? "")`                                       |

### scripts/ci-toolchain-selfcheck.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                |
| --: | ------- | --- | ---------------------------------------------------------- |
| 144 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
| 144 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
| 164 | ??-left |     | `const m = /(\d+)\.(\d+)\.(\d+)/.exec(text ?? "");`        |
| 169 | ??-left |     | `major: Number(m[1] ?? 0),`                                |
| 170 | ??-left |     | `minor: Number(m[2] ?? 0),`                                |
| 171 | ??-left |     | `patch: Number(m[3] ?? 0),`                                |

### scripts/ci-workspace-probe.mjs

|  行 | 类别         | 格  | 代码 / 理由                                                |
| --: | ------------ | --- | ---------------------------------------------------------- |
| 155 | ??-left      |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
| 155 | ??-left      |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`.trim();` |
| 288 | always-falsy |     | `if (!st) {`                                               |
| 444 | opt-chain    |     | `facts.node_modules?.present`                              |

### scripts/ci-workspace-provenance.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 397 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/db-backup-core.mjs

|  行 | 类别    | 格  | 代码 / 理由                                  |
| --: | ------- | --- | -------------------------------------------- |
| 114 | ??-left |     | `const sm = STAMP_RE.exec(stampText ?? "");` |

### scripts/db-migrate.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                      |
| --: | ------- | --- | -------------------------------------------------------------------------------- |
| 213 | ??-left |     | `? `起 pnpm 失败（${run.error.code ?? "UNKNOWN"}）：${run.error.message ?? ""}`` |

### scripts/db-push-core.mjs

|  行 | 类别    | 格  | 代码 / 理由                                        |
| --: | ------- | --- | -------------------------------------------------- |
| 200 | ??-left |     | `return error.code ?? error.message ?? "UNKNOWN";` |

### scripts/dev-drive-bench.mjs

|  行 | 类别         | 格  | 代码 / 理由    |
| --: | ------------ | --- | -------------- |
| 460 | always-falsy |     | `if (!hint) {` |

### scripts/dev-drive-levers.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                          |
| --: | ------------- | --- | ------------------------------------------------------------------------------------ |
| 77 | ??-left | B | `const volume = report.volume ?? {};` —— `ProbeReport.volume` 必填；`?? {}` 恒不成立（探针永远回对象，读不到写在字段里） |
| 78 | ??-left | B | `const caps = report.capabilities ?? {};` —— 同上：`capabilities` |
| 79 | ??-left | B | `const pnpm = report.pnpm ?? {};` —— 同上：`pnpm` |
| 80 | ??-left | B | `const git = report.git ?? {};` —— 同上：`git` |
| 81 | ??-left | B | `const cache = report.cache ?? {};` —— 同上：`cache` |
| 82 | ??-left | A | `const drive = volume.root ?? "";` —— `VolumeProbe.root` 是 `string`，`?? ""` 恒不成立 |
| 85 | ??-left | A | `levers.push(workdirLever(report.workdirs ?? []));` —— `workdirs` 在 `ProbeReport` 里是 `WorkdirEntry[]`，`?? []` 恒不成立 —— 它还悄悄把「探针忘了给」读成「空的」 |
| 87 | ??-left | A | `levers.push(defenderLever(volume, report.defender ?? { known: false }));` —— `defender` 必填（`probeDefender` 永远回对象）；那层 `?? { known: false }` 恒不成立，判空本来就在 `defenderLever` 里 |
| 95 | ??-left | A | `report.indexMarking ?? { known: false, sampled: 0, marked: 0, ratio: null },` —— `indexMarking` 必填；可 `null` 的是它内部的 `ratio`（`searchIndexLever` 里另有判空） |
| 143 | ??-left | A | `const storePath = pnpm.storePath ?? "";` —— `PnpmProbe.storePath` 是 `string`（读不到就是空串），`?? ""` 恒不成立 |
| 336 | ??-left | A | `const drive = volume.root ?? "";` —— `root` 是 `string`，`?? ""` 恒不成立 |
| 356 | ??-left | A | `if (/受信任/.test(volume.devDriveLabel ?? "")) {` —— `devDriveLabel` 是 `string`，`?? ""` 恒不成立（`devDrive === "yes"` 那一支它一定非空） |
| 498 | literal-cmp | B | `if (usage.state === "unknown") {` —— 走到这里只剩 `idle`（`busy` / `unknown` 已各自 return）；`=== "idle"` 与 `!== "busy" && !== "unknown"` 都会被 tsc 判 TS2367，直接落成语句 |
| 582 | always-truthy | A | `if (marking && marking.known && marking.ratio !== null && marking.ratio >= 0.95) {` —— `marking` 由调用点按默认值补全，`&& marking.known` 那半恒真；真正可缺的是 `ratio`（`number | null`） |

### scripts/dev-drive-probe.mjs

|  行 | 类别    | 格  | 代码 / 理由                                       |
| --: | ------- | --- | ------------------------------------------------- |
| 278 | ??-left |     | `raw = String(viaDriveInfo.stdout ?? "").trim();` |
| 285 | ??-left |     | `raw = String(viaGetVolume.stdout ?? "").trim();` |
| 447 | ??-left |     | `importMethod = matched[1] ?? null;`              |

### scripts/dev-drive-tune.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                             |
| --: | ------- | --- | --------------------------------------------------------------------------------------- |
| 89 | ??-left | B | `const volume = report.volume ?? {};` —— `ProbeReport.volume` 必填（`probeVolume` 永远返回对象），`?? {}` 恒不成立；真会缺的是 `fsType` / `label`（类型里就有 `null`） |
| 90 | ??-left | B | `const caps = report.capabilities ?? {};` —— 同上：`capabilities` 必填 |
| 96 | ??-left | A | `` —— `root` 在 `VolumeProbe` 里是 `string`；`?? "(未知)"` 恒不成立 —— 真正可能缺的是 `fsType` / `label`，它们的 `??` 保留 |
| 97 | ??-left | A | `` —— 同上：`devDriveLabel` 是 `string`，`?? "未知"` 恒不成立 |
| 107 | ??-left | A | `lines.push(` —— 状态词表四档与 `mark` 的四档同一份，`?? "?"` 恒不成立；删掉后状态扩档由 tsc 当场点名 |
| 109 | ??-left | B | `for (const action of lever.actions ?? []) {` —— `Lever.actions` 必填（`buildLevers` 每条都给数组），`?? []` 恒不成立 |

### scripts/dev-handle.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                       |
| --: | ------- | --- | ----------------------------------------------------------------- |
|  98 | ??-left |     | `return got.status === 0 ? String(got.stdout ?? "").trim() : "";` |
| 152 | ??-left |     | `return got.status === 0 ? String(got.stdout ?? "").trim() : "";` |

### scripts/dev.mjs

|  行 | 类别       | 格  | 代码 / 理由              |
| --: | ---------- | --- | ------------------------ |
|  49 | no-overlap |     | `if (a === undefined) {` |

### scripts/doc-toc.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                         |
| --: | ---------- | --- | ------------------------------------------------------------------- |
|  90 | ??-left    |     | `const hashes = m[1] ?? "";`                                        |
|  92 | ??-left    |     | `const title = (m[2] ?? "").replace(/[ \t]+#+[ \t]*$/, "").trim();` |
| 115 | no-overlap |     | `if (h === undefined) {`                                            |
| 121 | no-overlap |     | `if (next !== undefined && next.level <= h.level) {`                |
| 140 | ??-left    |     | `const raw = String(name ?? "")`                                    |

### scripts/docs-api-input-closure.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 427 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/e2e-run.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                  |
| --: | ------- | --- | ---------------------------------------------------------------------------- |
| 445 | ??-left |     | ``[e2e-run] ✗ 理由（"${String(raw ?? "").trim()}"）不算「有人回答过」—— ` +` |

### scripts/env-preflight.mjs

|  行 | 类别    | 格  | 代码 / 理由                        |
| --: | ------- | --- | ---------------------------------- |
|  46 | ??-left |     | `let value = (m[2] ?? "").trim();` |

### scripts/eslint-gate-canary.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                      |
| --: | --------- | --- | -------------------------------------------------------------------------------- |
| 146 | ??-left   |     | `const text = (res.stdout ?? "").trim();`                                        |
| 161 | opt-chain |     | `return new Set((entry?.messages ?? []).map((m) => m?.ruleId).filter(Boolean));` |

### scripts/executor-host.mjs

|  行 | 类别          | 格  | 代码 / 理由           |
| --: | ------------- | --- | --------------------- |
| 364 | always-truthy |     | `if (!hostRuntime) {` |

### scripts/freshness-gate.mjs

|  行 | 类别         | 格  | 代码 / 理由                                         |
| --: | ------------ | --- | --------------------------------------------------- |
| 184 | ??-left      |     | `ciStage: String(track.ciStage ?? "").trim(),`      |
| 215 | always-falsy |     | `if (!track.dirty \|\| track.dirty.length === 0) {` |

### scripts/freshness-ledger-sync.mjs

|  行 | 类别          | 格  | 代码 / 理由                      |
| --: | ------------- | --- | -------------------------------- |
| 149 | always-truthy |     | `if (res && res.status === 0) {` |

### scripts/freshness-ledger.mjs

|  行 | 类别         | 格  | 代码 / 理由                                                         |
| --: | ------------ | --- | ------------------------------------------------------------------- |
| 216 | always-falsy |     | `if (!track) {`                                                     |
| 314 | ??-left      |     | `.map((a) => String(a ?? "").trim())`                               |
| 410 | ??-left      |     | `const since = (track.dirty ?? []).length > 0 ? dirtySince : null;` |
| 424 | ??-left      |     | `if ((track.dirty ?? []).length === 0) {`                           |
| 481 | ??-left      |     | `const ciOwned = String(track.ciStage ?? "").trim() !== "";`        |
| 600 | ??-left      |     | `(track.dirty ?? []).length > 0`                                    |

### scripts/full-suite-run.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                 |
| --: | ------- | --- | --------------------------------------------------------------------------- |
| 150 | ??-left | D   | `exclude` 可选入参显式传 null 时这条路仍要成立                              |
| 275 | ??-left | A   | `xmlText` 读不到 junit 时是空串/undefined，形参改可缺                       |
| 321 | ??-left | D   | `m[1]`/`m[2]` 正则分组可缺，规则读成非空                                    |
| 322 | ??-left | D   | 同上                                                                        |
| 323 | ??-left | D   | 同上                                                                        |
| 371 | ??-left | A   | 同 275：这一档读不到 junit 时给空串                                         |
| 421 | ??-left | D   | `shouldRecord` 的 `exclude` 可选入参显式传 null 时仍要成立                  |
| 737 | ??-left | D   | `runPnpmSync` 是注入面，出参形状不由本文件保证                              |
| 737 | ??-left |     | `const out = `${String(res2.stdout ?? "")}\n${String(res2.stderr ?? "")}`;` |

### scripts/gates-which.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
|  95 | ??-left    |     | `const token = String(raw ?? "").replaceAll("\\", "/");`                                         |
| 173 | ??-left    |     | `const stdout = String(res.stdout ?? "");`                                                       |
| 174 | ??-left    |     | `const stderr = String(res.stderr ?? "");`                                                       |
| 395 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/generate-api-docs.mjs

|  行 | 类别       | 格  | 代码 / 理由                                           |
| --: | ---------- | --- | ----------------------------------------------------- |
|  96 | no-overlap |     | `if (arg === undefined) {`                            |
| 116 | no-overlap |     | `if (next === undefined \|\| next.startsWith("-")) {` |

### scripts/git-dir.mjs

|  行 | 类别    | 格  | 代码 / 理由                                  |
| --: | ------- | --- | -------------------------------------------- |
|  89 | ??-left |     | `const dir = String(r.stdout ?? "").trim();` |

### scripts/install-git-hooks.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                             |
| --: | ------- | --- | ----------------------------------------------------------------------- |
|  33 | ??-left |     | `return { ok: r.status === 0, stdout: String(r.stdout ?? "").trim() };` |

### scripts/junit-readout-diag.mjs

|  行 | 类别         | 格  | 代码 / 理由    |
| --: | ------------ | --- | -------------- |
| 101 | always-falsy |     | `if (!best) {` |

### scripts/known-failed-selftest-gate.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                    |
| --: | ------- | --- | ------------------------------------------------------------------------------ |
| 161 | ??-left |     | `return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };` |
| 161 | ??-left |     | `return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };` |

### scripts/launcher-core/corepack.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                       |
| --: | ------- | --- | --------------------------------------------------------------------------------- |
| 193 | ??-left | A | `const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;` —— probe.stdout 起不来/超时时实测 undefined；本文件新增 SpawnOutput typedef 按实测声明 |
| 193 | ??-left | A | `const output = `${probe.stdout ?? ""}${probe.stderr ?? ""}`;` —— 同上 stderr |
| 199 | ??-left | A | `return failed(command, "no-version", firstLines(output), probe.status ?? null);` —— probe.status 在 error 支被挡掉后恒有值；typedef 声明 status?: number|null |
| 208 | ??-left | A | `exitCode: probe.status ?? 0,` —— 同上（error 支已提前 return，这里的 ?? 0 只给类型看） |
| 299 | ??-left | A | `const tail = firstLines(`${result.stdout ?? ""}${result.stderr ?? ""}`);` —— prepare 的 spawnSync 出参同上，按 SpawnOutput 声明 |
| 299 | ??-left | A | `const tail = firstLines(`${result.stdout ?? ""}${result.stderr ?? ""}`);` —— 同上 stderr |

### scripts/launcher-core/log.mjs

|  行 | 类别    | 格  | 代码 / 理由                                  |
| --: | ------- | --- | -------------------------------------------- |
| 177 | ??-left |     | `const name = LEVELS[level] ?? LEVELS.INFO;` |

### scripts/launcher-core/node-runner.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                        |
| --: | ------- | --- | ------------------------------------------------------------------ |
|  38 | ??-left |     | `? String(result.error.code ?? result.error.message ?? "unknown")` |
| 193 | ??-left |     | `const text = String(script ?? "").trim();`                        |

### scripts/launcher-core/port-reap.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                           |
| --: | ------- | --- | --------------------------------------------------------------------- |
| 269 | ??-left |     | `const commandLines = await processCommandLines(verdict.pids ?? []);` |

### scripts/launcher-core/procs.mjs

|  行 | 类别    | 格  | 代码 / 理由                                 |
| --: | ------- | --- | ------------------------------------------- |
| 38 | ??-left | A | `resolve(err ? "" : String(stdout ?? ""));` —— execFile 回调的 stdout 在 ENOENT 时实测 undefined（@types/node 按 encoding 声明成 string），必要兜底；回调形参不接受 JSDoc 注记 → 落 D 见 PR |

### scripts/launcher-core/runtime-heal.mjs

|  行 | 类别    | 格  | 代码 / 理由                                   |
| --: | ------- | --- | --------------------------------------------- |
|  45 | ??-left |     | `const head = String(r.stdout ?? "").trim();` |
|  72 | ??-left |     | `return String(r.stdout ?? "");`              |

### scripts/launcher-core/shell.mjs

|  行 | 类别    | 格  | 代码 / 理由                            |
| --: | ------- | --- | -------------------------------------- |
| 185 | ??-left | A | `stdout: String(result.stdout ?? ""),` —— spawnSync 出参 stdout 起不来时实测 undefined；runSync 的 @returns/JSDoc 已按实测声明可缺 |
| 186 | ??-left | A | `stderr: String(result.stderr ?? ""),` —— 同上 stderr |
| 347 | ??-left | A | `stdout: String(result.stdout ?? ""),` —— spawnInGroup 的 spawnSync 出参按实测声明 stdout 可缺 |
| 348 | ??-left | A | `stderr: String(result.stderr ?? ""),` —— 同上 stderr |

### scripts/launcher-core/sync-attribution.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                   |
| --: | ---------- | --- | ------------------------------------------------------------- |
|  62 | ??-left    |     | `for (const rawLine of String(output ?? "").split("\n")) {`   |
|  70 | no-overlap |     | `if (rawStatus === undefined \|\| firstPath === undefined) {` |
|  70 | no-overlap |     | `if (rawStatus === undefined \|\| firstPath === undefined) {` |
|  79 | no-overlap |     | `if (newPath === undefined) {`                                |
| 113 | ??-left    |     | `for (const entry of entries ?? []) {`                        |

### scripts/lockfile/lock-diff.mjs

|  行 | 类别    | 格  | 代码 / 理由                                             |
| --: | ------- | --- | ------------------------------------------------------- |
| 227 | ??-left |     | `const name = unquote(m ? (m[2] ?? "") : line.trim());` |

### scripts/lockfile/render-lock-diff.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                           |
| --: | ------------- | --- | ------------------------------------------------------------------------------------- |
| 163 | always-truthy |     | `const dup = [...(diff.duplicates?.old \|\| []), ...(diff.duplicates?.new \|\| [])];` |
| 163 | opt-chain     |     | `const dup = [...(diff.duplicates?.old \|\| []), ...(diff.duplicates?.new \|\| [])];` |
| 163 | always-truthy |     | `const dup = [...(diff.duplicates?.old \|\| []), ...(diff.duplicates?.new \|\| [])];` |
| 163 | opt-chain     |     | `const dup = [...(diff.duplicates?.old \|\| []), ...(diff.duplicates?.new \|\| [])];` |

### scripts/merge-changelog-fragments.mjs

|  行 | 类别         | 格  | 代码 / 理由                     |
| --: | ------------ | --- | ------------------------------- |
| 181 | ??-left      |     | `rev = a[1] ?? null;`           |
| 182 | ??-left      |     | `slug = a[2] ?? null;`          |
| 231 | always-falsy |     | `if (!firstPending) {`          |
| 272 | opt-chain    |     | `const section = name?.trim();` |

### scripts/merged-side-loss-git.mjs

|  行 | 类别       | 格  | 代码 / 理由                                         |
| --: | ---------- | --- | --------------------------------------------------- |
|  99 | no-overlap |     | `if (line === undefined \|\| spec === undefined) {` |
|  99 | no-overlap |     | `if (line === undefined \|\| spec === undefined) {` |

### scripts/node-engines.mjs

|  行 | 类别          | 格  | 代码 / 理由                                              |
| --: | ------------- | --- | -------------------------------------------------------- |
|  82 | ??-left       | A   | `raw` 来自 package.json / 运行时版本，形参改可缺         |
|  96 | ??-left       | A   | `parseBound(raw)` 同上                                   |
| 133 | ??-left       | A   | `range` 来自 engines 字段，形参改可缺                    |
| 188 | ??-left       | D   | `m[1]` 可选分组可缺，规则把 RegExpExecArray 索引读成非空 |
| 217 | literal-cmp   | D   | 同上（第二个分组）                                       |
| 233 | ??-left       | C   | 只有上界的区间要落 null，这条判空守的是契约不是当前流程  |
| 440 | ??-left       | A   | `version` 来自运行时/package.json，形参改可缺            |
| 441 | ??-left       | A   | 同上                                                     |
| 470 | always-truthy | D   | 索引访问在 noUncheckedIndexedAccess 下可缺，规则没建模   |

### scripts/package-bin-entry.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 247 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/precommit-timing.mjs

|  行 | 类别       | 格  | 代码 / 理由                       |
| --: | ---------- | --- | --------------------------------- |
| 336 | ??-left    |     | `const text = String(xml ?? "");` |
| 603 | no-overlap |     | `if (arg === undefined) {`        |
| 608 | no-overlap |     | `if (next !== undefined) {`       |

### scripts/premerge-check.mjs

|  行 | 类别      | 格  | 代码 / 理由                                            |
| --: | --------- | --- | ------------------------------------------------------ |
| 306 | ??-left   |     | `const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;` |
| 306 | ??-left   |     | `const output = `${r.stdout ?? ""}${r.stderr ?? ""}`;` |
| 335 | ??-left   |     | `for (const c of commands ?? []) {`                    |
| 336 | opt-chain |     | `for (const a of c?.argv ?? []) {`                     |

### scripts/premerge-proof.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                                      |
| --: | --------- | --- | -------------------------------------------------------------------------------- |
| 213 | ??-left   |     | `return r.status === 0 ? String(r.stdout ?? "").trim() : "";`                    |
| 373 | ??-left   |     | `stdout: r.stdout ?? "",`                                                        |
| 390 | ??-left   |     | `const gitDir = path.resolve(ROOT, String(gitDirOut.stdout ?? "").trim());`      |
| 429 | opt-chain |     | `spawnSync("git", ["config", "user.name"], {`                                    |
| 449 | opt-chain | A   | `const reds = segments.filter((s) => (s?.code ?? 0) !== 0);`                     |
| 452 | opt-chain | A   | `(s) => `${String(s?.label ?? s?.key ?? "?")}（退 ${String(s?.code ?? "?")}）`,` |
| 452 | opt-chain |     | `(s) => `${String(s?.label ?? s?.key ?? "?")}（退 ${String(s?.code ?? "?")}）`,` |
| 452 | opt-chain |     | `(s) => `${String(s?.label ?? s?.key ?? "?")}（退 ${String(s?.code ?? "?")}）`,` |
| 457 | opt-chain | A   | `if (reds.every((s) => s?.key === "base")) {`                                    |

### scripts/premerge-timing.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                                                |
| --: | ------------- | --- | ---------------------------------------------------------------------------------------------------------- |
|  42 | always-falsy  |     | `if (!run \|\| !Array.isArray(run.entries) \|\| run.entries.length === 0) {`                               |
|  52 | always-truthy |     | `.filter((e) => e && typeof e.label === "string" && e.label !== "" && Number.isFinite(e.ms) && e.ms >= 0)` |
|  72 | ??-left       |     | `const usable = (entries ?? []).filter((e) => e && e.label && Number.isFinite(e.ms) && e.ms >= 0);`        |
|  72 | always-truthy |     | `const usable = (entries ?? []).filter((e) => e && e.label && Number.isFinite(e.ms) && e.ms >= 0);`        |

### scripts/publish-desktop-bundle.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                             |
| --: | ------- | --- | ----------------------------------------------------------------------- |
| 264 | ??-left |     | `const sha = String(runGit(["rev-parse", "HEAD"]) ?? "").trim();`       |
| 299 | ??-left |     | `return { ok: r.status === 0, stdout: String(r.stdout ?? "").trim() };` |

### scripts/qoder-ignore.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 224 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/quality-gate.mjs

|  行 | 类别         | 格  | 代码 / 理由                                            |
| --: | ------------ | --- | ------------------------------------------------------ |
| 282 | no-overlap   |     | `if (next === undefined \|\| next.startsWith("--")) {` |
| 483 | always-falsy |     | `if (!gate) {`                                         |
| 548 | no-overlap   |     | `process.argv[1] !== undefined &&`                     |

### scripts/run-tests.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                            |
| --: | ------- | --- | ---------------------------------------------------------------------- |
| 85 | ??-left | D | `for (const m of String(xml ?? "").matchAll(/<testsuite\b[^>]*>/g)) {` —— `xml` 是磁盘上的 junit 产物（外部数据），`String(xml ?? "")` 兜的是「读不到文件」；规则按形参声明读成恒非空 |

### scripts/setup-comfy-cli-venv.mjs

|  行 | 类别    | 格  | 代码 / 理由                                         |
| --: | ------- | --- | --------------------------------------------------- |
| 125 | ??-left |     | `const stdout = String(r.stdout ?? "");`            |
| 126 | ??-left |     | `const stderr = String(r.stderr ?? "");`            |
| 420 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;` |
| 420 | ??-left |     | `const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;` |

### scripts/shell-gate.mjs

|  行 | 类别       | 格  | 代码 / 理由                                    |
| --: | ---------- | --- | ---------------------------------------------- |
| 233 | no-overlap |     | `if (cargo !== null && cargo !== undefined) {` |
| 235 | ??-left    |     | `versionOutput ??`                             |

### scripts/ship-args.mjs

|  行 | 类别    | 格  | 代码 / 理由                                           |
| --: | ------- | --- | ----------------------------------------------------- |
| 45 | ??-left | D | `const bare = String(token ?? "").replace(/^#/, "");` —— `token` 来自命令行 / TAPD 链接尾段（外部输入），`String(token ?? "")` 是它给不出来时的兜底；规则只看得见 JSDoc 的 `string` |

### scripts/ship-build.mjs

|  行 | 类别          | 格  | 代码 / 理由 |
| --: | ------------- | --- | ----------- |
| 133 | always-truthy |     | `s &&`      |

### scripts/ship-claim.mjs

|  行 | 类别    | 格  | 代码 / 理由                        |
| --: | ------- | --- | ---------------------------------- |
|  81 | ??-left |     | `const text = String(body ?? "");` |

### scripts/ship-close.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                 |
| --: | ------- | --- | --------------------------------------------------------------------------- |
|  55 | ??-left |     | `for (const m of String(text ?? "").matchAll(/#\s?(\d{2,})/g)) {`           |
|  82 | ??-left |     | `for (const m of String(text ?? "").matchAll(/\(\s*#\s?(\d{2,})\s*\)/g)) {` |
| 117 | ??-left |     | `const t = String(title ?? "");`                                            |
| 118 | ??-left |     | `const n = String(prNumber ?? "");`                                         |

### scripts/ship-core.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                           |
| --: | ------- | --- | --------------------------------------------------------------------- |
| 288 | ??-left |     | `return m ? (m[1] ?? null) : null;`                                   |
| 330 | ??-left |     | `const named = remotes.map((r) => (r ?? "").trim()).filter(Boolean);` |
| 540 | ??-left |     | `const sha = String(headSha ?? "").trim();`                           |

### scripts/ship-diagnose.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                            |
| --: | ------------- | --- | ---------------------------------------------------------------------- |
| 252 | always-truthy |     | `const pipeline = first ? pipelineForStage(outcome, first.id) : null;` |
| 253 | always-truthy |     | `if (first && pipeline) {`                                             |

### scripts/ship-exec.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                    |
| --: | ------- | --- | ------------------------------------------------------------------------------ |
| 116 | ??-left |     | `const m = /"?sn"?\s*[:=]\s*"?(cnb-[A-Za-z0-9-]+)"?/.exec(String(raw ?? ""));` |
| 117 | ??-left |     | `return m ? (m[1] ?? null) : null;`                                            |

### scripts/ship-platform.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                                                |
| --: | ------- | --- | ------------------------------------------------------------------------------------------ |
| 526 | ??-left |     | `run("git", ["fetch", baseParts[0] ?? up.remote ?? "origin", trunkBranch \|\| "master"]);` |

### scripts/ship-poll.mjs

|  行 | 类别          | 格  | 代码 / 理由                                                                                                      |
| --: | ------------- | --- | ---------------------------------------------------------------------------------------------------------------- |
| 144 | always-truthy |     | `? classifyBuildOutcome(picked ? enrichStageErrors(run, slug, picked.sn, st.json) : st.json)`                    |
| 156 | always-truthy |     | ``[ship] 这一跑**被取消**（不是产物坏了）：${first ? first.name : "(不知哪一格)"} 被终止 ⇒ 下面那几格根本没跑${` |

### scripts/ship-pull-body.mjs

|  行 | 类别    | 格  | 代码 / 理由                            |
| --: | ------- | --- | -------------------------------------- |
|  40 | ??-left |     | `const lines = String(diffstat ?? "")` |

### scripts/ship-reap.mjs

|  行 | 类别         | 格  | 代码 / 理由                                                  |
| --: | ------------ | --- | ------------------------------------------------------------ |
| 165 | ??-left      |     | `const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();` |
| 165 | ??-left      |     | `const out = `${r.stdout ?? ""}\n${r.stderr ?? ""}`.trim();` |
| 188 | always-falsy |     | `if (!after) {`                                              |

### scripts/ship-stage-log.mjs

|  行 | 类别         | 格  | 代码 / 理由                                   |
| --: | ------------ | --- | --------------------------------------------- |
|  89 | ??-left      |     | `const want = String(stageRef ?? "").trim();` |
| 161 | always-falsy |     | `if (!hit) {`                                 |

### scripts/ship-standalone.mjs

|  行 | 类别         | 格  | 代码 / 理由                          |
| --: | ------------ | --- | ------------------------------------ |
| 245 | always-falsy |     | `opt.rerunCi ? "--rerun-ci" : null,` |
| 254 | always-falsy |     | `opt.whoami ? "--whoami" : null,`    |

### scripts/ship-ticket.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                     |
| --: | ------- | --- | --------------------------------------------------------------- |
| 292 | ??-left | D   | `String(body ?? "")`：空 body 是合法调用，规则读不到            |
| 424 | ??-left | C   | `shapes` 的键索引在 noUncheckedIndexedAccess 下可缺，规则没建模 |
| 431 | ??-left |     | `headings: shapes.headings ?? 0,`                               |
| 432 | ??-left | D   | `unchecked: shapes.unchecked ?? 0,`                             |
| 433 | ??-left |     | `checked: shapes.checked ?? 0,`                                 |
| 434 | ??-left | D   | `ordered: shapes.ordered ?? 0,`                                 |
| 436 | ??-left |     | `(shapes.headings ?? 0) +`                                      |
| 437 | ??-left |     | `(shapes.unchecked ?? 0) +`                                     |
| 438 | ??-left |     | `(shapes.checked ?? 0) +`                                       |
| 439 | ??-left |     | `(shapes.ordered ?? 0),`                                        |

### scripts/ship.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 634 | opt-chain  |     | `if (opt.asMerged !== null && landed?.verified === true) {`                                      |
| 708 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/sidecar-name.mjs

|  行 | 类别    | 格  | 代码 / 理由                                        |
| --: | ------- | --- | -------------------------------------------------- |
|  31 | ??-left |     | `const m = /^host:\s*(\S+)$/m.exec(output ?? "");` |

### scripts/smoke-executor-host-standalone.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                |
| --: | ------- | --- | ---------------------------------------------------------- |
| 128 | ??-left |     | `const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;` |
| 128 | ??-left |     | `const stdout = `${run.stdout ?? ""}${run.stderr ?? ""}`;` |

### scripts/spawn-shell-scan.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                      |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------------ |
| 138 | ??-left    |     | `for (const part of (m[1] ?? "").split(",")) {`                                                  |
| 393 | no-overlap |     | `if (process.argv[1] !== undefined && path.resolve(process.argv[1]) === import.meta.filename) {` |

### scripts/standalone-link-repair.mjs

|  行 | 类别    | 格  | 代码 / 理由                                                 |
| --: | ------- | --- | ----------------------------------------------------------- |
| 185 | ??-left |     | `const x = m[1] ?? "";`                                     |
| 191 | ??-left |     | `const rest = (m[2] ?? "").split(/[\\/]/).filter(Boolean);` |

### scripts/standalone-private-inputs.mjs

|  行 | 类别    | 格  | 代码 / 理由                          |
| --: | ------- | --- | ------------------------------------ |
| 388 | ??-left |     | `const rel = String(relPosix ?? "")` |

### scripts/standalone-runtime.mjs

|  行 | 类别      | 格  | 代码 / 理由                                                    |
| --: | --------- | --- | -------------------------------------------------------------- |
| 104 | ??-left   |     | `const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();` |
| 104 | ??-left   |     | `const out = `${run.stdout ?? ""}${run.stderr ?? ""}`.trim();` |
| 206 | ??-left   |     | `line(`host spawn error: ${err?.message ?? err}`);`            |
| 206 | opt-chain |     | `line(`host spawn error: ${err?.message ?? err}`);`            |
| 232 | ??-left   |     | `fail(`server failed to start: ${err?.message ?? err}`);`      |
| 232 | opt-chain |     | `fail(`server failed to start: ${err?.message ?? err}`);`      |

### scripts/storybook-check.mjs

|  行 | 类别       | 格  | 代码 / 理由                          |
| --: | ---------- | --- | ------------------------------------ |
| 295 | ??-left    |     | `return String(result.stdout ?? "")` |
| 397 | no-overlap |     | `described === undefined`            |

### scripts/storybook-checks/cva-variant-source.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                                                |
| --: | ---------- | --- | ------------------------------------------------------------------------------------------ |
| 101 | no-overlap |     | `node.argumentExpression !== undefined &&`                                                 |
| 290 | no-overlap |     | `parent !== undefined && ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)` |

### scripts/storybook-checks/story-surface.mjs

|  行 | 类别       | 格  | 代码 / 理由                                                             |
| --: | ---------- | --- | ----------------------------------------------------------------------- |
| 373 | no-overlap |     | `if (parent !== undefined && ts.isImportSpecifier(parent)) {`           |
| 376 | no-overlap |     | `if (parent !== undefined && ts.isImportClause(parent)) {`              |
| 437 | no-overlap |     | `if (!ts.isPropertySignature(member) \|\| member.name === undefined) {` |
| 476 | no-overlap |     | `if (ts.isJsxAttribute(node) && node.name !== undefined) {`             |
| 485 | no-overlap |     | `node.name !== undefined`                                               |
| 567 | no-overlap |     | `while (current.parent !== undefined) {`                                |
| 643 | no-overlap |     | `m.name !== undefined &&`                                               |

### scripts/suspended-gate-tests.mjs

|  行 | 类别         | 格  | 代码 / 理由                                                                     |
| --: | ------------ | --- | ------------------------------------------------------------------------------- |
| 103 | ??-left      |     | `return new Set((ledger ?? []).map((entry) => entry.test));`                    |
| 120 | ??-left      |     | `for (const rel of files ?? []) {`                                              |
| 137 | always-falsy |     | `if (!dropped \|\| dropped.length === 0) {`                                     |
| 140 | ??-left      |     | `const byTest = new Map((ledger ?? []).map((entry) => [entry.test, entry]));`   |
| 177 | ??-left      |     | `return (exclude ?? []).filter(Boolean).flatMap((rel) => ["--exclude", rel]);`  |
| 196 | ??-left      |     | `return { files: files ?? [], excludes, reading: suspendedReading(excludes) };` |
| 213 | ??-left      |     | `return applied?.reading ?? "";`                                                |
| 213 | opt-chain    |     | `return applied?.reading ?? "";`                                                |

### scripts/tw4-canonical-report.mjs

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 186 | ??-left    |     | `content: m[2] ?? "",`       |
| 274 | no-overlap |     | `if (piece === undefined) {` |

### scripts/tw4-spacing-canonical.mjs

|  行 | 类别       | 格  | 代码 / 理由                  |
| --: | ---------- | --- | ---------------------------- |
| 158 | no-overlap |     | `if (piece === undefined) {` |
| 175 | no-overlap |     | `if (piece === undefined) {` |

### scripts/typedoc-run.mjs

|  行 | 类别      | 格  | 代码 / 理由                         |
| --: | --------- | --- | ----------------------------------- |
| 200 | opt-chain |     | `child.stdout?.on("data", (b) => {` |
| 204 | opt-chain |     | `child.stderr?.on("data", (b) => {` |

### scripts/ui-primitives-rules-p67-p86.cjs

|  行 | 类别          | 格  | 代码 / 理由      |
| --: | ------------- | --- | ---------------- |
| 237 | always-truthy | B | `while (true) {` —— `while (true)` 的终止条件写在体内的 `break`；改成 `for (…; indexOf(...) !== -1; …)`，循环怎么停一眼可见（两处 `cursor` 推进原样） |

### src/app/(main)/settings/components/ComfyuiSection.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                  |
| --: | ------- | --- | ------------------------------------------------------------ |
| 127 | ??-left |     | `checked={c.drafts.settings.comfyuiAutoStart ?? true}`       |
| 137 | ??-left |     | `checked={c.drafts.settings.autoSyncLocalWorkflow ?? false}` |

### src/app/(main)/settings/components/DatabaseSection.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                          |
| --: | ------- | --- | -------------------------------------------------------------------- |
|  51 | ??-left |     | `? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port ?? 4983}）`` |
|  56 | ??-left |     | `? `Drizzle Studio 运行中（端口 ${c.dbStudioStatus.port ?? 4983}）`` |

### src/app/(main)/settings/components/ExitSection.tsx

|  行 | 类别    | 格  | 代码 / 理由                                            |
| --: | ------- | --- | ------------------------------------------------------ |
|  31 | ??-left |     | `checked={c.drafts.settings.exitKillComfyui ?? false}` |
|  53 | ??-left |     | `checked={c.drafts.settings.exitKillOllama ?? true}`   |

### src/app/(main)/settings/components/LlmLocalSection.tsx

|  行 | 类别       | 格  | 代码 / 理由                                                         |
| --: | ---------- | --- | ------------------------------------------------------------------- |
| 224 | no-overlap |     | `const isOverridden = override !== undefined && override !== null;` |

### src/app/(main)/settings/components/UsageTestDialog.tsx

|  行 | 类别         | 格  | 代码 / 理由               |
| --: | ------------ | --- | ------------------------- |
| 498 | always-falsy |     | `{usageTest.querying ? (` |

### src/app/(main)/settings/hooks/use-settings-page-db-studio.ts

|  行 | 类别    | 格  | 代码 / 理由               |
| --: | ------- | --- | ------------------------- |
| 127 | ??-left |     | `port: raw.port ?? 4983,` |

### src/app/(main)/settings/hooks/use-settings-page-remote-models.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                           |
| --: | --------- | --- | ------------------------------------------------------------------------------------- |
| 154 | opt-chain |     | `baseUrl: patch.baseUrl === undefined ? (existing?.baseUrl ?? null) : patch.baseUrl,` |
| 163 | opt-chain |     | `kind: patch.kind === undefined ? (existing?.kind ?? null) : patch.kind,`             |

### src/app/(main)/settings/hooks/use-settings-page.ts

|  行 | 类别          | 格  | 代码 / 理由                                                  |
| --: | ------------- | --- | ------------------------------------------------------------ |
|  80 | always-truthy |     | `return parsed && typeof parsed === "object" ? parsed : {};` |

### src/app/api/custom-nodes/route.ts

|  行 | 类别          | 格  | 代码 / 理由        |
| --: | ------------- | --- | ------------------ |
| 461 | always-truthy |     | `if (!resolved) {` |
| 601 | always-falsy  |     | `if (closed) {`    |

### src/app/api/llm/ollama-start/route.ts

|  行 | 类别         | 格  | 代码 / 理由                                  |
| --: | ------------ | --- | -------------------------------------------- |
| 163 | always-falsy |     | `if (!launched.child \|\| launched.error) {` |
| 164 | ??-left      |     | `const msg = launched.error ?? "未知错误";`  |
| 209 | opt-chain    |     | `child.stdout?.on("data", (d: Buffer) => {`  |
| 218 | opt-chain    |     | `child.stderr?.on("data", (d: Buffer) => {`  |

### src/app/api/tasks/[id]/stream/route.ts

|  行 | 类别    | 格  | 代码 / 理由                               |
| --: | ------- | --- | ----------------------------------------- |
|  84 | ??-left |     | `lastSent.progress = task.progress ?? 0;` |
| 186 | ??-left |     | `lastSent.progress = cur.progress ?? 0;`  |
| 191 | ??-left |     | `progress: cur.progress ?? 0,`            |

### src/app/workspace/page.tsx

|  行 | 类别      | 格  | 代码 / 理由                                     |
| --: | --------- | --- | ----------------------------------------------- |
| 119 | ??-left   |     | `const nodeCount = project.nodes?.length ?? 0;` |
| 119 | opt-chain |     | `const nodeCount = project.nodes?.length ?? 0;` |
| 120 | ??-left   |     | `const edgeCount = project.edges?.length ?? 0;` |
| 120 | opt-chain |     | `const edgeCount = project.edges?.length ?? 0;` |

### src/components/message-center/message-center-store.ts

|  行 | 类别      | 格  | 代码 / 理由            |
| --: | --------- | --- | ---------------------- |
| 248 | opt-chain |     | `c?.runId === m.runId` |

### src/components/settings/settings-section-summary.ts

|  行 | 类别    | 格  | 代码 / 理由                                          |
| --: | ------- | --- | ---------------------------------------------------- |
|  72 | ??-left |     | `return SECTION_SUMMARY[section] ?? "本分区的配置";` |

### src/components/studio/ProjectCanvas.tsx

|  行 | 类别    | 格  | 代码 / 理由                           |
| --: | ------- | --- | ------------------------------------- |
| 285 | ??-left |     | `const baseNodes = proj.nodes ?? [];` |
| 308 | ??-left |     | `setEdges(proj.edges ?? []);`         |

### src/components/studio/ProjectGate.tsx

|  行 | 类别      | 格  | 代码 / 理由                                     |
| --: | --------- | --- | ----------------------------------------------- |
|  61 | ??-left   |     | `const nodeCount = project.nodes?.length ?? 0;` |
|  61 | opt-chain |     | `const nodeCount = project.nodes?.length ?? 0;` |

### src/components/studio/ProjectOutputs.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                                        |
| --: | ------- | --- | ---------------------------------------------------------------------------------- |
| 386 | ??-left |     | `labels={Object.fromEntries(projects.map((p) => [p.id, p.name ?? "未命名项目"]))}` |

### src/components/studio/RequiredSummary.tsx

|  行 | 类别      | 格  | 代码 / 理由                       |
| --: | --------- | --- | --------------------------------- |
|  20 | opt-chain |     | `if (e?.direction !== "input") {` |

### src/components/studio/WindowControls.tsx

|  行 | 类别          | 格  | 代码 / 理由    |
| --: | ------------- | --- | -------------- |
|  98 | always-truthy |     | `if (alive) {` |

### src/components/studio/WorkflowIOPreviewPanel.tsx

|  行 | 类别         | 格  | 代码 / 理由                                                       |
| --: | ------------ | --- | ----------------------------------------------------------------- |
|  90 | always-falsy |     | `if (!local) {`                                                   |
| 115 | opt-chain    |     | `(entry) => entry?.modeOverrides?.[effectiveMode] !== undefined,` |

### src/components/studio/WorkflowNodeJsonPopover.tsx

|  行 | 类别      | 格  | 代码 / 理由                                                                                     |
| --: | --------- | --- | ----------------------------------------------------------------------------------------------- |
|  86 | opt-chain |     | `if (r.widgets_values?.length) {`                                                               |
|  89 | opt-chain |     | `if (r.outputs?.length) {`                                                                      |
| 119 | opt-chain |     | `const nodeView = useMemo(() => getView?.(request.nodeId) ?? null, [getView, request.nodeId]);` |

### src/components/studio/WorksGallery.tsx

|  行 | 类别      | 格  | 代码 / 理由                                     |
| --: | --------- | --- | ----------------------------------------------- |
| 141 | ??-left   |     | `const nodeCount = project.nodes?.length ?? 0;` |
| 141 | opt-chain |     | `const nodeCount = project.nodes?.length ?? 0;` |
| 142 | ??-left   |     | `const edgeCount = project.edges?.length ?? 0;` |
| 142 | opt-chain |     | `const edgeCount = project.edges?.length ?? 0;` |

### src/components/studio/canvas/RgthreeBodies.tsx

|  行 | 类别       | 格  | 代码 / 理由                                        |
| --: | ---------- | --- | -------------------------------------------------- |
| 142 | ??-left    |     | `(widgets ?? []) as Array<PowerLoraWidget>`        |
| 144 | no-overlap |     | `if (widget === null \|\| widget === undefined) {` |
| 144 | no-overlap |     | `if (widget === null \|\| widget === undefined) {` |
| 232 | ??-left    |     | `{name ?? "（未选择 Lora）"}`                      |
| 297 | ??-left    |     | `const p = properties ?? {};`                      |

### src/components/studio/canvas/SubgraphCollapsedAnchors.tsx

|  行 | 类别    | 格  | 代码 / 理由                          |
| --: | ------- | --- | ------------------------------------ |
|  47 | ??-left |     | `color: portColor(inp.type ?? "*"),` |
|  56 | ??-left |     | `color: portColor(out.type ?? "*"),` |

### src/components/studio/canvas/SubgraphPinRows.tsx

|  行 | 类别      | 格  | 代码 / 理由                                                                    |
| --: | --------- | --- | ------------------------------------------------------------------------------ |
|  83 | opt-chain |     | `{io?.ioEditMode && inName && !inInp?.isConnection && !inInp?.isBoundary && (` |
|  83 | opt-chain |     | `{io?.ioEditMode && inName && !inInp?.isConnection && !inInp?.isBoundary && (` |

### src/components/studio/canvas/SubgraphWidgetRow.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                                      |
| --: | ------- | --- | -------------------------------------------------------------------------------- |
|  38 | ??-left |     | `const isImageType = ["IMAGE", "MASK", "IMAGEUPLOAD"].includes(inp.type ?? "");` |

### src/components/studio/canvas/WorkflowEdge.tsx

|  行 | 类别    | 格  | 代码 / 理由                                      |
| --: | ------- | --- | ------------------------------------------------ |
| 115 | ??-left |     | `const sPos = sourcePosition ?? Position.Right;` |
| 116 | ??-left |     | `const tPos = targetPosition ?? Position.Left;`  |
| 118 | ??-left |     | `const sOut = HANDLE_OUT[sPos] ?? [1, 0];`       |
| 119 | ??-left |     | `const tOut = HANDLE_OUT[tPos] ?? [-1, 0];`      |

### src/components/studio/canvas/WorkflowSubgraphNode.tsx

|  行 | 类别          | 格  | 代码 / 理由                                                                       |
| --: | ------------- | --- | --------------------------------------------------------------------------------- |
| 111 | ??-left       |     | `const cleanedInputs = (data.inputs ?? [])`                                       |
| 158 | ??-left       |     | `? (data.size.h ?? 0) + NODE_TITLE_H`                                             |
| 174 | always-truthy |     | `{accent && nodeMode !== 0 && <FrostLayer color={accent} nodeMode={nodeMode} />}` |

### src/components/studio/canvas/hooks/use-related-edges-highlight.ts

|  行 | 类别         | 格  | 代码 / 理由                             |
| --: | ------------ | --- | --------------------------------------- |
| 153 | ??-left      |     | `source: edge.source ?? null,`          |
| 154 | ??-left      |     | `target: edge.target ?? null,`          |
| 194 | always-falsy |     | `return changed ? next : currentEdges;` |
| 257 | always-falsy |     | `return changed ? next : currentNodes;` |

### src/components/studio/canvas/workflow-node-entries.ts

|  行 | 类别    | 格  | 代码 / 理由                                            |
| --: | ------- | --- | ------------------------------------------------------ |
|  63 | ??-left |     | `const fromGraph = Object.entries(data.inputs ?? {});` |

### src/components/studio/comfyui/comfyui-control-config.ts

|  行 | 类别      | 格  | 代码 / 理由                                |
| --: | --------- | --- | ------------------------------------------ |
| 131 | opt-chain |     | `const path = status?.path?.trim() ?? "";` |

### src/components/studio/comfyui/hooks/use-comfyui-control.ts

|  行 | 类别    | 格  | 代码 / 理由                |
| --: | ------- | --- | -------------------------- |
| 260 | ??-left |     | `port: status.port ?? 0,`  |
| 264 | ??-left |     | `path: status.path ?? "",` |

### src/components/studio/history/HistoryDetailModal.tsx

|  行 | 类别      | 格  | 代码 / 理由                              |
| --: | --------- | --- | ---------------------------------------- |
| 239 | opt-chain |     | `{current.images?.length > 0 ? (`        |
| 295 | ??-left   |     | `parentTaskId={current?.id ?? ""}`       |
| 295 | opt-chain |     | `parentTaskId={current?.id ?? ""}`       |
| 296 | opt-chain |     | `projectId={current?.projectId ?? null}` |
| 297 | ??-left   |     | `prompt={current?.prompt ?? ""}`         |
| 297 | opt-chain |     | `prompt={current?.prompt ?? ""}`         |

### src/components/studio/history/hooks/use-history-list.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                                       |
| --: | --------- | --- | ------------------------------------------------------------------------------------------------- |
| 147 | opt-chain |     | `() => (ioQ.isSuccess ? parseWorkflowIOMap(ioQ.data?.template?.workflowIO) : EMPTY_WORKFLOW_IO),` |
| 147 | opt-chain |     | `() => (ioQ.isSuccess ? parseWorkflowIOMap(ioQ.data?.template?.workflowIO) : EMPTY_WORKFLOW_IO),` |

### src/components/studio/history/hooks/use-image-redraw-client.ts

|  行 | 类别    | 格  | 代码 / 理由                     |
| --: | ------- | --- | ------------------------------- |
|  31 | ??-left |     | `taskType: w.taskType ?? null,` |

### src/components/studio/hooks/use-comfy-readiness.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                  |
| --: | --------- | --- | ---------------------------------------------------------------------------- |
|  70 | opt-chain |     | `cudaVram: hasStats ? toBar(stats?.vramUsed, stats?.vramTotal) : null,`      |
|  70 | opt-chain |     | `cudaVram: hasStats ? toBar(stats?.vramUsed, stats?.vramTotal) : null,`      |
|  71 | opt-chain |     | `smiVram: hasStats ? toBar(stats?.smiVramUsed, stats?.smiVramTotal) : null,` |
|  71 | opt-chain |     | `smiVram: hasStats ? toBar(stats?.smiVramUsed, stats?.smiVramTotal) : null,` |
|  72 | opt-chain |     | `ram: hasStats ? toBar(stats?.ramUsed, stats?.ramTotal) : null,`             |
|  72 | opt-chain |     | `ram: hasStats ? toBar(stats?.ramUsed, stats?.ramTotal) : null,`             |

### src/components/studio/hooks/use-dev-server-liveness.ts

|  行 | 类别         | 格  | 代码 / 理由                 |
| --: | ------------ | --- | --------------------------- |
| 355 | always-falsy |     | `if (stoppedRef.current) {` |

### src/components/studio/hooks/use-film-studio.ts

|  行 | 类别    | 格  | 代码 / 理由                     |
| --: | ------- | --- | ------------------------------- |
| 204 | ??-left |     | `setRecent(fData.films ?? []);` |

### src/components/studio/hooks/use-model-tags.ts

|  行 | 类别         | 格  | 代码 / 理由     |
| --: | ------------ | --- | --------------- |
| 120 | always-falsy |     | `if (!d.tag) {` |

### src/components/studio/hooks/use-schema-sync-push.ts

|  行 | 类别          | 格  | 代码 / 理由                  |
| --: | ------------- | --- | ---------------------------- |
|  42 | always-truthy |     | `if (!stoppedRef.current) {` |

### src/components/studio/logs/LogFilterBar.stories.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                   |
| --: | ------- | --- | ------------------------------------------------------------- |
|  37 | ??-left |     | `header.countsByOrigin[origin] ?? header.countsByOrigin.all;` |

### src/components/studio/logs/LogPanel.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                                   |
| --: | ------- | --- | ----------------------------------------------------------------------------- |
| 133 | ??-left |     | `const originCounts = countsByOrigin[origin ?? "all"] ?? countsByOrigin.all;` |
| 133 | ??-left |     | `const originCounts = countsByOrigin[origin ?? "all"] ?? countsByOrigin.all;` |
| 347 | ??-left |     | `ORIGIN_TEXT[origin ?? "all"],`                                               |

### src/components/studio/logs/LogPanelHeader.stories.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                                        |
| --: | ------- | --- | ---------------------------------------------------------------------------------- |
|  59 | ??-left |     | `const originCounts = header.countsByOrigin[origin] ?? header.countsByOrigin.all;` |

### src/components/studio/logs/LogProvider.tsx

|  行 | 类别      | 格  | 代码 / 理由                                                 |
| --: | --------- | --- | ----------------------------------------------------------- |
|  58 | ??-left   |     | `return JSON.stringify(reason, null, 2) ?? String(reason);` |
| 182 | ??-left   |     | `const lv = event.payload?.level ?? "info";`                |
| 182 | opt-chain |     | `const lv = event.payload?.level ?? "info";`                |
| 183 | ??-left   |     | `const message = event.payload?.message ?? "";`             |
| 183 | opt-chain |     | `const message = event.payload?.message ?? "";`             |

### src/components/studio/logs/log-analysis.ts

|  行 | 类别         | 格  | 代码 / 理由      |
| --: | ------------ | --- | ---------------- |
|  80 | no-overlap   |     | `a !== null &&`  |
| 675 | always-falsy |     | `if (!bucket) {` |

### src/components/studio/logs/log-row-style.ts

|  行 | 类别      | 格  | 代码 / 理由                                                         |
| --: | --------- | --- | ------------------------------------------------------------------- |
| 303 | opt-chain |     | `element?.closest?.(`[${LOG_ROW_TEXT_ATTRIBUTE}]`) ??`              |
| 304 | opt-chain |     | `element?.parentElement?.closest?.(`[${LOG_ROW_TEXT_ATTRIBUTE}]`),` |

### src/components/studio/project-canvas/CanvasNode/ErrorPanel.tsx

|  行 | 类别         | 格  | 代码 / 理由                                    |
| --: | ------------ | --- | ---------------------------------------------- |
| 122 | always-falsy |     | `} else if (raw && typeof raw === "object") {` |

### src/components/studio/project-canvas/CanvasNode/hooks/use-generate.ts

|  行 | 类别      | 格  | 代码 / 理由         |
| --: | --------- | --- | ------------------- |
|  86 | opt-chain |     | `if (!t?.status) {` |

### src/components/studio/project-canvas/CanvasNode/hooks/use-workflow-io.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                                |
| --: | ------------- | --- | ------------------------------------------------------------------------------------------ |
|  89 | ??-left       |     | `data.wfList = wfRes.value.workflows ?? [];`                                               |
|  91 | always-truthy |     | `if (tagRes.status === "fulfilled" && tagRes.value && Array.isArray(tagRes.value.tags)) {` |
| 160 | always-falsy  |     | `if (!alive \|\| !tpl) {`                                                                  |
| 163 | ??-left       |     | `setWfIO(tpl.workflowIO ?? null);`                                                         |
| 165 | ??-left       |     | `/* SAFETY: 类型断言已复核 */ (tpl.paramMap as Record<string, unknown>) ?? null;`          |
| 169 | ??-left       |     | `patch({ paramMap: paramMap ?? undefined });`                                              |

### src/components/studio/project-canvas/ContentAssetNode.tsx

|  行 | 类别      | 格  | 代码 / 理由                                            |
| --: | --------- | --- | ------------------------------------------------------ |
| 160 | ??-left   |     | `const types = [...(event.dataTransfer.types ?? [])];` |
| 170 | opt-chain |     | `const f = event.dataTransfer.files?.[0];`             |

### src/components/studio/project-canvas/canvas-render-chain.ts

|  行 | 类别         | 格  | 代码 / 理由     |
| --: | ------------ | --- | --------------- |
| 120 | always-falsy |     | `if (!extra) {` |

### src/components/studio/project-canvas/hooks/use-canvas-connections.ts

|  行 | 类别      | 格  | 代码 / 理由                    |
| --: | --------- | --- | ------------------------------ |
|  59 | opt-chain |     | `t?.data?.kind === "workflow"` |

### src/components/studio/project-canvas/hooks/use-content-asset-gallery.ts

|  行 | 类别          | 格  | 代码 / 理由                                      |
| --: | ------------- | --- | ------------------------------------------------ |
|  70 | always-truthy |     | `images: list && list.length > 1 ? list : null,` |

### src/components/studio/project-canvas/stepLogCache.ts

|  行 | 类别      | 格  | 代码 / 理由                                               |
| --: | --------- | --- | --------------------------------------------------------- |
| 137 | opt-chain |     | `if (known?.t === entry.t && known?.msg === entry.msg) {` |

### src/components/studio/project-home/hooks/use-series-organizer.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                          |
| --: | --------- | --- | ------------------------------------------------------------------------------------ |
| 337 | opt-chain |     | `workflows: workflowList.data?.workflows?.map((w) => ({ id: w.id, name: w.name })),` |

### src/components/studio/workflow-editor/WorkflowEditorCanvasOverlays.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                 |
| --: | ------- | --- | ----------------------------------------------------------- |
|  55 | ??-left |     | `<p className="text-destructive">{error ?? "未知错误"}</p>` |

### src/components/studio/workflow-editor/WorkflowEditorTopbar.tsx

|  行 | 类别         | 格  | 代码 / 理由      |
| --: | ------------ | --- | ---------------- |
| 368 | always-falsy |     | `if (!detail) {` |

### src/components/studio/workflow-editor/WorkflowStores.tsx

|  行 | 类别          | 格  | 代码 / 理由                                                                    |
| --: | ------------- | --- | ------------------------------------------------------------------------------ |
| 220 | opt-chain     |     | `(entry) => entry?.modeOverrides != null && code in entry.modeOverrides,`      |
| 228 | opt-chain     |     | `const modes = entry?.modeOverrides;`                                          |
| 291 | always-truthy |     | `.filter(({ entry }) => entry && groupOf(entry) === movingGroup)`              |
| 561 | opt-chain     |     | `const rawEntry: unknown = detail.graph?.[nodeId];`                            |
| 612 | opt-chain     |     | `? (rawNodesSource.find((rawNode) => String(rawNode?.id) === nodeId) ?? null)` |
| 616 | opt-chain     |     | `raw: rawMetaById?.[nodeId],`                                                  |

### src/components/studio/workflow-editor/hooks/use-subgraph-source-modal.ts

|  行 | 类别    | 格  | 代码 / 理由                      |
| --: | ------- | --- | -------------------------------- |
|  57 | ??-left |     | `name: detail.name ?? "工作流",` |

### src/components/studio/workflow-editor/hooks/use-workflow-detail-loader.ts

|  行 | 类别      | 格  | 代码 / 理由                                                             |
| --: | --------- | --- | ----------------------------------------------------------------------- |
|  36 | opt-chain |     | `if (k?.startsWith("wfdetail:") && !k?.startsWith(CACHE_KEY_PREFIX)) {` |
| 159 | ??-left   |     | `setParamMap(data.paramMap ?? {});`                                     |
| 160 | ??-left   |     | `setWorkflowIO(data.workflowIO ?? {});`                                 |
| 162 | ??-left   |     | `setRootWorkflowName((prev) => prev ?? data.name ?? "");`               |
| 162 | ??-left   |     | `setRootWorkflowName((prev) => prev ?? data.name ?? "");`               |
| 179 | ??-left   |     | `o.parentTitle ?? data.name ?? "子工作流",`                             |

### src/components/studio/workflow-editor/io-exposure.ts

|  行 | 类别      | 格  | 代码 / 理由           |
| --: | --------- | --- | --------------------- |
|  83 | opt-chain |     | `if (!node?.id) {`    |
|  87 | opt-chain |     | `if (!input?.name) {` |

### src/components/studio/workflow-editor/workflow-editor-build-nodes.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                                   |
| --: | ------------- | --- | --------------------------------------------------------------------------------------------- |
| 138 | ??-left       |     | `title: pin.label ?? pin.localized ?? pin.name ?? "",`                                        |
| 242 | literal-cmp   |     | `if (Array.isArray(pin.pos) && pin.pos.length >= 2) {`                                        |
| 254 | ??-left       |     | `const inputsRaw = (detail.boundaryPins.inputs ?? []).map(rawPosOf);`                         |
| 255 | ??-left       |     | `const outputsRaw = (detail.boundaryPins.outputs ?? []).map(rawPosOf);`                       |
| 423 | literal-cmp   |     | `} else if (bl.kind === "input") {`                                                           |
| 654 | ??-left       |     | `const kahn = computeKahnLayout(realNodes, scopeDetail.graph ?? {}, colW, rowH, padX, padY);` |
| 662 | always-truthy |     | `if (useSavedPositions && savedPositions) {`                                                  |

### src/components/studio/workflow-editor/workflow-editor-derived.ts

|  行 | 类别          | 格  | 代码 / 理由                        |
| --: | ------------- | --- | ---------------------------------- |
|  35 | opt-chain     |     | `if (rn?.id) {`                    |
|  62 | always-truthy |     | `if (position && rawIds.has(k)) {` |

### src/components/studio/workflow-form/AspectMegapixelControl.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                                              |
| --: | ------- | --- | ---------------------------------------------------------------------------------------- |
| 216 | ??-left |     | `() => activeAspect?.value ?? currentAspect ?? DEFAULT_ASPECT_RATIO_LABEL_PRESET.value,` |

### src/components/studio/workflow-form/DynamicWorkflowForm/hooks/use-dynamic-workflow-form.ts

|  行 | 类别         | 格  | 代码 / 理由                                                    |
| --: | ------------ | --- | -------------------------------------------------------------- |
|  33 | opt-chain    |     | `const rect = event.currentTarget?.getBoundingClientRect?.();` |
|  33 | opt-chain    |     | `const rect = event.currentTarget?.getBoundingClientRect?.();` |
|  34 | always-falsy |     | `if (!rect \|\| rect.height <= 0) {`                           |
| 233 | opt-chain    |     | `if (target?.closest?.(DRAG_CANCEL_SELECTOR)) {`               |

### src/components/studio/workflow-form/GroupedControls.tsx

|  行 | 类别      | 格  | 代码 / 理由           |
| --: | --------- | --- | --------------------- |
|  71 | opt-chain |     | `if (entry?.ioKey) {` |

### src/components/studio/workflow-form/SizePresetTableModal.tsx

|  行 | 类别      | 格  | 代码 / 理由                                              |
| --: | --------- | --- | -------------------------------------------------------- |
| 123 | opt-chain |     | `const dims = table[scene]?.[preset.label]?.[tier] ?? {` |

### src/components/studio/workflow-form/VideoField.tsx

|  行 | 类别        | 格  | 代码 / 理由                |
| --: | ----------- | --- | -------------------------- |
| 104 | literal-cmp |     | `if (role === "aspect") {` |

### src/components/studio/workflow-form/WorkflowWirePortRows.tsx

|  行 | 类别         | 格  | 代码 / 理由                                                      |
| --: | ------------ | --- | ---------------------------------------------------------------- |
| 106 | opt-chain    |     | `const rect = e.currentTarget?.getBoundingClientRect?.();`       |
| 106 | opt-chain    |     | `const rect = e.currentTarget?.getBoundingClientRect?.();`       |
| 107 | always-falsy |     | `if (!rect \|\| rect.height <= 0) {`                             |
| 121 | opt-chain    |     | `if (target?.closest?.(DRAG_CANCEL_SELECTOR)) {`                 |
| 146 | always-falsy |     | `if (!onReorder \|\| !draggingKey \|\| draggingKey === ioKey) {` |

### src/components/studio/workflow-io.ts

|  行 | 类别         | 格  | 代码 / 理由                                    |
| --: | ------------ | --- | ---------------------------------------------- |
| 423 | always-falsy |     | `if (!entry \|\| typeof entry !== "object") {` |
| 712 | always-falsy |     | `if (!entry \|\| typeof entry !== "object") {` |

### src/components/studio/workflow-library/CustomNodesSettings/SettingsParts.tsx

|  行 | 类别      | 格  | 代码 / 理由                                                                                 |
| --: | --------- | --- | ------------------------------------------------------------------------------------------- |
| 155 | opt-chain |     | `{summary.missingPaths?.length ? ` · ⚠️ ${summary.missingPaths.length} 个目录未找到` : ""}` |
| 288 | ??-left   |     | `{(report.packages ?? []).map((pkg) => {`                                                   |
| 317 | opt-chain |     | `{pkg.nodeTypes?.length > 0 && (`                                                           |
| 334 | opt-chain |     | `{pkg.errors?.length > 0 && (`                                                              |

### src/components/studio/workflow-library/CustomNodesSettings/hooks/use-custom-nodes-settings.ts

|  行 | 类别          | 格  | 代码 / 理由                                            |
| --: | ------------- | --- | ------------------------------------------------------ |
| 125 | always-falsy  |     | `if (!data.settings) {`                                |
| 130 | always-truthy |     | `const paths = data.settings.paths \|\| [];`           |
| 135 | always-truthy |     | `discoveredByParent: data.discoveredByParent \|\| {},` |
| 136 | always-truthy |     | `byPath: data.byPath \|\| {},`                         |
| 164 | always-truthy |     | `while (true) {`                                       |
| 453 | always-truthy |     | `setManifestByNode(manifest.nodes \|\| {});`           |
| 485 | always-truthy |     | `while (true) {`                                       |
| 508 | literal-cmp   |     | `} else if (obj.type === "done") {`                    |

### src/components/studio/workflow-library/CustomNodesSettings/parsing.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                |
| --: | ------- | --- | -------------------------------------------------------------------------- |
|  28 | ??-left |     | `if (sub.status === "empty" && (sub.packageFileCount ?? 0) === 0) {`       |
|  35 | ??-left |     | `const firstErr = /* SAFETY: 类型断言已复核 */ (saved.errors ?? [])[0] as` |

### src/components/studio/workflow-library/WorkflowCanvasNodePreview.tsx

|  行 | 类别        | 格  | 代码 / 理由                                                                             |
| --: | ----------- | --- | --------------------------------------------------------------------------------------- |
| 364 | literal-cmp |     | `phaseKind={viewMode === "edit" && phase.kind === "failed" ? "idle" : phase.kind}`      |
| 369 | literal-cmp |     | `statusLabel={viewMode === "edit" && phase.kind === "failed" ? "待开始" : statusLabel}` |

### src/components/studio/workflow-library/WorkflowLibraryList.tsx

|  行 | 类别    | 格  | 代码 / 理由                                                |
| --: | ------- | --- | ---------------------------------------------------------- |
| 262 | ??-left |     | `mode: workflow.defaultMode ?? workflow.taskType ?? null,` |

### src/components/studio/workflow-library/WorkflowOutputParamCardColumn.tsx

|  行 | 类别    | 格  | 代码 / 理由                                |
| --: | ------- | --- | ------------------------------------------ |
| 142 | ??-left |     | `const name = (output.name ?? "").trim();` |

### src/components/studio/workflow-library/hooks/use-default-value-seeding.ts

|  行 | 类别    | 格  | 代码 / 理由                                                            |
| --: | ------- | --- | ---------------------------------------------------------------------- |
|  29 | ??-left |     | `const activeSeedKey = `${workflowId ?? ""}\|${effectiveMode ?? ""}`;` |

### src/components/studio/workflow-library/hooks/use-workflow-actions.ts

|  行 | 类别         | 格  | 代码 / 理由                                                  |
| --: | ------------ | --- | ------------------------------------------------------------ |
| 212 | opt-chain    |     | `const tpl = d?.template;`                                   |
| 213 | always-falsy |     | `if (!tpl) {`                                                |
| 223 | ??-left      |     | `saveJsonFile(payload, `${tpl.name ?? name}.json`);`         |
| 224 | ??-left      |     | `toast.success("已下载工作流", `${tpl.name ?? name}.json`);` |
| 245 | opt-chain    |     | `if (d?.missing) {`                                          |
| 247 | opt-chain    |     | `} else if (d?.unchanged) {`                                 |
| 249 | opt-chain    |     | `} else if (d?.updated) {`                                   |

### src/components/studio/workflow-library/hooks/use-workflow-import.ts

|  行 | 类别    | 格  | 代码 / 理由                                            |
| --: | ------- | --- | ------------------------------------------------------ |
|  69 | ??-left |     | `const files = [...(event.dataTransfer.files ?? [])];` |

### src/components/studio/workflow-library/hooks/use-workflow-library.ts

|  行 | 类别          | 格  | 代码 / 理由                                                  |
| --: | ------------- | --- | ------------------------------------------------------------ |
| 242 | ??-left       |     | `wf: listQ.data.workflows ?? [],`                            |
| 243 | ??-left       |     | `pend: listQ.data.localPending ?? [],`                       |
| 249 | ??-left       |     | `setWorkflows(listQ.data.workflows ?? []);`                  |
| 250 | ??-left       |     | `setLocalPending(listQ.data.localPending ?? []);`            |
| 251 | ??-left       |     | `for (const workflow of listQ.data.workflows ?? []) {`       |
| 415 | always-truthy |     | `loading: listQ.isLoading && !listQ.data && !listQ.isError,` |

### src/components/studio/workflow-library/workflow-library-config.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                     |
| --: | ------- | --- | ------------------------------------------------------------------------------- |
| 197 | ??-left |     | `return getWorkflowType(normalizeTaskType(workflow.taskType ?? ""))?.category;` |

### src/components/studio/workflow-library/workflow-param-mapping-ui.ts

|  行 | 类别    | 格  | 代码 / 理由                                                 |
| --: | ------- | --- | ----------------------------------------------------------- |
|  71 | ??-left |     | `label: PARAM_CLASS_LABEL[key] ?? PARAM_CLASS_LABEL.other,` |
|  72 | ??-left |     | `color: PARAM_CLASS_COLOR[key] ?? PARAM_CLASS_COLOR.other,` |

### src/components/studio/workflow-utils.ts

|  行 | 类别          | 格  | 代码 / 理由                                                         |
| --: | ------------- | --- | ------------------------------------------------------------------- |
| 285 | no-overlap    |     | `if (value === null \|\| value === undefined) {`                    |
| 285 | no-overlap    |     | `if (value === null \|\| value === undefined) {`                    |
| 506 | always-truthy |     | `(byLevel[lv] \|\|= []).push(node.id);`                             |
| 541 | opt-chain     |     | `if (!rawNode?.id) {`                                               |
| 549 | ??-left       |     | `for (const [nodeId, raw] of Object.entries(detail.graph ?? {})) {` |
| 550 | always-falsy  |     | `if (!raw \|\| typeof raw !== "object") {`                          |
| 716 | ??-left       |     | `for (const raw of Object.values(detail.graph ?? {})) {`            |
| 784 | ??-left       |     | `for (const consumerRaw of Object.values(detail.graph ?? {})) {`    |

### src/components/ui/editable-label.tsx

|  行 | 类别      | 格  | 代码 / 理由         |
| --: | --------- | --- | ------------------- |
|  79 | opt-chain |     | `onChange?.(next);` |

### src/components/ui/field.tsx

|  行 | 类别      | 格  | 代码 / 理由                         |
| --: | --------- | --- | ----------------------------------- |
| 186 | opt-chain |     | `if (uniqueErrors?.length === 1) {` |

### src/components/ui/form-rhf.tsx

|  行 | 类别         | 格  | 代码 / 理由                                                           |
| --: | ------------ | --- | --------------------------------------------------------------------- |
|  71 | always-falsy |     | `if (!fieldContext) {`                                                |
| 138 | opt-chain    |     | `const body = error ? String(error?.message ?? "") : props.children;` |

### src/components/ui/json-viewer.tsx

|  行 | 类别          | 格  | 代码 / 理由      |
| --: | ------------- | --- | ---------------- |
| 220 | always-truthy |     | `while (true) {` |

### src/components/ui/page-header.tsx

|  行 | 类别        | 格  | 代码 / 理由                                        |
| --: | ----------- | --- | -------------------------------------------------- |
| 152 | literal-cmp |     | `(title !== undefined && helpText !== undefined);` |

### src/components/ui/segment-popover.tsx

|  行 | 类别    | 格  | 代码 / 理由                                       |
| --: | ------- | --- | ------------------------------------------------- |
| 158 | ??-left |     | `key={`${section.label}:${section.value ?? ""}`}` |

### src/components/ui/use-hotkey.ts

|  行 | 类别    | 格  | 代码 / 理由                                  |
| --: | ------- | --- | -------------------------------------------- |
| 121 | ??-left |     | `const platform = navigator.platform ?? "";` |

### src/components/workshop/CharacterDesigner.tsx

|  行 | 类别    | 格  | 代码 / 理由                         |
| --: | ------- | --- | ----------------------------------- |
| 363 | ??-left |     | `value={character.styleTags ?? []}` |

### src/components/workshop/CharacterPortraitStudio.tsx

|  行 | 类别          | 格  | 代码 / 理由                                   |
| --: | ------------- | --- | --------------------------------------------- |
| 252 | always-truthy |     | `{(session.log.length > 0 \|\| focused) && (` |

### src/components/workshop/ExtractModelSelect.tsx

|  行 | 类别          | 格  | 代码 / 理由      |
| --: | ------------- | --- | ---------------- |
|  96 | always-truthy |     | `if (channel) {` |

### src/components/workshop/ShotFilmStrip.tsx

|  行 | 类别      | 格  | 代码 / 理由                                  |
| --: | --------- | --- | -------------------------------------------- |
|  65 | opt-chain |     | `const heading = shot.sceneHeading?.trim();` |

### src/components/workshop/ShotStudio.tsx

|  行 | 类别        | 格  | 代码 / 理由                            |
| --: | ----------- | --- | -------------------------------------- |
| 638 | literal-cmp |     | `(channel === "local" && !workflowId)` |

### src/components/workshop/hooks/use-llm-config.ts

|  行 | 类别      | 格  | 代码 / 理由                              |
| --: | --------- | --- | ---------------------------------------- |
| 115 | ??-left   |     | `const model = cfg.model?.trim() ?? "";` |
| 115 | opt-chain |     | `const model = cfg.model?.trim() ?? "";` |

### src/components/workshop/hooks/use-workshop-pipeline.ts

|  行 | 类别    | 格  | 代码 / 理由                                        |
| --: | ------- | --- | -------------------------------------------------- |
|  68 | ??-left |     | `scriptMarkdown: dto.scriptMarkdown ?? "",`        |
|  69 | ??-left |     | `scenes: dto.scenes ?? [],`                        |
|  70 | ??-left |     | `characters: dto.characters ?? [],`                |
|  71 | ??-left |     | `shots: dto.shots ?? [],`                          |
| 362 | ??-left |     | `setWorkflowId(draft.workflowId ?? "");`           |
| 363 | ??-left |     | `setVideoWorkflowId(draft.videoWorkflowId ?? "");` |

### src/config/custom-nodes.ts

|  行 | 类别         | 格  | 代码 / 理由 |
| --: | ------------ | --- | ----------- |
| 234 | always-falsy |     | `if (!n) {` |

### src/lib/agent/server.ts

|  行 | 类别          | 格  | 代码 / 理由                                                         |
| --: | ------------- | --- | ------------------------------------------------------------------- |
|  23 | always-truthy |     | `.filter((m) => m && typeof m === "object")`                        |
|  26 | literal-cmp   |     | `if (role !== "assistant" && role !== "user" && role !== "tool") {` |

### src/lib/app-settings/app-settings.server.ts

|  行 | 类别    | 格  | 代码 / 理由                                    |
| --: | ------- | --- | ---------------------------------------------- |
|  34 | ??-left |     | `const root = (comfyuiPath ?? "").trim();`     |
|  69 | ??-left |     | `const root = (comfyuiPath ?? "").trim();`     |
| 179 | ??-left |     | `exitKillComfyui: s.exitKillComfyui ?? false,` |
| 180 | ??-left |     | `exitKillOllama: s.exitKillOllama ?? true,`    |

### src/lib/async-action.ts

|  行 | 类别    | 格  | 代码 / 理由                                  |
| --: | ------- | --- | -------------------------------------------- |
| 204 | ??-left |     | `return { ok: true, detail: detail ?? "" };` |

### src/lib/auth-server.ts

|  行 | 类别      | 格  | 代码 / 理由                                                      |
| --: | --------- | --- | ---------------------------------------------------------------- |
|  87 | opt-chain |     | `return resolveUserByEmail(email, session?.user?.name ?? null);` |
|  99 | opt-chain |     | `return resolveUserByEmail(email, session?.user?.name ?? null);` |

### src/lib/browser-io.ts

|  行 | 类别          | 格  | 代码 / 理由                  |
| --: | ------------- | --- | ---------------------------- |
|  32 | always-truthy |     | `if (navigator.clipboard) {` |

### src/lib/browser-storage.ts

|  行 | 类别       | 格  | 代码 / 理由                                                                          |
| --: | ---------- | --- | ------------------------------------------------------------------------------------ |
|  41 | no-overlap |     | `return typeof window.localStorage !== "undefined" && window.localStorage !== null;` |

### src/lib/comfyui/client.ts

|  行 | 类别      | 格  | 代码 / 理由                                           |
| --: | --------- | --- | ----------------------------------------------------- |
| 185 | opt-chain |     | `const comfyuiPath = settings.comfyuiPath?.trim();`   |
| 362 | ??-left   |     | `url.searchParams.set("subfolder", subfolder ?? "");` |
| 364 | ??-left   |     | `url.searchParams.set("type", type ?? "");`           |

### src/lib/comfyui/desktop-instance.ts

|  行 | 类别    | 格  | 代码 / 理由                                                |
| --: | ------- | --- | ---------------------------------------------------------- |
|  38 | ??-left |     | `const id = (content ?? "").trim();`                       |
| 285 | ??-left |     | `while ((m = re.exec(s ?? ""))) {`                         |
| 338 | ??-left |     | `port: input.comfyuiPort ?? 0,`                            |
| 339 | ??-left |     | `extraArgs: splitArgTokens(input.comfyuiExtraArgs ?? ""),` |

### src/lib/comfyui/env-python.ts

|  行 | 类别    | 格  | 代码 / 理由                                               |
| --: | ------- | --- | --------------------------------------------------------- |
|  42 | ??-left |     | `for (const rawLine of (content ?? "").split(/\r?\n/)) {` |

### src/lib/comfyui/execution-graph.ts

|  行 | 类别    | 格  | 代码 / 理由                                            |
| --: | ------- | --- | ------------------------------------------------------ |
|  82 | ??-left |     | `for (const [id, n] of Object.entries(input ?? {})) {` |

### src/lib/comfyui/executor-cli.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                                              |
| --: | --------- | --- | -------------------------------------------------------------------------------------------------------- |
| 240 | opt-chain |     | ``工作流文件就绪（${Object.keys(patched?.nodes ?? {}).length \|\| Object.keys(patched).length} 节点）`,` |
| 401 | opt-chain |     | `child.stdout?.setEncoding("utf8");`                                                                     |
| 442 | opt-chain |     | `child.stdout?.on("data", stdoutParser.sink);`                                                           |
| 450 | opt-chain |     | `child.stderr?.setEncoding("utf8");`                                                                     |
| 451 | opt-chain |     | `child.stderr?.on("data", stderrSink.sink);`                                                             |

### src/lib/comfyui/executor-dispatch.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                                     |
| --: | --------- | --- | ----------------------------------------------------------------------------------------------- |
| 221 | opt-chain |     | `overrides: /* SAFETY: 类型断言已复核 */ (row.params as { workflowInputs?: Job["overrides"] })` |
| 291 | opt-chain |     | `dispatchState.handle.unref?.();`                                                               |

### src/lib/comfyui/executor-finalize.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                  |
| --: | ------- | --- | ---------------------------------------------------------------------------- |
| 330 | ??-left |     | `const buf = await getView(im.filename, im.subfolder ?? "", im.type ?? "");` |
| 330 | ??-left |     | `const buf = await getView(im.filename, im.subfolder ?? "", im.type ?? "");` |
| 339 | ??-left |     | `const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");`    |
| 339 | ??-left |     | `const buf = await getView(v.filename, v.subfolder ?? "", v.type ?? "");`    |
| 348 | ??-left |     | `const buf = await getView(a.filename, a.subfolder ?? "", a.type ?? "");`    |
| 348 | ??-left |     | `const buf = await getView(a.filename, a.subfolder ?? "", a.type ?? "");`    |
| 357 | ??-left |     | `const buf = await getView(o.filename, o.subfolder ?? "", o.type ?? "");`    |
| 357 | ??-left |     | `const buf = await getView(o.filename, o.subfolder ?? "", o.type ?? "");`    |

### src/lib/comfyui/executor-history.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                                      |
| --: | --------- | --- | ------------------------------------------------------------------------------------------------ |
|  53 | opt-chain |     | `const entry = /* SAFETY: 类型断言已复核 */ hist?.[promptId] as ComfyHistoryEntry \| undefined;` |

### src/lib/comfyui/executor-ws.ts

|  行 | 类别         | 格  | 代码 / 理由                                                          |
| --: | ------------ | --- | -------------------------------------------------------------------- |
| 167 | always-falsy |     | `if (s.ws) {`                                                        |
| 207 | ??-left      |     | `logger.warn(`[comfyui] WS(${path}) 出错：${err?.message ?? err}`);` |
| 207 | opt-chain    |     | `logger.warn(`[comfyui] WS(${path}) 出错：${err?.message ?? err}`);` |

### src/lib/comfyui/instance-port.ts

|  行 | 类别      | 格  | 代码 / 理由                         |
| --: | --------- | --- | ----------------------------------- |
|  68 | opt-chain |     | `const root = comfyuiPath?.trim();` |

### src/lib/comfyui/lifecycle-exit.ts

|  行 | 类别         | 格  | 代码 / 理由                                                                 |
| --: | ------------ | --- | --------------------------------------------------------------------------- |
| 209 | always-falsy |     | `if (stopped) {`                                                            |
| 234 | no-overlap   |     | `uptimeMs: startedAt === null ? null : now() - startedAt,`                  |
| 258 | no-overlap   |     | `if (typeof handle === "object" && handle !== null && "unref" in handle) {` |

### src/lib/comfyui/lifecycle-launch.ts

|  行 | 类别         | 格  | 代码 / 理由                                                            |
| --: | ------------ | --- | ---------------------------------------------------------------------- |
| 235 | ??-left      |     | `comfyuiPort: settings.comfyuiPort ?? 0,`                              |
| 236 | ??-left      |     | `comfyuiExtraArgs: settings.comfyuiExtraArgs ?? "",`                   |
| 403 | always-falsy |     | `if (!launched.child \|\| launched.error) {`                           |
| 404 | ??-left      |     | `const detail = `启动 ComfyUI 失败：${launched.error ?? "未知错误"}`;` |
| 591 | always-falsy |     | `return portConflict ? { ...result, portConflict: true } : result;`    |

### src/lib/comfyui/lifecycle.ts

|  行 | 类别    | 格  | 代码 / 理由                                |
| --: | ------- | --- | ------------------------------------------ |
| 695 | ??-left |     | `comfyuiPath: settings.comfyuiPath ?? "",` |

### src/lib/comfyui/protocol-adapter.ts

|  行 | 类别      | 格  | 代码 / 理由                                                               |
| --: | --------- | --- | ------------------------------------------------------------------------- |
|  68 | opt-chain |     | `return msg?.type === "executing" \|\| msg?.type === "progress";`         |
|  68 | opt-chain |     | `return msg?.type === "executing" \|\| msg?.type === "progress";`         |
|  73 | opt-chain |     | `return msg?.type === "executing" && Boolean(msg.data?.node);`            |
|  78 | opt-chain |     | `return msg?.type === "executing" && msg.data?.node === null;`            |
|  83 | opt-chain |     | `return msg?.type === "progress";`                                        |
|  89 | opt-chain |     | `return msg?.type === "execution_success" \|\| this.isNodeFinished(msg);` |
|  95 | opt-chain |     | `return msg?.type === "execution_error";`                                 |

### src/lib/comfyui/raw-overrides.ts

|  行 | 类别       | 格  | 代码 / 理由                                                               |
| --: | ---------- | --- | ------------------------------------------------------------------------- |
| 153 | opt-chain  |     | `const inputs = node?.inputs ?? [];`                                      |
| 156 | opt-chain  |     | `if (inp?.widget) {`                                                      |
| 168 | opt-chain  |     | `const inputs = node?.inputs ?? [];`                                      |
| 171 | opt-chain  |     | `if (!inp?.widget) {`                                                     |
| 180 | no-overlap |     | `w != null && typeof w === "object"`                                      |
| 192 | opt-chain  |     | `const inputs = node?.inputs ?? [];`                                      |
| 194 | opt-chain  |     | `if (!inp?.widget) {`                                                     |
| 203 | no-overlap |     | `w != null && typeof w === "object"`                                      |
| 216 | opt-chain  |     | `const inputs = node?.inputs ?? [];`                                      |
| 219 | opt-chain  |     | `if (inp?.widget) {`                                                      |
| 233 | opt-chain  |     | `if (!Array.isArray(node?.widgets_values)) {`                             |
| 403 | opt-chain  |     | `if (!inp?.widget) {`                                                     |
| 478 | no-overlap |     | `if (raw == null \|\| typeof raw !== "object" \|\| Array.isArray(raw)) {` |
| 582 | opt-chain  |     | `const inputs = node?.inputs ?? [];`                                      |
| 600 | no-overlap |     | `inp.widget != null && typeof inp.widget === "object"`                    |
| 654 | opt-chain  |     | `if (!ov?.nodeId \|\| ov.value === undefined) {`                          |
| 701 | opt-chain  |     | `if (!ov?.nodeId \|\| ov.value === undefined) {`                          |

### src/lib/comfyui/raw-view-graph.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                                   |
| --: | ------------- | --- | --------------------------------------------------------------------------------------------- |
| 131 | always-falsy  |     | `if (!inp \|\| typeof inp.name !== "string") {`                                               |
| 172 | always-truthy |     | `? n.outputs.map((output) => (output && typeof output.type === "string" ? output.type : ""))` |

### src/lib/comfyui/raw.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                         |
| --: | ------------- | --- | ----------------------------------------------------------------------------------- |
| 230 | always-truthy |     | `if (n && Array.isArray(n.pos) && n.pos.length >= 2) {`                             |
| 250 | always-falsy  |     | `if (!wrapper \|\| typeof wrapper.type !== "string") {`                             |
| 269 | always-truthy |     | `if (inner && Array.isArray(inner.pos) && inner.pos.length >= 2) {`                 |
| 421 | opt-chain     |     | `return SEED_WIDGET_NAMES.has(name) \|\| options?.control_after_generate === true;` |
| 446 | opt-chain     |     | `const wname = inp?.widget?.name;`                                                  |
| 548 | opt-chain     |     | `if (options?.forceInput === true) {`                                               |

### src/lib/comfyui/reaper.ts

|  行 | 类别      | 格  | 代码 / 理由                                                   |
| --: | --------- | --- | ------------------------------------------------------------- |
| 519 | opt-chain |     | `inQueue = all.some((all) => all?.prompt_id === t.promptId);` |
| 624 | opt-chain |     | `reaperState.handle.unref?.();`                               |

### src/lib/comfyui/status.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                                     |
| --: | --------- | --- | ----------------------------------------------------------------------------------------------- |
| 207 | opt-chain |     | `const setup = /* SAFETY: 类型断言已复核 */ (parsed as { setup?: { cmds?: unknown } })?.setup;` |
| 291 | ??-left   |     | `const comfyuiPath = settings.comfyuiPath?.trim() ?? "";`                                       |
| 291 | opt-chain |     | `const comfyuiPath = settings.comfyuiPath?.trim() ?? "";`                                       |

### src/lib/comfyui/validation.ts

|  行 | 类别      | 格  | 代码 / 理由                                                               |
| --: | --------- | --- | ------------------------------------------------------------------------- |
| 144 | opt-chain |     | `: /* SAFETY: 类型断言已复核 */ ((v as { message?: string })?.message ??` |
| 145 | opt-chain |     | `/* SAFETY: 类型断言已复核 */ (v as { details?: string })?.details ??`    |

### src/lib/comfyui/workflow-detail-io.ts

|  行 | 类别         | 格  | 代码 / 理由                                                 |
| --: | ------------ | --- | ----------------------------------------------------------- |
| 185 | always-falsy |     | `if (!v \|\| typeof v !== "object") {`                      |
| 236 | always-falsy |     | `if (!v \|\| typeof v !== "object") {`                      |
| 274 | always-falsy |     | `if (!dict) {`                                              |
| 285 | always-falsy |     | `if (!dict) {`                                              |
| 462 | no-overlap   |     | `if (override == null \|\| typeof override !== "object") {` |
| 464 | never        |     | `next[mode] = override ?? {};`                              |

### src/lib/comfyui/workflow-detail-raw-inputs.ts

|  行 | 类别          | 格  | 代码 / 理由                                                           |
| --: | ------------- | --- | --------------------------------------------------------------------- |
| 174 | no-overlap    |     | `if (inN?.id != null) {`                                              |
| 174 | opt-chain     |     | `if (inN?.id != null) {`                                              |
| 211 | always-truthy |     | `(i) => !!i && (i.name === "seed" \|\| i.name === "noise_seed"),`     |
| 225 | opt-chain     |     | `const inputIdx = inputs.findIndex((i) => i?.name === fieldName);`    |
| 246 | opt-chain     |     | `const rn = raw.nodes.find((n) => String(n?.id) === nodeId);`         |
| 258 | opt-chain     |     | `const rn = raw.nodes.find((n) => String(n?.id) === nodeId);`         |
| 288 | opt-chain     |     | `typeof resolved.def?.name === "string" && resolved.def.name.trim()`  |
| 332 | opt-chain     |     | `const inp = internalNode.inputs.find((i) => i?.name === fieldName);` |
| 426 | always-falsy  |     | `if (!subDef \|\| !Array.isArray(subDef.inputs)) {`                   |
| 496 | always-falsy  |     | `if (!rn) {`                                                          |
| 521 | always-falsy  |     | `if (!inp \|\| typeof inp.name !== "string") {`                       |
| 565 | always-falsy  |     | `if (!inp \|\| typeof inp.name !== "string") {`                       |

### src/lib/comfyui/workflow-detail-raw.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                                    |
| --: | ------------- | --- | ---------------------------------------------------------------------------------------------- |
|  45 | always-falsy  |     | `if (!rn \|\| rn.type === "Note" \|\| rn.type === "MarkdownNote") {`                           |
|  51 | always-falsy  |     | `if (!o \|\| typeof o.name !== "string") {`                                                    |
|  71 | always-truthy |     | `const flags = rn && typeof rn.flags === "object" && rn.flags !== null ? rn.flags : {};`       |
|  71 | no-overlap    |     | `const flags = rn && typeof rn.flags === "object" && rn.flags !== null ? rn.flags : {};`       |
|  81 | always-truthy |     | `rn && typeof rn.properties === "object" && rn.properties !== null ? rn.properties : {},`      |
|  81 | no-overlap    |     | `rn && typeof rn.properties === "object" && rn.properties !== null ? rn.properties : {},`      |
|  96 | no-overlap    |     | `if (n?.id != null) {`                                                                         |
|  96 | opt-chain     |     | `if (n?.id != null) {`                                                                         |
| 129 | no-overlap    |     | `if (node?.id == null) {`                                                                      |
| 129 | opt-chain     |     | `if (node?.id == null) {`                                                                      |
| 141 | always-falsy  |     | `if (!inp \|\| typeof inp.name !== "string") {`                                                |
| 197 | opt-chain     |     | `const classType: string = n?.class_type ? n.class_type : n?.type ? (n.type as string) : "?";` |
| 197 | opt-chain     |     | `const classType: string = n?.class_type ? n.class_type : n?.type ? (n.type as string) : "?";` |
| 200 | opt-chain     |     | `if (isUuidClass && raw?.definitions?.subgraphs) {`                                            |
| 216 | ??-left       |     | `title: resolvedTitle ?? n?._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,`         |
| 216 | opt-chain     |     | `title: resolvedTitle ?? n?._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,`         |

### src/lib/comfyui/workflow-detail.ts

|  行 | 类别         | 格  | 代码 / 理由                                                                               |
| --: | ------------ | --- | ----------------------------------------------------------------------------------------- |
| 210 | ??-left      |     | `/* SAFETY: 类型断言已复核 */ (tpl.positions as Record<string, [number, number]>) ?? {};` |
| 272 | ??-left      |     | `title: resolvedTitle ?? n._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,`     |
| 299 | ??-left      |     | `nodeTitleById[n.id] = n.title ?? n.class_type;`                                          |
| 376 | always-falsy |     | `if (!n \|\| (n.type !== "Note" && n.type !== "MarkdownNote")) {`                         |
| 558 | ??-left      |     | `tpl.sourceMtime = reimported.update.sourceMtime ?? tpl.sourceMtime;`                     |
| 559 | ??-left      |     | `tpl.sourceChecksum = reimported.update.sourceChecksum ?? tpl.sourceChecksum;`            |
| 560 | ??-left      |     | `tpl.taskType = reimported.update.taskType ?? tpl.taskType;`                              |
| 685 | ??-left      |     | `for (const inp of n.raw_inputs ?? []) {`                                                 |
| 712 | ??-left      |     | `/* SAFETY: 类型断言已复核 */ (tpl.positions as Record<string, [number, number]>) ?? {},` |

### src/lib/comfyui/workflow-preview.ts

|  行 | 类别          | 格  | 代码 / 理由                        |
| --: | ------------- | --- | ---------------------------------- |
| 252 | always-truthy |     | `(byLevel[lv] \|\|= []).push(id);` |
| 325 | always-truthy |     | `(byLevel[lv] \|\|= []).push(id);` |

### src/lib/comfyui/workflow-subgraph-parse-graph.ts

|  行 | 类别         | 格  | 代码 / 理由                                                                                      |
| --: | ------------ | --- | ------------------------------------------------------------------------------------------------ |
| 189 | opt-chain    |     | `.map((entry, index) => ({ index, slot: entry?.idx ?? index }))`                                 |
| 235 | opt-chain    |     | `if (!rn?.id) {`                                                                                 |
| 258 | opt-chain    |     | `const sorted = [...rn.outputs].sort((a, b) => (a?.idx ?? 0) - (b?.idx ?? 0));`                  |
| 258 | opt-chain    |     | `const sorted = [...rn.outputs].sort((a, b) => (a?.idx ?? 0) - (b?.idx ?? 0));`                  |
| 259 | opt-chain    |     | `outputNameByNodeSlot[nodeId] = sorted.map((x) => (typeof x?.name === "string" ? x.name : ""));` |
| 392 | opt-chain    |     | `if (!rn?.id) {`                                                                                 |
| 420 | always-falsy |     | `if (!inp \|\| typeof inp.name !== "string") {`                                                  |
| 527 | always-falsy |     | `if (!o \|\| typeof o.name !== "string") {`                                                      |
| 607 | no-overlap   |     | `flags: typeof rn.flags === "object" && rn.flags !== null ? rn.flags : {},`                      |
| 631 | ??-left      |     | `title: n._meta?.title ?? (isUuidClass ? "" : classType) ?? nodeId,`                             |

### src/lib/comfyui/workflow-subgraph-parse.ts

|  行 | 类别         | 格  | 代码 / 理由                                                             |
| --: | ------------ | --- | ----------------------------------------------------------------------- |
| 314 | always-falsy |     | `if (!n \|\| (n.type !== "Note" && n.type !== "MarkdownNote")) {`       |
| 336 | no-overlap   |     | `innerNodes.filter((rn) => rn?.id != null).map((rn) => String(rn.id)),` |
| 336 | opt-chain    |     | `innerNodes.filter((rn) => rn?.id != null).map((rn) => String(rn.id)),` |
| 340 | literal-cmp  |     | `if (!Array.isArray(pos) \|\| pos.length < 2) {`                        |
| 351 | opt-chain    |     | `if (!rn?.id) {`                                                        |

### src/lib/console/console-catalog.ts

|  行 | 类别    | 格  | 代码 / 理由                        |
| --: | ------- | --- | ---------------------------------- |
| 376 | ??-left |     | `const raw = (line ?? "").trim();` |
| 454 | ??-left |     | `const raw = (line ?? "").trim();` |

### src/lib/console/console-run.ts

|  行 | 类别         | 格  | 代码 / 理由                                                                    |
| --: | ------------ | --- | ------------------------------------------------------------------------------ |
| 307 | ??-left      |     | `const killed = current?.killed ?? false;`                                     |
| 307 | opt-chain    |     | `const killed = current?.killed ?? false;`                                     |
| 316 | always-falsy |     | `truncatedNote: truncated ? `输出超过 ${MAX_OUTPUT_CHARS} 字符已截断` : null,` |

### src/lib/core/repository-base.ts

|  行 | 类别    | 格  | 代码 / 理由                                                   |
| --: | ------- | --- | ------------------------------------------------------------- |
| 102 | ??-left |     | `return /* SAFETY: 类型断言已复核 */ (rows[0] as T) ?? null;` |

### src/lib/core/repository-user.ts

|  行 | 类别       | 格  | 代码 / 理由                                                            |
| --: | ---------- | --- | ---------------------------------------------------------------------- |
|  59 | no-overlap |     | `if (typeof item === "object" && item !== null && "apiKey" in item) {` |
|  83 | no-overlap |     | `if (typeof item === "object" && item !== null && "apiKey" in item) {` |

### src/lib/dom-rect.ts

|  行 | 类别    | 格  | 代码 / 理由                            |
| --: | ------- | --- | -------------------------------------- |
| 120 | ??-left |     | `clientWidth: box.clientWidth ?? 0,`   |
| 121 | ??-left |     | `clientHeight: box.clientHeight ?? 0,` |
| 122 | ??-left |     | `scrollWidth: box.scrollWidth ?? 0,`   |
| 123 | ??-left |     | `scrollHeight: box.scrollHeight ?? 0,` |

### src/lib/history-detail-actions.ts

|  行 | 类别      | 格  | 代码 / 理由                                           |
| --: | --------- | --- | ----------------------------------------------------- |
|  59 | opt-chain |     | `return { workflow: result?.workflow ?? undefined };` |

### src/lib/llm/browser.ts

|  行 | 类别          | 格  | 代码 / 理由      |
| --: | ------------- | --- | ---------------- |
|  91 | always-truthy |     | `while (true) {` |

### src/lib/llm/parse.ts

|  行 | 类别    | 格  | 代码 / 理由                          |
| --: | ------- | --- | ------------------------------------ |
|   7 | ??-left |     | `let trimmed = (text ?? "").trim();` |

### src/lib/llm/prompts.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                                      |
| --: | ------- | --- | ------------------------------------------------------------------------------------------------ |
|  23 | ??-left |     | `return JSON.stringify(v) ?? fallback;`                                                          |
| 100 | ??-left |     | `const obj = /* SAFETY: 类型断言已复核 */ (extractJson(text) as Record<string, unknown>) ?? {};` |
| 129 | ??-left |     | `const obj = /* SAFETY: 类型断言已复核 */ (extractJson(text) as Record<string, unknown>) ?? {};` |

### src/lib/llm/server.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                                          |
| --: | ------------- | --- | ---------------------------------------------------------------------------------------------------- |
|  28 | always-truthy |     | `provider: /* SAFETY: 类型断言已复核 */ (process.env.LLM_PROVIDER as LLMProviderType) \|\| "local",` |
|  74 | ??-left       |     | `kind: /* SAFETY: 类型断言已复核 */ (r.kind as RemoteModelKind) ?? null,`                            |
|  93 | no-overlap    |     | `if (row.temperature != null) {`                                                                     |
| 105 | no-overlap    |     | `if (row.maxTokens != null) {`                                                                       |
| 170 | ??-left       |     | `kind: /* SAFETY: 类型断言已复核 */ (r.kind as RemoteModelKind) ?? null,`                            |
| 185 | no-overlap    |     | `typeof e === "object" && e !== null ? maskRemoteEntryForClient(e) : e,`                             |
| 235 | ??-left       |     | `: (JSON.stringify(cause) ?? "");`                                                                   |
| 358 | opt-chain     |     | `if (!cfg.model?.trim()) {`                                                                          |
| 407 | always-truthy |     | `while (true) {`                                                                                     |
| 524 | opt-chain     |     | `const fn = call?.function;`                                                                         |
| 525 | opt-chain     |     | `if (!call?.id \|\| !fn?.name \|\| typeof fn.arguments !== "string") {`                              |

### src/lib/llm/types.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                            |
| --: | ------- | --- | -------------------------------------------------------------------------------------- |
| 212 | ??-left |     | `return /^(https?:\/\/)?(localhost\|127\.\|\[::1\])/i.test(String(url ?? "").trim());` |

### src/lib/media/media-url.ts

|  行 | 类别      | 格  | 代码 / 理由                                    |
| --: | --------- | --- | ---------------------------------------------- |
|  51 | ??-left   |     | `const filename = ref.filename?.trim() ?? "";` |
|  51 | opt-chain |     | `const filename = ref.filename?.trim() ?? "";` |

### src/lib/media/size-preset-store.ts

|  行 | 类别      | 格  | 代码 / 理由                                  |
| --: | --------- | --- | -------------------------------------------- |
| 130 | opt-chain |     | `const row = snapshot[scene]?.[ratioLabel];` |

### src/lib/media/size-presets.ts

|  行 | 类别      | 格  | 代码 / 理由                                                             |
| --: | --------- | --- | ----------------------------------------------------------------------- |
| 224 | opt-chain |     | `const row = table[scene]?.[nearestRatioPreset(ratio).label];`          |
| 813 | opt-chain |     | `const row = table[scene]?.[nearestRatioPreset(width / height).label];` |

### src/lib/media/task-images-client.ts

|  行 | 类别    | 格  | 代码 / 理由                                     |
| --: | ------- | --- | ----------------------------------------------- |
|  65 | ??-left |     | `return parseTaskImageRows(task.images ?? []);` |

### src/lib/process/process-launch.ts

|  行 | 类别         | 格  | 代码 / 理由                         |
| --: | ------------ | --- | ----------------------------------- |
| 114 | always-falsy |     | `if (!buf \|\| buf.length === 0) {` |

### src/lib/production/review-calibration.ts

|  行 | 类别       | 格  | 代码 / 理由                          |
| --: | ---------- | --- | ------------------------------------ |
| 111 | no-overlap |     | `if (hasHuman && rating !== null) {` |
| 128 | no-overlap |     | `if (hasHuman && rating !== null) {` |

### src/lib/production/review-rubrics.ts

|  行 | 类别    | 格  | 代码 / 理由              |
| --: | ------- | --- | ------------------------ |
| 253 | ??-left |     | `return rubric ?? null;` |

### src/lib/production/review-types.ts

|  行 | 类别         | 格  | 代码 / 理由                     |
| --: | ------------ | --- | ------------------------------- |
| 182 | always-falsy |     | `return hit ? next : entities;` |
| 221 | always-falsy |     | `return hit ? next : entities;` |
| 401 | always-falsy |     | `return hit ? next : entities;` |
| 440 | always-falsy |     | `return hit ? next : entities;` |

### src/lib/production/sync.ts

|  行 | 类别         | 格  | 代码 / 理由                                               |
| --: | ------------ | --- | --------------------------------------------------------- |
| 188 | always-falsy |     | `return hit ? next : shots;`                              |
| 211 | always-falsy |     | `return hit ? next : shots;`                              |
| 230 | always-falsy |     | `return hit ? applyShotRedo(withPrompt, shotId) : shots;` |

### src/lib/project-canvas/canvas-api.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                    |
| --: | ------------- | --- | ------------------------------------------------------------------------------ |
| 189 | always-truthy |     | `while (true) {`                                                               |
| 202 | opt-chain     |     | `if (onProgress && typeof task?.progress === "number") {`                      |
| 205 | ??-left       |     | `const imgs: Array<TaskResult> = task?.images ?? [];`                          |
| 205 | opt-chain     |     | `const imgs: Array<TaskResult> = task?.images ?? [];`                          |
| 215 | opt-chain     |     | `const st = /* SAFETY: 类型断言已复核 */ task?.status as string \| undefined;` |
| 222 | opt-chain     |     | `const rawErr = task?.error;`                                                  |
| 226 | always-falsy  |     | `: rawErr && typeof rawErr === "object"`                                       |
| 245 | opt-chain     |     | `params: task?.params ?? undefined,`                                           |
| 251 | opt-chain     |     | `validationErrors: parseValidationErrorsJson(task?.validationErrors),`         |

### src/lib/project-canvas/canvas-helpers.ts

|  行 | 类别       | 格  | 代码 / 理由                        |
| --: | ---------- | --- | ---------------------------------- |
| 196 | opt-chain  |     | `} else if (src.prompt?.trim()) {` |
| 202 | opt-chain  |     | `if (src.negative?.trim()) {`      |
| 209 | no-overlap |     | `if (src.steps != null) {`         |
| 216 | no-overlap |     | `if (src.cfg != null) {`           |
| 222 | opt-chain  |     | `if (src.seed?.trim()) {`          |

### src/lib/project-canvas/canvas-store.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                        |
| --: | ------------- | --- | ---------------------------------------------------------------------------------- |
| 109 | ??-left       |     | `nodes: p.nodes ?? [],`                                                            |
| 110 | ??-left       |     | `edges: p.edges ?? [],`                                                            |
| 205 | ??-left       |     | `nodes: /* SAFETY: 类型断言已复核 */ (row.nodes as CanvasProject["nodes"]) ?? [],` |
| 206 | ??-left       |     | `edges: /* SAFETY: 类型断言已复核 */ (row.edges as CanvasProject["edges"]) ?? [],` |
| 369 | always-truthy |     | `while (true) {`                                                                   |
| 453 | ??-left       |     | `return (project.nodes?.length ?? 0) === 0 && (project.edges?.length ?? 0) === 0;` |
| 453 | opt-chain     |     | `return (project.nodes?.length ?? 0) === 0 && (project.edges?.length ?? 0) === 0;` |
| 453 | ??-left       |     | `return (project.nodes?.length ?? 0) === 0 && (project.edges?.length ?? 0) === 0;` |
| 453 | opt-chain     |     | `return (project.nodes?.length ?? 0) === 0 && (project.edges?.length ?? 0) === 0;` |
| 574 | ??-left       |     | `nodes: project.nodes ?? [],`                                                      |
| 575 | ??-left       |     | `edges: project.edges ?? [],`                                                      |

### src/lib/project-canvas/history-panel-types.ts

|  行 | 类别      | 格  | 代码 / 理由                      |
| --: | --------- | --- | -------------------------------- |
|  80 | opt-chain |     | `const p = task.prompt?.trim();` |

### src/lib/shell/shell-tabs-store.ts

|  行 | 类别    | 格  | 代码 / 理由                    |
| --: | ------- | --- | ------------------------------ |
| 105 | ??-left |     | `label: tab.label ?? t.label,` |

### src/lib/task-cancel-client.ts

|  行 | 类别      | 格  | 代码 / 理由                                             |
| --: | --------- | --- | ------------------------------------------------------- |
|  38 | ??-left   |     | `status: t?.status ?? null,`                            |
|  38 | opt-chain |     | `status: t?.status ?? null,`                            |
|  39 | opt-chain |     | `error: typeof t?.error === "string" ? t.error : null,` |

### src/lib/workflow/workflow-exposed-params.ts

|  行 | 类别    | 格  | 代码 / 理由                              |
| --: | ------- | --- | ---------------------------------------- |
| 285 | ??-left |     | `return EXPOSED_PARAM_LABEL[cls] ?? id;` |

### src/lib/workflow/workflow-io-types.ts

|  行 | 类别         | 格  | 代码 / 理由                                    |
| --: | ------------ | --- | ---------------------------------------------- |
| 109 | always-falsy |     | `if (!entry \|\| typeof entry !== "object") {` |
| 211 | always-falsy |     | `if (!entry \|\| typeof entry !== "object") {` |

### src/lib/workflow/workflow-param-mapping.ts

|  行 | 类别        | 格  | 代码 / 理由                                                   |
| --: | ----------- | --- | ------------------------------------------------------------- |
| 407 | ??-left     |     | `for (const [id, target] of Object.entries(byEntry ?? {})) {` |
| 408 | literal-cmp |     | `if (typeof target !== "string" && target !== null) {`        |
| 504 | opt-chain   |     | `if (entry?.nodeId === nodeId && entry.name === handleId) {`  |

### src/lib/workflow/workflow-run-store.ts

|  行 | 类别      | 格  | 代码 / 理由                                               |
| --: | --------- | --- | --------------------------------------------------------- |
| 321 | opt-chain |     | `if (known?.t === entry.t && known?.msg === entry.msg) {` |

### src/lib/workshop/api-channel-shared.ts

|  行 | 类别    | 格  | 代码 / 理由                          |
| --: | ------- | --- | ------------------------------------ |
| 194 | ??-left |     | `const base = String(baseUrl ?? "")` |

### src/lib/workshop/api-channel.server.ts

|  行 | 类别    | 格  | 代码 / 理由                        |
| --: | ------- | --- | ---------------------------------- |
|  92 | ??-left |     | `prompt: req.prompt ?? undefined,` |

### src/lib/workshop/generation-client.ts

|  行 | 类别        | 格  | 代码 / 理由                                                        |
| --: | ----------- | --- | ------------------------------------------------------------------ |
|  65 | opt-chain   |     | `if (!res?.taskId) {`                                              |
| 300 | ??-left     |     | `const io = detail?.workflowIO ?? null;`                           |
| 300 | opt-chain   |     | `const io = detail?.workflowIO ?? null;`                           |
| 301 | opt-chain   |     | `const modes = Array.isArray(detail?.availableModes)`              |
| 307 | ??-left     |     | `: (detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null);` |
| 307 | ??-left     |     | `: (detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null);` |
| 307 | opt-chain   |     | `: (detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null);` |
| 307 | opt-chain   |     | `: (detail?.defaultMode ?? detail?.taskType ?? modes[0] ?? null);` |
| 310 | ??-left     |     | `paramMap: detail?.paramMap ?? null,`                              |
| 310 | opt-chain   |     | `paramMap: detail?.paramMap ?? null,`                              |
| 472 | literal-cmp |     | `if (type === "state") {`                                          |

### src/lib/workshop/script-parser.ts

|  行 | 类别          | 格  | 代码 / 理由                                  |
| --: | ------------- | --- | -------------------------------------------- |
|  71 | always-truthy |     | `const type = meta.type \|\| "short_video";` |

### src/lib/workshop/workflow-encapsulation.ts

|  行 | 类别    | 格  | 代码 / 理由                                                      |
| --: | ------- | --- | ---------------------------------------------------------------- |
| 110 | ??-left |     | `const text = `${e.name ?? ""} ${e.label ?? ""}`.toLowerCase();` |

### src/lib/workshop/workflow-run.server.ts

|  行 | 类别    | 格  | 代码 / 理由                                                         |
| --: | ------- | --- | ------------------------------------------------------------------- |
|  46 | ??-left |     | `const mode = tpl.defaultMode ?? tpl.taskType ?? modes[0] ?? null;` |
|  46 | ??-left |     | `const mode = tpl.defaultMode ?? tpl.taskType ?? modes[0] ?? null;` |

### src/server/api/routers/series-generation.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                                |
| --: | --------- | --- | ------------------------------------------------------------------------------------------ |
|  83 | opt-chain |     | `const shots = Array.isArray(prod?.shots) ? (prod?.shots as Array<{ id?: string }>) : [];` |
| 176 | opt-chain |     | `const shots = Array.isArray(prod?.shots) ? (prod?.shots as Array<{ id?: string }>) : [];` |

### src/server/api/routers/series.ts

|  行 | 类别      | 格  | 代码 / 理由                                            |
| --: | --------- | --- | ------------------------------------------------------ |
| 708 | opt-chain |     | `const name = pc?.name ?? "";`                         |
| 785 | opt-chain |     | `const n = typeof c?.name === "string" ? c.name : "";` |

### src/server/api/routers/skill.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                     |
| --: | ------- | --- | ------------------------------------------------------------------------------- |
|  30 | ??-left |     | `tags = JSON.parse(/* SAFETY: 类型断言已复核 */ (obj.tags as string) ?? "[]");` |

### src/server/api/routers/workflow-mutations.ts

|  行 | 类别          | 格  | 代码 / 理由                                                                |
| --: | ------------- | --- | -------------------------------------------------------------------------- |
| 322 | always-truthy |     | `nd && "id" in nd`                                                         |
| 327 | opt-chain     |     | `if (pid && posMap?.[pid]) {`                                              |
| 432 | ??-left       |     | `sourceMtime: result.update.sourceMtime ?? existing.sourceMtime,`          |
| 433 | ??-left       |     | `sourceChecksum: result.update.sourceChecksum ?? existing.sourceChecksum,` |
| 434 | ??-left       |     | `taskType: result.update.taskType ?? existing.taskType,`                   |

### src/server/api/trpc.ts

|  行 | 类别      | 格  | 代码 / 理由                                                                |
| --: | --------- | --- | -------------------------------------------------------------------------- |
|  45 | opt-chain |     | `if (session?.user?.email) {`                                              |
|  49 | ??-left   |     | `name: session.user.name ?? null,`                                         |
| 216 | ??-left   |     | `const key = ctx.user.id ?? ctx.headers.get("x-forwarded-for") ?? "anon";` |
| 216 | ??-left   |     | `const key = ctx.user.id ?? ctx.headers.get("x-forwarded-for") ?? "anon";` |

### src/server/db.ts

|  行 | 类别    | 格  | 代码 / 理由                                                          |
| --: | ------- | --- | -------------------------------------------------------------------- |
|  65 | ??-left |     | `url: `file:${resolveDbPath(env.DATABASE_URL ?? DEFAULT_DB_FILE)}`,` |

### src/server/film/orchestrator.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                  |
| --: | ------- | --- | ---------------------------------------------------------------------------- |
| 147 | ??-left |     | `type: /* SAFETY: 类型断言已复核 */ (type as ProjectType) ?? "short_video",` |
| 580 | ??-left |     | `const nextProgress = task.progress ?? 0;`                                   |
| 581 | ??-left |     | `if (shot.status !== next \|\| (shot.progress ?? 0) !== nextProgress) {`     |

### src/server/workshop/comfyui.ts

|  行 | 类别    | 格  | 代码 / 理由                                           |
| --: | ------- | --- | ----------------------------------------------------- |
| 221 | ??-left |     | `url.searchParams.set("subfolder", subfolder ?? "");` |
| 222 | ??-left |     | `url.searchParams.set("type", type ?? "");`           |

### src/server/workshop/draft-repository.ts

|  行 | 类别    | 格  | 代码 / 理由                                   |
| --: | ------- | --- | --------------------------------------------- |
|  18 | ??-left |     | `title: draft.meta.title ?? "",`              |
|  19 | ??-left |     | `type: draft.meta.type ?? "short_video",`     |
|  20 | ??-left |     | `tone: draft.meta.tone ?? "",`                |
|  21 | ??-left |     | `logline: draft.meta.logline ?? "",`          |
|  22 | ??-left |     | `scriptMarkdown: draft.scriptMarkdown ?? "",` |
| 113 | ??-left |     | `title: draft.meta.title ?? "",`              |
| 114 | ??-left |     | `type: draft.meta.type ?? "short_video",`     |
| 115 | ??-left |     | `tone: draft.meta.tone ?? "",`                |
| 116 | ??-left |     | `logline: draft.meta.logline ?? "",`          |
| 117 | ??-left |     | `scriptMarkdown: draft.scriptMarkdown ?? "",` |
| 129 | ??-left |     | `return (result.rowsAffected ?? 0) > 0;`      |

### src/server/workshop/llm.ts

|  行 | 类别       | 格  | 代码 / 理由                      |
| --: | ---------- | --- | -------------------------------- |
|  48 | no-overlap |     | `if (row.temperature != null) {` |
|  52 | no-overlap |     | `if (row.maxTokens != null) {`   |
|  75 | opt-chain  |     | `if (!cfg.model?.trim()) {`      |

### src/server/workshop/repository.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                                    |
| --: | ------- | --- | ---------------------------------------------------------------------------------------------- |
|  77 | ??-left |     | `type: /* SAFETY: 类型断言已复核 */ (content.type as ProjectMeta["type"]) ?? state.meta.type,` |
|  94 | ??-left |     | `type: /* SAFETY: 类型断言已复核 */ (row.type as ProjectMeta["type"]) ?? "short_video",`       |
| 120 | ??-left |     | `ideaLength: (row.idea ?? "").length,`                                                         |
| 121 | ??-left |     | `scriptLength: (row.scriptMarkdown ?? "").length,`                                             |
| 229 | ??-left |     | `return (result.rowsAffected ?? 0) > 0;`                                                       |

### tests/helpers/gate-repo.ts

|  行 | 类别    | 格  | 代码 / 理由                        |
| --: | ------- | --- | ---------------------------------- |
| 574 | ??-left |     | `const stdout = res.stdout ?? "";` |
| 575 | ??-left |     | `const stderr = res.stderr ?? "";` |

### tests/helpers/jsdom-capability.ts

|  行 | 类别         | 格  | 代码 / 理由                                            |
| --: | ------------ | --- | ------------------------------------------------------ |
| 114 | always-falsy |     | `if (!error \|\| typeof error.message !== "string") {` |

### tests/helpers/test-db.ts

|  行 | 类别    | 格  | 代码 / 理由                   |
| --: | ------- | --- | ----------------------------- |
| 432 | ??-left |     | `const bound = params ?? [];` |

### tests/helpers/theme-tokens.ts

|  行 | 类别    | 格  | 代码 / 理由                                                                       |
| --: | ------- | --- | --------------------------------------------------------------------------------- |
| 303 | ??-left |     | `const layered = atrule?.type === "atrule" && /^layer/i.test(atrule.name ?? "");` |
