"use client";

/**
 * 设置页「应用自更新」分区的 sub-hook（`use-settings-page` 的拆分件）。
 *
 * 收口 Tauri updater 与安装/重启的**全部暂态**（busy / available / version /
 * currentVersion / message / progress）与**三个动作**（checkAppUpdate /
 * installAppUpdate / relaunchApp）；重入判据走 `useReentrancyLock` 唯一出口
 * （规范 16 §16.2.4.69）：读 `busy` state 是同一次事件循环里判不出的
 * （setState 是异步落状态的），「检测中」点「安装」会并发发出去。
 *
 * 拆分动机：主 hook `useSettingsPage` 曾 900+ 行，把这一整块自更新的 state
 * 与动作沉出去，主 hook 只留「组合 controller」这一层。返回形状与主 hook
 * 之前的 `appUpdate` 对象逐字段一致，控制器与视图不感知——§12.18 复用优先，
 * 拆包只挪文件、不动契约。
 */
import { useCallback, useState } from "react";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import {
  checkAppUpdate as checkAppUpdateClient,
  downloadAndInstallUpdate,
  relaunchApp as relaunchAppClient,
} from "~/lib/shell/app-update-client";

/** 自更新分区的完整视图态（原 `SettingsPageController["appUpdate"]` 内联形状）。 */
export interface AppUpdateView {
  /** 是否在桌面壳内（决定「检测更新」是否可用）。 */
  inShell: boolean;
  /** 一次操作的进行态；idle 表示空闲。 */
  busy: "idle" | "checking" | "installing";
  /** 最近一次检测是否发现可用更新。 */
  available: boolean;
  /** 可用的远端版本号（available 时非空）。 */
  version: string | null;
  /** 当前本地版本号（可用时从检测结果读取）。 */
  currentVersion: string | null;
  /** 最近一次检测/安装的可读结果或提示。 */
  message: string | null;
  /** 下载进度（bytes，total 可能为空），installing 时非空。 */
  progress: { downloaded: number; total?: number } | null;
}

export interface UseSettingsAppUpdate {
  appUpdate: AppUpdateView;
  checkAppUpdate: () => Promise<void>;
  installAppUpdate: () => Promise<void>;
  relaunchApp: () => Promise<void>;
}

export function useSettingsAppUpdate(): UseSettingsAppUpdate {
  const [busy, setBusy] = useState<"idle" | "checking" | "installing">("idle");
  /* 检测 / 下载安装共用一把锁：两者都读同一份 busy 判据，分开锁会留「检测中
   * 点安装」并发发出去的窗口（读 busy 是同一次事件循环里判不出的）。 */
  const lock = useReentrancyLock();
  const [available, setAvailable] = useState(false);
  const [version, setVersion] = useState<string | null>(null);
  const [currentVersion, setCurrentVersion] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<{
    downloaded: number;
    total?: number;
  } | null>(null);

  const checkAppUpdate = useCallback(async () => {
    /* 重入判据走唯一出口（规范 16 §16.2.4.69）：读 `busy` 是同一次事件循环里
     * 判不出的（`setBusy` 是异步落状态的）。 */
    if (!lock.tryEnter()) return;
    setBusy("checking");
    setMessage(null);
    const result = await checkAppUpdateClient();
    setBusy("idle");
    setAvailable(result.available);
    setVersion(result.update?.version ?? null);
    setCurrentVersion(result.update?.currentVersion ?? null);
    setMessage(result.detail);
    lock.exit();
  }, [lock]);

  const installAppUpdate = useCallback(async () => {
    if (!lock.tryEnter()) return;
    setBusy("installing");
    setMessage(null);
    setProgress({ downloaded: 0 });
    const result = await downloadAndInstallUpdate((downloaded, total) => {
      setProgress({ downloaded, total });
    });
    setBusy("idle");
    setProgress(null);
    // 安装成功后应用通常会退出重启；失败时把可读错误透给用户。
    setMessage(result.triggered ? "更新已安装，应用即将重启…" : result.detail);
    lock.exit();
  }, [lock]);

  const relaunchApp = useCallback(async () => {
    const result = await relaunchAppClient();
    if (!result.ok) {
      setMessage(result.detail);
    }
  }, []);

  return {
    appUpdate: {
      inShell: isDesktopShell(),
      busy,
      available,
      version,
      currentVersion,
      message,
      progress,
    },
    checkAppUpdate,
    installAppUpdate,
    relaunchApp,
  };
}
