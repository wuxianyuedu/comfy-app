## Added

- **产品版本号三处同步有了判据（ISSUE #1611 阶段三 D7 收尾）** ——
  `scripts/check-app-version.cjs` + `pnpm check:app-version` + pre-commit D 组
  「产品版本号三处同步(D7)」。同一个版本号手写在三个文件里
  （`package.json` / `src-tauri/tauri.conf.json` / `src-tauri/Cargo.toml`），
  而**没有任何一处判据认识它** —— 三处当时恰好相等，所以错位还看不出来。

  **为什么这不只是「改名要去三个地方」**：`tauri.conf.json` 的版本在**编译期**
  内嵌进壳，也是 `tauri-plugin-updater` 判「更新新旧」的基准。只升 `package.json`
  时，安装包与更新判定还停在旧版本 ⇒ 用户点「检测更新」看到「已是最新」，
  而实际发布的已经是新构建 —— 且第一次忘记升某处的那一刻起，这个错位**永久静默**。
  这也是 P0-4（Sentry release）刻意**不取** `package.json` 的 `version` 当 release
  的同一个理由（release 恒取 git sha）。

  **取向是「守住相等」，不是「合成一份来源」**：三个文件都得各写各的 ——
  `package.json` 由 npm 读、`tauri.conf.json` 由 tauri-build 在编译期读、
  `Cargo.toml` 由 cargo 读；让其中一个去 import 另一个，是在三个工具各自的清单格式里
  塞第四个语言（省一次改三处，代价是每次升级都要赌那个语法还被支持）。
  判据只判两件：三处都能读到且**逐字相等**、形态是 `MAJOR.MINOR.PATCH`
  （可带 `-pre` / `+build`）；**刻意不判**「该不该升」「有没有比上次大」
  「changelog 里有没有对应条目」——那是发布判断（§12.18）。

  `Cargo.toml` 那一处**按段切**读（只认 `[package]` 段内的那一行）：
  裸 grep 会把 `[dependencies.foo]` 里的 `version = "…"` 读成产品版本。

## Changed

- **顺带收掉「版本号的第四种抄法」：源码里再写一份字面量。**
  `src/server/mcp/workshop-mcp.ts` 的 MCP `serverInfo.version` 此前硬编码
  `"0.1.0"` —— 它**没有任何读者会去核**（MCP 客户端只把它显示出来），
  于是版本升上去它照旧说旧号且无人发现。现在从 `src/lib/app-version.ts` 的
  `APP_VERSION` 取（读 `package.json` 的 `version`），那三处由上述判据守着相等。
  不用 `process.env.npm_package_version`：它只在 `pnpm run` 起的进程里有值，
  standalone 与桌面壳起的 Node 都没有 —— 「本地能读、出厂读不到」比硬编码更难发现。

- **文档侧的同一种抄法由 `doc:check` 拦**：`docs/reference-facts.md` 新增
  `app.version` 事实（权威源 = `package.json` 的 `version`），扫描面刻意只收
  「引用产品版本」的两篇（`PRODUCTION-GAPS.md` / 主规范）—— 被扫描的文档里允许出现
  **别的**版本号（依赖 / Node / Rust），判「提到同一个号就红」会误报一片。
  这条事实上线时当场照出 `PRODUCTION-GAPS.md` 的 D7 条目里那个写死的版本号。

- `docs/guides/PRODUCTION-GAPS.md` 的 **D7 从待办改判为已闭合**，逐条记下判据
  文件名与「为什么不合成一份来源」（照台账口径：勾销必须与判据同批）；
  `docs/generated/PRODUCTION-GAPS.md` 由 `pnpm doc:render` 同步。
  规范 `launch-and-build` 新增 §7.1.1（三处各自由谁读、判据判什么、
  刻意不判什么），跨平台动作对照表（§9.5）登记新增动作，
  §13.1 的提交前清单加一行。

## Tests

- `tests/check-app-version.test.ts`（12 条）四头判：① 三处两两不等都红；
  ② 文件缺失 / 字段被挪段（`[workspace.package]`）/ 字段没了 —— **读不出也红**，
  不许静默放行；③ `[dependencies]` 段里的 `version` 不算产品版本（按段切）；
  ④ 接线在（`package.json` 入口 + 钩子 D 组真跑这一步）。
  **变异核过**：把钩子里那一步注释掉 → 第 ④ 组当场红（「D 组 53 步里没有版本号
  同步判据」）；复位全绿。
