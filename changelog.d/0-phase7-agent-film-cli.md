## Added

- **`agent-film` CLI —— 一条命令把「剧本 → 成片」跑到底（Phase 7）**：给「让编码代理 / 人直接从一句话创意自主跑到成片」一个对外入口。`scripts/agent-film.mjs`（`pnpm agent:film`）对一个**跑起来的 App**（默认 `http://127.0.0.1:3000`，`--url` 可覆盖）经其 tRPC `run` 端点：`run.start`（默认 `--approval auto`、带上 `--image-workflow`/`--video-workflow`）发起服务端自主执行，再轮询 `run.status` 直到 `done`/`failed`/`awaiting_approval`/`paused`，逐步打印 `status + 下一步动作`，按结果给退出码。
  - 引擎在服务端 `advanceRunLoop`（#909）推进；CLI 只「发起 + 观察」，不在本机跑模型/ComfyUI（真产出由目标 App 承担）。
  - 纯逻辑（`parseArgs` / `validateArgs` / `buildStartCall` / `buildStatusCall` / superjson 解析 / `driveFilmRun` 轮询状态机）全部导出、可注入 `request`/`doSleep` 做**离线单测**（`tests/agent-film.test.ts`，12 例）；`--dry-run` 打印将要发出的请求、`--json` 输出终态快照。
  - 本地单用户模式（未登录）下 `authedProcedure` 回落到演示用户，故 CLI 直连本机 App 即可，无需 cookie。

## 说明

本轮按「先只建入口、离线验证」交付：CLI 的请求编码（superjson HTTP）、轮询状态机、参数与退出码都有单测；对**真·模型 + ComfyUI + 跑起来的 App** 的端到端实跑（含 `--dry-run` 之后的一次真 start→poll→done）需在环境就绪时验证一次。脚本沿用仓库 `@ts-nocheck` 约定（checkJs 对独立 CLI 不逐行标注）。
