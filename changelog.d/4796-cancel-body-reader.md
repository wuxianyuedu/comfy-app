## Fixed

- **「中止路径取消上游流」的收口抽成共享出口**（#4796）：`finally` 里
  「`reader.cancel` 兜底调用 + `releaseLock()`」这份形态此前在 api-channel 的
  safeFetch、media-source.server、workshop comfyui 中继、llm video-task-util
  四处逐字重复（#4726 修时又落了第四份）。收口进 `src/lib/network/cancel-body-reader.ts`
  的 `cancelBodyReader(reader)`，四处改 import，行为零变化；补四态单测
  （正常 / cancel 同步抛 / cancel 异步拒 / 旧测试桩无 cancel）。
