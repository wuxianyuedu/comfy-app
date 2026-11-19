## Changed

- **判红日志附件挂到 PR 本体，另配 `CNB_PULL_REQUEST_TOKEN`**（ISSUE #3454，#3437 / #3378 后续指令）：PR #3448 上用户连问两次「附件现在放在评论里，不能直接放在 PR 本身吗」，而 11:05 那一跑的 todo 记着「给出结论并回复 = completed」、评论区却没有回复落地。期望 1 已先用 `patch-pull` 把附件链写进 #3448 描述坐实「能放 PR 本体」（纯 API、一条命令可回退）；本格把那条一次性探针收成 relay 的常规通道。
- **令牌那一格（期望 3）人已拍板：另配一枚 `CNB_PULL_REQUEST_TOKEN`（`repo-pr:rw`），不给 `CNB_ISSUE_TOKEN` 扩权**。权限面是硬约束：`post-pull-comment` / `upload-file` 要 `repo-notes:rw`，`patch-pull` 要 `repo-pr:rw`；两枚各管一条通道。#3437 收敛时写下的「不新增 secret」旧约束只为描述这一格解除，评论 / 附件仍走原来那枚。
- GA 侧 `ci-ga-logs-relay.mjs`：在「上传 → PUT → 发 PR 评论」之后多一跳**只写镜像** —— `GET /-/pulls/{n}` 读回整段 body → `mergeRelayDescription` 摘掉自己旧的 `<!-- GA_LOG_RELAY_V1 … -->` … `<!-- /GA_LOG_RELAY_V1 -->` 成对块、逐字保留人工描述、把最新一块补到末尾 → `PATCH /-/pulls/{n}` 写回。评论先发（附件「发布」那一跳），镜像随后用同一条 `asset_link`；`PATCH` 的 `body` 是整段覆盖，所以读改写只换自己那块、不整段重发、不重复堆叠。
- **降级不承重**：`CNB_PULL_REQUEST_TOKEN` 是可选前提（不进 `reasons`），缺席 / GET 读不回 / 应答缺 `body` / PATCH 403 都只多一行读数 —— 评论已送达就仍是送达，不改三态、不改本 run 的 conclusion、不拦合。step 仍 `if: always()` + `continue-on-error`，判绿不发评论也不写描述。
- **两个来源显式分开**：评论列表 = 唯一权威读源（`ship-ga-logs-cnb.mjs` 仍只扫 `cnb pulls list-comments`，一行不改），PR 描述 = relay 的只写镜像、本地从不读。这正面回答接手时那条技术注意 —— 给描述通道加读回会让 `parseRelayComment` 把两处都命中、出现「读到哪份全凭列表顺序」；定成只写就不需要优先级规则。
- **不碰承重**：不写 commit-statuses、不改流水线 `name`、不改 `GA_VERDICT` 折叠、不改三态退码；「取不到 ≠ 判红」不变。构建详情页那个「附件」tab 仍是第三个对象（插件格要 Docker、自托管节点没开），与 PR 描述不是一回事。
- 逐笔对账同批：`ci-ga-logs-relay.mjs`（头注 / 纯函数 / 镜像函数 / 接线）/ `pr-gate.yml`（注入新 secret + 头注两枚令牌各管一摊）/ `tests/ci-ga-logs-relay.test.ts`（镜像块形状、摘块与人工描述保留、替换不堆叠、专用令牌逐跳、四种降级、描述失败仍 `CODE.OK`）/ `tests/no-platform-ci-config.test.ts`（env 接线 + 本地读者不读描述 + step 不承重）/ §13.5.33.6 续节 + 生成态镜像 / `ga-migration-checklist.md` + 镜像 / 本碎片。
