## Fixed

- **模型库那屏的 e2e 冒烟一直锚在旧角色上，现已改锚「单选语义」那一层**（ISSUE #1925 的连带）。
  `e2e/model-library.spec.ts` 用 `getByRole("button", { name })` 逐档点名筛选档位，而那排 chip
  收进 `ui/select-chip` 之后写的是 `role="radio"` + `aria-checked` —— 于是 `@critical` 那条
  稳定红成「缺筛选档位『全部』/ element(s) not found」，**而六个档位加默认选中其实都还在**
  （红了之后读 Playwright 留下的无障碍快照才看清：`radiogroup "按类型筛选模型"` 下六个 `radio`、
  「全部」带 `[checked]`）。这不是产品回归，是**用例侧的定位器过期**。
  - 改法是把锚点从「它长得像按钮」换成「这一排只能选一个」这件事本身：整组
    `getByRole("radiogroup", { name: "按类型筛选模型" })` + 组内逐档 `getByRole("radio", …)`，
    并补一条 `toBeChecked()` 钉住**默认选中档必须是「全部」**（进屏就看不全列表是真故障）。
    jsdom 那侧的 `ModelLibrary.test.tsx` 早就是这个口径，两侧现在同锚。
  - **新补的那条 `toBeChecked()` 做过两刀变异复演**：把断言目标换成「大模型」⇒ 红（说明它真在读
    选中态，不是空转的装饰）；把 `radiogroup` 的名字改成不存在的 ⇒ 红（组名也在承重）。
  - 顺带记一条档位判据的读数事实：全量 e2e 里 `runtime-budget.spec.ts:91` 那格在同一跑里红
    （`loadEventEnd 2293ms` vs 预算 1432ms），**隔离单 worker 复跑转绿** ⇒ 按 §13.6.4 判为争抢假红，
    **没有**抬 2× 倍数、也没有动轮数与丢弃轮次。随后一次参数都不带地跑完整档：**81 条全绿（2.6m）**，
    那一格自己也绿 —— 与「争抢」这个定性对得上，账由整档那一跑记（透传参数的局部跑按设计不记账）。
  - 这一档此前被 schema 预检挡在门外（待执行差异含 `DROP TABLE loraTrainingJob`）。按那条判据的
    设计「丢不丢得起」由人拍；拍过之后实测**真实批次只有那一条 DROP**（该表 0 行，且逐表核过
    `task` / `workflowTemplate` / `skill` / `workshopDraft` / `remoteModel` / `llmConfig` / `user`
    的行数一格未变）。留一条过程教训：**备份 WAL 模式的 SQLite 只拷 `db.sqlite` 是不够的**，
    旁边那个 `-wal` 也带着数据 —— 可回退的形态是 `VACUUM INTO` 出单文件快照，并且**真的拷回去
    打开过、逐表 DDL 与行数对上**，而不是「两侧 sha256 相同」那句轻描淡写。
