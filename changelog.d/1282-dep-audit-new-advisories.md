## Fixed

- 依赖审计棘轮在 `pnpm check:all` 上转红（基线外新增 3 条 high/critical advisory）：按
  `pnpm-workspace.yaml` overrides 把 `proxy-addr` 2.0.7→2.0.8、`source-map-js` 1.2.1→1.2.2、
  `sharp` 0.35.4→0.35.5 顶到最小可达修复版（全是同 major 补丁版、全是传递依赖）。
  三条都走出路 ① 「能修的先修」，没有登记进 `scripts/.dependency-audit-baseline.json`
  —— 那份台账是给「上游没有修复版」用的，「有修复版却登记」是棘轮的后门。
