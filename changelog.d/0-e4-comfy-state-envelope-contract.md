## Added

- **台账 E4 的第三格契约判据：`tests/comfy-state-envelope-contract.test.ts`** ——
  `/api/comfy/state` 那条长轮询的信封，生产侧记下的那一笔与消费侧交给订阅者的那一笔必须是同一份形状。
  这一格的形状与前两格（`task.list` 的 `videoPath`、`task.detail` 的 `images`）不同：
  **两边各自造了自己的帧** —— 客户端那份用例回答 `fetch` 的是它手写的 `change()` 夹具
  （`src/lib/comfy/comfy-state-client.test.ts`），路由那份用 `toMatchObject({seq, kind})`
  只点它关心的两列，两份用例都不引用对方的产物。于是任何一侧改名或少发一列，`"use client"`
  那份手写收窄（逐字段 `typeof` 加一处 `as`）就把每一帧判成坏帧丢掉，`pollOnce` 再把 `null`
  当成「这一轮没有变化」—— 表现是「状态再也不即时更新」，而这条通道存在的理由正是替掉那一拍
  5s 轮询。tsc / eslint / 两边各自的用例 / 覆盖率门槛全绿。
- 判据不新造夹具帧：把**真路由**的回答接进**真客户端**（mock 只有 `fetch` 一处；路由、
  `state-watch` 的纪元与挂起等待、客户端的 `seq` 去重与 `runId` 全部真实跑），然后判三件事 ——
  ① 交出去的那一笔与记下的那一笔 `toEqual`（整枚信封相等，这一条同时挡「少一列」与
  「多要求一列」两个方向，而逐列断言正是 `toMatchObject` 漏掉那一维的原因）；
  ② 反向证明：线上把 `detail` 改名时**一帧都不交**，而不是交出一个 `detail: undefined`
  的半成品（少了这条，①可以被一份「两边都不读 detail」的实现无痛满足）；
  ③ 纪元跨两端仍然成立：第二笔在第一拍回到客户端**之后**才发生，唤醒的是真
  `waitForComfyStateChange` —— 替身永远测不到「挂起的等待被后来的一笔唤醒」这条。
- 变异两刀，打在不同的半边（打完逐字节还原、`md5sum -c` 自证）：
  消费侧不再要求 `detail` 是字符串 → **只有**反向那一格红，其余 16 条全绿（客户端那 9 条喂的
  是自己手写的帧，线上少了什么它无从知道）；路由少发 `detail` → 本格三红，另加路由自己那条
  「200 + 那次变化的载荷」红（`src/app/api/comfy/state/route.test.ts` 4 条里红 1 条，它断的是全形状）。
  ⇒ 缺的从来不是「路由侧有没有读数」，而是**把两边接起来**那一格。

## Changed

- §11.11 那份「契约测试落点」表加上这一格；台账 E4 的剩余清单从三处收到两处
  （远端模型的键名分叉、`generate.generate` 的入参）。
