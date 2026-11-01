## Fixed

- **`check:toolchain` 的依赖下限采集失败不再被折成「在声明范围内」**（ISSUE #2722）：
  采集器（`collectDependencyFloors`）的五条 `ok:false` 话术（package.json 读不到 /
  没有依赖声明 / 依赖没装 / engines.node 缺失 / 形状读不懂）此前被消费端的
  `floors ?? []` 静默折掉 —— `kind:"unparsable"` 那条已写好的 WARN 对这一路
  **结构上不可达**，屏幕上照旧打 `[OK] Node … 在声明范围内`。
  现在：采集改用 `depsRoot`（`--deps-root` 的契约本来就是「只换依赖检查的根」，
  此前写死真仓 root 让用例永远测不到失败档）；采集失败 ⇒ 只念 WARN（带采集器的
  `reason`），**不进版本判定**——「没跑起来」不再被印成「在声明范围内」。
  退出码不变（这一档不是拦截项）。最常见命中：还没 `pnpm install` 就自查
  （硬规则 26 的场景）。回归：临时根（有 engines.node + 依赖声明、无 node_modules）
  ⇒ WARN 带 reason 且无 OK 行；对照（真仓）照旧 OK。
