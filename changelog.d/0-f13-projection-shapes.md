## Added

- **`tests/f13-projection-shapes.test.ts`（进固定清单）**：把台账 F13 那一族从「靠人记得住」
  变成形状判据。判四件事，全部按源码形状而不是语义：
  ① 非测试源码里每一处 `as never` 都要**逐处登记 + 写清为什么**（新增未登记 = 红；
  登记的那处不见了 = 红；按「文件 + 该文件内次数」记账，不按会漂的行号）；
  ② 投影类参数（名字含 `select` / `projection` / `columns`）的类型不许是 `unknown` / `any`；
  ③ `.select(… as never)` 这个形状零存在（就是当年 `train.cancel` 的那一句）；
  ④ `src/lib/core/repository-*.ts` 的签名里不许有以 `_` 开头的参数 —— 那个下划线正是
  「我知道它没人用，但我不想删」的写法，也就是空气能力的来源。
  登记表里允许留「已知欠账」，但理由必须写成欠账（MCP 那一处现在就是这么记的），
  并另开台账项 F13′ 说清修法。
  反证与变异都做过：往 `executor.ts` 加一处 `as never` → 恰好「逐处登记」那条红并点名文件与次数；
  在别处加一处 → 同样红；合成输入里 `.select(select as never)` 与 `select?: unknown`
  各被对应的计数照出；只在注释里出现的被禁形状剥完注释就不该照到（有专门一条用例）。

## Fixed

- **`findByIdForUserSelect` 的投影参数是空气**（台账 F13 的性能版兄弟）：签名第三个参数
  `_select?: unknown` 从来没被用过，实现走 `db.select()` 全列，而 `workflow-detail.ts`
  三个调用点一直按 Prisma 的布尔投影形状传 `{ id: true, rawJson: true, … }` ——
  那份「只取需要的列，别把 `positions` / `rawJson` 两个大 JSON blob 拖两遍」的清单
  一个字都没生效，方法名承诺的能力不在。`unknown` 让调用点与实现的实现对不上时
  tsc 一声不响（与 `train.cancel` 同因，只是后果是性能不是 500）。
  改法不是把这个参数做实，而是**删掉这个不做实事的方法**：元数据那一读换成真投影
  （`findSourceMetaForUser` + `SOURCE_META_COLUMNS`，只取 `id` / `sourcePath` / `sourceMtime`），
  另两读改吃已有的 `findByIdForUser` —— 行为一字不变（它们本来拿的就是整行）。
- **LLM 回来的景别原样入库**：`parseShotsFromJson` 把 `shotType` 声明成 `string`，
  下游 `shotType: s.shotType as never` 塞进 `Shot` —— `as never` 在这里的意思就是
  「模型返回什么景别都直接存」。改在**解析边界**收进清单（`normalizeShotType`），
  清单外的值（中文标签、拼错的、缺字段的）一律回落默认档。
- **同一份景别清单被抄了四遍**：`ShotType` 联合、`script-parse.ts` 的 `VALID_SHOT_TYPES`、
  `llm/prompts.ts` 的 `SHOT_TYPES`、`StoryboardPlanner.parts.tsx` 的下拉选项又一份。
  现在 `SHOT_TYPES` 是唯一出处（`ShotType` 由它派生、`SHOT_TYPE_LABELS` 的键由它检查完备性），
  其余三处吃它 —— 提示词里那句「取值之一」与下拉里的选项以后不会再各改各的。

## Tests

- `src/lib/agent/executor.test.ts` 加一条：模型给清单外景别 → 落库必须是默认档
  （变异核过：把 passthrough 写回去 → 恰好这一条红）。

## Docs

- 台账 F13 关闭（判据 + 三处实例）、新开 **F13′**（MCP 写侧入参没有域内校验：
  `as never` 不是桥接第三方签名，而是边界上没检查；登记表先把它记成欠账，修法与
  「删掉那两条登记」写在条目里）。
- 规范 §11.2.1 新增一条口径：「对编译器按下静音键」的动作本身要能被机器看到 ——
  判据写成逐处登记表而不是笼统禁用，且登记按「文件 + 次数」记账，不按会漂的行号。
