## Fixed

- **工坊自动保存会用本机旧草稿整片盖掉 AI 侧写入的角色卡 / 场景 / 分镜（#5147）**。
  现场：AI 侧把 6 场景 / 6 角色 / 19 镜写进 `production`，界面那份是**挂载那一刻**从
  localStorage 读进来的旧副本（这三列全空），几秒后一次 `PUT /api/production 200` 就把
  同一行整片盖成 `scenes=[] / characters=[] / shots=[]`，随后的自主 run 判「还没有镜头」
  退回去规划分镜、LLM 不可用，整条 run 失败。
  根因是「双操作者」在**写侧**没有对应保护：载荷是**整份**草稿，且没有「我这份基于哪个
  版本」的凭据 —— 草稿镜像那条路早有版本对账（`ifNewer` / 挂载比 `updatedAt`，#4023），
  生产数据这条路一直没有。
  处置三条（与草稿镜像同口径）：
  - **窄字段写入**（主修）：`PUT /api/production` 里**没带的键 = 这一列不动**，工坊自动保存
    只发相对挂载基线**真改过**的字段（`narrowProductionWrite`）。于是「界面那份没有角色卡」
    不再等于「把库里的角色卡清空」——整片覆盖在结构上不可能发生，而不是事后判一次要不要拒绝。
    副作用是这类无意义整片 PUT 也不再发（用户没编辑时一拍都不发）。
  - **整份写入的版本闸**：载荷带 `baseUpdatedAt`（它读到那一行的时刻）且八条内容列全在、
    而库里比它更新时，跳过写入并回 `{ ok: true, stale: true }` + 服务端现值（草稿镜像
    `ifNewer` 的同一形状）。窄写入不走这一闸 —— 它只覆盖用户改过的字段，拦下来等于把
    用户的改动丢掉。
  - **挂载采纳**：AI 写进 `production` 的内容在界面重新挂载时会被看见（本机草稿为空、或
    服务端严格更新时采纳，判据 `shouldAdoptProduction`），采纳后写入基线跟着换成那一份，
    否则下一次自动保存会把「刚采纳来的内容」当成用户改动整片重发。本机设备选择
    （`modelSelections` / `workflowId` / `videoWorkflowId`）不随采纳被换掉。
  用例：新增 `payload.test.ts` 的窄写入 / 采纳判据 21 条、`route.test.ts` 的路由层 7 条
  （含「只带剧本的窄写入不许动那三列」这条现场复现）、
  `use-workshop-production-conflict.test.tsx` 3 条端到端复现、`production-client.test.ts`
  的三态结论 5 条。
