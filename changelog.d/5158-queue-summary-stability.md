## Fixed
- 根治队列页轮询驱动的重渲染（#5158）：取证推翻了"task.summary 双发"的初判——浏览器端 11 次请求每 ~2.2 秒一次，只有 1 个 queue 实例，真正的问题是每轮轮询带来 3 次状态抖动（summary data / isFetching true / isFetching false），长任务成对出现。现在给 summary 查询加稳定 selector：四个计数内容不变就沿用旧 stats 对象；后台轮询的 isFetching 不再进 controller 的 `refreshing`（刷新反馈只由用户主动动作驱动）。实测队列页长任务从 20s 内 48 个（52–130ms）降到 25s 内 13 个（50–105ms，均值 67ms）。同批补内容判等行为用例。
