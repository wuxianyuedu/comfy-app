<!-- ⚠️ 本文件为自动生成产物（`pnpm doc:render`），请勿手改。
编辑态文档（单一事实 + 占位符）见：`docs/guides/ga-migration-checklist.md`。改动请回源文件，再重新生成。 -->

# GA 侧适配清单（任务 3 并行期勘察输出）

> 产出日期：2026-11-06
> 来源：会话 323c5de20d55fff7f1e90699 勘察结论 + `.cnb.yml` vs `.github/workflows/*` 配置对比
> 纪律：本清单不要求一次性全部落地，按「一主题一分支一 PR」逐条交付；过程中不得修改 CNB 侧的格与台账；所有改动必须排在 master-gate.yml 收口之后。

## 已完成

| 项 | PR | 备注 |
|---|---|---|
| GA push 档 master-gate.yml 新增 | #3215 | 文档链两格与 CNB 并行判，CNB 侧不动 |
| GA 判决回读补全失败 job 日志 | #3192 | 附件格实测要 docker 已删 |
| 定时重档迁 GA + 镜像派发判据修稳 | — | 历史提交 |
| GA 推送格 payload 组装（PR 标题 / base_sha / cnb_commit） | #3160 | run 标题携带 PR 标题 |
| GH 日志回读工具（ship --gh-logs） | #3203 | 判红自动触发 + 显式入口 |

## 待落地（按优先级 + 主题分组）

### 一、并发与资源（4 项）

#### G-1：vitest maxWorkers / pool 配置

- **现状（CNB 口径）**：自托管 16 核节点，`scripts/ci-load.mjs` 按现场核数折算 maxWorkers，动态值；人的覆盖出口是 `COMFY_CI_MAX_WORKERS`（≥1 整数，非法值按默认办并提示）
- **GA 实测读数**：
  - 核数：**11-06 起是 4 核**（镜像仓转 public 后托管 runner 规格变了）：GA 日志原文 `[ci-affected] 改动面：…；并发 --maxWorkers=1（4 核，os）`（run 42202918718 › affected-tests）；早前 `（2 核，os）` 的读数已过期
  - 改造前的推导：`ceil(4/8) = 1` ⇒ `--maxWorkers=1`。那个 8 是**共享宿主机**的档（依据见下），照抄到 GA 就是「4 核里 3 核空转」
  - 全量单测墙钟基线（run 41616389372，2026-11-03 10:11:51 → 10:22:20 UTC）：`Test Files 873 passed (873)`，`pnpm run test:coverage --maxWorkers=1`，约 629 秒（≈10.5 分钟）。**注意**：那跑是 **2 核机器**，只能作量级基线；**4 核 + 1 worker 的全量基线目前还没有**
