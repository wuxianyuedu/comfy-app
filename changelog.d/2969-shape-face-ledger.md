## Changed

**stripComments 的副本台账从「只认函数名」扩到「名字 ∪ 形状」两串并扫**（ISSUE #2969）：
此前 13 份内联链式副本（`replaceAll(/\/\*[\s\S]*?\*\//g, "")` 那一型）不写
`function stripComments(`，名字面完全看不见；其中 `tests/helpers/quality-gate-gates.ts`
还是无行首锚的 NAIVE 形状（同一行引号之后的裸调会被整截吃掉）。

- 存量副本收敛：10 份等价的换成 `./helpers/strip-comments`（见本分支的历史提交），
  余下 `tests/helpers/quality-gate-gates.ts`、`tests/dev-launcher-toolchain-gate.test.ts`、
  `tests/reduced-motion-tiers.test.ts` 三份也一并换走 —— 其中 quality-gate-gates 那份
  NAIVE 双漏（`http://…` 被截断、字符串里的 `/*` 吃掉后文真代码）随之消失。
- 台账扩面：新增形状串 `SHAPE_MARK`（块注释剥除正则的尾巴）与 `SHAPE_LEDGER`；
  「名字面无定义的形状副本」一律要在台账或 SHAPE_LEDGER 里，否则红；已换走却还挂着的
  反向也会红（表要能记账）。NAIVE 那一型改为在**判决面（名字 ∪ 形状）**上扫，
  堵住「两根串都点不到」的双漏。
- 形状串自带前提格：台账里至少有一份现存副本必须命中该串，串失效时这一格直接红，
  不会空转成恒真。
