## Changed

- **控制台从「全屏浮层」改成与历史 / 队列同形的视图**（ISSUE #1327 反馈）：用户点名
  「不要全屏界面，和队列/流程/历史等用一样形式的界面」。
  - **形态**：`ConsolePanel` → `ConsoleView`，外框由 `FullScreenLayer` 换成
    `DocumentFrame`（`width="wide"` + 居中列 + 页头 `h1` + 副标题 + 极光背景）——
    与历史 / 队列 / 模型库同一套形状；三段式（左预设 / 右输出 / 底部输入）与交互一字未改。
  - **入口**：从 `OVERLAY_NAV_ITEMS`（全局浮层入口）挪回 `NAV_ITEMS` 成为全局项
    `console`（`WorkspaceView` 与 `WORKSPACE_VIEWS` 同步登记），于是它有了自己的
    **视图页签**：能开、能关、能被命令面板与顶栏标题识别 —— 与历史 / 队列 / 流程
    同一套导航与页签语义。`AppShell` 里那份浮层接线随之删除。
  - **回收语义没变，这条要说清**：视图页签只在切换前后**记住「开着这一页」**，而
    工作区同一时刻只渲染当前视图（`page.tsx` 的 `switch`），所以切走会让
    `ConsoleView` 卸载、`use-console` 的清理断流、服务端据此回收整棵树
    （实测：切走的 5s 命令在日志里落成 `killed=true`）。这条与从前「关浮层就回收」
    一致，不是本次引入的回归；要的是「输出留在原地」的话，得把状态抬进模块级 store
    （与 `log-store` 同族），那是另一件事。
  - 判据同步：`nav-items.test.ts` 的浮层入口清单收成两项（模型适配 / 模式契约）、
    全局项清单末两位变成 `["workflows", "console"]`；`docs/guide-console.md` 的形态
    与「切走就回收」两节按新形态改写。

## Fixed

- **顺带收掉主干上那两条确定性红**（挡住任何分支的提交，硬闸类须为 0；`origin/master`
  干净 worktree 上单跑同样红，复算见 PR 说明）：
  - `tests/gate-executors.test.ts` 的 `判据脚本 44 份` 是**写死的读数**，而门禁链此后
    又真的多了一份判据（`check-gate-executors.cjs --report` 现在回 45）；改成断**性质**
    （`> 40`）加原有的逐名否定断言 —— 要防的是「把散文举例数成判据」，不是「总数等于某个数」。
    这与 `09aca6df` 的「读数不再写死」同一味药，当时漏了这个文件。
  - `tests/__snapshots__/theme-tokens.css-theme-surface.txt` 落后于 `globals.css`：
    缺 `--color-glow-*` 四颗（#1514 订正光晕形状时加的）。`vitest -u` 更新，diff 就是
    那四行新增 token。
  - 归属说明：这两条分别属门禁线与设计线，本轮只是**顺手解阻**（不修则本 PR 一条也提不上去）；
    各自的线如需按自己的口径改法，直接改这两处即可。