- **依据（为什么 GA 要换档）**：8 核/worker 的原文理由只有一条 ——「单条流水线别把整台机占满，只承诺峰值占用减半」（#2317，代价叙述由 #2320 订正），前提是同机并着别人的流水线、且仓库控不住一台机接几个 runner。GA 每个 job **独享一台 4 核 VM**，没有邻居要保护；按原意「留一半」，4 核应对应 **2 worker**（`ceil(cores/2)`）。原始理由里**没有**内存/磁盘约束，不是 OOM 经验
- **建议改法（已落地）**：`scripts/ci-load.mjs:resolveCiWorkers()` 按 `GITHUB_ACTIONS === "true"` 分档 —— GA 走 `GA_CORES_PER_WORKER=2`（4 核 ⇒ 2），其余（CNB 自托管 / 本地）仍走 `CORES_PER_WORKER=8`，CNB 的 16⇒2 / 8⇒1 / 12⇒2 **逐字不变**（`tests/ci-load.test.ts` 两套断言同时钉住）；`COMFY_CI_MAX_WORKERS` 覆盖出口优先级与口径不变。规范 §13.5.21 同批补了这段
- **待定项（未验证，4 不升默认的理由）**：4 worker = 把 4 核打满，**内存上限没有读数**（「4 vCPU / 16GB」只是口径，本仓未实测）。所以默认停在 2；4 只有在下面三臂读数出来、且没有 OOM / worker 启动失败时才考虑升
- **取数计划（同一台 4 核 GA 机器上 1 / 2 / 4 三臂）**：

  | 臂 | 怎么设 | 用哪一跑 | 读什么 |
  | --- | --- | --- | --- |
  | 1 worker | 仓库变量 `COMFY_CI_MAX_WORKERS=1` | 任意 PR 的 `受影响用例`（快信号）＋ 下一跑 daily `单元测试`（全量） | `--maxWorkers=` 行、`（N 核，os）`、该格墙钟 |
  | 2 worker（默认） | **删掉仓库变量**（展开空串 ⇒ GA 档推导 2） | 同上 | 同上 |
  | 4 worker | 仓库变量 `COMFY_CI_MAX_WORKERS=4` | 同上 | 同上；另 grep `heap out of memory` / worker 启动失败 / `Test timed out` |

  - ⚠️ 仓库变量当前被用户设成 **4**，会盖掉默认档 —— 取「2 worker」那一臂前**必须先删变量**，否则量到的还是 4
  - 墙钟读法：`GET /repos/wuxianyuedu/comfy-app/actions/runs/{id}/jobs`（公开仓免令牌）取 step 起止；`--maxWorkers=` 与核数行需要 GA 日志回读（`actions:read` 起）
  - 判据：4 必须在墙钟 ≤ 2 且**零** OOM / worker 启动失败 / `Test timed out` 的前提下才升默认；任一臂出现不稳 ⇒ 回 2（或 1）。**没有这三臂读数，不把 4 写进默认**
  - 对照限制：不要拿 629s / 873 files（2 核时代）当同规格基线；跨规格只能报量级
- **影响判断**：worker 数不是 daily 墙钟的主因（串行拓扑才是，见 G-9）；本条收益有上限，别指望靠并发把 300m 预算吃下来
- **优先级**：P2（默认档已按平台落地；剩余是 4 与否的读数与内存验证）

#### G-2：NODE_OPTIONS / 内存预算

- **现状（CNB 口径）**：重档格显式设 NODE_OPTIONS；daily.yml 的 ESLint step 设 `--max-old-space-size=4096`
- **GA 实测表现**：全仓 `.github/workflows/` 只有一处 `NODE_OPTIONS`（daily.yml 的 ESLint `--max-old-space-size=4096`，注释记着「这一格 OOM 过」）；tsc / db-push / vitest（pr-gate 三格、daily 单测）都**没有** OOM 读数 —— 上一版「统一加 4096」是推断，不是读数
- **影响判断**：无症状的 step 抬堆上限只会掩盖真实内存回归；反过来，真 OOM 时默认约 2GB 的老生代上限会先于 job 墙钟报红，至少报错点得出来
- **建议改法**：**不统一加**。只在有 OOM 读数的 step 上给（当前唯一：daily ESLint 4096）；其余 step 等出现 `heap out of memory` 再按现场加，并在该 step 的注释里记下读数出处
- **优先级**：P3（现状已符合「只在需要处给」，本条只剩口径记录）

#### G-3：timeout-minutes 配置

- **现状（CNB 口径）**：各格独立 timeout，无总上限概念
- **GA 实测表现**：单 job 硬上限 6 小时（runner 层）；daily.yml 顶层 300 分钟（5h），各 step 已与 CNB 对应 stage 同预算（安装 20 / 库表 30 / 新鲜度 5 / 构建 30 / lint 30 / 浏览器 20 / E2E 45 / API 文档 30 / 单测 45 / 覆盖率产物 5；另有 GA 专有的镜像漂移判据 5 —— ISSUE #3252 的每日兜底，CNB 侧无对应 stage，合计 249m < 300m）；pr-gate.yml 各 job 20–60 分钟
- **影响判断**：顶层 300m 只兜「整条链挂死」；step 级预算让卡死在自己的名字上报（CNB 的口径），也防单格吃光整条链的墙钟
- **建议改法**：daily.yml 的 step 级预算已落地（本主题 PR）；将来若拆成多 job，按各 job 重算。pr-gate.yml heavy-gates job 已显式 60 分钟（安装 + cargo 编译最长）
- **优先级**：P2（step 级预算已落地，剩余只在拆 job 时重算）

