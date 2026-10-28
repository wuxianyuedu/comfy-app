## Changed

ci: push 档扩成「树级校验档」，PR 档卸下文档链三格 + 工作区出处。

`.cnb.yml` 的 `master 合并复核`（push 档）此前只有「合并形态复核」一格（20~35 秒），
而 PR 档背着 33 格。本次按 L1/L2/L3 分层口径重排：

- **push 档扩成「树级校验档」**（新增 `COMFYAPP_CI_PUSH_GATES` 清单与 `.push-stages`
  锚点，判据双向核对）：`合并形态复核` → `安装依赖`（前提格，typedoc 要 node_modules）
  → `生成态文档与源同步` / `API 文档生成与自检` / `文档引用与权威源一致` /
  `工作区出处`。四格判的都是「合并后的树」一致不一致，不是「这次改动」——
  每次合并判一次就够，不必每个 PR 各判一遍。入口、旗标、`ifModify` 一字未改。
- **PR 档**（`COMFYAPP_CI_GATES`）摘掉这四个名字，`覆盖率上报` 刻意留守：
  它读同跑 `受影响用例` 产出的 coverage/lcov.info，push 档不跑测试，挪过去是
  「报告不在 → 自己跳过」的静默空转。
- **R6（push 锁 `cancel-in-progress: false`）不变**：成本上去之后终止销毁的结论更贵，
  这条反而更不能松。判据注释与规范 §13.5.3.10 同批订正（当年就写明扩格时先改这条）。
- 判据：`tests/no-platform-ci-config.test.ts` 新增 push 档「声明与事实双向核对」
  （清单 ↔ `master 合并复核` 流水线逐格相等）、前提格顺序约束（安装先于 typedoc）、
  以及 `覆盖率上报` 不许混入 push 清单的钉子。
