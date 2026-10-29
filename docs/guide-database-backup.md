# 数据库备份与迁移指南

> 适用范围：Comfy-APP-T3 本地 SQLite 数据库（`db.sqlite`）的日常备份、
> 跨机器/跨用户迁移、以及损坏后的恢复操作。

---

## 1. 数据库在哪里

应用运行时的 SQLite 驱动是 **`@libsql/client`**（本地 `file:` 模式），数据库文件路径由
`.env` 中的 `DATABASE_URL` 决定，默认值：

```
DATABASE_URL="file:./db.sqlite"
```

> ⚠️ **网上许多 SQLite 备份写法用的是 `better-sqlite3`，本应用的生产运行时没有这个包** ——
> 它是 `devDependencies`（只给测试基建用），装好依赖的开发机碰巧能跑，
> **桌包用户与 standalone 运行期照抄就是 `MODULE_NOT_FOUND`**。本指南里所有手工命令只用
> 运行时真在场的东西：应用自带的脚本（Node 自带的 `node:sqlite`）或 `@libsql/client`。
> 驱动这一族的完整读数见规范 `docs/standards/launch-and-build.md` §6.1。

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

### 2.1 用现成的入口（推荐）

```bash
# 在项目根目录执行
pnpm db:backup
```

它做的是 `VACUUM INTO`（SQLite 自带的「一条语句拿一份一致性单文件快照」），
**不用停应用**，并且做完三道自证：产物单文件（不带 `-wal` / `-shm`）、
`PRAGMA integrity_check` 回 `ok`、产物里至少有一张表。读数：

```
[db:backup] 落点：<项目根>\data\backups\db-backup-20261029-125022.sqlite（保留最近 3 份，本机私有目录、不入版本控制）
```

- **落点**是 `data/backups/`，不是项目根旁边：生产里 `process.cwd()` 就是安装目录，
  而下一次安装 / 更新会覆盖安装清单里的文件——备份放那儿会被一次升级带走。
- **只留最近 3 份**（同一秒里再点一次会排 `-2`，不覆盖前一份）。
- 界面上同一条路：设置页的数据库备份区（列清单 / 立即备份 / 选一份请求恢复）。
- 还有一档自动的：**在设置页点「同步表结构」并确认那一次**（它带 `--force`）之前先备份 ——
  `--force` 是唯一会跑「删列 / 重建表」的那条路，也是唯一一次失误不可逆的时刻。
  普通启动那一路**不带** `--force`：它按白名单只认建表 / 建索引 / 加列，不会丢数据，
  所以刻意不备份 —— 每次都备会让 `data/backups/` 被「一次正常启动」填满，
  3 份保留量反而挤掉真正有价值的那几份。备份失败**不阻断**同步（那是你已确认的动作），
  但会把原因讲出来，让「这次变更万一丢了数据、目前没有退路」至少是可见的。

恢复**不在点按钮那一刻换文件**：那一条只写一个「待恢复」标记，真正的换文件发生在
**下次启动**（`applyPendingRestoreAtBoot`）。这是刻意的——运行期有多个进程握着这个库
（内嵌 Next server、执行宿主、你可能开着的 Drizzle Studio），在别人握着句柄时覆盖
`db.sqlite` 是不可逆的数据事故。

### 2.2 为什么不是「在线 `backup()`」，也不是直接 `copy`

- **在线 `backup()`**：那是 `better-sqlite3` 的 API，而本应用运行时用的是
  `@libsql/client`，它**没有** `backup()`（`Client` 只有 `execute` / `transaction` /
  `sync` / `close`）。所以这条路在本仓不是「不推荐」，是**不存在**。
- **直接 `copy db.sqlite`**：只有在应用**正常关闭**（SQLite 关库时 checkpoint，把 WAL
  合回主库）之后才是完整快照。应用还开着、或被强杀 / 崩溃时，WAL 里那些**已提交但尚未
  checkpoint** 的数据不在主库文件里，`copy` 出来的那一份就缺这一段——而它正是你刚做完的活。
  `VACUUM INTO` 的产物包含这部分，所以本指南把 `pnpm db:backup` 放在推荐位，
  把 `copy` 只留给「已经确认应用关干净、且手边没有任何脚本」的场合（§3 的跨机迁移）。

### 2.3 备份建议

- 定期把 `data/backups/` 里的文件拷到项目外（云盘 / 另一台机器）——`data/` 是本机私有状态，
  `.gitignore` 收它，打包时 `scripts/standalone-private-inputs.mjs` 也会把它从分发产物里剥掉，
  所以它**不会**进版本控制，也**不会**跟着桌包分发；反过来讲：它也不在备份之外，
  重装 / 删目录时那份库会一起没了，跨介质另存才叫备份。
- 一份备份能还原出的**不只是业务数据**：`db.sqlite` 里那些 LLM API Key 是 AES-256-GCM
  **密文**，而解开它们的那把在 `data/llm-secret.key`；`account` / `session` 表里还躺着
  可用的会话凭据（与 `.env` 的 `AUTH_SECRET` 绑定）。所以「库 + `data/` 目录」一起拷走
  ≈ 整套凭据一起拷走 —— 别把这一对丢进公共网盘或直接发给别人；要跨机分享数据时，
  先想清楚对方需不需要你的密钥。

