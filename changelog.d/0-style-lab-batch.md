## Added

- 风格试验的**矩阵扇出**落地：`styleLab.runBatch` 把一次试验展开成整批座位，逐格入队一条
  出图任务；`styleLab.stopBatch` 取消这一批还没出完的格子；`styleLab.detail` 一次读回试验定义
  与整张座位表（每格带上任务状态与成品图地址）。
- `src/server/lib/style-lab-batch.ts`：扇出与取消的服务端唯一实现。四条必须集中一处的判断
  都在这一份里 —— 预算硬上限（超了就整批拒绝）、重跑判重（已绑 `taskId` 的座位跳过，只补
  没跑过的）、整批只 `kickQueue()` 一次（逐格踢只是把派发器敲 N 遍）、基准 seed 每批只定一次。
- 服务端扇出**复用** `createWorkflowRunTask`（工作流库执行的服务端唯一入口）而不是另写一遍
  入队：给它补了 `mode`（试验存的是用户手选的就绪模式，不该被工作流默认模式顶掉）、`kick`
  与返回的 `unmatched`，界面因此能如实说出「哪个口这次没生效」。
- `src/lib/style-lab/style-lab-matrix.ts` 新增纯派生：`planStyleLabSeats`（风格 × 特征的整批
  座位，界面预览的格数与服务端真展开的格数从此同一口径）、`cellTraitKey`（带轴 id 的身份键）、
  `cellMatchKey`（重跑判重用的组合键）、`cellToCharacter`（一格投影成角色卡，提示词仍走工坊
  那份 `buildCharacterPrompt` 的顺序）、`batchBaseSeed` / `cellTaskSeed`。
- `firstSavedImage(resultImages)`：任务产物清单里第一张图的唯一出口。此前只有首帧合成
  那一处内联做过同一件事（`cast` 成数组再按 `mediaType` 找），风格试验的矩阵是第二个
  消费点 —— 这一刀把那处也接到共享出口上，因此「取第一张图」现在真的只有一份实现。
- 座位表界面 `StyleLabCells`：每格给出风格、特征、状态三件，成品图可直接点开大图；跑一批 /
  停一批的入口挂在展开的那一条试验上。

## Fixed

- `styleExperiment` 少一个归属列：这张表新增时没有 `userId`，而列表与详情都不按用户过滤 ——
  于是别人的试验会出现在这一屏上，`runBatch` 还能拿别人的试验去排本机显卡。补上归属列
  （与 `task` / `workflowTemplate` / `production` 同一形态）、把列表 / 详情 / 软删的 SQL 都带上
  归属条件，并给「我的 + 未软删 + 按创建时间倒序」这条唯一读路径补复合索引。
- `createWorkflowRunTask` 里「工作流没有可执行内容」那道闸写在 `createQueued` **之后**：抛错时
  那一行已经是库里的 QUEUED 任务，一次注定失败的提交仍会排进单卡串行的队列、跑到用户别的
  任务前面（`MAX_CONCURRENCY = 1`）。这道闸移到落库之前，并有回归用例锁住「库里不留排队行」。
- 取消路径不再另写一份：`stopBatch` 复用执行侧的 `cancelTask`（与 `task.cancel` 同一个出口），
  因此落执行日志、真的中断在飞的请求、并归还并发槽；取消前按 `progress.userId` 复核归属。

## Changed

- 一批的 seed 缺省档从「每格各随机」改成「整批共用一枚」：这一屏比较的是风格与特征，seed
  是必须钉住的变量；每格各随机时，两张图的差别里混着抽样噪声。只有显式 `seedMode: "random"`
  才逐格换 seed，不认识的值也按缺省档处理（「换 seed」是用户的显式选择，不该由拼错的值给出）。
- 格子的 `traitKey` 改成**带轴 id 的身份键**（`costume=唐装;temperament=清冷`），屏上那句
  「服装：唐装 · 气质：清冷」由视图层现推。只拼取值时，两个特征维度一旦撞同一个词就会把
  两格判成同一格 —— 表现是矩阵静默少出一张图，而界面上那句算式仍照原样报 K 格。
- 扇出前多一道「拼不出提示词就不跑」的闸：风格与特征都没选时整批 prompt 都是空串，空值会
  照着作者连好的那个口写进去，出图用的是工作流图内的默认内容。登记一条空定义仍是合法草稿
  —— 只有「真跑」才必须有内容。
- 删掉「批量生成下一批开放」那句占位说明与表单上那枚永远禁用的按钮，改成把用户指向真实
  下一步（在列表里展开这一条）。
- 测试基建 `tests/helpers/test-db.ts`：`$tables` 补上两张试验表的读口，并新增 `updateRow` /
  `deleteRows`。此前用例里改 `$tables.X` 拿到的对象**并不落库**（每个键都是重新 `SELECT` 的
  getter），要造「任务已收口」「格子指向别人的任务」这类库内状态只能发真的 SQL。
