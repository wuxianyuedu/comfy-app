## Fixed

- **`docs/standards/07-日志系统.md` §7.19 那条「`appendSorted` 按 `seq` 合并批次
  （快路径：批次本就单调时直接 push，不排序）」** —— 一处名字过期 + **一条现在根本不存在的
  行为陈述**。对着现树复算（`src/components/studio/logs/log-timeline.ts`）：
  - 做合并的是 `mergeTimeline` / `mergeTimelineIndexed`，`appendSorted` 这个名字全树 0 命中；
  - **没有「批次单调就不排序」那条快路径** —— 只要这一批有新增就一定 `sort`；
    真正省下来的是**跨轮复用那份索引**（`rememberTimelineIndex` / `indexOfTimeline`），
    而且一批里没有新东西时连数组都不换（`added.length === 0` 直接回原数组）；
  - 排序键写得更精确一点：`time` 升序、`seq` **只作同毫秒的次键** —— 原文那句
    「按 `seq` 合并」容易被读成「seq 是主键」，而 `LogEntry.seq` 自己的注释就写着它
    不参与跨毫秒排序（ISSUE #262 那条定义）。
  改成上述三条，并留下去哪儿看实现的文件名。
- **同批判过、确认不是缺陷的两条**（batch3 的检索法留下的尾巴，别再重查）：
  - `docs/standards/launch-and-build.md` §5 那句「`build-desktop.mjs` 的 `STATIC_NOISE`
    又只剔目录名」：`STATIC_NOISE` 确实不在树上，但它在**「根因（当时）」那半句**里，
    而同一行的「已修」半句点的三个名字 `stripDevArtifacts` / `pruneStaticToAllowList` /
    `ALLOWED_SCRIPTS` **全部在场** —— 那一行不需要动，它已经把读者引到现状上了。
    顺带一条口径：那半句里**没有**后继常量名可以替换（旧的黑名单机制是被白名单整体换掉的，
    不是改名），所以「把旧名改成新名」这种修法在这条上根本不成立。
  - `docs/standards/16-shadcn-ui与表单校验.md` §16.2.4「项目产出 `STATUS_CHIP`」：
    那张表的列头是**「此前」**（这一节讲的是「七处各写一份配色」被收成一处之前的形状），
    所以旧名字是内容本身；现树里 `src/components/studio/ProjectOutputs.tsx` 用的是共享的
    `~/components/ui/status-badge` 的 `StatusBadge`，与那句不矛盾。没动。
- **这一族的查法**（可复用，本批与 batch3 同一份）：把台账文档里所有反引号包起来的标识符
  抽出来（3138 个），逐个对全代码树取字面命中；零命中的 126 个再**逐条读它所在句子的语境** ——
  绝大多数是框架名（`GetWindowRect` / `assetPrefix` / `ERR_PNPM_*`）、或已经自注过的改名/删除
  记录，剩下的才是真缺陷。**光看「命中数为 0」不能定缺陷**：上面两条都是 0 命中但都不该改。
- 复算：`pnpm doc:render` 后 `docs/generated/07-*` 与源同批；`render-doc-placeholders --check` ✓；
  `check-doc-references.cjs` 退 0；`check-changelog-fragments` ✓；
  `tests/check-doc-references.test.ts` + `tests/docs-candidate-hygiene.test.ts` +
  `src/components/studio/logs/log-store.test.ts` 全绿（最后那份是 `mergeTimeline` 的现有执行者，
  改文档不动它，跑一次是为了确认我引用的行为确实是它现在判的那件事）。
