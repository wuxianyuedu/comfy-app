## Changed

- **把缓存槽的开关拨下去**（`COMFY_CI_SLOT=1`，`.cnb.yml` 里 PR 与每日两格安装依赖同值）
  （ISSUE #2022 第二步；机制在 #2045，规范 §13.5.3.4.3）。这一跑之后，`Install dependencies`
  在依赖面没变的构建里不再重装，而是把 `F:\runner\ci-cache\comfy-app-t3/<键>/node_modules`
  整棵接过来（一条 junction，实测代价 12 KB），并补跑一次 `node scripts/install-git-hooks.mjs`
  —— 补那一次是因为本仓的 postinstall 写的是检出的 `.git/config`（`core.hooksPath` +
  `git lfs install --local --manual`），那不在 `node_modules` 里、接槽接不过来。
  三档收益的读数出处是它自己的打印（`✓ 走缓存槽（reuse）` / `走缓存槽（install-into-slot）` /
  `槽未接管（原因）⇒ 照常装`），不是「这格看起来变快了」。

- **原来打算只拨 PR 那一格、把 `每日安装依赖` 留成「不走槽的对照臂」——被既有判据否掉了**：
  `tests/no-platform-ci-config.test.ts` 比的就是两条流水线的「命令行 **+ env 赋值**」逐字相同
  （§12.12 那条孪生判据长在配置上），当场红。让位的是对照臂这个想法，不是判据。而且它本来
  也不必要：该比的两侧在同一条流水线里各有打印 —— 未命中那一跑量的就是冷装本身，命中那一跑
  的打印里装那一跳根本没发生。回退 = 摘掉两处 env 里的 `COMFY_CI_SLOT` 那一行。

## Fixed

- **拨之前先补的一处洞**：槽里的指纹文件「在、但这一趟读不动」原先与「不在」同判，于是被判成
  「键变了」⇒ 走重装，而重装失败时那一句是**删掉槽**。并发作业下那棵树可能正被另一个作业接在
  上面（它是读到匹配指纹才接的），一次 `EBUSY` 的代价就是删掉别人正在用的依赖树。现在
  `readSlotState` 把三格分开（树在不在 / 读到什么 / 读不动），**读不动 ⇒ 不接、不重装、不删**，
  直接退回普通装。判据里用「同名的目录」造出 `existsSync` 为真而 `readFileSync` 必抛的形状钉住它
  （`tests/ci-slot-apply.test.ts`）。
