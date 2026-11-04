## Fixed

- **PR 标题与 diffstat 的比对区间跟着 PR 的目标分支走，不再跟本地 upstream 走**（ISSUE #3021）：栈式 PR 的现场是「`git push -u` 把 upstream 置成父分支的远端副本，而本地那条远端跟踪引用停在父分支的旧点」—— 于是 `upstream..HEAD` 把父分支上**别人后加的**提交也算进来，标题取成别人的那一笔（#3017 那次取到 `#2955`），正文 diffstat 涨到 999 个文件，而平台按 `base.ref` 的当前顶端算出来只有 3 个。现在两处区间（标题的 `..HEAD` 与 diffstat 的 `...HEAD`）都从「PR 的目标分支」解析：新建时用它传给 `--base` 的那一条，复用时用平台回读的 `base.ref`（`readPullVerdict` 新增 `baseBranch`）；取数前先 `git fetch` 刷新该引用 —— 过期引用正是那次串味的真因。目标分支取不到时照实退回 upstream 并明念一句「没有跟随 `base.ref`」，不静默、也不猜成主干。非栈式场景的区间仍是 `<远端>/<主干>`，行为不变。
