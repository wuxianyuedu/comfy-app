#!/usr/bin/env node
// standalone 运行期可变产物的落盘根（日志 + 导出）。
//
// 为什么要有这一份：`standalone-runtime.mjs` 注释里点明 —— server.js 启动即
// `process.chdir(__dirname)`，于是 `process.cwd()` 被钉死成「载荷根 / 安装目录」
// （`APP_ROOT`）。那份目录既可能不可写（Program Files 类安装位），又会在更新时被整包
// 替换 —— 日志与导出落在这里会在更新后丢失，甚至首启就写不进去。`db.sqlite` / 运行期
// 密钥同理（ISSUE #3498），但它们的迁移要带首启拷贝旧库、风险另计；本模块只管日志与
// 导出的那一半。
//
// 单一事实来源：本函数算出的根经 `COMFY_APP_DATA_DIR` 环境变量交给 Next server
// （见 `launcher-core/standalone-runtime-env.mjs` 的 `buildStandaloneRuntimeEnv`），
// 启动器自己写 server / host 日志也用同一个值 —— 两侧必须指向同一处，否则「启动器写的
// server 日志」与「面板读的 `log/current/nextjs`」会对不上（日志面板直接废掉）。
//
// 覆盖优先：显式 `COMFY_APP_DATA_DIR` 最高优先（测试与高级用户都能指定），且让「数据根」
// 这一项只有一个来源；否则按 OS 取 app-data 目录，回退到 homedir 下的约定位置。依赖全部
// 可注入，便于跨平台单测（详见 `tests/app-data-dir.test.ts`）—— 本文件是纯 Node 宿主、
// 不在 Next 的模块图上，TS 侧没有声明文件。
import os from "node:os";
import path from "node:path";

/** 本应用的 app-data 目录名（跨平台一致，避免各 OS 形态分叉）。 */
export const APP_DATA_DIR_NAME = "comfy-app-t3";

/**
 * 解析 standalone 运行期数据根（日志与导出的落盘根，其下再拼 `log/` 与 `log/exports/`）。
 *
 * 依赖（env / platform / homedir）全部可注入，跨平台单测不需要真的跑在对应系统上。
 * @param {{ env?: Record<string, string | undefined>, platform?: NodeJS.Platform, homedir?: string }} [options]
 * @returns {string}
 */
export function resolveAppDataDir(options = {}) {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const homedir = options.homedir ?? os.homedir();
  // 显式覆盖最高优先：测试与高级用户都能指定，且让「数据根」这一项只有一个来源。
  if (env.COMFY_APP_DATA_DIR) {
    return env.COMFY_APP_DATA_DIR;
  }
  if (platform === "win32") {
    // `%LOCALAPPDATA%` 更适合「可重装 / 可清空」的运行期产物（日志 / 导出），不随用户漫游。
    const base = env.LOCALAPPDATA ?? env.APPDATA ?? path.join(homedir, "AppData", "Local");
    return path.join(base, APP_DATA_DIR_NAME);
  }
  if (platform === "darwin") {
    return path.join(homedir, "Library", "Application Support", APP_DATA_DIR_NAME);
  }
  // linux / other：XDG 数据目录，回退 `~/.local/share`。
  const base = env.XDG_DATA_HOME ?? path.join(homedir, ".local", "share");
  return path.join(base, APP_DATA_DIR_NAME);
}
