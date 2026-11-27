## Added
- `pnpm db:inspect [--table <名>] [--limit N] [--sql "<只读 SELECT>"] [--json]`（#5171）：只读核对 db.sqlite 此前靠 `node -e "new DatabaseSync(...)"`，PowerShell 引号转义易错、路径锚点错会查到空库。现在复用 `resolveSqlitePath` / `schemaDigest` / `verifyBackupFile`，一条命令给出库绝对路径、integrity_check、表数与行数、源码 schema 指纹与库指纹；只接受单条 SELECT / WITH，写语句与藏了第二条语句的输入当场拒绝。补只读语句形状用例。
