"use client";

/**
 * 设置页「ComfyUI 启动 / 状态 / 打开」分区的 sub-hook（`use-settings-page` 的
 * 拆分件，与 `use-settings-page-ollama` / `use-settings-page-db-studio` 同族）。
 *
 * 收口：状态与安装形态两份查询（comfyStatus 5s 轮询、enabled 门控与首屏配置
 * 就绪挂钩）、启动（先把当前草稿里的 ComfyUI 各项落库再拉起，之后重判形态）、
 * 关闭、页签内嵌打开（ISSUE #310 的单窗口语义）、系统浏览器打开（与页签并列）、
 * 以及运行时启动日志的 active 判据。
 *
 * 拆分动机：主 hook 870+ 行；ComfyUI 这一整块与 Ollama / DbStudio 一样是
 * 「状态查询 + 动作 + 日志」的自洽单元，共享的只有「保存草稿」——经参数注入
 * （`settingsDraft` / `showFlash` / `setSaving`）。返回形状与主 hook 原
 * controller 逐字段一致，视图与测试都不感知——§12.18 复用优先。
 */
import { useCallback, useState } from "react";

import { runAsyncAction } from "~/lib/async-action";
import { useShellTabs } from "~/lib/shell/shell-tabs-store";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { openComfyTab } from "~/lib/comfy/comfy-tab-client";
import { shouldUseBrowserTab } from "~/lib/comfy/comfy-embed";
import { api } from "~/trpc/react";

import { useExternalAction } from "~/components/ui/use-external-action";
import { useRuntimeLogSource } from "./use-runtime-log-source";
import type { Settings } from "./use-settings-page-types";

