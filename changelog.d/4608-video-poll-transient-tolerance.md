## Fixed

- **API 视频轮询不再对单次瞬态错误零容忍（#4608）**：`VideoStudio` 的异步轮询循环此前把 `apiPollVideo` 的任意一次抛出（上游 5xx/429、网络抖动）直接冒泡到 `generateClip` 的 catch，镜头当场落 `failed`——远端任务可能仍在正常生成，白丢一次已提交的任务。现在轮询循环内对**请求级失败**计数容忍：连续 N=3 拍都失败才落 failed 并提示连续次数，成功一拍（含 `pending`）即清零；总预算仍是原来的 10 分钟 deadline，退避沿用循环既有的 3s 间隔（规范 §8.10「有界次数 + 墙钟预算」）。「任务明确结束但无 URL」与「预算耗尽」两种终态语义不变。`VideoStudio.test.tsx` 补三条用例：单次 5xx 后拿到 url 仍 done、中间 pending 清零连续计数、连续三次失败才 failed。
