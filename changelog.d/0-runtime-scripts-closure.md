## Fixed

- **standalone / static 产物里的编排器缺件：7 个运行期模块没登记进分发白名单**。`RUNTIME_SCRIPTS`（剔除侧）与 `ALLOWED_SCRIPTS`（产物层检查侧）此前只登记了 `launcher-core/{procs,shell,log,worktree,orchestrator}.mjs` 这一批，而 `dev-launcher.mjs` **顶层静态 import** 的这七份都不在清单里：`env-preflight.mjs` / `db-schema-state.mjs` / `db-push-core.mjs`（起 Next 前的两道预检与执行件）、`launcher-core/{corepack,splash-assets}.mjs`（工具链对齐、启动页资源同步）、`lockfile/{lock-diff,render-lock-diff}.mjs`（依赖与 lockfile 的差异打印）。剔除步骤会把它们从产物里删掉，而 ESM 在**加载期**就解析整张图 —— 桌面包脱离仓库后「重新编排一次」直接 `ERR_MODULE_NOT_FOUND`，用户只看得到「双击没反应」。
  - 两份清单同步补齐（`scripts/standalone-private-inputs.mjs` 的 `RUNTIME_SCRIPTS`、`scripts/check-standalone-contents.cjs` 的 `ALLOWED_SCRIPTS`），并写清判据不是「看着像运行时的都写上」。
  - 判据从「靠人记」改成**机器核对**（`tests/dist-artifact-hygiene.test.ts` 两条新用例）：① 从 `dev-launcher.mjs` 出发递归解析相对 import 闭包，闭包里每个 `scripts/**` 模块都必须在白名单内（只跟 `.mjs`、剥掉行注释 —— JSDoc 里的 `lockfile/lock-diff.d.mts` 是类型引用不算运行期依赖），并断言闭包条数 >10，防「解析退化后静默变成什么都没漏」；② 两份清单的集合必须完全相同 —— 剔除侧漏了是产物缺件，检查侧漏了是合法产物被判违规。
  - 规范 `docs/standards/launch-and-build.md` §7.3 补上白名单的两条判据、这次漏项的性质与两侧漂移的两种表现；§3.3 的回归锚点表补 `dist-artifact-hygiene` 的新锚点与本轮的 `command-echo` 用例。
