# 数据库备份与迁移指南

> 适用范围：Comfy-APP-T3 本地 SQLite 数据库（`db.sqlite`）的日常备份、
> 跨机器/跨用户迁移、以及损坏后的恢复操作。

---

## 1. 数据库在哪里

应用使用 **better-sqlite3** 驱动，数据库文件路径由 `.env` 中的
`DATABASE_URL` 决定，默认值：

```
DATABASE_URL="file:./db.sqlite"
```

解析规则：相对路径以**进程 CWD**（即项目根目录）为锚点。因此实际文件位置：

| 运行方式 | 数据库实际路径 |
|---|---|
| `pnpm dev`（开发） | `<项目根>/db.sqlite` |
| Tauri 打包版（生产） | `<res_dir>/db.sqlite`（由壳的 `current_dir` 决定） |

SQLite 在 WAL 模式下会产生两个辅助文件：

- `db.sqlite-wal`（Write-Ahead Log）—— 未合并进主库的增量事务
- `db.sqlite-shm`（Shared Memory）—— WAL 索引，进程间协调用

**备份时只需主库 `db.sqlite`**；WAL/SHM 是运行时产物，可安全丢弃（见下方 §2）。

---

## 2. 备份数据库

### 2.1 安全备份（推荐）

在应用**关闭**状态下，直接复制 `db.sqlite` 即可：

```bash
# 在项目根目录执行
copy db.sqlite db-backup-20260920.sqlite
```

应用关闭时 SQLite 已将 WAL 合并回主库（checkpoint on close），
所以单文件就是完整快照。

### 2.2 热备份（应用运行中）

如果不想停应用，用 SQLite 的在线备份 API（一条命令完成）：

```bash
node -e "const D=require('better-sqlite3'); const src=new D('db.sqlite'); const dst=new D('db-hot-backup.sqlite'); src.backup(dst); src.close(); dst.close(); console.log('done');"
```

这会产出一个一致性快照，不影响应用读写。

### 2.3 备份建议

- 定期备份到项目目录外（避免 git 误提交 / 构建产物污染）。
- `.gitignore` 已排除 `db.sqlite*`，不会意外进版本控制。
- 如果有多台机器，可把备份文件放云盘同步。

---

## 3. 将他人的数据库直接拿来用（迁移）

场景：同事/另一台机器上编辑了工作流、模型配置等数据，你想直接导入。

### 3.1 操作步骤

1. **关闭本机的应用**（Tauri 窗口 + dev server 终端，确保无进程持有 DB）。

2. **备份当前数据库**（以防需要回退）：
   ```bash
   copy db.sqlite db-before-migration.sqlite
   ```

3. **删除本机 WAL/SHM 辅助文件**（如果存在）：
   ```bash
   del db.sqlite-wal db.sqlite-shm
   ```
   这些是运行时产物，不应跨机器携带——不同机器的 WAL 页状态不兼容。

4. **将对方的 `db.sqlite` 复制过来**，放到项目根目录（覆盖旧的）：
   ```bash
   copy \\other-pc\shared\db.sqlite .\db.sqlite
   ```

5. **启动应用**。SQLite 会自动创建新的 WAL/SHM，schema 版本由
   启动器的 `heal-db.cjs`（drizzle-kit push）保证兼容。

### 3.2 注意事项

- **只传 `db.sqlite`，不传 `-wal` / `-shm`**。原因：

  应用正常关闭时，SQLite 会自动执行 checkpoint——把 WAL 中所有已提交的
  数据合并回主库，WAL 随之清空。所以**关应用后的 `db.sqlite` 单文件就是
  完整快照**，`-wal`/`-shm` 里已经没有任何数据了。

  跨机器携带 WAL 不仅无益，反而有害：WAL 文件头有一个随机 salt 值，必须
  与主库 header 中的 salt 一致 SQLite 才会回放它。不匹配时轻则忽略（白带），
  重则像今天一样——WAL 本身已损坏，SQLite 尝试回放时报
  `database disk image is malformed`，把一份健康的主库也带崩。

  **结论**：备份和迁移永远只操作 `db.sqlite` 一个文件。
- **版本兼容**：如果对方的 schema 比你本地代码新（多了列/表），启动时
  `heal-db` 会自动补列；如果对方 schema 比你旧，drizzle-kit push 会
  建新表/索引，不会删已有数据。
- **认证与会话**：`account`/`session` 表里的 better-auth 凭据与机器的
  `AUTH_SECRET` 绑定。如果 `.env` 里的 `AUTH_SECRET` 和对方不同，
  迁移后需要重新登录（不影响工作流/模型等业务数据）。
- **模型路径**：`model` / `remoteModel` 表中可能存有对方机器的绝对路径。
  导入后在「模型管理」页面检查并修正路径。

---

## 4. 损坏恢复（database disk image is malformed）

### 4.1 诊断

应用日志（设置面板 → 应用日志 → 错误）出现：

```
tRPC failed on workflow.list: database disk image is malformed
```

界面表现为工作流库卡在「正在加载工作流…」，其他依赖 DB 的页面同样异常。

### 4.2 根因确认

```bash
# 只读打开主库，检查完整性
node -e "const D=require('better-sqlite3'); const db=new D('db.sqlite',{readonly:true}); console.log(db.pragma('integrity_check')); db.close();"
```

如果报错 `malformed`，再单独测主库（不带 WAL）：

```bash
copy db.sqlite test-main.sqlite
node -e "const D=require('better-sqlite3'); const db=new D('test-main.sqlite',{readonly:true}); console.log(db.pragma('integrity_check')); db.close();"
```