#### G-4：并发档位用法（it.concurrent）

- **现状（CNB 口径）**：固定清单 `COMFY_VITEST_CONCURRENT_FIXED`；受影响清单空
- **GA 实测表现**：单 worker 上 concurrent 与串行无差；多 worker 上 concurrent 会跨 worker 分散执行
- **影响判断**：GA 多 worker 后 concurrent 能真正并行，提升 wall clock
- **建议改法**：保持 CNB 同款脚本零改动，vitest worker 数到位后自然生效
- **优先级**：P2（依赖 G-1 的 worker 配置）

### 二、缓存与安装（4 项）

#### G-5：setup-node 缓存命中率

- **现状（CNB 口径）**：无 node_modules 缓存（自托管每次全量 clone + 装依赖）
- **GA 估算（未实测，读数见下方待办）**：setup-node cache: pnpm；冷装 pnpm install 曾按 ~6-8 分钟估（含原生编译），热装（缓存命中）按 ~2-3 分钟估 —— 这两个值**不是 GA runner 上的读数**，引用前先补测
- **影响判断**：缓存命中率未知；如果镜像仓只有本项目 CI 触发（每次都是独立 run），缓存可能因为 runner 复用率低而命中率低
- **建议改法**：
  - 在 pr-gate.yml / daily.yml 的 setup-node step 之后加一个"报告缓存状态"的小 step（`node -e "console.log(process.env.CACHE_HIT || 'cold')"` —— 但 setup-node 不暴露这个）
  - 实测几次冷装 vs 热装差异，确认缓存有效
  - 如果缓存命中率 < 30%，考虑改用 actions/cache 直接缓存 node_modules
- **优先级**：P0（安装是 GA CI 的固定成本；实际耗时待测 —— 见上方「未实测」，不要拿 6-8 分钟的估算当读数）

#### G-6：pnpm install 参数

- **现状（CNB 口径）**：`ci-install-deps.mjs` 包裹，多了缓存槽登记逻辑（自托管专属）
- **GA 实测表现**：pr-gate.yml / daily.yml / master-gate.yml 都是裸 `pnpm install --frozen-lockfile`，缓存槽登记在 GA 上空转（退出码 0）
- **影响判断**：GA 侧已是正确形态，零变更必要
- **建议改法**：保持现状
- **优先级**：已收口

#### G-7：LFS 配额

- **现状（CNB 口径）**：自托管本地 LFS
- **GA 实测表现**：GitHub LFS 1 GiB 存储 + 1 GiB/月带宽；每次拉取都计带宽；`checkout lfs: true` 会拉全部 LFS 对象
- **影响判断**：master-gate.yml 的文档链命令不碰字体等 LFS 对象 → 之前 `lfs: true` 是纯开销（PR #3223 修复）；pr-gate.yml 里只有 fixed-structural-tests / affected-tests 会跑字体用例 `tests/embedded-title-font.test.ts` → 只这两格必须 LFS；static-gates / typecheck-db-format / heavy-gates 不读字体
- **建议改法**：
  - master-gate.yml：已改为 `lfs: false`（PR #3223）
  - pr-gate.yml：只有 fixed-structural-tests / affected-tests 保持 `lfs: true`；其余三格不开（checkout 默认 false，不再写 `lfs: true`）
  - daily.yml：全量单测需要字体用例，保持 `lfs: true`
  - 监控 LFS 配额消耗，如接近 1 GiB/月，评估缓存 LFS 对象或减少拉取
- **优先级**：P2（当前配额充裕）

#### G-8：fetch-depth 配置