export function useSettingsComfy(input: {
  /** 当前偏好草稿：启动动作会先把草稿里的 ComfyUI 各项落库再拉起。 */
  settingsDraft: Settings | null;
  showFlash: (kind: "ok" | "err", text: string) => void;
  setSaving: (value: boolean) => void;
  /** 首屏两份配置就绪前不发秒级探测（与 Ollama / DbStudio 同一门控）。 */
  statusQueriesEnabled: boolean;
}) {
  const { settingsDraft, showFlash, setSaving, statusQueriesEnabled } = input;
  /* 启动动作自带「先把当前草稿里的 ComfyUI 各项落库」——这份 mutation 与
   * 主 hook 的 `saveSetting` 是同一端点的两个独立实例（tRPC mutation 无共享
   * 状态），互不影响。 */
  const saveSetting = api.setting.save.useMutation();
  const [comfyStarting, setComfyStarting] = useState(false);
  const comfyInstanceQ = api.setting.comfyInstance.useQuery();
  const comfyStatusQ = api.setting.comfyStatus.useQuery(undefined, {
    refetchInterval: 5_000,
    refetchIntervalInBackground: false,
    enabled: statusQueriesEnabled,
  });
  const comfyStartM = api.setting.comfyStart.useMutation();
  const comfyStopM = api.setting.comfyStop.useMutation();
  /* 「在浏览器打开」：服务端能力早就有了（openComfyUi → openUrlInBrowser 拉起
   * 系统默认浏览器），此前只缺一个能点到它的入口。与页签内嵌**并列**，不替代。 */
  const comfyOpenM = api.setting.comfyOpen.useMutation();
  const [comfyStopping, setComfyStopping] = useState(false);
  const [comfyOpening, setComfyOpening] = useState(false);

  /* ComfyUI / Drizzle Studio 状态探测延后到首屏两份配置就绪后再发：
   * comfyStatus 在 ComfyUI 未运行时要对连续端口段做超时探测（秒级），
   * 同挂载触发会被 httpBatchLink 并进首屏同一批请求，而批量响应不分块
   * 流式返回 —— 首屏只需要的 get/configGet 会被迫等整批结束，页面
   * 多停在加载态数秒。（enabled 门控经参数传入；两份查询的说明见
   * 主 hook 对 `statusQueriesEnabled` 的注释。） */
  /* ── ComfyUI 启动 ───────────────────────────────────────── */
  const startComfy = useCallback(async () => {
    setSaving(true);
    setComfyStarting(true);
    try {
      await runAsyncAction(
        async () => {
          await saveSetting.mutateAsync({
            comfyuiPath: settingsDraft?.comfyuiPath,
            comfyuiExtraArgs: settingsDraft?.comfyuiExtraArgs,
            comfyuiAutoStart: settingsDraft?.comfyuiAutoStart,
            comfyuiPort: settingsDraft?.comfyuiPort,
          });
          const result = await comfyStartM.mutateAsync({});
          await comfyStatusQ.refetch();
          // 启动动作会先把当前草稿（含路径）落库：形态跟着重判定一次。
          await comfyInstanceQ.refetch();
          /* 端点返回 `{ ok, detail }` 的信封（服务端自己探过启动结果），
           * 交给出口按同一口径读 —— 调用处不再写 `result.ok ? "ok" : "err"`。 */
          return result;
        },
        { report: showFlash, failureText: "启动 ComfyUI 失败" },
      );
    } finally {
      setSaving(false);
      setComfyStarting(false);
    }
  }, [
    settingsDraft,
    saveSetting,
    comfyStartM,
    comfyStatusQ,
    comfyInstanceQ,
    showFlash,
    setSaving,
  ]);

  const stopComfy = useCallback(async () => {
    setSaving(true);
    setComfyStopping(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await comfyStopM.mutateAsync();
          await comfyStatusQ.refetch();
          return result;
        },
        { report: showFlash, failureText: "关闭 ComfyUI 失败" },
      );
    } finally {
      setSaving(false);
      setComfyStopping(false);
    }
  }, [comfyStopM, comfyStatusQ, showFlash, setSaving]);

  const openComfy = useCallback(async () => {
    /* 浏览器 / dev 形态：不内嵌、不占应用内页签栏，直接把 ComfyUI 交给新浏览器
     * 页签。window.open 必须在任何 await 之前同步调用才不被弹窗拦截器拦下，所以
     * 这条分支放在 refetch 之前，用状态轮询已缓存的 base（浏览器里轮询很勤，基本
     * 是新鲜的）；拿不到缓存才退回 refetch（冷启动罕见路径）。见 comfy-embed.ts
     * `shouldUseBrowserTab` 的形态说明。 */
    if (shouldUseBrowserTab(isDesktopShell())) {
      const cached = comfyStatusQ.data?.base ?? null;
      if (cached) {
        window.open(cached, "_blank", "noopener,noreferrer");
        showFlash("ok", `已在新浏览器页签打开 ComfyUI（${cached}）`);
        return;
      }
      setComfyOpening(true);
      try {
        const fresh = await comfyStatusQ.refetch();
        const b = fresh.data?.base ?? null;
        if (!b) {
          showFlash(
            "err",
            "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看",
          );
          return;
        }
        window.open(b, "_blank", "noopener,noreferrer");
        showFlash("ok", `已在新浏览器页签打开 ComfyUI（${b}）`);
      } finally {
        setComfyOpening(false);
      }
      return;
    }

    setComfyOpening(true);
    try {
      await runAsyncAction(
        async () => {
          /* 点「打开查看」前先要一份新鲜状态：用户此刻的意图就是「打开我在运行的
           * 实例」，拿几秒前的旧结论会直接报「未在运行」并把按钮禁用掉（ISSUE #339
           * 里「外部已经启动了，界面却打不开」的观感来源）。 */
          const fresh = await comfyStatusQ.refetch();
          const base = fresh.data?.base ?? comfyStatusQ.data?.base ?? null;
          if (!base) {
            showFlash(
              "err",
              "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看",
            );
            return;
          }
          /* 桌面壳：打开方式由服务端探测结论决定（ISSUE #310）——目标是**只有多页签**、
           * 不弹第二个窗口。正常情况下 ComfyUI 由本应用拉起、启动参数带了
           * `--enable-cors-header`，跨源不会被 origin-only 中间件拦 403，直接内嵌；
           * 万一判到不可嵌（外部实例不受本应用参数控制等），页签照常打开、里面渲染
           * 可读说明 —— 仍留在同一个窗口里，不另开窗口。 */
          const decision = await openComfyTab(base, window.location.origin);
          // 用稳定 id 打开 ComfyUI 页签：重启后端口偏移（base 变化）时
          // 复用同一页签并刷新地址，而不是叠出重复页签。
          useShellTabs.getState().openTab({
            id: "comfyui",
            label: "ComfyUI",
            url: decision.embedUrl,
            closable: true,
            blockedReason:
              decision.target === "blocked" ? decision.detail : null,
            /* 不可嵌时把地址一并带进说明：用户能复制到浏览器自查，也能判断
             * 是外壳拦的还是 ComfyUI 自己拦的（ISSUE #310）。 */
            blockedUrl: decision.target === "blocked" ? decision.base : null,
          });
          showFlash(
            decision.target === "embed" ? "ok" : "err",
            decision.detail,
          );
        },
        { report: showFlash, failureText: "打开 ComfyUI 失败" },
      );
    } finally {
      setComfyOpening(false);
      // 无论成败都刷新状态行，修正探测抖动（如进程查询超时）造成的「未运行」显示。
      // （原实现成功与失败路径各有一次 refetch，收进 finally 统一为一次。）
      await comfyStatusQ.refetch();
    }
  }, [comfyStatusQ, showFlash]);

  /* 「在浏览器打开」＝把 ComfyUI 交给系统默认浏览器（放大看 / 装浏览器插件 /
   * 多屏铺开）。它与页签内嵌是**并列出口**，不改变页签那一套：页签仍然内嵌，
   * 这里只是把同一个地址再交给浏览器。
   *
   * 端点用 comfyOpen 而不是 openExternal：地址由服务端自己探（openComfyUi 内部
   * 先 probeComfyUi），不采信前端 state 里的旧 base —— 用户点按钮时可能已经
   * 隔了很久，端口可能已经变了，拿旧地址会打开一个空白浏览器页。
   *
   * 与 openComfy 一样先 refetch 一次状态，避免拿几秒前的旧结论误报「未运行」。 */
  const openComfyInBrowserAction = useExternalAction({
    target: "browser",
    report: showFlash,
  });
  const openComfyInBrowser = useCallback(async () => {
    await openComfyInBrowserAction.run(async () => {
      await comfyStatusQ.refetch();
      return comfyOpenM.mutateAsync();
    });
  }, [openComfyInBrowserAction, comfyOpenM, comfyStatusQ]);

  /* ── 常驻服务启动日志（ComfyUI）─────────────────────────────
   * 追加不轮转的文件（多次启动的行混在一起），服务端按会话横幅切分后回
   * 「会话列表 + 选中会话正文」，见 use-runtime-log-source。
   * `active` = 正在启动 → 每秒跟随本次启动；否则挂载 / 刷新时取一次。 */
  const comfyLogActive = comfyStarting || !!comfyStatusQ.data?.starting;
  const comfyLog = useRuntimeLogSource({
    source: "comfyui-runtime",
    active: comfyLogActive,
  });

  const comfy = comfyStatusQ.data;

  return {
    comfyStatus: comfy
      ? {
          up: !!comfy.up,
          starting: !!comfy.starting,
          probing: !!comfy.probing,
          stopping: !!comfy.stopping,
          base: comfy.base ?? null,
          port: comfy.port ?? 0,
          via: comfy.via ?? null,
        }
      : null,
    comfyInstance: comfyInstanceQ.data ?? null,
    comfyStarting,
    comfyStopping,
    comfyOpening,
    comfyBrowserOpening: openComfyInBrowserAction.busy,
    startComfy,
    stopComfy,
    openComfy,
    openComfyInBrowser,
    comfyLog: { ...comfyLog, active: comfyLogActive },
    /** 「保存偏好」后重判安装形态用（形态依赖刚保存的路径）。 */
    refetchComfyInstance: async () => {
      await comfyInstanceQ.refetch();
    },
  };
}
