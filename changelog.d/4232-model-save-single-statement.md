## Fixed

- `modelSave` 的端点存档与模型行两段独立提交：第二段失败时模型行已是新值、endpointPath 存档仍旧值（#4232，§08 8.12② 的失败窗口）。两条写打的是同一张表同一行——收成同一条语句：路由器的「读-合并-写」整体在 keyed mutex 内完成（并发保存的串行化不变），合并好的整份 doc 折进 `saveModel` 的同一条 INSERT/UPDATE。
