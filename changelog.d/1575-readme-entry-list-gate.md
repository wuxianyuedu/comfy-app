## Added

- **入口清单有了执行者：`README.md` 那两张入口表与磁盘 / `package.json` 三向对齐**（ISSUE #1575）。
  `check-ps1-consistency.mjs` 此前只核规范 §9.5 两侧文件存在，**不解析 README 那张表** ——
  而这正是记着账的盲区：R9 的注释把「根入口的 discoverability」明确托付给 README 的入口清单
  （「不靠铺在根目录第一眼看见」），于是「新加一个入口」有两条腿 —— 放对目录（R9 管）、
  登记进清单（没人管）。判据现在补上第二条腿，三向对齐：
  - **README → 磁盘**：两张表里每个 `.ps1` 路径真实存在（`tools/build/*.ps1` 这类通配要求真的命中脚本）；
  - **`pnpm` 命令 → `package.json`**：跨平台表的每条 `pnpm xxx` 是真实脚本（`install` / `dlx` 等内建除外）；
  - **磁盘 → 两份清单**：`tools/**` 下每个双击入口至少出现在 README 那张表**或**
    `tools/README.md` 的全目录视图 —— README 表刻意只收**日常动作**（构建 / Registry / Studio
    那几类由 `tools/README.md` 承担），**两份都收不到**才算违规；说不出来就写进脚本里的
    `ENTRY_LIST_EXEMPT` 逐条给理由（它同样核「指向的文件存在」与「已经登记过了却还留着」两种过期账）。
  另外拦一种反向错法：表里列**逻辑脚本**（`tools/scripts/*.ps1` / `*.logic.ps1`）——
  它们是入口背后的实现（同名不同层），不是「我想…就双击它」的落点。

## Fixed

- **`tools/start/Create-AppShortcut.ps1` 两份清单都没有**（判据上线时当场抓到）：它是
  `build-tauri-release.ps1` 构建成功后自动调用的补生成工具，但它自己的提示文案又写着
  「也可手动 `cargo build --release` 之后单独跑」—— 也就是**能用但没人知道它存在**。
  已在 `tools/README.md` 的全目录视图里登记（它属于按用途成组的那一类，不进 README 的日常动作表）。

## Tests

- `tests/ps1-consistency.test.ts` 新增 6 条：真仓库通过 + 三个方向的失效形态各一条
  （README 表里的路径不存在 / `pnpm` 命令不是真实脚本 / 两份清单都不收某个入口）
  + 入口表整节被删 + 表里列了逻辑脚本。临时仓库夹具同批补齐 —— 它现在会照抄真实的
  `tools/**` 入口清单，否则「磁盘 → 清单」那半边在夹具里恒为空、**永远不响**。
  判据的四个半段各做过反向变异（关掉任一段，对应用例即红）。