- **现状（CNB 口径）**：自托管每次全量 clone（OverlayFS 不可用），fetch-depth 无意义
- **GA 实测表现**：
  - pr-gate.yml static-gates：`fetch-depth: 0` ✅ 保留（分支守卫 / 提交声明核对 / 补丁覆盖率要读 `origin/master`，浅克隆里没有这条 ref）
  - pr-gate.yml typecheck-db-format：**回到 `0`**（`2` 被实测证伪：`--changed` 的基线是 payload 的 `CNB_PULL_REQUEST_TARGET_SHA`，不等于合成 merge 的 base 父；老 PR 重跑 + master 前进时基线更老、落在 depth=2 之外 ⇒ 三点 diff 退 2，ISSUE #3375）
  - pr-gate.yml fixed-structural-tests：`0` → `2` ✅（#3255 / #3329：按历史现算的判据改读仓内台账后，`fixed` 段不解析改动面、不读 git 全历史 ⇒ 浅检出重新成立；下节「被实测证伪的判断」记的是它**此前**退回 `0` 的那一轮）
  - pr-gate.yml affected-tests：**回到 `0`**（同 ISSUE #3375：`affected` 段要按三点 diff 算改动面，基线对象缺失就 fail-closed 退 2；`fixed` 段不解析改动面，故 `fixed-structural-tests` 那格可留 `2`）
  - pr-gate.yml heavy-gates：`fetch-depth: 0` ✅ 保留（依赖新鲜度按 `merge-base HEAD origin/master` 算，浅克隆没有 `origin/master`）
  - master-gate.yml：`fetch-depth: 0` → 1（PR #3223 修复）✅ 文档链命令只读当前树
  - daily.yml：**回到 `0`**（全量单测含按历史现算的判据，`1` 会红；本笔修正）
  - package-desktop.yml：`fetch-depth: 0` → 1（桌包档只 `pnpm tauri build`，不跑测试、不做三点 diff）✅
- **影响判断**：fetch-depth 过大 = 纯网络开销；过小 = 缺历史导致三点 diff / LFS / 按历史现算的判据（`git log --all`）失败；**凡读 `CNB_PULL_REQUEST_TARGET_SHA` 做三点 diff 的格必须全历史** —— 该 sha 是 PR 事件的目标分支快照，PR 存活期间 master 前进就会比合成 merge 的 base 父更老（ISSUE #3375）
- **建议改法**：逐个评估每份 workflow 的 checkout 配置，最小化 fetch-depth；**判据里有 `git log` 的格必须全历史**
- **优先级**：P0（冷装优化的核心）

### 三、拓扑（3 项）

#### G-9：job 拆分策略

- **现状（CNB 口径）**：PR 档多 stage 串行（薄化后 10 格）；每日档单 job 串行 13 格
- **GA 实测表现**：pr-gate.yml 已拆 5 个并行 job ✅；daily.yml 仍是单 job 串行（安装 → lint → 单测 → E2E → 覆盖率上报，每个 step 独立装依赖）
- **影响判断**：daily.yml 无法利用 GA 并行 job 能力；串行 290 分钟（接近 5 小时预算）
- **建议改法**：
  - daily.yml 拆分为并行 job：install（pnpm install + LFS）→ lint / ESLint / oxfmt / 单测 / E2E 各独立 job
  - 共享 setup-node + 缓存命中
  - 各 job 独立 timeout（lint 15m，单测 60m，E2E 30m，覆盖率上报 5m）
  - 总 wall clock 预计从 290m 降到 120-150m
- **优先级**：P1

#### G-10：concurrency 语义

- **现状（CNB 口径）**：lock.key 按 PR IID 分锁（`pr-$IID`），cancel-in-progress:true
- **GA 实测表现**：pr-gate.yml `pr-${{ github.event.client_payload.pr_number }}` + cancel-in-progress:true ✅；daily.yml `daily`；master-gate.yml `push-master` + cancel-in-progress:false（master push 不取消在跑的）
- **影响判断**：基本对齐；master-gate.yml 的并发组语义正确（master push 不互斥）
- **建议改法**：保持现状
- **优先级**：已收口

#### G-11：台账登记口径

