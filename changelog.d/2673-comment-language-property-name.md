## Fixed

- **注释语言硬闸的「名字位置」豁免补齐 `@property`：一条纯结构行不再被当成英文散文
  （ISSUE #2673 / 规范 §12.4.6）**：`scripts/check-comment-language.cjs` 剥「@tag + 类型块 +
  名字」三段时，第三段的名字只按 `@(param|arg|argument)` 认（`PARAM_TAG_RE`），而它的
  豁免面注释列的是 `@param` / `@returns` / `@typedef` / `@type` / `@property` / `@template`
  一整族 —— **注释说了六家，代码只认三家**。于是
  `* @property {string} note` 被判成「英文说明句」（`note` 恰在虚词表里），
  而那一行一个英文说明字都没有。现场：ISSUE #2589 批 6 给 `ci-probe-lock-readout.mjs`
  补 `Reading` typedef 时被硬闸拦下（该判据存量已清零 ⇒ 新增即阻断，所以它挡的是从主干
  分出去的每一次提交，不是某一次偶发）。
  同一处逻辑的前半曾为 `@param {Date} at` / `@param {string} from` / `{string} to`
  误报修过一次（判据注释里留着那段现场），这次是那条修法没覆盖到 `@property`。

  改法是把 tag 表补成 `@(param|arg|argument|property|prop)`，**不**把 typedef 那行改写成
  迎合正则的形状（判据钉语义不钉行形状），也**不**新写第二份判据。可选字段写成
  `@property {T} [name]` 时方括号那一段早已被 `stripJsdocTypeSyntax` 剥掉，不需要特判。

  同批两条用例进 `tests/comment-language.test.ts`（正向 + 反向锚点，共 30 条绿）：
  虚词字段名的结构行豁免；`@property {string} note the reason the reading was unavailable`
  这类**真散文**仍判红 —— 只加正向那条等于把豁免面放宽而不设边界。
  变异实测：把判据退回未扩的样子 ⇒ 正向红、反向锚点照绿（`1 failed | 1 passed`）。
  全仓复算：`✓ 无英文注释（扫描 2306 个文件）`。
