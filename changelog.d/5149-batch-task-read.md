## Changed
- 批量窄投影读任务，收掉角色库与 agent 的 N+1 全重列查询（#5149）：新增 `taskRepository.findByIdsWithImages(ids)`——一条 `IN` + 既有 `taskCardColumns` 窄投影 + 一批 `attachImages`，四个 MB 级重列（workflowSnapshot / logs / rawCli / execPayload）不再为「只读十来列」的消费点反序列化。角色库生成历史 / 生成对账两处、agent 优选循环改用新出口按 id 索引回查；agent 的打分仍按候选顺序串行（LLM / IO 语义不变），只把读任务批量化。对外 API 形状与错误语义（缺行 / 越权 → NOT_FOUND）不变。同批补批量与逐条等价、去重、缺行不补位、窄投影不含重列的用例。