- **现状（CNB 口径）**：COMFYAPP_CI_GATES / PUSH_GATES / DAILY_GATES + GATE_TIER_LEDGER 四份台账
- **GA 实测表现**：GA workflow 的 step 不进这些台账；只有入口脚本路径在 `COMFYAPP_CI_GATES_ELSEWHERE`
- **影响判断**：GA 侧 step 变更不会触发台账更新；但当前只有入口脚本路径登记，step 级不登记（刻意设计）
- **建议改法**：保持现状（GA side steps 不进台账）；如未来需要 GA 侧 step 级对账，单独加机制
- **优先级**：已收口

### 四、平台差异（5 项）

#### G-12：日志上限

- **现状（CNB 口径）**：单 stage 硬上限 102400 字节，超了静默截断不报错
- **GA 实测表现**：官方未明确 step 日志硬上限；广为流传的 4MB 是 Travis 旧信息
- **影响判断**：GA 日志可能更长，ship --gh-logs 回读需要适配
- **建议改法**：实测 GA 单 job 输出量上限；当前 ship --gh-logs 有 30KB 脱敏截断，加"如 GA 侧日志 > 30KB 则完整落盘到临时文件"的兜底（PR #3203 已实现完整落盘）
- **优先级**：P2（ship --gh-logs 已实现完整落盘兜底）

#### G-13：artifact 保留期

- **现状（CNB 口径）**：无 artifact 机制（产物留在工作区，下次构建抹掉）
- **GA 实测表现**：daily.yml 覆盖率 artifact 设 14 天；pr-gate.yml 无 artifact（不需要）
- **影响判断**：现状合理；14 天够回读
- **建议改法**：保持现状
- **优先级**：已收口

#### G-14：shell / 编码矩阵

- **现状（CNB 口径）**：PowerShell + CP936 编码；需要 `ci-cp936-exit.mjs` 包裹所有命令
- **GA 实测表现**：bash + UTF-8；不需要编码包裹
- **影响判断**：GA 侧直接跑真命令即可；所有 GA workflow 脚本零改动通过
- **建议改法**：保持现状
- **优先级**：已收口

#### G-15：6 小时总上限

- **现状（CNB 口径）**：无显式单流水线总上限；各 stage 独立 timeout
- **GA 实测表现**：单 job 硬上限 6 小时；单 workflow 也有 6h 上限
- **影响判断**：daily.yml 300 分钟（5h）在安全范围；拆分后更安全
- **建议改法**：拆分 daily.yml 后重算各 job timeout；总和 < 6h 即可
- **优先级**：P1（随 daily.yml 拆分）

#### G-16：失败重试

- **现状（CNB 口径）**：PR 档 retries:0（平台侧 PR 流水线明确声明不自动重试）
- **GA 实测表现**：无原生 job 重试配置；需要第三方 action 或手动重跑
- **影响判断**：GA 侧需要手动重跑；CNB 侧也是 retries:0，基本对齐
- **建议改法**：保持现状，不引入自动重试
- **优先级**：已收口

### 五、CNB 专有读数替代（5 项）

#### G-17：CNB_COMMIT 变量

- **现状（CNB 口径）**：平台原生注入，指向 PR 源分支 head（非合成 merge）
- **GA 实测表现**：pr-gate.yml heavy-gates job 从镜像 payload 的 `cnb_commit` 注入同名 env 变量；脚本零改动
- **影响判断**：镜像推送格必须正确传递 `cnb_commit`，否则格式化提交分离判据会退"没判"（exit 2）
- **建议改法**：保持 payload 传递路径；镜像推送脚本 `ci-github-mirror-push.mjs` 必须可靠传递
- **优先级**：P1（与 pr-gate.yml 绑定）

#### G-18：CNB_PULL_REQUEST_TARGET_SHA 变量

- **现状（CNB 口径）**：平台原生注入，三点 diff 基线
- **GA 实测表现**：pr-gate.yml / daily.yml 从镜像 payload 的 `base_sha` 注入同名 env 变量；脚本零改动
- **影响判断**：三点 diff 类判据（ci-affected-tests / premerge-check / check-format --changed）读同名变量；缺席时各自退回 merge-base（脚本内已有该口径）
- **建议改法**：保持 payload 传递路径
- **优先级**：P1

