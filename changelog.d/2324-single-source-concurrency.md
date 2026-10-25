## Changed

**「这一跑开几个并发」从三份副本收成一处**（ISSUE #2324）。#2317 那一档当时只压住了平台的
两格，而本地那一跳照旧铺开 —— 因为同一个判断在三处各有一份数字：

| 出处（改前） | 值 | 谁吃它 |
| --- | --- | --- |
| `vitest.config.ts` `maxWorkers: 8` | 8（字面） | 所有**没带 `--maxWorkers`** 的 vitest：`pnpm test`、`run-tests.mjs`、`quality-gate.mjs` 的 `["exec","vitest","run","--coverage"]`（= `pnpm check:all` 那一跳） |
| `run-affected-tests.mjs` `DEFAULT_MAX_WORKERS = 4` | 4（字面） | 钩子档没给 / 给错 `COMFY_PRECOMMIT_MAX_WORKERS` 时那一支 |
| `ci-load.mjs` `CORES_PER_WORKER = 8` | 16 核 ⇒ 2 | `ci-affected-tests.mjs`（PR `受影响用例`）、`full-suite-run.mjs`（每日 `单元测试`） |

- `vitest.config.ts` 的根 `maxWorkers` 改成 `resolveCiWorkers().workers` ⇒ **本地那一跳
  与平台同一档**（16 核 ⇒ 2）。临时要快跑：`COMFY_CI_MAX_WORKERS=8 pnpm test`（一处旋钮管全部）。
- `run-affected-tests.mjs` 的 `DEFAULT_MAX_WORKERS` **撤掉**：兜底并发改由调用点注入
  （`resolveMaxWorkers(raw, resolveCiWorkers().workers)`），函数保持纯（既不读 env 也不读核数），
  而**漏传兜底直接 `throw`** —— 静默退回某个数字正是这次要收掉的那一族；
  `runChunk` 的默认档同样从 `ci-load` 推导，本地那份常数一并消失。
- 同批处理两处耦合，不留悬空引用：`.gate-thresholds.json` 去掉 `DEFAULT_MAX_WORKERS` 那一条
  （31 条，地板 `MIN_ENTRIES = 15` 不受影响；账与源码必须同批，否则判据自己报「找不到该常量声明」）；
  `tests/test-config-inheritance.test.ts` 的 `SHARED_EXPECTATIONS.maxWorkers` 从字面 8 改成
  推导值（谁把配置改回常数，两处不相等就红 —— 抓漂移的能力还在，只是不再钉机器相关的数字）。
- 用例侧：`tests/hook-affected-launch.test.ts` 那五处改成**显式传兜底**（机器无关），
  并新增一格「漏传兜底必须停手」；档位数字只在 `tests/ci-load.test.ts` 一处逐字钉。
- 规范：§13.5.21 写明三个消费点同出一处；§13.5.3.8 与 §11.13 里那些 `4 / 8` 的表格
  **按原样保留当账本**（它们是当时机器形态与负载条件的读数），只在标题处标注「非现状」。
