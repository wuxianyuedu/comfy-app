## Fixed

- **契约测试那一族的 mock 边界收成一处实现体**（ISSUE #2173）：`tests/helpers/wire-mock-boundary.ts`
  新增五件替身工厂（内存库 / 会话 / 日志静音 / 里程碑日志改写临时路径 / 派发续跑），
  五份文件各留一行 `vi.mock(...)` 声明 —— `tests/task-list-wire-contract`、
  `tests/task-detail-images-wire-contract`、`tests/generate-input-wire-contract`、
  `tests/remote-model-entry-wire-contract`、`src/server/api/routers/generate.test.ts`。
  因果不是"忘了抽"：`vi.mock` 的**声明**必须留在每个测试文件顶层（被 hoist 到 import 之前），
  所以一开始看着"没法共用"；能共用的是**工厂体**。实测两条形状边界：
  工厂里**只能 dynamic import** 那个 helper（静态 import 的绑定在 hoist 时机上是 TDZ，
  当场复现 `Cannot access '__vi_import_7__' before initialization`）；而里程碑日志那份
  `vi.hoisted` 临时路径**可以整段撤掉** —— 路径落在工厂里算，求值时机本来就在被测模块之前，
  于是两份文件各少一块样板（省下的是那一整块，不只是"看起来更干净"）。
  顺带收掉的一处真实漂移：`remote-model` 那份的 logger 替身是**裸对象**（不带
  `importOriginal` 展开），其余四份带 —— 五种写法里已经有一种与另外四种不同，
  这正是"第 N 份样板会持续增长"的那一类。

- **「`tests/**` 在不在孪生扫描面上」这一问答成一句话**（正文第 2 条要求的定口径）：
  **是口径，不是疏漏** —— `check-code-duplication.cjs` 的 `isTestFile` 早就显式排除测试/快照，
  §12.12 的判定口径里也写着「不含测试」。但当场把面放宽成「src + tests 且**包含**测试文件」
  复算了一次，结论比"要不要扩面"更要紧：

  ```text
  候选文件（≥60 行）1390 份，其中测试形态 678 份
  现状口径（只 src、排除测试）孪生对：0        ← 与 `node scripts/check-code-duplication.cjs --report` 的读数一致
  放宽口径（src+tests、含测试文件）孪生对：3
  本单点名的五份 → 放宽后一对都不报
  ```

  那 3 对是 `annotate-consumer-gate` / `task-meta-consumer-gate` / `test-todo-gate` 三份门禁用例
  （互 0.84~0.89，整文件级雷同，正是"用例之间大量雷同是正常的"那句要挡的东西），
  而本单同形的只是十来行 mock 样板 —— 摊进两百行的文件里够不到 75%。
  ⇒ **块级样板不在这一层的物理量程里**：扩根既抓不到本单的形状，又会一次引进三对存量红。
  出路是抽实现体（本批做的这件），不是把判据改成启发式的块级比较（§12.18 那条
  「别为『抓该不该通用』写扫描器」同一条理由）。

- **两处文字跟着订正**：判据的 `isTestFile` 注释补上「这是口径 + 为什么 + 上面那两个数」，
  并记下那条排除**也吃掉 `src/**/*.test.ts`**（盲区比"tests/ 目录"那句说法更大一点）；
  §12.12 增一段同名的边界。AGENTS 硬规则 20 补一句同一件事。
