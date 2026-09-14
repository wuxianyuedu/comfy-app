## Changed

- **Next 16 的代理约定迁移到 `src/proxy.ts`，构建期不再打 `middleware` 废弃警告**：`src/middleware.ts` 已按 Next 16 的继任约定改名为 `src/proxy.ts`（driver 同步改称 `proxy`，行为不变——本应用为本地单用户桌面壳，只做透传，不做登录墙）。**刻意不删这个文件**：删掉同样能消警告，但会连带丢掉 `config.matcher` 这份「哪些路径将来要走代理」的声明。新增提交门槛 **R11** 锁住三点：文件名必须是 `proxy.ts`（写回 `middleware.ts` 会重新吃废弃警告）、必须在 `src/` 根与 `app/` 同级（放进 `app/` 或更深目录 Next 不会加载，构建期毫无提示）、文件不得删除；`src/proxy.ts` 作为框架保留名由 `R2_EXEMPT` 显式豁免 kebab-case 规则（豁免与 R11 成对，见规范 12 章 §12.10）。

## Fixed

- **`pnpm build` 里那些 `Dynamic filesystem access causes tracing of the whole project` 告警，此前被当成「注解没加」处理，方向是错的**：实测（Next 16.3.2 + Turbopack）`/*turbopackIgnore: true*/` **只作用于动态 `import()` / `require()`，对 `fs.*` 的路径访问一概无效**——把它写在调用参数里、把路径先算成变量再注解、换成尾注、做成模块级常量再展开，四种写法逐条实测，仓库里那 5 条告警一条不少。因此仓库里现存的那些注解（`envfile.ts` / `debug/source/route.ts` / `localWorkflows.ts` / `db.ts`）**从未真正生效**，不能当作「已修」的证据。真正的防线是 `next.config.js` 的 `outputFileTracingExcludes`（工作在产物路径层面，不依赖静态分析，体积护栏 1.5GB 也靠它）；本次新增 `tests/turbopack-tracing-excludes.test.ts` 锁住它不被静默改坏——键位必须在顶层（挂 `experimental` 下一个字都不会被读，历史上就是这么失效过一轮）、关键目录清单不得缺项、且**不得**用 `turbopack.ignoreIssue` 去遮这条告警（实测它只过滤 CLI 输出、不改行为：把哨兵目录从 excludes 摘掉后照样回到 `standalone`——那是关信号而不是修问题）。规范新增 `launch-and-build.md` §7.2 记录这套判读方法与三条禁令。

- **构建期模块图上的无谓包装会把 Turbopack 打到 Rust panic**：实测在构建期模块图的模块里给每个路径访问都套一层展开/映射，会触发 `ModuleGraph::get_traces` 的 `internal error: entered unreachable code: there must be a path to a root`，整个 `next build` 被 `Error: Panic in async function` 带走，`--debug` 也只丢一行 `FATAL`、指不到业务原因。规范 §7.2 把它列为禁令（构建期模块图上的改动保持最小、直接）。
