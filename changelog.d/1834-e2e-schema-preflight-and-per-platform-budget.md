## Fixed

- **e2e 开跑前多一道 schema 预检：库结构带「会丢数据」的未应用变更时，先告诉人跑
  `pnpm db:push`，而不是跑 8 分钟红一片**（ISSUE #1834 收尾翻出来的现场）。现场形态：
  本机 dev 库落后当前 schema 几个版本，待执行批次里含 `DROP TABLE loraTrainingJob`
  —— 启动链路**按设计**不自动执行这批（丢数据的决定归人，`db-schema-state.mjs`），
  于是 `pnpm dev` 带着一张缺 6 列的 `task` 表跑完全程，`queue-status.server.ts` 的
  查询 500，**queue-monitor 四条 + main-journey 两条稳定红**，报错话术全在说
  「元素没出现」—— 红指向错的地方，下一个人照着断言查产品代码，查到的是空气。
  `scripts/e2e-run.mjs` 新增 `checkSchemaBeforeRun()`（取证：读指纹，不一致时
  dry-run 一次 drizzle，永远不写库）+ `schemaPreflightDecision()`（纯判词，四条
  分岔全钉进 `tests/e2e-run.test.ts`）：指纹一致 / 无待执行语句 / 全是安全语句
  ⇒ 放行；**含丢数据语句 ⇒ 阻断**并逐条列出 + 给出 `pnpm db:push` 出口。
- **「真跑一次」不再依赖宿主 shell 的 `PYTHONPATH` 干净**：CodeBuddy 宿主的
  agent shell 把 `PYTHONPATH` 设成了自己的 `vendor\shim`，而
  `fakeExecutorEnv()` 按**前缀语义**拼进结果，于是
  `tests/e2e-fake-comfyui-executor-env.test.ts` 的「在本机真跑一次」断言
  「精确等于替身目录」在该宿主上必红（红在「宿主机被压满」，不在判据上）。
  该用例改为注入一份只摘掉 `PYTHONPATH` 的 env（PATH 必须留着 —— 解释器是真从
  PATH 上解析的，那正是「真跑一次」的意思）；前缀语义本身另有纯断言守着。

## Changed

- **页面级运行时读数的基线按平台各自一份**（ISSUE #1834 收尾的 win32 读数）：
  win32 与 posix 的稳态读数差 **2.2×**（`/workspace`：715.5ms vs 320ms，win32 侧
  三次独立运行同值：两遍全量 e2e + 一遍单 worker 独跑）。共用一个基线的下场是
  两种宿主二选一恒红 —— 与 ISSUE #1767「两个平台同一条形状」同一条理由：判据必须
  在它跑得到的那种宿主上自证。`scripts/.runtime-budget-baseline.json` 改出
  `metric.byPlatform`（posix 320/250、win32 716/344），`e2e/runtime-budget.spec.ts`
  按 `process.platform` 读各自档，倍数（×2）两平台相同；同源判据
  （`tests/e2e-runtime-budget.test.ts`）随之覆盖两个平台。darwin 未实测落 posix 档，
  真红了按 §13.5.4 例外流程补录，别去动别的平台的数。
