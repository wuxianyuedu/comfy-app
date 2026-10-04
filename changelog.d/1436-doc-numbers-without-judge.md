## Fixed

- **`allowBuilds` 的条数在文档里写死了三处，实际早已从 6 漂到 11**
  （`AGENTS.md`、`docs/standards/launch-and-build.md` 两处）。它漂了没人发现，
  因为**这个数字没有任何执行者**：`allowBuilds` 不在 `docs/reference-facts.md`
  的登记表里，所以 `pnpm doc:check` 核不到它 —— 与 §13.10.5「别写钩子步数」是同
  一类问题（写死的数字会静默过期，而判据变红不了）。

  修法不是把 6 改成 11（下一个新依赖又会漂），而是**把数字从文档里拿掉**，
  改成指向权威源（「条数以 `pnpm-workspace.yaml` 为准」）。三处同口径：
  `AGENTS.md` 硬规则 2、`launch-and-build.md` 的排障表与钉死项表。

## Fixed

- **两处 `TODO` 注释带着「本 PR / 批次」的口径**（规范 §12.4.2）：
  - `src/components/studio/queue/hooks/use-queue-monitor.ts` 写着「故**本 PR** 不为此
    重构那个常驻 hook」—— PR 归属归 git log，写进注释会随代码搬迁过期失真。
    改写成「已知的重复消费（未修）+ 收口方向 + 改哪一处会牵动这条成本」，
    信息量不减、但不依赖「当时那个 PR 是谁」。
  - 同一处顺带把 `TODO:` 前缀去掉：本仓的注释口径是「只写当前代码的 Why」，
    规划性文字要么落成判据、要么写成现状描述（`TODO` 会让人以为有工单跟着，
    实测没有）。
