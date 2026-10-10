## Added

- **D6 落地：数据库自动备份 / 恢复（ISSUE #1611，拍板口径「照建议默认」）。** 上一笔把三种待拍口径各落到一条建议默认上，让拍板变成「答『按建议』或给替换值」；本笔就是那一句「照建议默认」之后的实现 —— 三条口径与落点一一对应：

  - **① 只在「会动结构的同步之前」自动做一档，另留手动档。** `scripts/db-sync.mjs` 在 `if (force)` 支上先备份再同步 —— `--force` 是唯一会跑删列 / 重建表的那条路（`db-schema-state.mjs` 的 `riskyStatements` 白名单），也是唯一一次失误不可逆的时刻，而它此前**零备份**。非 `--force` 的自动同步按白名单只认建表 / 建索引 / 加列、不丢数据，因此**不备份**（每次都备会让 3 份保留量被「一次正常启动」挤掉真正有价值的那几份）。手动档是新增的 `pnpm db:backup`。
  - **② 最近 3 份，落 `<应用根>/data/backups/`。** 按次命名（`db-backup-<YYYYMMDD>-<HHmmss>[-n].sqlite`，同秒内不覆盖）+ 轮转（硬规则 4）。落 `data/` 是因为它已经就是本机私有状态的既定落点（`.gitignore` 收 `/data/`、`standalone-private-inputs.mjs` 还会把它从分发产物里剥掉）；**不放「项目根旁边」**是因为生产里 `process.cwd()` 就是安装目录，下一次安装 / 更新会覆盖安装清单里的文件。
  - **③ 设置页一个入口，但换文件落在「应用没在跑」的那一刻。** `setting.backupRestore` **只写待恢复标记**；真正换文件由三个启动入口（`dev.mjs` / `start.mjs` / `dev-launcher.mjs`）在**起 Next 之前**调 `applyPendingRestoreAtBoot` 完成 —— 运行期有多个进程同时持有这个库（内嵌 Next server、执行宿主、用户可能开着的 Drizzle Studio），就地覆盖 `db.sqlite` 是不可逆的数据事故。所以界面上说的是「**重启应用后生效**」，而不是一句把人骗去刷新页面的「已恢复」。

- **热备份机制是 `VACUUM INTO`，不是原文写的在线 `backup()`。** 那条方案**在运行时不存在**：`better-sqlite3` 是 `devDependencies`（测试基建），生产走 `@libsql/client`，而它没有 `backup()`。`VACUUM INTO` 一条语句产出一致性单文件快照，不停应用、不带 `-wal` / `-shm`；两条链（`@libsql/client` 与 `node:sqlite`）都在 WAL 模式下实测过：产物单文件、`pragma integrity_check` 回 `ok`、表数据可读，**且 WAL 里尚未 checkpoint 的已提交写入也在产物里**（这正是「直接 copy `db.sqlite`」做不到的那一点）。

- **两处刻意不做的事**（写进台账免得被读成漏了）：恢复**不提供「就地换文件」**；换文件之前**必先给当前库做一份退路备份**，那一步失败就**不换** —— 宁可让用户重来，也不要把唯一的退路丢掉。

- **一处实测出来的顺序陷阱：退路备份的轮转会把「正在被恢复的那一份」删掉。** 恢复的顺序是「先给当前库做退路 → 再复制要恢复的那一份过来」，而退路备份的那次轮转按「最近 N 份」一算，被恢复的那一份（它可能正好是最老的）就落进了删除名单 —— 实测表现是 `copyFileSync` 报 `ENOENT`、库没换成，而**退路已经做了**（用户付了代价什么也没得到）。修法是让 `createBackup` 收一个 `protect` 名单：被保护的名字不占保留份数、也不进删除名单。回归用例把「保留份数刚好占满 + 被恢复的是最老那份 + 退路备份 `now` 推到很久以后」三个条件凑齐，去掉保护即红（实测过）。

- 三条判据全部对着机器事实，「文件存在」一条都答不上来：产物能被 `integrity_check` **读通**且表数 > 0；`-wal` / `-shm` **不进备份**；库被占用 / 产物读不通时**给出可见出口**（硬规则 4）。备份写**临时名**、验完才改名 —— 中途失败不留一个「看着像备份、其实读不通」的文件（那比没有备份更危险）。

## Changed

- `docs/guides/PRODUCTION-GAPS.md` 的 **D6 从「等一个决策」改判为已落地**，记下拍板结论、逐条对应关系与两处刻意不做的边界；`docs/generated/PRODUCTION-GAPS.md` 由 `pnpm doc:render` 同步；`docs/README.md` §8.7 巡检记录补上本笔（承接同一轮）。
- 新增 `src/lib/db-backup/` 子域（`DOMAINS` 登记 + `vitest.config.ts` 按实测值 100 设门槛，规范 §12.5.3 R14 / §18.6）；`db-backup-core.mjs` 登记进 `RUNTIME_SCRIPTS` 与 `ALLOWED_SCRIPTS`（`dev-launcher.mjs` 顶层静态 import 它，缺一份整个编排器 ENOENT）。
