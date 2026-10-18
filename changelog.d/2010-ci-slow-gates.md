## Changed

- **CI 三格耗时项收窄：`Install dependencies` / `同步数据库表结构` / `文件结构硬规则`**
  （ISSUE #2010 / 规范 §13.5.22）：判据一格没放宽，改的是「这一步要不要执行」。
  - **`Install dependencies`**：旧判据「本次变更没碰依赖面就跳过」在自托管上**一次都没
    生效过** —— 每一次构建都是全新 clone，`node_modules` 一个都没有，第一条先命中。
    现在判据是「装出来的那一套 ⇄ 现在的依赖面」对不对得上
    （`ci-install-deps.mjs` 的 `pnpmInstallFingerprint()`：四份依赖声明的内容摘要 +
    `patches/`；**装之前算、装成功后落盘**，半套不许被记成已验证）。
  - **`同步数据库表结构`**：库已经是这一版 schema 建的那张时一次 drizzle 都不起 ——
    判据是 `db-schema-state.mjs` 的 `probeSchemaFresh()`（只读、毫秒级，本机实测
    790ms → 64ms）。`outdated` 与 `unknown`（库不在 / 空库 / 从未登记指纹）照跑：
    「拿不到结论」不是「已经一致」。这条判据现在只有一处，`db:push` 的空转档、
    启动链路的指纹闸门、e2e 的开跑前预检共用它。
  - **`文件结构硬规则`**：登记进 `INCREMENTAL_GATES`，`ifModify` 由判据自己的声明层
    机械导出（`file-structure-rules.cjs` 的 `TRIGGER_GLOBS` = `SCAN_ROOTS` + 根目录
    扩展名），所以「扫描根」与「配置里的 globs」不可能各自漂。
- **e2e 开跑前的 schema 预检不再算两次**：`main` 之前判完 `ensure` 之后又调了一次
  `checkSchemaBeforeRun()`，在指纹对不上的机器上等于再起一轮 drizzle dry-run（十几秒）。
  现在判决由 `makePreflightCollectors()` 算一次、挂给 `main` 读（`schemaVerdict`）。
