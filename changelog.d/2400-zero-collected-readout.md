## Fixed

- **「跑了但一条用例都没收集到」不再与真绿同形**（ISSUE #2400）：`base-check` 的
  `judge()` 对退出码 0 但输出带「一条用例都没收集到」指纹的行落 `inconclusive`
  （指纹与 127 / 退 1 那两形共用同一份）—— 此前 `summarizeRows` 只看退出码，
  「段绿 + 逐条里混着一条没判的」在 premerge 那一跳放行，与这一族自己
  「拿不到测量 ≠ 测量是绿的」的口径相反。
- **`pnpm test:file` 的 `-t` 零命中有了独立读数**：带名称过滤的一跑与 junit 配对
  （default reporter 保留实时输出），执行 0 条 ⇒ 打「一条都没命中 —— 那不是
  『跑过且绿』」并退 2（与「未校验」同码）；命中时念「执行 N 条」。
  顺带补上 `run-tests.mjs` 缺失的「被 import 不执行」守卫 —— 此前测试 import 它
  会在 vitest worker 里再起一轮嵌套的全量 vitest（本次开发中真撞上）。
  自己带 `--reporter` / `--outputFile` 的调用不改写（读数降级为没有，不冒充）。
