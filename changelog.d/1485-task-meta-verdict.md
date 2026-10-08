## Changed

- **`ctx.task.meta`：量完决定不铺开，把「怎么用才对」变成判据**（ISSUE #1485 的最后一条）。它是 vitest 5 盘点里**唯一**能从 CLI 那侧读到的通道 —— 实测 `--reporter=default --reporter=json --outputFile=…` 下自定义键**原样落进**报告（`{"tier":"artifact"}`）、**绿的用例也带**（`annotate` 只有失败时才可见，§11.21.1 ③）、人读的 text 输出照旧。对照 `annotate`：`--reporter=json` 里一个字都没有，唯一读数通道是 programmatic API，与门禁链的 CLI spawn 天然不兼容。
  - 但它的可见性也是**隐式**的：门禁链跑 vitest 的参数是 `node <入口> run --maxWorkers=4 <files…>`，**没有** `--reporter=json`、没有 `--outputFile` —— 写了 `ctx.task.meta.x = …` 而没人带那两个参数去跑，那些数据落进**空气**，一个字都不会被看见，而表面上代码写得像「已经登记了」（§11.13.1 / §11.18.3.1 / §11.21.3 同族）。
  - 新增判据 `scripts/check-task-meta-consumer.cjs`（pre-commit D 组）：**有站点就必须登记消费方**（`scripts/.task-meta-consumers.json`）。零站点是本仓库当前状态（纯闸门）。站点认的是 **`task.meta` 这条属性链**而不是裸 `meta` —— 本仓库另有大量 `<meta>` / `meta.name` / `{ meta: … }` 的写法，放宽会误报一片，而**误报的判据活不过一次评审**；这条由门禁自测里那格「无关的 meta 用法不算站点」钉住（变异核验时正是它把放宽后的版本打红的）。判据自己不许静默降级（台账解析不了 / `consumers` 不是数组 → 判失败）。
  - 门禁自测 `tests/task-meta-consumer-gate.test.ts` 进 C 组固定清单，跑真脚本、九条口径各一条执行者；变异核过三条：站点正则放宽成裸 `meta` → **误报那条红**；窄化成行内字面量 → 折行那条红；取消字符串/注释挖空 → 夹具那条红。
  - 规范 11 新增 **§11.22**（实测表 / 隐式可见性 / 什么时候该用 / 判据与三条变异 / §11.22.5 四条「不做」——其中「不替代 `conditional-skip-registry`」是分工而非取舍：那一套管**静态声明**、`task.meta` 管**运行期事实**，叠成一层会变成两个真相来源，§12.18）；§13.1 手跑清单同步。
