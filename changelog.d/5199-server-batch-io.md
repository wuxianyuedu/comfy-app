## Fixed
- 模型适配器概览（`workshopAdaptersSummary`）对整批模型只预读一次项目默认 JSON，逐模型改为纯函数内存合并，模型数不再等于读盘往返次数；按原序拼回结果，归因仍靠模型名（#5199）。
- 角色库批量生图入队（`enqueueCharacters`）改用 `runWithConcurrency` 有界并发派发（宽度 2）：角色之间不再逐条串行等两次 SQLite 写，单角色内仍保持「先 createQueued 再 markGenerating」的顺序；失败短路，不留「建了任务没标记生成中」的孤儿（#5199）。
