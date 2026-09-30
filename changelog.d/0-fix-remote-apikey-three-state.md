## Fixed

- **远端模型的密钥不再被「保存一次设置」清掉**（安全台账 A11，A4 那次脱敏的副作用）。
  根因是**三态被压成两态**：`getConfigForClient` 下发的条目出于脱敏**不带** `apiKey`，
  而设置页保存走的是「整份清单覆盖」（`remoteModelRepository.replaceAll`），那里
  「没带」与「用户要清空」都是 `null` —— 于是用户原样保存一次设置，所有远端模型的密钥
  就被写成 `null`（表现：填过密钥的远端模型隔一次保存就 401，而界面从没说过密钥没了）。
  同一条批量语句里 `workshopAdapters` 早就从既有行继承，只有 `apiKey` 是覆盖语义 ——
  一个函数内两种语义。修法把三态一次铺到四个位置：
  - `~/lib/llm/types.ts` 新增 `normalizeEntryApiKey()`：非空串 = 写新值 /
    `null` 或空白串 = **显式清空** / 缺键与 `undefined` = **不提供意见**；
    `normalizeExtraModels` 与 `splitExtraModels` 都改吃它（此前两处各写一份
    「不是非空串就折成 null」，正是压平三态的地方，§12.12）；
  - `replaceAll` 缺键时继承库里那把，且**原样搬运密文**（重新加密会换 IV，
    读出来解不开）；
  - `getConfigForClient` 逐条下发 `hasApiKey`：密钥照旧不出门，但「这条配过密钥」出门 ——
    客户端没有这个信息就无法表达「我没重填」；
  - `updateRemoteModel` 未重填也未点清除时**省略这个键**（草稿不揣测保留值）。
- **同一条写入路径上的另一半：远端密钥此前明文落库**。`llmConfig` 那条路径一直走
  AES-GCM 加密，而 `replaceAll` 直接把传值写进 `remoteModel` —— `db.sqlite` 会被
  `next build` 整份复制进 standalone 产物（硬规则 17 说的那条「密钥明文分发」通道）。
  现在写入前加密；读取侧 `decryptLlmKey` 对历史明文值原样透传，老数据不受影响。
- 判据：`src/lib/llm/types.test.ts`（三态 + 两个归一器同源）、
  `src/lib/core/repository.test.ts`（全量同步那条现在验「缺键=继承、密文原样搬运、
  明文不落盘」，另加一条专测三态）、`src/lib/llm/server.test.ts`（出口带 `hasApiKey`
  且整个序列化结果一个字密钥都不出现）、
  `src/app/(main)/settings/hooks/use-settings-page.test.ts`（客户端三态表达）。
