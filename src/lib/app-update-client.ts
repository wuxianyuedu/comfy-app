// 应用自更新能力封装：Tauri updater（检测/下载/安装）+ process（重启）。
//
// 归属：壳交互（桌面侧能力），放 src/lib/<domain>-client.ts（AGENTS.md 硬规则 9：
// 视图层不得新增 IO，壳/网络调用统一进 lib 客户端）。浏览器 / dev 环境下
// 两个插件都不存在，调用返回「不可用」，视图据此降级提示，不散落探测。
//
// 更新源与签名公钥在 src-tauri/tauri.conf.json 的 plugins.updater 配置；未配置
// 端点时 check() 返回 null（视为无更新），UI 提示「未配置更新源」。

import { isDesktopShell } from "~/lib/desktop-shell-client";

/** 一次「检测更新」的结果：是否有可用更新及其元信息。 */
export interface AppUpdateInfo {
  currentVersion: string;
  /** 远端可用版本；无更新时为 null。 */
  version: string | null;
  date?: string;
  body?: string;
}

export interface AppUpdateCheckResult {
  ok: boolean;
  /** 是否确有可用更新。 */
  available: boolean;
  /** 可读结果 / 失败原因。 */
  detail: string;
  /** available 为 true 时附带的更新元信息。 */
  update?: AppUpdateInfo;
}

export interface AppUpdateInstallResult {
  ok: boolean;
  /** 是否已触发安装/重启（Windows 端 install 后应用即退出）。 */
  triggered: boolean;
  detail: string;
}

/** 下载进度回调：已下载字节 / 总字节（contentLength 可能为空）。 */
export type AppUpdateProgress = (downloaded: number, total?: number) => void;

const NOT_SHELL = "当前不在桌面壳内，无法检测应用更新";

/**
 * 检测应用更新。仅桌面壳内可用；非壳环境或未配置更新源时返回 ok=false /
 * available=false，调用方据此给出可读提示。
 */
export async function checkAppUpdate(): Promise<AppUpdateCheckResult> {
  if (!isDesktopShell()) {
    return { ok: false, available: false, detail: NOT_SHELL };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      return {
        ok: true,
        available: false,
        detail: "当前已是最新版本",
      };
    }
    return {
      ok: true,
      available: true,
      detail: `发现新版本 ${update.version}（当前 ${update.currentVersion}）`,
      update: {
        currentVersion: update.currentVersion,
        version: update.version,
        date: update.date,
        body: update.body,
      },
    };
  } catch (e) {
    return {
      ok: false,
      available: false,
      detail: `检测更新失败：${e instanceof Error ? e.message : String(e)}。请确认已配置更新源与签名公钥。`,
    };
  }
}

/**
 * 下载并安装应用更新，成功后重启应用使新版本生效。
 * reportProgress 用于视图层展示进度条。Windows 端 install 完成后应用会自行退出，
 * 因而本方法返回即表示已触发安装（不再等待应用事实退出）。
 */
export async function downloadAndInstallUpdate(
  reportProgress?: AppUpdateProgress,
): Promise<AppUpdateInstallResult> {
  if (!isDesktopShell()) {
    return { ok: false, triggered: false, detail: NOT_SHELL };
  }
  try {
    const { check } = await import("@tauri-apps/plugin-updater");
    const update = await check();
    if (!update) {
      return { ok: false, triggered: false, detail: "未发现可用更新" };
    }
    let downloaded = 0;
    let total: number | undefined;
    await update.downloadAndInstall(
      (event) => {
        if (event.event === "Started") {
          total = event.data.contentLength;
          reportProgress?.(0, total);
        } else if (event.event === "Progress") {
          downloaded += event.data.chunkLength;
          reportProgress?.(downloaded, total);
        }
      },
      { restartAfterInstall: true },
    );
    // Windows 下 install 成功后会退出应用；走到这里说明未自动重启（非 Windows），
    // 成功安装后交由调用方决定是否显式 relaunch。
    return { ok: true, triggered: true, detail: "更新已安装并重启" };
  } catch (e) {
    return {
      ok: false,
      triggered: false,
      detail: `更新失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

/**
 * 重启应用（不涉及更新）。由「重启应用」按钮调用，也作为更新流程的收尾兜底。
 */
export async function relaunchApp(): Promise<{ ok: boolean; detail: string }> {
  if (!isDesktopShell()) {
    return { ok: false, detail: NOT_SHELL };
  }
  try {
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
    // relaunch 成功即触发进程重启，此调用通常不返回。
    return { ok: true, detail: "已触发重启" };
  } catch (e) {
    return {
      ok: false,
      detail: `重启失败：${e instanceof Error ? e.message : String(e)}`,
    };
  }
}
