## Fixed

- ComfyUI WS 帧处理乱序（#3913）：`handleMessage` 经 fireAndForget 并发执行，
  progress 分支在首个 await 处让出，两帧交叠时后发帧的 UPDATE 先落库、DB
  progress 以旧值收尾一拍。帧处理收进 `AsyncMutex` 按到达顺序串行化（帧处理
  均为毫秒级 DB 写，无可感延迟）。
