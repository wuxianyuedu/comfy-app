## Fixed

- **`COMFY_EXECUTOR=host` 下 `pnpm start` 不起执行器宿主，任务永远到不了终态**
  （ISSUE #1767）。启动入口里 `dev-launcher.mjs`（编排 6.5 步）与
  `standalone-runtime.mjs`（桌包）都会按开关拉起 `scripts/executor-host.mjs`，
  而 `scripts/start.mjs` 与 `scripts/dev.mjs` 都没有这一步 —— host 模式下行被写成
  `claimedBy='host'`，而**只有宿主**会去领它（inline 那侧的回收器刻意不跨片误杀，
  ISSUE #1204），于是行安静留在 `QUEUED`、没有任何失败判决。
  - **现场量出来的形态**：Playwright 的 CI 档（`CI=1`）webServer 跑的就是
    `pnpm start`，本机 `.env` 写着 host 的开发者因此看到
    `e2e/main-journey.spec.ts` 两条 `@critical` 用例**各超时 60s、各带 2 次重试全红**，
    而报错话术在说「任务没有到终态：出图这一跳断了（下游替身没应答，或执行器收口失败）」
    —— 真因在另一个进程里，按话术去查替身会一路查空。本机实测复现：
    `.env` 加 `COMFY_EXECUTOR=host` 后两条用例 1 分钟超时全红、库里 6 行
    `QUEUED/claimedBy='host'` 无人领取；补上这一步后同一轮全绿。
  - 「拉起宿主」的判据与落点收进 `scripts/launcher-core/executor-host-spawn.mjs`
    一份实现（§12.18 / §12.12）：`dev-launcher.mjs` 的那段自带逻辑换成薄包装，
    `scripts/start.mjs` 接上同一次调用，并排在起 Next 之前（宿主 boot 的行与 Next
    的启动行在时间上可比）。归一化后的开关值仍**显式**回写进子进程 env（ADR §14 D5）。
  - 判据 `tests/executor-host-spawn.test.ts`：判决三分支（host / inline / 认不出的值）、
    入口缺件时**不退回 inline** 并把后果说清、起进程时 args 与 env 的形状，
    以及「三个入口都接线」的源码级断言（把 `start.mjs` 那一步删掉即红 —— 已反向验证）。

- **假 comfy-cli 的解释器入口是 `.sh` shim，Windows 上 Node 起不了**
  （ISSUE #1767 的同批第二处）。`playwright.config.ts` 此前把 `COMFY_CLI_PYTHON`
  指向 `e2e/support/fake-comfyui/python.sh`（内容是 `PYTHONPATH=… exec python3 "$@"`），
  而本应用把它当**解释器路径**直接 spawn：Linux / macOS 上内核认 shebang 能跑，
  **Windows 上必然起不来**（Node 的 `spawn` 走 CreateProcess，只执行 `.exe` 与经
  cmd.exe 的 `.cmd` / `.bat`；判据见 `src/lib/process/executable-resolve.ts` 文件头，
  硬规则 12 也据此禁 `.bat` / `.cmd`）—— 两条主链路用例在 Windows 开发机上因此必红。
  - 修法取向是**不 shim 解释器**：shim 存在的唯一理由是给子进程带 `PYTHONPATH`，
    而它本来就是环境变量 —— 于是改由 `e2e/support/fake-comfyui-executor-env.mjs`
    一次拼出「按平台探测出来的真解释器（Windows 先 `python`/`py`、POSIX 先 `python3`）
    + `PYTHONPATH` 前缀（不覆盖别人设过的）」，两个平台走同一条路径，
    `python.sh` 随之删除。
  - 判据 `tests/e2e-fake-comfyui-executor-env.test.ts`：候选顺序按平台、
    两种「给不出来」的分岔都给空 env + `reason` 而不抛、`PYTHONPATH` 是前缀不是覆盖，
    以及「替身目录下不再有 `.sh` / `.ps1` / `.cmd` / `.bat` 形态的入口」。
