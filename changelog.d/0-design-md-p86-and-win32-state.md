## Fixed

- **`docs/DESIGN.md` 里三处被落地否掉的句子**（都是本线自己写的，落地后几小时内就被后续提交推翻）：
  - **像素档那句「win32 只差首页两张、登记在 `PENDING_PLATFORMS` 里是欠条」已经不成立**：
    `98f50899`（ISSUE #1593）把首页两张补上并清空了登记表 —— 现跑 `git ls-files 'e2e/*.png'`
    两档各成套、`scripts/visual-baselines.mjs` 的 `PENDING_PLATFORMS` 是空表。照旧文读会以为
    还挂着欠条。
  - **「屏级页头的形状没人守」这一句也旧了**：ISSUE #1668 提的两格都由 `974b622f` 收掉，
    P86 已落成 `check-ui-primitives.cjs` 里的硬闸（现跑 `node scripts/check-ui-primitives.cjs --strict`
    = 85 条硬闸、0 处命中）。§Components「屏级页头」那节的执行者分工因此改成三头：
    **名字** = `page-name-single-source`（消费者面是一份具名清单，它不判新屏）、
    **字阶档** = P83、**形状** = P86（锚 `.u-title-page` 与 `mt-1 text-sm` 在 8 行窗口内同现，
    色类刻意不进锚 —— 写进锚会恰好漏掉唯一的手抄样本、落在 0 上永远绿）。
  - §Shapes 那句「页头由 `page-name-single-source` 按形态守着」指向了错的执行者，同步改掉。

## 记下的现场（本轮不修，属像素档那条线）

- **win32 像素档当前实测不绿，而且不是负载**：`node scripts/pixel-run.mjs` 跑 10 张红 5 张，
  **`--workers=1` 与默认并发红的是同一批** ⇒ §13.6.4 那条「降并发绿 = 机器问题」的出路在这里
  不成立。逐张归因：
  | 红的那张 | 归因 |
  | --- | --- |
  | 首页 暗 / 浅 | 红**只在侧栏三个标签的字形上**（模型适配 / 控制台 / 模式契约），正是 `2c9adb1b` 重构过的三项；而 win32 记账比那笔晚 37 分钟却没反映它 ⇒ 最合理解释是 AGENTS §4.3 的「运行图落后于源码」（录基线那台 dev 实例是旧的） |
  | 模型库空态 | 记账之后 `974b622f` / `71426352` 又改了模型屏 ⇒ 合法视觉变更，该重录 |
  | 画布「有内容」 | 它自己那条固定 id 的 `insert into "project"` 撞已存在行（库里留着 `e2e-visual-canvas`）⇒ **e2e 没做库隔离**，与像素无关 |
  | 日志面板默认档 | 红 1,031 像素、纯字形、稳定复现，**尚未归因**（同一屏的加宽档是绿的） |
- ⇒ 结论口径写进契约：**这份账现在不能当「win32 自证过」引用**。要恢复自证得「全新起一份
  dev server + 先把 e2e 那个固定 id 的项目隔离掉」再重录，那是 #1620 那条线的动作。

## 验证

| 项 | 结果 |
| --- | --- |
| `pnpm doc:check` | ✓ 文档引用与权威源一致 |
| `tests/design-md-contract-sync.test.ts` | 13 passed |
| P86 是不是真在守 | `node scripts/check-ui-primitives.cjs --strict` → 85 条硬闸、0 处命中（不是引用规范表的说法） |
| 基线与登记表 | `git ls-files 'e2e/*.png'` 两档各成套；`PENDING_PLATFORMS` 读源码确认为 `{}` |
| 像素档 | `pixel-run` 默认并发与 `--workers=1` 各跑一次，红的集合逐张比对相同（5/10） |
| 归因证据 | 首页 diff 图（红仅在侧栏三标签）、`db.sqlite` 里 `e2e-visual-canvas` 的 `createdAt` = 14:13（晚于 14:05 的记账）、`git log --since` 对照三笔改动的文件面 |
| `.githooks/pre-commit` | 见下方提交 |

**边界**：只改 `docs/DESIGN.md` 与这份碎片；**没有**重录任何基线、**没有**动 `db.sqlite`
（那 5 行项目里有别人的手工数据，删它要另拍）、**没有**关 #1620。