- 如果去掉 WAL 后 integrity_check 返回 `ok` → **损坏在 WAL 文件**（最常见），
  按 §4.3 处理。
- 如果主库本身也报错 → **主库损坏**，按 §4.4 处理。

### 4.3 WAL 损坏修复（主库健康）

1. 关闭应用（Tauri 窗口 + dev 终端）。
2. 删除 `db.sqlite-wal` 和 `db.sqlite-shm`。
3. 重启应用。

主库数据完整，仅丢失 WAL 中尚未合并的极少量未提交事务（实际影响极小）。

### 4.4 主库损坏修复

如果主库本身有损坏页：

1. 尝试抢救可读数据：
   ```bash
   node -e "
   const D=require('better-sqlite3');
   const src=new D('db.sqlite',{readonly:true});
   const dst=new D('db-recovered.sqlite');
   // 逐表导出（遇到损坏表会跳过）
   const tables=src.prepare(\"SELECT name FROM sqlite_master WHERE type='table'\").all();
   for(const t of tables){
     try{
       const rows=src.prepare('SELECT * FROM \"'+t.name+'\"').all();
       if(rows.length){
         const cols=Object.keys(rows[0]);
         dst.exec(src.prepare(\"SELECT sql FROM sqlite_master WHERE name='\"+t.name+\"'\").get().sql);
         const ins=dst.prepare('INSERT INTO \"'+t.name+'\" ('+cols.map(c=>'\"'+c+'\"').join(',')+') VALUES ('+cols.map(c=>'@'+c).join(',')+')');
         for(const r of rows) ins.run(r);
       }
       console.log('OK:',t.name,rows.length,'rows');
     }catch(e){console.log('SKIP:',t.name,e.message);}
   }
   src.close(); dst.close();
   "
   ```
2. 用 `db-recovered.sqlite` 替换 `db.sqlite`。
3. 启动应用（schema 自愈会补齐缺失结构）。
4. 如有 §2 的定期备份，直接从备份恢复是最省事的。

---

## 5. 开发模式下的进程定位与终止

### 5.1 为什么任务管理器里进程是散的

开发模式下，你会在 Windows 任务管理器里看到多个独立分组：

- "Node.js JavaScript Runtime" —— Next dev server
- "Python" —— ComfyUI 运行时
- "主应用" —— Tauri 壳窗口

它们**不会自动归到同一个应用组**下，原因是 dev 模式下这些进程由
`dev-launcher.mjs` 分别 spawn，不是 Tauri exe 的直接子进程。

**打包版（production）不存在此问题**：Tauri 壳作为父进程直接管理
sidecar（Next standalone + ComfyUI），Windows 任务管理器会按进程树
将它们嵌套在同一个应用条目下。

### 5.2 按端口快速定位 PID

每个应用实例有唯一的端口（见 `.env` 的 `COMFYAPP_PORT`），
按端口找是最快的方式：

```cmd
:: 找 Next dev server（默认 3100，多实例时各不相同）
netstat -ano | findstr :3100 | findstr LISTENING

:: 找 ComfyUI（默认 8188）
netstat -ano | findstr :8188 | findstr LISTENING
```

输出的最后一列就是 PID。

### 5.3 终止整棵进程树

拿到 PID 后，用项目自带的跨平台回收脚本（会连带杀所有子进程）：

```bash
:: 在项目根目录执行，<PID> 换成上一步拿到的数字
node scripts/reap-process.mjs <PID> --force
```

例如 Next dev server 的 PID 是 61232、ComfyUI 的 PID 是 43692：

```bash
node scripts/reap-process.mjs 61232 --force
node scripts/reap-process.mjs 43692 --force
```

> **`--force` 的含义**：Windows 上发 `taskkill /T /F`（强制），
> POSIX 上向进程组发 SIGKILL。不加 `--force` 则先尝试优雅终止。

### 5.4 按项目路径批量查找（多实例时）

如果你同时跑了多个项目副本（不同端口），想一次性找出某个项目
的所有相关进程：

```powershell
# 在 PowerShell 中执行（把路径换成本项目的）
Get-CimInstance Win32_Process |
  Where-Object { $_.CommandLine -match 'comfy-app-t3-branch' } |
  Select-Object ProcessId, Name, @{N='Cmd';E={$_.CommandLine.Substring(0,[Math]::Min(120,$_.CommandLine.Length))}} |
  Format-Table -AutoSize
```

这会列出所有命令行中包含该项目路径的进程（node/python/tauri 壳），
再对根 PID 逐个 `reap-process`。

### 5.5 最省事的方式

如果 dev server 的终端窗口还开着，直接在那个终端按 **Ctrl+C** 即可——
`dev-launcher.mjs` 会走正常的整棵进程树回收流程（包括 Python 子进程）。
只有终端已关闭、进程残留时才需要上面的手动定位方法。

---

## 6. 快速参考

| 操作 | 命令/步骤 |
|---|---|
| 备份 | 关应用 → `copy db.sqlite backup.sqlite` |
| 恢复备份 | 关应用 → 删 `-wal` `-shm` → `copy backup.sqlite db.sqlite` → 开应用 |
| 用别人的库 | 关应用 → 删本机 `-wal` `-shm` → 覆盖 `db.sqlite` → 开应用 |
| WAL 损坏修复 | 关应用 → 删 `-wal` `-shm` → 开应用 |
| 完整性检查 | `node -e "..."` 见 §4.2 |
| 定位 dev server PID | `netstat -ano \| findstr :3100 \| findstr LISTENING` |
| 终止进程树 | `node scripts/reap-process.mjs <PID> --force` |
| 按项目路径找所有进程 | PowerShell `Get-CimInstance` 见 §5.4 |
