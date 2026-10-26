## Fixed

**面板自用端点的过滤集合改从一处清单推：`GET /api/dev/build-id` 的回声行不再进时间线**（ISSUE #2417）。

- 当场读数（真机 dev 会话的转录 `log/current/nextjs/nextjs-panel-*.log`，同一份文件里三族并排）：
  `/api/logs/current` 7482 行、`/api/dev/server-id` 3036 行、**`/api/dev/build-id` 472 行** ——
  前两族被滤掉，第三族一行不少地留在面板里。它由代码更新检测每 30s 一拍、且
  `pauseWhenHidden: false`（页面切后台照打），而时间线**现在不设上限**，于是这是一条只增不减的累积，
  并且这些行读不到行内时刻、只能钳到解析当时，成批挤在同一毫秒里。
- 根因是**过滤判据手抄了一份端点名**：`isPanelSelfPollingLine` 的正则写死
  `logs/current|dev/server-id`，而端点族的第三个（`/api/dev/build-id`）是后来长出来的。
  与 ISSUE #2389 同形 —— 抄一份清单就是给下一次新增留一份会脱钩的副本。
- 修法：新增 `src/lib/log/panel-self-poll.ts` 作**唯一定义处**（`LOG_SLICE_ENDPOINT` /
  `SERVER_ID_ENDPOINT` / `BUILD_ID_ENDPOINT`，后者本就定义在
  `src/lib/shell/code-update-since-load.ts` 且被请求方使用，清单直接取它），
  两个请求方（`log-file-client.ts`、`use-dev-server-liveness.ts`）与过滤判据
  （`log-analysis.ts`）都从这份清单取 —— 「新增一个自用请求」与「过滤它的回声」成为同一处改动。
- 判据：`log-store.test.ts` 补正向断言（含转录里的**原样形状**：行首一个空格 +
  `200 in 255ms (next.js: …)` 的分段后缀），并保留 / 补强反向断言 ——
  `/api/trpc/*`、`POST /api/logs/app-runtime`、`/api/logs/history` 不滤，
  以及前缀相同的 `/api/logs/currentX` **不滤**：集合写宽会把真日志滤没，那比多几行回声坏得多。
- 同一条账顺带订正两处旧话：「轮询 **4 路**来源」⇒ 六路（`launcher` / `shell-launch` /
  `shell` / `dev` / `app` / `app-runtime`），一处在本函数的说明里、一处在用例的注释里。
