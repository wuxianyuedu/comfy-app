## Changed

- `scripts/` 目录按家族归入域子目录（#3930）：`check-*`/`gate-*` → `scripts/gates/`、
  `ci-*` → `scripts/ci/`、`ship*` → `scripts/ship/`、`affected-*` 与 `run-affected-tests.mjs` →
  `scripts/affected-tests/`、`ui-primitives-*` → `scripts/ui-primitives/`、`db-*` → `scripts/db/`、
  `tw4-*` → `scripts/tw4/`、`dev-drive-*` → `scripts/dev-drive/`、`freshness-*` → `scripts/freshness/`、
  `reformat-*` → `scripts/reformat/`、`e2e-*` → `scripts/e2e/`、`merged-side-loss-*` →
  `scripts/base-check/`，共 257 份文件；顶层只留单件入口（每份是一个 pnpm 动词、一个钩子步骤
  或被壳 / CI 直接调用的入口），并新增 `scripts/README.md` 导航索引。
- 壳运行期引用的路径**不动**：`dev-launcher.mjs`、`standalone-runtime.mjs`、`app-port.mjs`、
  `reap-process.mjs`、`launcher-core/**` 等 13 个路径是 `shell_launch.rs` 判 prebuilt / standalone
  形态与进程回收的运行期依据（§1.5 / §7.6）。
- 连带同步全部引用面（§12.5.3 迁移五查）：包脚本与钩子的 `run` 行、`.cnb.yml`、GA workflows、
  测试导入与沙箱搭建（`tests/helpers/gate-repo.ts` 的 `script` 参数改为相对 `scripts/` 的子路径、
  `copyGateDeps` 按basename 索引递归补齐 `../` 依赖）、文档路径（`doc:check` 验证）与
  `scripts/` 内隐藏台账的路径键；新增的 `gates/check-gate-executors.cjs` 改为递归枚举
  `scripts/**`（basename 全仓唯一）。
- 判据的执行者登记不变：标签、档位、红绿语义全部照旧；本次只动路径，不改任何判据口径。
- 两次合并 origin/master（并行落地的十余笔提交）：解 11 个文件的冲突（脚本路径按域布局
  对齐、预算注释取 master 新值），并把合并带入的新脚本归入对应域子目录
  （ship-status / ship-fetch-issue → ship/、freshness-ledger-write → freshness/、
  db-unique-sweep → db/、affected-launcher-hygiene + launcher-closure → affected-tests/）。
  `src-tauri/src/single_instance.rs` 测试模块里的一行路径注释留待下次重编壳时顺带更新
 （为一行注释触发整壳重编不值当）。
