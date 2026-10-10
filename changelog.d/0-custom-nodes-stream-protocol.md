## Added

- `src/app/api/custom-nodes/route.test.ts` 新增「流式探测的进程协议」12 条（该文件 77 条）：
  解释器退避链的两个真形状 —— **异步 `error` 事件（ENOENT）** 与 **退出码 127**（此前唯一那条
  失败用例把 `spawn` 排成**同步 throw**，走的是外层 catch，而真机上缺解释器不 throw，
  那条退避链在 Windows 上是主路径）、非 ENOENT 的 error **不换**解释器而把原因当场透成进度、
  `stderr` 每一行转成带 `⚠️` 的进度、`PROGRESS::hash` 的 `done`/`total` 两个计数、
  没有 `msg=` 的旧格式整段当文案、不成形的 `PROGRESS::` 行跳过、**一行被 chunk 切断**要拼回来、
  以最后一行 JSON 为准、收尾 JSON 坏了要带退出码且流不挂着。
- 门槛按实测抬：`src/app/api/custom-nodes/route.ts` 80/83/77/70 → 87/87/85/79
  （实测 87.87 / 80 / 88.09 / 85.4，此前 77.95 / 70.96 / 83.33 / 80.8），四个维度同批只升不降。

> 同批照出的那句「未找到 Python 解释器」不可达，由下一片
> `0-python-interpreter-exhaustion.md` 修掉；那两条用例现在正面要求这句话。
