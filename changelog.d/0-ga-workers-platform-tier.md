## Changed

**vitest 并发按平台分档：GA 独享 runner 走 `ceil(cores/2)`（4 核 ⇒ 2），CNB 共享宿主机保持 `ceil(cores/8)` 逐字不变**

GA 适配清单 G-1。只动并发，**用例、预算、覆盖率阈值一个字不动**。

- 依据：`CORES_PER_WORKER=8` 的原文理由是「共享宿主机上单条流水线别把整台机占满，只承诺峰值占用减半」（#2317，代价叙述由 #2320 订正）。GA 托管 runner 每个 job 独享一台 4 核 VM，照抄 8 得到 `ceil(4/8)=1`，等于三核空转
- 实现：`scripts/ci-load.mjs` 新增 `GA_CORES_PER_WORKER=2` 与 `platformCpusPerWorker()`；`resolveCiWorkers()` 在 `GITHUB_ACTIONS==="true"` 时用 GA 档，缺省一律按原档（本地与 CNB 行为不变）；`COMFY_CI_MAX_WORKERS` 覆盖出口优先级不变
- 用例：`tests/ci-load.test.ts` 增加 GA 档断言，CNB 的 `CORES_PER_WORKER=8`、16⇒2、8⇒1、12⇒2 逐字保留；另加「同一核数两档给出不同答案」与「缺省 / 非 `true` 仍按 CNB 档」
- **4 worker 不升默认**：GA 「4 vCPU / 16GB」只是口径，本仓无内存读数；1 / 2 / 4 三臂取数计划与判据写进 G-1，没有读数不升档
- 规范 §13.5.21 同批补了「平台分档」一段；`pr-gate.yml` / `daily.yml` 的环境注释同步（只改注释，值仍是 `${{ vars.COMFY_CI_MAX_WORKERS }}`）
