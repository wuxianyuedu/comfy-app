## Added

- **四张「是否引入」CI 工具裁决单落档（ISSUE #2635–#2638）**：新增规范 §13.5.32，四条裁决各带读数与复评触发——
  - **#2638 oxlint** ⇒ 不进 CI 常驻第二道闸（维持 #2541 拍板），现行用法落档：单子读数已过时——oxlint 全家（`oxlint` / awesomeness 预设 / 双插件 + 根级 `oxlint.config.ts`）已在 devDependencies，#2774/#2775/#2841 把它跑成了「单规则临时配置 + `--fix` 全仓清零批」的既成用法；角色 = 评估尺 + 清污批驱动 + 迁移彩排。L1 那格空着是有意的：全预设未清零 + 两份 config 同判据双执行者（§13.5.29）未收敛。复评触发 = 全预设 0 命中日，按 §13.5.30 三门槛重过。
  - **#2637 tsgolint** ⇒ 并轨进 #2638 复评、独立条目撤编：`oxlint-tsgolint` 已在 devDependencies，tsgolint 以 oxlint 类型感知引擎身份入仓；原「覆盖补齐且冷启动 <5s」条件改写为同一张复评清单（类型感知规则面对照 `eslint.config.js` / CI 冷检出实测 / 去重口径收敛）。
  - **#2636 密钥扫描** ⇒ 不引入 gitleaks，且单子「现状」读数不成立：`scripts/check-tracked-secrets.cjs`（ISSUE #2157）已两档在岗（`--staged` 钩子增量面 / `--all` 全仓，存量 0 命中）——搜 `gitleaks|密钥扫描` 搜不到 `tracked-secrets` 这个名字，判据 ⇄ 执行者以 `check-gate-executors.cjs` 对账为准。复评触发 = 真实漏网事故且归因到形状缺口（扩 `PREFIX_SHAPES` 形状表，不引第二把尺）。
  - **#2635 单测分片** ⇒ 维持现状：待核已答（`test-db.ts` 用 `:memory:`，无共享库文件，隔离比「按 worker」更强）；决定性读数是全平台流水线落同一台 16 核自托管节点——跨 job 分片不产生新核时、只复现并行挤占现场（两条 8640s 挂死）。复评触发 = 第二个构建节点落地。
