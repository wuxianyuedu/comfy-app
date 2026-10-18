## Added

- **生产构建改为定时任务：每天一次**（ISSUE #2010）。`.cnb.yml` 的 `master:` 下新增
  `"crontab: 0 4 * * *"` 事件（每天 04:00，平台时区 `Asia/Shanghai`），只跑一格
  「每日生产构建」，入口是新增的 `scripts/ci-daily-build.mjs`。
  - 它回答的是**另一个问题**：PR 那条流水线的「生产构建」答「这次改动能不能构建出来」，
    这一条答「**master 的 HEAD 今天能不能构建出来**」—— 空转的日子里 PR 侧一次都不会跑，
    而 `next build` 的结论并不只由源码决定（锁文件与 typedoc 对不上、上游 advisory、
    Playwright 下载根、节点上的 Python 解释器都会在某个早上变掉）。
  - `ci-daily-build.mjs` **不是新判据**：它就是 `artifact-run.mjs`（同一份 `pnpm run build`
    链、同一笔记账）外面一层只属于定时那一跑的壳 —— 打事件身份、打一次工具链镜像读数
    （`ci-image-identity.mjs`，读数、恒退 0）、把退出码原样转出去。判据一个字没重写。
  - 两份 stage 清单不合并：PR 那份是 `env.COMFYAPP_CI_GATES`，定时这份是新增的
    `env.COMFYAPP_CI_DAILY_GATES`（混成一份之后「谁在什么时候跑」就再也读不出来）。
- `tests/no-platform-ci-config.test.ts` 把这条流水线的四件事实钉成判据：事件键必须是带引号的
  `"crontab: <五段 cron>"`（写成映射 / `schedule:` 都不会报错、只是永不触发）、分支键必须是
  单一明确分支名（官方：定时任务不支持 glob）、频率必须是「每天 1 次」（分钟段与小时段单值）、
  那一格必须是跑法脚本而不是裸 `pnpm run build`、且带 `timeout` 预算。另加一组反向自检
  （坏形态必须被拦下），并新增 `crontabEvents()` / `registeredDailyGateOrder()` /
  `pipelineStageNames()` 三个解析器；锚点引用数从 2 改成 3（三条流水线各引用一次 `*common`）。

## Docs

- 规范 §13.5.23 写清「为什么要多这一条」（空转是最贵的失效形态、结论不只由源码决定、
  执行身份是配置持有者）与「它刻意不做什么」（不跑全套门禁、不记第二次账、不设法把账回写
  仓库）；`.cnb.yml` 的头注同步从「两条流水线」改成「三条流水线」。