#### G-19：工作区出处（CNB 专有）

- **现状（CNB 口径）**：自托管节点的工作区路径、commit hash 等事实读数
- **GA 实测表现**：GitHub runner 无此概念；GA workflow 不承接这一格
- **影响判断**：留在 CNB push 档，不需要迁移
- **建议改法**：保持在 CNB push 档
- **优先级**：已收口

#### G-20：缓存槽读数（CNB 专有）

- **现状（CNB 口径）**：`ci-install-deps.mjs` 里的 COMFY_CI_SLOT 逻辑（自托管多节点缓存槽）
- **GA 实测表现**：setup-node cache 自动处理；GA 侧裸 `pnpm install --frozen-lockfile` 已是正确形态
- **影响判断**：已在 GA 侧正确收口
- **建议改法**：保持现状
- **优先级**：已收口

#### G-21：平台合成合并预览（CNB 专有）

- **现状（CNB 口径）**：pr-gate.yml 注释提到"平台合成合并预览，报错行号属于合并后的树"
- **GA 实测表现**：pr-gate.yml 按 payload 的 head_sha 检出同一棵树（CNB 合成 merge 的树）；tree 完全一致
- **影响判断**：两边判同一份树，判据等价
- **建议改法**：保持现状
- **优先级**：已收口

### 六、新缺口（GA 侧没有但应该有的）

#### G-22：GA pr-gate.yml 红日志 workflow 层补全

- **现状**：GA pr-gate.yml 任何 job 跑红后，GitHub Actions 会自动保留日志 7 天（公有仓）或 1 天（私有仓默认），但 ship 侧没有令牌无法自动回读
- **问题**：当 CNB 判决判定格判"GA 红"时，只有 runs API 的 conclusion=failure 结果，不知道具体哪个 job / step 红的
- **建议改法**：
  - pr-gate.yml 每个 job 在失败时 upload-artifact（job summary + 关键文件）
  - 失败 job 的 `if: failure()` 里加 `actions/upload-artifact@v4`
  - artifact 命名规则：`pr-gate-${{ github.event.client_payload.pr_number || 'manual' }}-${{ job.name }}-logs`
  - CNB 侧判决回读格可额外拉 artifact 并附到 CI 失败日志
- **优先级**：P0（当前 GA 红时无法诊断根因）✅ 已落地（本主题 PR）

#### G-23：镜像仓 GA workflow 变更的镜像同步机制

- **现状**：GA workflow 文件（pr-gate.yml / daily.yml / master-gate.yml）修改后，下次 CNB PR 流水线会自动推到镜像仓
- **问题**：如果镜像推送红（节点出网，近期频发），GA workflow 可能长期落后；镜像仓的 master 分支 HEAD 可能陈旧
- **建议改法**：
  - 在 CNB push 档新增一个"GA workflow 镜像自检"格：定期（每日或每次 push）核查镜像仓 HEAD 的 workflow 文件是否与本仓一致
  - 如果不一致，触发补推
- **优先级**：P2（当前手动 `pnpm ship --rerun-ci` 可临时解决）

## 落地顺序（建议）

1. **P0**：G-5 缓存命中率实测 + G-8 fetch-depth 评估 + G-22 红日志补全
2. **P1**：G-1 daily.yml 拆分 + G-2 NODE_OPTIONS 补齐 + G-9 job 拆分 + G-17/G-18 payload 路径验证
3. **P2**：G-4 concurrent + G-7 LFS 配额监控 + G-12 日志上限实测 + G-15 timeout 重算 + G-23 镜像同步机制
4. **已收口**：G-6/G-10/G-11/G-13/G-14/G-16/G-19/G-20/G-21 —— 零变更

## 被实测证伪的判断

