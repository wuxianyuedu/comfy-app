## Added

- 设置页的备份 / 恢复覆盖**本机应用数据**（#3732）：创建备份时除数据库快照
  （VACUUM INTO）外，同步把 `data/` 顶层文件（应用设置、模式契约本机覆盖、
  侧栏行为、密钥文件等）拷进 `data/backups/app-data-backup-<时刻>/`，与
  `db-backup-<时刻>.sqlite` 配成一套；轮转同节奏（保留 3 套）。
- 恢复沿用两步制（点按钮只写标记，下次启动应用没在跑时真正覆盖）：覆盖数据库
  的同时把同套的本机应用数据文件覆盖回 `data/`；覆盖前当前 `data/` 先存进
  `app-data-pre-restore-<时刻>/` 退路目录。
- 新增「从指定目录导入」：填一个目录路径，里面认得出的 `db-backup-*.sqlite`
  （逐份过 integrity_check）与 `app-data-backup-*/` 会拷回 `data/backups/`
  （同名不覆盖），导入后照常进清单、可恢复。
