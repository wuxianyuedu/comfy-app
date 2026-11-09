## Changed

- **oxlint 启用原生 `vitest` 插件「建议开」那批 15 条**（issue #3180，台账 §六）：
  `valid-expect` **必须配 `{ maxArgs: 2 }`**（默认只认 1 参会把合法双参断言成片误报，审计读数
  555 处 / 137 份——这是口径问题不是存量问题），另有 `no-conditional-expect` / `no-conditional-tests` /
  `no-duplicate-hooks` / `no-focused-tests` / `no-identical-title` / `no-alias-methods` /
  `consistent-vitest-vi` / `valid-expect-in-promise` / `no-test-return-statement` /
  `require-awaited-expect-poll` / `no-mocks-import` / `no-interpolation-in-snapshots` /
  `no-import-node-test`（后七条 0 命中，直接受判防新债）。评估尺 `oxlint.config.ts` 同批同步。
  相较最初建议的**两处调整**（均有实测证据）：`no-disabled-tests`（3/3 命中全是 `it.skipIf`
  工厂创建的误报；三元式 `it.skip` 反而漏判）与 `valid-title`（4/4 全是成员访问 / 模板字面量
  标题，微样本实证整类拒绝、无 options 放行）移入不开清单。
  **存量 120 处清零**：`no-conditional-expect` 107 处按四种形态逐条改写——①平台/档位分支收进
  期望值（`toBe(条件)` / 期望值三元）；②先断言前置再判的死守卫改 `throw` 守卫（类型收窄保留、
  断言无条件跑）；③数据分型 if/else 拆「filter + 双循环 / 双测」并补非空守卫；④可缺席值收进
  合取式不变式。小存量 13 处同批清零：`valid-expect` 5 处改「先挂 no-op 拒绝处理器、推进定时器后
  await」（unhandled-rejection 防线）；`no-duplicate-hooks` 3 处合并钩子；`no-conditional-tests`
  2 处转逐行理由（vitest 5 签名分叉 + 预算登记约束，条件建测是 `itRatchet` 包装的本职）；
  `no-identical-title` 1 处改题（同 describe 两支判据）；`no-alias-methods` 1 处 `toThrowError`→
  `toThrow`；`consistent-vitest-vi` 1 处局部变量改名（`vitest` → `vitestRun`，不再撞规则名）。
