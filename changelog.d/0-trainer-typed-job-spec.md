## Fixed

- **`src/lib/comfyui/trainer.ts` 的 `job as unknown as TrainJobSpec` 双跳断言**：
  DB 表 `loraTrainingJob` 与后端契约 `TrainJobSpec` 历史上靠这一行盲连。三类漂移
  全被吞：
  · `LoraTrainingJob` 多出的列（`userId` / `status` / `progress` / `outputName`
  / `logs` / `error` / `createdAt` / `updatedAt`）会随 `JSON.stringify(spec)`
  **原样**发给训练后端 —— 后端多解一步就多一处可能踩坑，也让「DB 加一列」
  在这条通道上变成一次未审计的 API 变更；
  · `classWord: string | null`（DB）与 `classWord?: string`（契约）语义不同：
  前者是「显式 null」、后者是「不提供」，盲 cast 让下游按 `undefined` 判的
  代码读到 `null`；
  · `datasetImages` 是 JSON 列，Drizzle 侧类型是 `unknown`，历史上真出现过
  「只存了文件名数组」的老行形状。

  新增具名函数 `toTrainJobSpec(job: LoraTrainingJob): TrainJobSpec`：逐字段挑、
  只发契约里声明的字段；`classWord` 的 `null` 归一到 undefined；`datasetImages`
  过一次 `normalizeDatasetImages` 运行时判据（老行「只存了文件名」归一化到
  `{ name }`、对象项缺 `name` 丢弃、非数组退化 `[]`）。归一化后 **schema 与
  契约的对齐变成编译器 + 一处判据的责任**：TrainJobSpec 加字段忘了在
  `toTrainJobSpec` 里给值 → `tsc` 立刻报缺属性。

- **同文件的 `filter((item) => item?.caption?.trim())` + `map` 里 `item.caption!.trim()`**：
  filter 返回 boolean 不会窄化元素类型，`!` 只是把判据「用两次」给编译器看。
  换成 `hasNonEmptyCaption` 类型谓词，map 里 `item.caption` 是 `string`，
  `!` 消失；`?.` 也去掉（`toTrainJobSpec` 保证每项都不是 undefined）。

  行为对**下游**（后端 POST / 未配后端入队）等价；类型安全审查 src/lib 报告的
  B-2 条目。
