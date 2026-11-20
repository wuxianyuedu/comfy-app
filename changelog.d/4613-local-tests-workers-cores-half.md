## Changed

**本地全量测试默认并发从 `cores/8` 放宽到 `cores/2`**（ISSUE #4613）。共享 CI 节点
「给邻居留一半余量」的那一档（16 核 ⇒ 2 worker）此前同样落在独占开发机上，449+ 文件
全量墙钟明显偏长，而快跑出口 `COMFY_CI_MAX_WORKERS=8` 藏在配置注释里，多数人不知道。

- `scripts/ci/ci-load.mjs` 新增本地档 `LOCAL_CORES_PER_WORKER = 2` 与 `isCiEnvironment()`
  （`CNB_CPUS` / `GITHUB_ACTIONS` / `CI` 三者都缺席 ⇒ 本地开发机；`CI` 显式写 `false`/`0`
  按关掉算）：本地默认按 `cores/2` 铺开，16 核 ⇒ 8 worker。CNB 共享宿主机（8）与
  GA 独享（2）两档一个不改。
- `vitest.config.ts` 把并发档打进输出：本地默认跑测试打一行
  `[vitest] 本地并发档 --maxWorkers=N（<核数> 核 ÷2；要压并发设 COMFY_CI_MAX_WORKERS=<n>…）`，
  覆盖 / 坏值照旧念 `resolveCiWorkers()` 的 note —— 旋钮不再藏在注释里。CI 侧输出不变。
- CI 行为逐字不变：CNB（`CNB_CPUS` 在场）仍 `ceil(cores/8)`，GA（`GITHUB_ACTIONS=true`）
  仍 `ceil(cores/2)`；`COMFY_CI_MAX_WORKERS` 覆盖出口的优先级与口径不变。
- 用例：`tests/ci-load.test.ts` 新增本地档一组（档位逐字钉死、`isCiEnvironment` 三变量
  判据、`platformCpusPerWorker` 分档表、本地默认 == 公式值）；规范 §13.5.21 同批更新。
