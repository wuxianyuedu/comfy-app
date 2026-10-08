## Fixed

- **测试层的裸 `sleep` 有了执行者，并把存量收口到 0 处**（ISSUE #1498）。§11.14 早就把
  `await new Promise(r => setTimeout(r, N))` 定为第一层反模式，执行者写的是「新增时由
  review 拦下、存量按节奏收口」—— 实测这句话两头都落空：上一轮清掉的 6 个文件是**抽样**、
  口径没有钉住（同一件事在两次盘点里从 20 处变成 38 处），而
  `grep -c test-sleep .githooks/pre-commit` 一直是 0、CI 又随 ISSUE #623 删除 ——
  「review 拦下」是唯一执行者，而 review 是人、人会漏。
  - 新增 `scripts/check-test-sleep.cjs`（接进 pre-commit 的 D 组，棘轮基线
    `scripts/.test-sleep-baseline.json` **只许降**；`--update` 拒绝把数字往上涨），
    并把它作为判定型判据登记进 `check-gate-executors.cjs` 的盘点面。
  - **真该收口的 12 处全部改完，实测 0 处**：6 处手搓 `while + await setTimeout` 轮询
    改成 `expect.poll`（`executor-host` / `cross-platform-launcher` 的 `waitUntil`、
    `kill-process-tree.windows` 的 `readArgs`、`capture-streams.server` 的
    `readCaptureWhenFilled`），6 处「睡一拍再断状态」改成等真条件（`lifecycle` 的
    `starting` 落位、`use-custom-nodes-settings` 的收尾链）。
  - **四类正当形态**逐站点声明 `sleep-ok`（17 处）：mock 内部延迟（拿「慢」暴露并发 /
    抢跑语义）、等一个「不会发生的事」（断言「一直没有发生」，轮询表达不了）、
    必须真挂钟（时间戳差 / 防抖窗口 / pino 整异步落盘）。`setTimeout(…, 0)` 不算站点 ——
    它等的是宏任务排空、没有预算可赌，由**判据自己认出来**而不是让 7 处各写一条声明
    （纯噪音会把「所有站点都得声明」变成一句空话）。

## Docs

- 规范 §11.14 新增两节：**§11.14.1** 存量收口有执行者（判什么 / 四类豁免怎么登记 /
  三条口径细节）、**§11.14.2 门禁夹具不进收口面**（把上一轮为 `tw4-canonical` 单独
  解释过一次的口径立成通用规则：判据自己的夹具是量具，不是存量，不许为过门禁去改它）。
  §11.14 开头那句「新增时由 review 拦下」改为指向判据。§13.1 自查清单补上这一步。

## Tests

- `tests/test-sleep-gate.test.ts`（13 条，进 `FIXED_STRUCTURAL_TESTS`）：跑真脚本、
  只放被测文件的临时仓库，逐条钉判定口径 —— 该拦的（赌时间 / 空声明 / 棘轮上涨 /
  `--update` 放水 / 变量延时 / 零参箭头 helper）与该放的（`setTimeout(…, 0)` /
  声明豁免 / 折行站点 / 夹具字符串 / 带参箭头回调 / 没被 await 的 Promise /
  声明跨过调用开头 / 声明作用半径 / 棘轮收口提示）。
- 收口的 12 处所在文件的既有用例全绿（含 `--no-file-parallelism` 串行重跑核过）。
