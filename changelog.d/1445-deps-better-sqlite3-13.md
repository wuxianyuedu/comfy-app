## Changed

- **`better-sqlite3` 12.11.1 → 13.0.3**（ISSUE #1445 第 5 件，**大版本**；原生模块）。

## Fixed

- **`pnpm-workspace.yaml` 的 `allowBuilds`：`"better-sqlite3": true` → `false`**（v12 时
  这里是 `true`）。v13 换了发版形态，这条批准从「必要」变成了「有害」：
  - v12 的 `install: prebuild-install || node-gyp rebuild` —— 靠安装期**下载**预编译产物；
  - v13 **没有 `install` 脚本了**，改成**随包附带** `prebuilds/<platform>.node`（8 个平台，
    含 `linux-x64` / `win32-x64`），由 `lib/binding.js` 按当前平台直接 `require`，运行期
    根本不需要编译；`engines` 也随之从 `20.x || 22.x || …` 收成 `>=22`（本仓 `.nvmrc` 是
    24 线，满足）。
  - 但包仍带 `binding.gyp` 与 `"gypfile": true`，pnpm 据此**隐式**跑 `node-gyp rebuild`：
    在没装 C++ 工具链的环境里那句必然失败（本仓构建容器实测 `make` / `gcc` / `g++` 全缺，
    报 `gyp ERR! stack Error: not found: make`），整个 `pnpm install` 以
    `ERR_PNPM_EXECUTOR_LIFECYCLE_SCRIPT_FAILED` 中断 —— **而它要产出的那个 `.node` 包里
    本来就有**。这是本次升级唯一的硬阻塞，且只在缺工具链的环境现形（本地有 MSVC / make 的
    机器不会踩到，属「绿色开发机、红色构建机」那一类）。
  - 改成 `false` 之后：既不触发未批准构建，也不再让一次无谓的编译决定 install 成败。
  - **判据**（不是「看起来能装」）：`require("better-sqlite3")` 开内存库、建表、读写往返
    实测通过（13.0.3 / linux-x64，SQLite 3.53.4）；`pnpm exec vitest run tests/ src/server/`
    144 文件 / 2040 条通过。

- **本仓其实早就为 v13 做过适配**，本次只是把它接上：`tests/helpers/test-db.ts` 的
  `serializeValue` 已经在归一 boolean → 1/0，提交 `d93807ef`（fix(test-db): 归一 boolean 为
  1/0，修复 better-sqlite3 v13 无法绑定）就是为这件事留的 —— v13 不再隐式把 `true` 强转 1。
  本次核过那条归一化仍在生效、所有走内存测试库的用例全绿。
- 顺带把「谁在运行期用这个包」核对清楚，避免把测试基建的升级读成运行时驱动的升级：
  运行时数据库走的是 **`@libsql/client`**（`src/server/db.ts` 的文件头就写着为什么要从
  better-sqlite3 换走 —— 同步驱动会堵住整个 Next 事件循环）；`better-sqlite3` 现在只出现在
  **测试基建**（`tests/helpers/test-db.ts` 的内存库）与 `drizzle-kit` 工具链里。因此这一件
  不影响分发包，也不进 standalone 产物（产物层的 `check-standalone-contents.cjs` 照旧退 0）。
