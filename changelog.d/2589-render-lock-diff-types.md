## Fixed

- **脚本档清账批 5：`scripts/lockfile/render-lock-diff.mjs` 20 格清零，账从 226 处 / 18 份降到
  206 处 / 17 份（ISSUE #2589 / 规范 §13.5.14.1）**：这一份是差异的**渲染层**
  （`quality-gate` / `check-deps-freshness` / `diff-cli` 打的中文差异报告都出自它）。
  其中 10 格 `TS2339` 说句实话**不是代码错**：函数头写的是 `@param {object} diff`，
  而 `object` 上任何属性都不存在 —— 同一件事的权威声明（`LockDiff` typedef）就在它隔壁那份
  文件里已经写好一份。修法是把注解**指回那一份**（`import("./lock-diff.mjs").LockDiff`），
  不在这里重述形状（§12.12「同一维度一处定义」的另一面：注解也不许另说一遍）。

  指回去之后新现形的是两类，都按语义处理，没有一处是靠兜底糊过去的：

  - **两段「标签 + 值」的元组循环**（`[["settings…", diff.settings], …]`）把标签与值折进了
    同一个联合，解构出的 `d` 于是是 `string | FlatDiff` —— 那几格 `TS2339` 报的是**写法**：
    改成带类型的元组数组（`Array<[string, FlatDiff]>` / `Array<[string, EntryDiff]>`），
    循环体一字未动。
  - **`diff.importers[importer]` 这种按下标取**在 `noUncheckedIndexedAccess` 下每次都
    「可能 undefined」，而这里的键明明是 `Object.keys` 刚拿到的。没有补 `?? {}` 那种
    不可能的兜底（硬规则「不为不会发生的场景写错误处理」），改成 `Object.entries` 一次取到
    键与值 —— 同一段代码、同一个遍历顺序、零新分支。

  另一格是 `DepChange.value`：同一个形状服务 `added` / `removed`（有 `value`）与
  `changed`（没有），所以它**只能**是可选的。那两句读它的地方的值改用 `?.` ——
  注释里写清了两件事：构造上 `added` / `removed` 恒带 `value`（`diffImporters` 就是这么造的），
  以及旧写法在这一格真为空时抛的是 `TypeError` 而不是打出一个 `"*"`，
  所以这一改**只影响一条不可达的路径**。

  **中途被 #2524 那条反截断判据抓了一次**：我第一版把注解写成
  `@param {number} [opts.maxPerSection=8]`，而 `opts` 已经改成对象形状 ⇒ `TS8032`
  （限定名要前置的 `@param {object}`）。那一格是**语法层**的，tsc 从此不再报语义诊断 ——
  判据那一条「这一跑里有语法/配置层的报错」当场把它标成不算结论，
  而不是让总数看着「像降了几格」。这就是 #2524 当时为什么要加这一条。

  行为恒等两层证明：① 契约用例 `tests/lockfile-diff.test.ts` 21 条绿，加消费者
  `deps-freshness-gate` / `ci-install-deps` 共 67 条；② 端到端跑
  `node scripts/lockfile/diff-cli.mjs --installed <旧 lockfile>`（真有差异的那一对：
  `53bc34bb` 版 16686 行 vs 现在 16994 行），HEAD 那一版与本版各一次，
  **25 行输出逐字相同**、退码同为 1。`oxfmt --check` 对这份文件 HEAD 版就报脏
  （它不在格式门禁的扫描面上），所以本笔没跑格式化器，只把自己新增的行折到不越宽。
