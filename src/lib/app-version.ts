// 产品版本号的**运行时读取面**（浏览器 / 服务端同构）。
//
// 单一事实仍然是 `package.json` 的 `version`（外加 `tauri.conf.json` 与
// `Cargo.toml` 两处，由 `scripts/check-app-version.cjs` 守着三者逐字相等，
// 规范 launch-and-build §7.1.1）。此处只做一件事：**不在源码里另抄一份**。
//
// 为什么在源码里手抄一份是危险的：MCP `serverInfo.version` 此前是硬编码的
// `"0.1.0"`，而它没有任何读者会去核（客户端只把它显示出来）—— 版本升到 0.2.0
// 时它照旧说 0.1.0，且**没有任何东西会红**。凡是要显示产品版本的地方，一律
// 从这里取，别再写字面量。
//
// 为什么不用 `process.env.npm_package_version`：它只在 `pnpm run` 起的进程里
// 有值，`next build` 产出的 standalone 与桌面壳起的 Node 都不带它 ——
// 那种「本地能读、出厂读不到」的写法比硬编码更难发现。

import pkg from "../../package.json";

/** 当前产品版本号（= `package.json` 的 `version`）。 */
export const APP_VERSION: string = pkg.version;
