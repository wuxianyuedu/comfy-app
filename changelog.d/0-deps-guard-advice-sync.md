## Fixed

- **同一个约束在两条出口话术里仍然是「靠人记」**（AGENTS 硬规则 9 的收口漏项）：
  上一轮给这条规则补了现场执行者 `runningAppInstances()` 与 `pnpm deps:guard`，
  并把 `README.md` §9.5 与 `launch-and-build.md` §3.2 接上了；但**人真会照着做的那两份**
  没跟上 —— `scripts/check-deps-freshness.mjs` 的四处出口里仍写「在项目根执行
  `pnpm install`」并用括号口头提醒「dev server 正在跑时先关掉」，
  `docs/guides/sync-after-pull.md` 全文一次都没提这个命令（实测 `grep -c` = 0）。
  后果不是不好看：判据把「去装依赖」指给人，人手里却没有那条已经存在的拦子，
  仍然会撞 EPERM 连锁失败。现在三处出口点名 `pnpm deps:guard`（漂移 / 解析不到 /
  远端陈旧那三档），指南的 §2 标准操作与 §4 对照表同步，
  「dev server 正在运行」那一行从「先关掉再装」改成「不用自己判断，`deps:guard` 按归属拦下并给 PID」。

## 刻意没做的事（写清楚，别当成已完成）

- **`no-install` 那一档不加 `pnpm deps:guard`**，并在代码里写了原因：
  「没有安装记录」与「本检出的应用服务在跑」不会同时成立（跑着的服务必然踩在一份
  装好的树上），在那里加一步是噪声 —— 与其余三档的区别是**判据成立的前提不同**，
  不是漏改。
- 没有把「删 `node_modules` 重装」那段 PowerShell 也改成前置调用，只在对照表那一行
  补了同一句提醒：删目录同样是会被活进程锁住的动作，但它属于「已经决定要重装」
  的分支，出口该由那段脚本自己说，不在表里重复一遍实现。

## 验证

- 判据输出改了 3 处字符串，**改前查过谁钉着它们**：`grep -rn "在项目根执行 pnpm install" tests/`
  只命中我自己测试文件里的一句注释，没有断言；逐字引用这两句的是指南与它的生成物
  （`docs/guides/sync-after-pull.md` ⇄ `docs/generated/sync-after-pull.md`），
  所以按 §13.5.5 的口径重跑 `pnpm doc:render` 让生成物同源，而不是手改生成物。
- `pnpm doc:check` 绿（文档引用与权威源一致）；`tests/deps-freshness-gate.test.ts`
  + `tests/dev-launcher-dependency-sync.test.ts` 共 30 条，29 绿。
- **那 1 条红不是本次引入的**，也不是我碰过的文件：断言取的是 `if (gated.error) {`，
  而 `dev-launcher.mjs` 的**全部历史**里这个字面量一次都没出现过
  （`git log -S 'if (gated.error) {' -- scripts/dev-launcher.mjs` 为空），
  引入这条断言的提交与把实现写成 `if (!gated.ok) {` 的是同一个
  （`46244f1b`，它不是我分支点的祖先，经 squash 进入 master）。
  即 **master 上现在就挂着一条永远不可能变绿的编排器断言**。已单独报给业主，
  修法是把断言改成实际形态并保留意图（编排侧把预检失败转成非零）。
