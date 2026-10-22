## Added

- **台账 E4 的第六格：远端模型那一列的读边界与入参判据配上「同读数」判据**
  （`tests/remote-model-entry-wire-contract.test.ts` 新增两条）。这一格判的不是「是不是同一份代码」，
  而是「同一枚合法条目，三个出口给不给同样的字段」：把条目过一遍入参判据，再分别过
  `normalizeExtraModels`（读）与 `splitExtraModels`（写分派），三者必须 `toEqual`。

## Changed

- **同一份逐字段归一从两遍收成一处**：`normalizeExtraModels`（读 DB / 载荷里那一列）与
  `splitExtraModels`（设置页保存时拆「本地候选字符串 / 远端条目对象」那两堆）过去在同一个文件里
  各写一遍同样的四步 —— 名字 trim 后无名即丢、接口空白折 `null`、密钥走 `normalizeEntryApiKey`
  的三态、用途过 `REMOTE_MODEL_KINDS` 白名单 —— 只差「按名字去重」那一条。
  现在四步只有一个实现（`normalizeExtraModelItem`），两个出口各自只保留自己**多出来**的规则。
  加一列时改一处漏一处的失效形态（读出来少一列 vs 保存时静默不落，两个方向都不红）就此收掉。
- **没有并成一份 schema，这是刻意的**，并把它钉成判据：入参判据与读边界是两个角色 ——
  前者判「这条请求能不能收下」（词表外的用途当场拒，那是客户端拼错了），
  后者判「库里那一行读出来是什么」（词表外的用途落 `null`、整条留着 —— 历史上写坏一列
  不该让一个模型从列表里消失）。并成一份要么把「拒」变成「静默降级」，要么把「留着」变成
  「保存不了」，两个方向都比现状坏。新增的那条
  「认不出的用途：入参拒收、读边界落 `null` 并留住整条」就是用来挡「哪天有人把它们并起来」的。

## 判据

- 变异两刀各打一支：给 `remoteModelEntrySchema` 加一列而读边界不认识它 →
  「同读数」那条红（`expected …(3) to deeply equal …(4)`）；只改写入分派那一支
  （把空白接口改成空串）→ 同一条红而 router 那三格照绿。
- 既有的 `src/lib/llm/types.test.ts` 与 `src/server/api/routers/llm.test.ts` 一字未改，全绿。
