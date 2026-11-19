## Fixed

- **ComfyUI runner 终态去重标记有界保留（#3961 / #3850）**：`claimSettle` / `claimFinalize` 对 `settled` / `finalized` 引入按插入序的有界保留（上限 4096），在保持短窗重复收口防护语义的同时避免已完成 taskId 在长生命周期执行宿主中无界累积；DB 终态守卫仍作为重复写入的后备保护。
