## Fixed

- workflow.update 的「模板列 + 标签 upsert + 标签关联重挂」三段写收进同一 immediate 事务（#3870，审计源 #3848）：后段失败整体回滚，不再留下「模板已改、标签仍旧」的半态；整段「读→合并→写」按模板 id 串行化，双页签/自动保存并发保存不再互相覆盖 positions/rawJson。仓储层 update/upsertByNames/setModelTags 支持事务执行器注入。
