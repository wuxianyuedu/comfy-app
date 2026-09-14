## Fixed

- **开发机的 `.env` 与 `db.sqlite` 会被打进桌面包，密钥明文随安装包分发**：
  `next build` 会把仓库根的这两份文件复制进 `.next/standalone`（`.env` 是 Next standalone 的环境加载行为，`db.sqlite` 是动态路径 tracing），而 `scripts/build-desktop.mjs` 的噪声剔除清单**只剔目录名**，两者于是随 `src-tauri/static` 被编译期内嵌进 exe。两个后果都不是「多带了个文件」：① `BETTER_AUTH_SECRET` / OAuth client secret 明文解包即得；② 壳以 `current_dir(res_dir)` 启动 sidecar，而 `resolveDbPath` 按 `process.cwd()` 解析 `db.sqlite`——被带进包的开发库**就是**应用首次启动时读写的那个库，开发者本机数据变成出厂数据。现在 `next.config.js` 的 `outputFileTracingExcludes` 补上 `db.sqlite*`（实测对 `db.sqlite` 有效），并新增 `scripts/standalone-private-inputs.mjs`（清单单一实现）在 `pnpm build` 收尾与 `build-desktop` 组装后各剥一次（`.env` 加 excludes 实测**无效**，只能显式删除）。
- **错误日志镜像绕过 pino 的脱敏，密钥明文写进面板可见的日志文件**：`src/server/lib/logger.ts` 的 ERROR 镜像（落 `log/services/app-runtime.log`）在对象取不到 `msg` / `err.message` 时走 `JSON.stringify(payload)` 整包兜底，而该通道**不经 pino redact**（另一条写入路径）。实测 `log.error({ BETTER_AUTH_SECRET: "…" })` 在 pino 流里是 `[Redacted]`、镜像文件里却是明文。更根本的是 `REDACT_PATHS` 的 `*.secret` 只匹配「属性名恰好叫 `secret`」，`BETTER_AUTH_GITHUB_CLIENT_SECRET` 这类 `*_SECRET` 命名一条都不命中——而 pino 的通配语义（实测：`*secret` / `*_SECRET` / `*secret*` 全不匹配部分字符串；`*` 会把整条记录连 `msg` 一起打成 `[Redacted]`）无法表达「名字含 secret」。现在镜像不再整包透传（无可读文案时只输出**键名清单**，键名不是值），并新增**值形状守卫** `redactSecretShaped()`：在日志写入边界递归擦掉 PEM 私钥块、JWT、以及长度 ≥ 24 且自带数字、Shannon 熵 ≥ 3.5 bit/char 的高熵串——不问字段名，因而覆盖「名字无法穷举」的密钥；`Error` 实例保形（保住 `message`）。
- **`pnpm test` 往仓库真实 `log/` 目录写日志**：`src/server/lib/logger.test.ts` 的镜像用例 import 真实 `APP_RUNTIME_LOG` 并用 `slice(before.length)` 读增量，`src/server/api/routers/generate.test.ts` 的业务里程碑日志也直接落真实文件——实测删掉 `log/` 后跑 `pnpm test` 会重建目录并写入若干行（含被断言的「密钥原文」标记行），既是污染也是环境耦合。现在镜像目标可由 `createPinoLogger({ mirror })` 注入，两处用例都落到自己的 mkdtemp 目录。

## Security

- 分发产物不再携带开发机密钥与开发数据库（见上）；日志镜像通道的密钥不再以明文落盘。

## Added

- `scripts/standalone-private-inputs.mjs`：开发机私有输入（`.env` 家族 / `db.sqlite*`）剔除清单的**单一实现**，被 `pnpm build` 的收尾步骤与 `scripts/build-desktop.mjs` 共同复用，避免两处清单各写一套后静默漂移。
- `scripts/check-standalone-contents.cjs` 的禁忌清单补上「开发机私有输入」与「开发库文件」，并把检查范围从 `.next/standalone` 扩到 `src-tauri/static`（后者更接近用户拿到的东西）。此前该脚本对着含 `.env` 的产物照样报「✓ 产物干净」——它自己文档里警示的「清单还在 ≠ 清单生效」的同类盲区，这次是检查清单漏项。
- `tests/dist-artifact-hygiene.test.ts`：把「产物卫生清单还在」「两处复用同一实现」「`pnpm build` 自身收尾就剥离」钉成可失败断言。
