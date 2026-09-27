## Fixed

- `src/lib/db-schema-ready.test.ts` 在 **Windows** 上必然红：`afterEach` 删临时目录时 `EPERM, Permission denied: …db-schema-ready-xxxx`。
  成因：「reaper 模块级副作用」那组要真加载 `~/server/db`，libsql 的 `file:` 客户端开着 `<tmp>/db.sqlite` 的句柄；POSIX 上删得掉（inode 引用计数），Windows 上句柄未释放就锁死整个目录 —— 所以这条只在本地 Windows 露出，属「别人机器上绿、我这台红」那类最难查的红。
  修法两步：① 先关掉单例上的客户端（`NODE_ENV !== "production"` 时 drizzle 实例挂在 `globalThis.db`，取其 `$client.close()`，用可选链以兼容句柄不存在/无 `close` 的情况）；② 删除改带退避 —— `fs.rmSync(..., { maxRetries: 10, retryDelay: 100 })`，`maxRetries` 正是 Node 为 EPERM / EBUSY 这类瞬态文件锁准备的口。
  两条契约（表未就绪时 `isSchemaReady()` 为 false、reaper 不读库）一字未动，只修清理路径。
