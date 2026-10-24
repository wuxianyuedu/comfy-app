## Changed

**单条 CI 流水线的 CPU 占用降一档：并发从「一个 worker 至少 4 核」改成「至少 8 核」**（ISSUE #2317）。

- `scripts/ci-load.mjs` 的 `CORES_PER_WORKER` 4 → 8 ⇒ 16 逻辑核的节点上
  `受影响用例` / `每日单元测试` / `每日生产构建` 那几档的 `--maxWorkers` 从 **4 降到 2**。
  当场依据：`受影响用例` 一格占整条流水线 37 格合计格时的**七成**（1187s / 1660s），
  且同一格里首跑以负载形态假红（`Test Files 3 failed` ⇒ 隔离复跑 `95 passed`，
  两条用例各自 106s / 61s）。**代价是该格时长大约翻倍 —— 这是要换的东西，不是回归。**
- **判据一个字没动**：用例、`testTimeout` 预算、覆盖率阈值全部不放宽；降负载的防线仍在
  `run-affected-tests.mjs` 的 `--no-file-parallelism` 隔离复跑。人的出口
  `COMFY_CI_MAX_WORKERS` 照旧（要再压到 1 就压）。
- 档位不再被恒等式放过：`tests/ci-load.test.ts` 那条原写
  `toBe(16 / CORES_PER_WORKER)`（改常数它都绿），现在逐字钉 `CORES_PER_WORKER === 8`
  与 `workersForCores(16) === 2`（另加 8 核 ⇒ 1、12 核 ⇒ 2 两档）。
- 并发读数现在**在收尾也念一次**：`ci-affected-tests.mjs` 开头那行会被平台的
  102400 上限截掉（实测某跑日志第 2 行就是那句），收尾复述带
  `--maxWorkers / 核数 / 来源 / 子进程原值退出码`，两件通道改为可注入（`writeOut` / `writeErr`）。
- 规范同步：§13.5.21 补「为什么抬档」与三条边界；`docs/generated/**` 镜像同批重生成。
