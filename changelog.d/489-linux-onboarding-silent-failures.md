## Fixed

- **Linux / CI 首次上手链路的两个静默失败（ISSUE #489）**。两条都不是「Linux 跑不了」，
  而是「跑失败了却看不出失败」。

  **一、`pnpm test` 在无 `.env` 环境必挂（CI 的 `Test` 步骤一直红）**。
  `src/lib/db-schema-ready.test.ts` 的文件级 `beforeEach` 里把 `process.cwd()` mock 到临时
  目录——文件级钩子对本文件**所有** `describe` 都生效，而末尾「reaper 模块级副作用」那组要
  `import` 真实的 `~/server/db` → `~/env`，`env.js` 拿 `<cwd>/../.env` 探测配置文件，于是
  探测必然落空、抛 `MissingEnvFileError`，用例与它守护的「表就绪守卫」毫无关系地失败。
  本机有 `.env` 的人是绿的，CI 是裸 `pnpm run test`（不注入 `SKIP_ENV_VALIDATION`）所以每次
  必挂；而 `test:coverage` 走另一条链路，呈现成「Coverage 绿、Test 红」这种最容易被忽略的形态。
  另外实测**只补两个 `BETTER_AUTH_GITHUB_*` 变量并不够**（校验是「`.env` 文件存在性 + 必填项」
  两层）。修法：cwd 替身改为按 `describe` 建立、退出即还原；该组自己 `vi.stubEnv` 补齐
  `SKIP_ENV_VALIDATION` 与占位密钥，不去读开发者本机的 `.env`。

  **二、`pnpm db:push` 在无 TTY 环境「成功」了，但只有真实业务页面 500**。
  `drizzle-kit push` 需要交互确认时报 `Interactive prompts require a TTY terminal` 后
  **exit 0**，并把 `db.sqlite` 留成 **0 字节**（一张表都没建）。CI、脚本、远程会话、容器都是
  这个条件，而文档 §9.1 的第一步就写着 `pnpm db:push`。最误导的地方是 `/`、`/api/health`、
  `/settings` 全 200（`SELECT 1` 在空库上也成功），只有 `/api/logs/list` 报
  `SqliteError: no such table: user`——「只探首页会误判成完全通了」。
  修法：`pnpm db:push` 改走 `scripts/db-push.mjs`——以 `--force` 非交互运行（幂等），
  **复核库里到底有没有表**（刻意不看退出码：无 TTY 上正是「报错但 exit 0」），复核失败即
  非零退出 + 可行动提示。另加两道出口：`dev.mjs` / `start.mjs` 启动即探哨兵表并警告
  （**只警告不退出**，改纯前端的人不该被挡住），`GET /api/health` 一并探 schema 就绪度
  （空库 → 503 + `db: "empty"`，此前它会把「表没建」漏报成 `db: up`）。

  **三、顺带修掉一个同族的 CI 阻断（`pnpm build` 在 CI 上必挂）**。
  CI 的 Build 步骤只设 `SKIP_ENV_VALIDATION`、不注入 `DATABASE_URL`，于是 `env.DATABASE_URL`
  是 `undefined`，`src/server/db.ts::resolveDbPath` 里直接 `url.startsWith("file:")` 抛
  `Cannot read properties of undefined`；`db.ts` 被每条路由的模块图拉到，build 死在
  `Collecting page data`，报错行号落在 `/api/debug/source`、`/api/logs/history` 一类无关路由上。
  修法：`resolveDbPath` 先兜 `url || "./db.sqlite"`（`src/server/workshop/db.ts` 一直是这么写的，
  `src/server/db.ts` 漏了），缺值时退到与 drizzle-kit 同一锚点的默认库文件；该文件顺带转为
  **纯 ASCII**（它在构建期模块图上且实测会被 code frame 渲染，中文偏移会触发 Next 的
  Rust panic 把整个 build 带走，见规范 §5）。

  **门禁补齐**：CI 新增 `pnpm run db:push` 步骤（此前门禁**从不建库**，「跑起来的应用要有库」
  这条路径没有任何自动检查在验，缺陷二因此长期潜伏），`e2e/smoke.spec.ts` 新增 @critical 用例
  断言 `/api/health` 返回 `db: "up"`——现在它等价于「表真的建好了」。

  **反向验证**（确认不是「写了就绿」）：在 `HEAD` 干净检出上复跑，改前 `pnpm test` 报
  `MissingEnvFileError`、改后 205 个测试文件 2454 例全绿；把 `db:push` 改回裸 `drizzle-kit push`
  新用例即失败；把 `resolveDbPath` 的兜底去掉、或给 `src/server/db.ts` 加回中文，对应用例分别失败。

  另注：`pnpm test`/`pnpm build` 在**完全没有 `db.sqlite`** 时也能过（测试全部用隔离/临时库），
  所以 CI 绿了并不代表数据库路径被覆盖——那条路径现在由新增的 `db:push` 步骤 + 健康检查冒烟覆盖。
