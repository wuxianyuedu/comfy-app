## Fixed

- **收回「`outputFileTracingExcludes` 是这条口子的真正防线」那句 overclaim**
  （规范 launch-and-build §7.2 第三件事、`tests/turbopack-tracing-excludes.test.ts`
  文件头、`next.config.js` 的块注释）：真去数产物之后，实测这份清单里声明过的**整目录**
  条目一条都不减 —— `./changelog.d/**` 对应 747 个真文件、`./src/**/*.test.ts(x)` 对应
  406 个、`./src-tauri/**` 对应 4553 个（那是一份上一轮组装的 `static` 被重新 trace 进
  standalone，会随每次打包自我复制）。单文件条目（`./db.sqlite`）实测有效。
  **减法只在产物层发生**，所以判据必须数产物、清单只当意图声明读。
- **同一条通道的第三类泄漏补上减法**：`scripts/standalone-private-inputs.mjs` 的
  `DEV_ARTIFACTS` 登记 `changelog.d`，并新增**按形状递归**的剔除
  （`FORBIDDEN_SHAPES` 三类 + `PRIVATE_SHAPES` 两类），因为这几类不在产物根：
  `src-tauri/static/src/` 里也有一份测试文件、`node_modules/<pkg>/docs/` 里的文档要等
  `build-desktop` 的 `dereference: true` 才变成真文件（实测 `static` 层 472 份 `.md`）、
  开发库也实测出现在 `prisma/db.sqlite` 这种子目录位置 —— 判据早就写了「绝不能出现」，
  减法一直够不着。`pnpm build` 收尾与 `build-desktop` 各剥一次，两处复用同一实现。
- **产物计数与剔除都不许穿符号链接**（`check-standalone-contents.cjs` 与本文件的
  探针与剔除同改）：`.next/standalone/node_modules/<pkg>` 是指向本仓库 pnpm store 的
  链接，顺链接**数**会把开发机内容记成产物内容（「`pino` 一个包漏 484 份文档」就是这么
  出来的假账，产物里根本没有这些真文件），顺链接**删**会直接损坏开发机依赖。
  唯一例外是反向检查（Next 自带运行时脚本「必须有的」）按**可达**口径算 ——
  用真文件口径会把 `node_modules/next` 后面的运行时脚本判成缺件（假红）。
- **收回我上一轮往 `next.config.js` 加的 `./node_modules/**/docs/**`**：实测无效，
  且它的注释正踩着上面那条「别只加 excludes 就当修好」。

## Added

- `tests/dist-artifact-hygiene.test.ts` 的 `it()` **15 → 20**：形状剔除在临时目录里**真删一次**
  （命中的删掉、`src/lib/real.ts` 与运行时脚本、`docs/` 里的非 `.md` 一个都不碰）、
  被掏空的 `docs` 目录收掉而还有内容的留着、**造一个指向外部目录的链接**断言剔除后外部
  内容原样存在（这条是安全判据，不是清洁度判据）、`stripDevArtifacts` 也挂上了形状剔除、
  以及剔除侧五行形状与检查侧 `FORBIDDEN` **逐字同源**。
- 两份清单的比对改成**真 require**：`check-standalone-contents.cjs` 尾部的
  `process.exit(main())` 加了 `require.main === module` 守卫并导出
  `FORBIDDEN` / `ALLOWED_SCRIPTS` / `REQUIRED_RUNTIME_FILES` / `collectFiles`。
  前一版用正则从源码里「抠」出对方那条正则，实测被 `[^/]` 这种「字符类里的斜杠」
  切成半条（`SyntaxError: Unterminated character class`），而按行匹配又会被 prettier
  的折行判红 —— 拿到 RegExp 本体、比 `.source`，才是逐字比对。

## 存量与验证

- 存量按「先数清再清零」的口径实测：剔除前 standalone 真文件违规 = 测试文件 406 +
  变更碎片 747 + 子目录开发库 1，文档类真文件 0（484 那份是穿链接数的假账）；
  `static` 层文档类真文件 472 + 测试文件 24。
- 全新 `pnpm build` 后 `node scripts/check-standalone-contents.cjs` 报
  `[standalone] ✓ 产物干净`，同时 `app-route-turbo` / `app-page-turbo` / `pages-turbo`
  三份运行时脚本仍可达（减法没把必须有的删掉）。
- **对真数据的 static 层复核**（`.next/standalone` 里那 472 份文档在链接背后、删不到，
  必须看解引用之后的那份）：把本机 `src-tauri/static` 整份拷进临时目录跑
  `stripDevArtifacts`，形状命中 **498 个**（文档目录 472 / 测试文件 24 /
  `.env` 1 / 子目录开发库 1）→ 剔除后 **0**，而 `server.js`、三份
  `next-server/*runtime.prod.js`、12615 个 `node_modules` 文件全部保住。
  副本测毕删除，未改动本机 `src-tauri/static`。
- 端到端复核（§7.4 那个「页面正常、接口全 500」的反例形状必须亲自跑）：把被删掉的
  `.env` / `.next/static` 临时补回产物目录起 `server.js`，`/`、`/login`、
  `/api/health`、`/api/dev/build-id`、`/api/logs/current` 全 **200**，日志里
  `Failed to load external module` **0 条**；测毕回收整棵进程树并把补回去的
  `.env` / `db.sqlite*` 再剥一次。
- **仍红且不属于本轮**：`check-standalone-contents.cjs` 的 `[static]` 那组报的是本机
  一份陈旧 `src-tauri/static` 组装（缺 `.env` / 各 `*.config.*` / 14 个门禁脚本 /
  472 份文档），它是未跟踪的本地构建产物、不在 pre-commit 与 `check:all` 的链路里；
  下一次 `build-desktop` 会走同一份实现清掉。本轮不改 `build-desktop` 的组装语义。
