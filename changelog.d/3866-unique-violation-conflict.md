## Fixed

- 「先查后写/裸 insert」撞唯一索引一族转业务语义（#3866，审计源 #3848）：用户首访建号（`user.email`）、LLM 供应商/模型新建（名称唯一索引）改独占插入 + 冲突后复读；供应商/模型改名、技能 slug、工作流模型标签改名捕获唯一冲突转 409/CONFLICT，不再漏裸 500。新增判据 `isSqliteUniqueViolation`（`src/lib/sqlite-error.ts`）。