- **「读 `CNB_PULL_REQUEST_TARGET_SHA` 做三点 diff 的两格，depth=2 就够」**（PR #3236 的推论：合成 merge 的两个父 = base 与 head）。
  - 证伪读数（PR #3366 重跑 `cnb-ukn-1k6sn867h` › GitHub `affected-tests` / `typecheck-db-format`，2026-11-08 04:46）：两格失败行逐字相同 ——
    `262308122060db67debad3bba1a9036fe9a5a9a2 的 diff 没跑起来（浅克隆 / 该 sha 不在本地对象库里；先 fetch 再跑）（退 2 —— 这一格没判，不构成证据）`。
  - 根因：payload 注入的 `CNB_PULL_REQUEST_TARGET_SHA = 26230812` 是 **PR 创建事件**的 master 快照；重跑时合成 merge 的 base 父已是 `b263d7d18`（比它新 3 笔），而 `--depth=2` 只 fetch 到合成 merge 的两个父 ⇒ 基线对象与它到 HEAD 的历史都不在本地对象库。同日新开的 PR（#3374 / #3393）base 与 base 父一致、depth=2 够 ⇒ 绿，故这一形只在「老 PR 重跑 + master 已前进」暴露。
  - 处置：`typecheck-db-format` / `affected-tests` 两格回到 `fetch-depth: 0`，判据脚本（`changed-scope.mjs` / `check-format.cjs` / `ci-affected-tests.mjs`）一字不改 —— 它们按 fail-closed 退 2 是正确行为；`fixed-structural-tests` 的 `fixed` 段不解析改动面，保持 `2`。
  - 作用域：`repository_dispatch` 取**镜像仓默认分支**的 workflow 定义 ⇒ 修复合进 CNB `master`、经 `master 合并复核` 的 `GitHub master 镜像` 那一格推到镜像仓之后，才对后续 PR 的 GA 判据生效；已在飞的 PR 需要各自重跑一次。
- **「pr-gate 三个装依赖 job 的 `fetch-depth` 都能收到 2」**（PR #3236 的假设：合成 merge 的两个父就是 base 与 head ⇒ 2 够）。
  - 证伪读数（GA run 42177286869 › `fixed-structural-tests`，2026-11-06 06:53–06:56，`git fetch --depth=2`）：
    ```
    FAIL tests/audits-doc-references.test.ts > docs/audits/** 的台账引用不许漂到已删的棘轮基线上 > 判据面非空：仓库历史里确实有已删的棘轮基线（否则上面那条在空转）
    AssertionError: expected 0 to be greater than 0
    Tests  1 failed | 265 passed (266)
    ```
  - 根因：`scripts/fixed-structural-tests.mjs:600` 把 `tests/audits-doc-references.test.ts` 列进固定清单；该用例用 `git log --all --diff-filter=D -- scripts/` 现算「已删的棘轮基线」，浅克隆下退化成空集（脚本注释里本就写着「浅检出时退化成空集，有专门用例判红」）。
  - 处置：`fixed-structural-tests` 回到 `0`；`affected-tests` 保持 `2`（`COMFY_AFFECTED_SEGMENT=affected` 不含固定清单）；`daily` 从 `1` 回到 `0`（全量单测含同一份用例）。
  - 时间差值得记：PR #3236 自己那跑是绿的 —— `repository_dispatch` 取的是**默认分支**的 workflow，所以检出面收窄的后果只在它合并之后的下一跑才暴露。

## 待验证项

- [ ] master-gate.yml 首次运行（镜像仓 force push master 是否必定触发 push 事件）—— 推断，非实测
- [ ] GA 侧冷装实际耗时（pnpm install 6-8 分钟是估算，未在 GA runner 上实测）
- [x] GA pr-gate.yml worker 数 —— 实测 1：`[ci-affected] 收尾复述：并发 --maxWorkers=1（2 核，os）`（`ceil(2/8)=1`）
- [ ] `COMFY_CI_MAX_WORKERS` 第二臂（覆盖 2）—— 卡在写权限：需仓库变量或 workflow 派发的写权限，当前令牌只有 `actions: read`
- [ ] 节点出网稳定性（github.com port 443 间歇性超时的根因是 runner 白名单还是网络抖动）—— #3046 已知问题
