## Fixed

- **`ModelRow.createdAt` 是死字段，被一次双跳断言盖住**（`model-library-config.ts` +
  `hooks/use-model-library.ts`）：
  - 该字段在**所有视图里零消费**（只有测试夹具给值）——模型库卡片不显示创建时间；
  - 而它是 `as unknown as ModelRow[]` 盖过来的：服务端返回的 `Model` 全行里
    `createdAt` 经 SuperJSON 反序列化后是 **`Date`**，视图类型却声明 `string`。
    类型对不上、靠 `as unknown as` 抹平，而那个对不上的字段根本没人用。

  修法两条一起做：删掉死字段，并把断言**去掉**（不是换成单跳）。
  去掉之后编译仍通过 —— 因为这恰好证明了 `ModelRow` 是服务端 `Model` 行的**子集**，
  字段名与类型逐项对得上，本来就不需要断言。双跳断言的代价是**把这份兼容性检查也
  一起丢掉**：服务端哪天把 `fileName` 改名，这里不会红，只会在渲染时静默变
  `undefined`。现在改字段名会当场编译失败。

- **同类形态记档、本批不动**（留着比乱改更安全）：`WorkflowRow` 也有同样的
  「双跳断言 + 声明与运行时不符」，但拆开后会露出**下一层**真实错配
  （`paramMap` 服务端是 `unknown`、视图声明 `Record<string, string> | null`），
  要改得先定那个 JSON 列的正确类型 —— 属独立的一刀，不在本批混做。
  详见 ISSUE 跟帖。
