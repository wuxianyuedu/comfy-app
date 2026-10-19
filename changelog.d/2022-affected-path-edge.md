## Changed

- **增量层的第 ④ 档「按路径引用」改拿剥注释后的代码文本比对**（ISSUE #2022，口径见
  §13.5.8）：这一档原样写着 `text.includes(改动路径)`，而门禁自测**在文件头引用规范
  章节**是硬规则 15 要求的动作 —— 于是「改一句注释」与「运行期读了那个文件」逐字同形。
  实测只提交文档时，`docs/standards/13-提交与-code-review.md` 一个路径把 6 份门禁自测
  拉进增量面（账本最后一次逐文件读数合计 455.8s，其中 `check-reformat-only` 单条
  278.9s = 5 分钟预算的 93%），而那 6 份里没有一份在运行期读那份 `.md`。
  现在 `buildImportedBy` 顺手算出 `codeTexts`（复用唯一那份 `stripComments`，
  纯 Node 层不能 import `tests/helpers/` 的 TS 版本），④ 只比它；反向 import 那一档
  照旧用原文。真仓库复算：文档提交 94 → 88 份（确定性，份数与被剔文件身份不随负载变），
  而改 `scripts/check-reformat-only.cjs` 时它的自测仍由「脚本同名回归」点回来。
  判据：`tests/affected-tests.test.ts` 两条新例 —— 注释里的路径不拉人、同一份路径写在
  代码字面量里照旧拉人（只判前一条的话，把整个 ④ 删掉也能过）。
