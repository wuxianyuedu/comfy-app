## Fixed

- **Linux / macOS 首次上手：照文档走完 `.env` 引导仍然起不来（ISSUE #489）**。
  两层叠加，且**失败的时机与提示都在误导**。

  **一、文档第一步 `cp .env.example .env` 本身就产出一个起不来的 `.env`。**
  `.env.example` 里 `BETTER_AUTH_SECRET` 与两个 `BETTER_AUTH_GITHUB_*` 就是**空串**，
  而 `src/env.js` 的 createEnv 配了 `emptyStringAsUndefined: true` —— 空串等价于
  「没给」，于是照文档 cp 出来的人拿到的是 `Invalid environment variables`，看不出是
  「值留空」。Windows 侧一直有 `scripts/prepare-local-run.ps1` 的第 4 步自动补齐
  （随机密钥 + OAuth 占位值），**Linux / macOS 没有任何等价物**；而规范 §9 的
  Web-only 模式明确不依赖任何 `.ps1`，等于这条链路上少了同一个能力。

  **二、失败发生在 Next 已经打印「✓ Ready」之后。**
  `src/env.js` 的校验在 Next 加载 `next.config.js` 阶段，而 Next 会先输出
  `- Local: http://localhost:<port>` 与 `✓ Ready in 77ms`，**之后**才抛
  `Failed to load next.config.js`。用户读到的是「起来了但报错」，真相是端口无人监听。
  更糟的是缺文件那条错误里的小贴士指向「双击 `tools/start/run-local.ps1`」——
  Windows 专属入口，Linux / macOS / CI 上并不存在。

  修法：新增 `scripts/env-init.mjs`（`pnpm env:init`）与 `scripts/env-preflight.mjs`。
  `env:init` 与 `.ps1` 第 4 步同口径（`BETTER_AUTH_SECRET` 用 64 位随机 hex、OAuth 两项填
  本地占位值，其余行原样保留），幂等、已存在则不覆盖；`env-preflight` 被 `dev.mjs` /
  `start.mjs` 共用，**在起 Next 之前**判「文件在 + 三项非空」，未就绪即打印可行动作并
  非零退出——从此不会再出现「先 ✓ Ready 再崩」。`src/env.js` 的缺文件提示也改为
  `pnpm env:init`，不再夹带任何 `.ps1` 入口。

  实测（本机 Linux，同一份检出）：`pnpm env:init` → `pnpm db:push` → `pnpm start`，
  `/`、`/settings`、`/api/health`、`/api/logs/list` 全 200；
  缺 `.env` 与「`cp` 出来的空值 `.env`」两种情形都在起 Next 之前被拦下。

  回归测试见 `tests/linux-env-bootstrap.test.ts`（**真跑** `env-init.mjs` 与 `dev.mjs`，
  不 mock fs）。反向验证：把入口脚本的预检去掉 → 「不打印 Ready 行」用例失败；
  把 `.env` 生成改回「只 cp」→ 「生成物能过预检」用例失败。
