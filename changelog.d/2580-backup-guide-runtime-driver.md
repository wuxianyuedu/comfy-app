## Fixed

- **备份指南教的是生产运行时不存在的驱动**（ISSUE #2580，P2）：
  `docs/guide-database-backup.md` 从第 10 行起写着「应用使用 **better-sqlite3** 驱动」，
  并据此给出三串可复制粘贴的命令（在线 `src.backup(dst)`、`db.pragma('integrity_check')`、
  逐表抢救的循环）。而 `better-sqlite3` 是 `devDependencies`（只给测试基建）——
  装好依赖的开发机碰巧能跑，**桌包用户与 standalone 运行期根本没有这个包**，
  照指南敲就是 `MODULE_NOT_FOUND`，而这条路径动的正是用户数据（备份 / 恢复）。
  机制其实早已换型：`scripts/db-backup-core.mjs` 用 `VACUUM INTO`（一条语句拿一致性
  单文件快照，`-wal` / `-shm` 不进备份，WAL 里未 checkpoint 的已提交数据也在产物里），
  台账 D6、核心实现、以及「`src/lib/db-backup/backup.ts` 里不许出现那三个字样」的断言都改了，
  **唯一没跟上的是给用户看的那一页**。
  现在三段与实现同源：入口 = `pnpm db:backup` / 设置页那一条 / 启动期落地待恢复
  （`applyPendingRestoreAtBoot`：点「恢复」只写标记，真正换文件发生在下次启动 ——
  运行期有多个进程握着这个库，在别人握着句柄时覆盖 `db.sqlite` 是不可逆事故）；
  「没有 pnpm 的场合」那一档改用**运行时真在场**的 `node:sqlite`（§4.4 那份逐表抢救脚本
  已在临时库里跑过：`OK: <表> <行数>` / `SKIP: <表> <原因>`，产物 `integrity_check` 回 `ok`）。
  ⚠️ 顺带订正一处会误导人的旧说法：原文写「应用关闭时 SQLite 已把 WAL 合并回主库，
  所以直接 `copy db.sqlite` 就是完整快照」—— 那句只在**正常关闭**之后成立；
  进程被强杀 / 崩溃 / 还开着时，已提交但未 checkpoint 的数据还在 `-wal` 里，`copy` 出来的
  那一份缺的正是你刚做完的活。
- **新增一条防复发判据**（挂在既有的 `pnpm doc:check` 里，不是第二个扫描器）：
  `scripts/check-doc-references.cjs` 多一族 `checkRuntimeAbsentDriverCommands()` ——
  **只认命令形状**（`require("better-sqlite3")` / `from "better-sqlite3"`），
  遍历面由磁盘现算（`README.md`、`docs/README.md`、`AGENTS.md`、`docs/guide-*.md`、
  `docs/guides/*.md`），**不含 `docs/standards/**`**：那一层要记「当年为什么换掉它」，
  按名字判就误报一片，而误报的判据活不过一次评审（硬规则 24 末句）。
  口径与面登记在 `docs/reference-facts.md` §3.8；用例
  `tests/check-doc-references.test.ts`「用户面文档不许教跑不通的驱动」（5 条，含
  「基线那条绿不许是空面」：先断言面内确有散文提及那个名字，再断言绿）。
  **单子里那句「文档点名的每个 `pnpm <脚本>` 必须存在于 `package.json`」没有做** ——
  它与 AGENTS 硬规则 27 末段那条已签字的裁决直接冲突（实测扫 48 份文档得 52 处命中、
  几乎全是误报：`pnpm tauri` 那类二进制名、散文里提到 pnpm 这个词、以及「某入口已被撤销」
  的历史叙述；名字空间是三层，判据只比得到一层）。已把这条冲突记在 #2580 的回执里。
- **同类用户指南扫过一处同形漂移**（同批改）：`docs/guides/sync-after-pull.md` 把
  「`better-sqlite3` 等原生模块**运行时**报错」列为彻底重装的触发条件 —— 运行期不用那个包，
  报错只可能出现在跑测试的进程里；改成点名「测试宿主」并指回规范 §6.1。
  其余提及（`docs/guides/ci-node-image.md` 讲镜像 glibc 与 prebuild 的配对、
  `docs/guides/PRODUCTION-GAPS.md` D6 讲换型理由、`docs/standards/18` 里那条历史缺陷）
  都是**散文而不是命令形状**，不是同一类漂移，未动。
