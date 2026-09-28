## Added

- **桌包 standalone 形态有了运行入口 `scripts/standalone-runtime.mjs`**（P3 §5 · Phase 3-E2a，ISSUE #1216）。壳原先直接 `node server.js`，而分发产物按硬规则 17 不含 `.env`、只带生产依赖因此没有 `drizzle-kit`、后续「按 `COMFY_EXECUTOR` 拉起宿主」也得有人执行——这三件事都得起 server 的那个人来做。判据本体收在 `scripts/launcher-core/standalone-runtime-env.mjs`：
  - **运行期 env 装配**：`SKIP_ENV_VALIDATION` + `src/env.js` 的四项必填逐个给值 + **绝对** `DATABASE_URL`（Next 的 standalone `server.js` 启动即 `process.chdir(__dirname)`，写相对路径等于赌两侧锚点一致）；回环写 `127.0.0.1` 不写 `localhost`（硬规则 20）。
  - **`BETTER_AUTH_SECRET` 持久化**在载荷根的 `data/runtime-secret.json`（跨重启必须稳定，否则用户每次开机被登出）。「文件在但内容不可用」（非法 JSON / 短于 32）一律抛错，**不悄悄换一把**——换一把等于把既有会话全部作废，而现场不会有任何线索指向密钥文件坏了。
  - **首启建表**：库里一张表都没有时应用随包的 `schema.sql`（实测建出 24 张表）；已有用户的表绝不动（重装/升级路径）。
  - **日志按次命名**：`log/nextjs/standalone-server-{stdout,stderr}-<运行戳>.log`，保留 5 份（固定名会被残留句柄锁死，硬规则 4）。文件名用 `runStamp()` 而不是日志行那套 `localTimestamp()`——后者带冒号与空格，在 Windows 上是非法文件名（第一版实测打开就 `ENOENT`，用例已钉住文件名不许含 `:` 与空格）。
  - **每用户数据落位**（签字口径）：实测 NSIS 默认 `perUser` → 装到 `%LOCALAPPDATA%\ComfyAPP`，载荷根因此本来就可写；`db.sqlite` / `log/` / `data/` 都落在那一层，卸载不动它们（`RMDir` 不递归）。把数据与代码彻底分家要收口 10 余处 `process.cwd()` 锚点，不在本刀顺手做。
  - **退出与回收**：server 退出则入口以同一退出码退出（壳据此写失败出口）；只在子进程还活着时经统一入口 `scripts/reap-process.mjs` 回收整棵树（子进程已退出再补一刀会在日志里留一行假的 `reap FAILED`）。
  - 回归：`tests/standalone-runtime.test.ts`（22 条，其中 4 条用**桩 server 真起入口**，验 boot 行 / 建表 / 退出码透传 / 缺 `server.js` 与缺 `PORT` 时大声失败）。
  - **本条不含宿主拉起**：入口的宿主半边（按 `resolveExecutorMode()` 起 `executor-host.mjs`）= 3-E2b，收口 #1216。分发口径不变：#1216 落地前不要在桌包里设 `COMFY_EXECUTOR=host`。