---

## 3. 将他人的数据库直接拿来用（迁移）

场景：同事/另一台机器上编辑了工作流、模型配置等数据，你想直接导入。

### 3.1 操作步骤

1. **关闭本机的应用**（Tauri 窗口 + dev server 终端，确保无进程持有 DB）。

2. **备份当前数据库**（以防需要回退）——应用已经关上了，两种都行：
   ```bash
   pnpm db:backup   # 推荐：产物自带 integrity_check，且落在 data/backups/ 里按份轮转
   copy db.sqlite db-before-migration.sqlite   # 关干净之后的手工档
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

只读打开主库，检查完整性（用的是 **Node 自带的 `node:sqlite`**，装了 Node 就能跑，
不需要任何依赖）：

```bash
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('db.sqlite',{readOnly:true}); console.log(db.prepare('PRAGMA integrity_check').all()); db.close();"
```

健康的库回一行 `ok`；有损坏时回的是逐行的问题描述。

如果报错 `malformed`，再单独测主库（不带 WAL）：

```bash
copy db.sqlite test-main.sqlite
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('test-main.sqlite',{readOnly:true}); console.log(db.prepare('PRAGMA integrity_check').all()); db.close();"
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

如果主库本身有损坏页，先救可读的那一半。**别在原始文件上做**——下面这份脚本只读它，
写的是新库 `db-recovered.sqlite`。

把这段存成项目根里的 `db-rescue.mjs`（用的还是 Node 自带的 `node:sqlite`，零依赖）：

```js
// 逐表把还读得动的数据搬进一份新库：某张表读不动就跳过它，不整库放弃。
import { DatabaseSync } from "node:sqlite";

const src = new DatabaseSync("db.sqlite", { readOnly: true });
const dst = new DatabaseSync("db-recovered.sqlite");

dst.exec("BEGIN");
for (const t of src
  .prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'")
  .all()) {
  try {
    const rows = src.prepare(`SELECT * FROM "${t.name}"`).all();
    if (t.sql) dst.exec(t.sql);
    if (rows.length === 0) {
      console.log("OK:", t.name, "0 rows");
      continue;
    }
    const cols = Object.keys(rows[0]);
    const ins = dst.prepare(
      `INSERT INTO "${t.name}" (${cols.map((c) => `"${c}"`).join(",")})` +
        ` VALUES (${cols.map((c) => `:${c}`).join(",")})`,
    );
    for (const r of rows) ins.run(r);
    console.log("OK:", t.name, rows.length, "rows");
  } catch (e) {
    console.log("SKIP:", t.name, e.message);
  }
}
dst.exec("COMMIT");
src.close();
dst.close();
```

跑它、再按 §4.2 那句验一份产物：

```bash
node db-rescue.mjs
node -e "const {DatabaseSync}=require('node:sqlite'); const db=new DatabaseSync('db-recovered.sqlite',{readOnly:true}); console.log(db.prepare('PRAGMA integrity_check').all()); db.close();"
```

- 每行 `OK: <表名> <行数>` 是搬好了的；`SKIP: <表名> <原因>` 是救不动的那张——
  **先看清 SKIP 了哪些**，再决定要不要用这份产物覆盖。
- 这份产物**不校验业务完整性**（外键、`session` 与 `AUTH_SECRET` 的配对都要人看一眼），
  它只保证「SQLite 读得动」。
1. 确认产物可用后，关掉应用，用 `db-recovered.sqlite` 替换 `db.sqlite`（连同 §3.1 第 3 步
   删掉 `-wal` / `-shm`）。
2. 启动应用（schema 自愈会补齐缺失结构）。
3. **如果 §2.1 那份 `pnpm db:backup` 有产物，从备份恢复永远比抢救省事** ——
   设置页选那份 + 确认，下次启动自动换文件。

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
| 备份 | `pnpm db:backup`（不用停应用；落 `data/backups/`，留最近 3 份，自带 `integrity_check`） |
| 恢复备份 | 设置页选那份 + 确认 → 重启应用（换文件发生在启动那一跳） |
| 用别人的库 | 关应用 → 删本机 `-wal` `-shm` → 覆盖 `db.sqlite` → 开应用 |
| WAL 损坏修复 | 关应用 → 删 `-wal` `-shm` → 开应用 |
| 主库损坏抢救 | `node db-rescue.mjs` 见 §4.4（只读原库，写新库） |
| 完整性检查 | `node -e "…node:sqlite…PRAGMA integrity_check"` 见 §4.2 |
| 定位 dev server PID | `netstat -ano \| findstr :3100 \| findstr LISTENING` |
| 终止进程树 | `node scripts/reap-process.mjs <PID> --force` |
| 按项目路径找所有进程 | PowerShell `Get-CimInstance` 见 §5.4 |
