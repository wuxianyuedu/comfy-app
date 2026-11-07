## Fixed

**镜像推送前加「远端是不是已经更新」这道闸，迟到重跑不再把 GitHub `master` 推回旧值**（ISSUE #3252）：

- 现场回归：`cbb029de` 已推上去之后，旧 HEAD `b209aa05` 的迟到重跑用
  `git push --force` 把 GitHub `master` 退回 `b209aa05`；现有的推后回读只验
  「远端 == 本次 HEAD」，这一刀本身是「成功」的，抓不到这种倒退。
- `scripts/ci-mirror-remote-guard.mjs`：推送前单发读一次远端 ref，按本地对象库判祖先
  （`cat-file -e` + 双向 `merge-base --is-ancestor`）。远端是本次 HEAD 的后代 ⇒
  拒推、退 `1`（作为**事实**，日志带 `remote=` / `local=` 完整 sha）；
  分叉、以及完整克隆下「远端 sha 本地不存在」同样拒推。
- **与探活的分工**：单发、不重试、不占推送重试预算；`ls-remote` 读不到 / 浅克隆
  只逐字记「闸不可用」并照推，不会回到「出网抖动 ⇒ 整格 `exit 2`」。
- 其余形态照推：远端 ref 不存在（首次推送）、远端与 HEAD 相等（0 对象）、远端落后。
- 这道闸只挂 master 档（`runMasterMirror`）；PR 档不加。
- 用例：后代拒推（双 sha、不发起 push）、分叉拒推、完整克隆缺对象拒推、
  shallow 放行、读失败照推（不付退避）、ref 不存在照推、相等 / 落后照推。
- 首跑读数（`cnb-rqs-1k6r4p7b7`，HEAD `d67bda56` 的 push 构建）：`ls-remote` 撞
  `Recv failure: Connection was reset` ⇒ 逐字记「前闸：闸不可用（ls-remote 没通）→ 照推」，
  随即推送 6 次仍 `Failed to connect to github.com port 443 after 21046 ms`、预算 201s
  用尽 ⇒ `exit 2`（读数档折绿）—— 出网抖动时闸**没有**把整格短路成 `exit 2`。
- 本地校验：`tests/ci-github-mirror-push.test.ts`（含 7 条前闸用例）、
  `tests/ci-pr-failure-issue.test.ts`、`tests/ci-mirror-drift.test.ts` 全绿；
  `tsc --noEmit`、`pnpm lint`、oxlint 清零规则、基础设施文件长度闸均为 0。
