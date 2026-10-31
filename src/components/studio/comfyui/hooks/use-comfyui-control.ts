"use client";

/**
 * 侧栏「ComfyUI」页的业务逻辑层（规范 17 §17.2 第②层）。
 *
 * 这一页回答一件事：**本机这个出图后端现在是什么状态，我要把它开起来 / 关下去 /
 * 打开看看**。它由设置页「创作后端」分区搬来（ISSUE #1900）—— 那一分区留着
 * **配置**（路径、解释器、端口、启动参数、是否自动拉起），运行态与启动日志
 * 归这一页，于是「改配置」与「看运行」不再是同一屏上互相挤的两件事。
 *
 * 搬过来时**没有**复制一份实现：设置页那一侧把运行时整块交出来，本 hook 接住；
 * 那一侧不再持任何运行态（所以不存在两份状态各自漂移的可能）。
 *
 * ## 与设置页侧的分工
 *
 * | 问题 | 归谁 |
 * | --- | --- |
 * | 路径 / 端口 / 启动参数 / 自动拉起怎么配 | 设置 → 创作后端（`useSettingsComfy`） |
 * | 装的是桌面版还是便携版 | 两侧都读 `setting.comfyInstance`（fs-only 的同一份事实） |
 * | 在不在跑 / 起 / 停 / 打开 / 启动日志 | 本 hook |
 * | 未配置路径时该去哪 | 本 hook 给 `configHint`，视图给出口 |
 *
 * 启动动作**不再**「先保存草稿再拉起」：本页没有草稿（配置在设置页保存），
 * 服务端按库里那一行拉起 —— 想改路径再去设置页改，改完回来启动。视图会把
 * 「将按哪个路径启动」写在页上（`instance`），不让用户猜。
 */

import { useCallback, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";

import { fireAndForget, runAsyncAction } from "~/lib/async-action";
import { useShellTabs } from "~/lib/shell/shell-tabs-store";
import { isDesktopShell } from "~/lib/shell/desktop-shell-client";
import { openComfyTab } from "~/lib/comfy/comfy-tab-client";
import { shouldUseBrowserTab } from "~/lib/comfy/comfy-embed";
import { useTRPC } from "~/trpc/react";

import { useExternalAction } from "~/components/ui/use-external-action";
import { useToast } from "~/components/studio/ToastProvider";
import { useRuntimeLogSource } from "~/components/studio/logs/use-runtime-log-source";
import { useComfyStateEvents } from "./use-comfy-state-events";

/** 事件通道之外那条**兜底**轮询的节奏（毫秒）。
 *
 *  为什么要留：长轮询断开 / 服务重启 / 事件没送到时，界面不能就此停在旧结论上。
 *  为什么是 30s 而不是 5s：主角换成了事件（变化发生即推、变化一到即重问），
 *  这条只是「万一主通道坏了」的后备 —— 后备的节奏该按「多久发现通道坏了」定，
 *  而不是按「事实能多快追上」定。 */
const COMFY_STATUS_FALLBACK_MS = 30_000;

export function useComfyuiControl() {
  const trpc = useTRPC();
  /* 反馈通道走 toast：这一页是工作区里的普通视图（不是设置页那种「一页到底」的
   * 表单文档），动作结果是**这一刻**的事，留在屏幕上不占版面。 */
  const toast = useToast();

  const [comfyStarting, setComfyStarting] = useState(false);
  const [comfyStopping, setComfyStopping] = useState(false);
  const [comfyOpening, setComfyOpening] = useState(false);

  const comfyStartM = useMutation(trpc.setting.comfyStart.mutationOptions());
  const comfyStopM = useMutation(trpc.setting.comfyStop.mutationOptions());
  const comfyOpenM = useMutation(trpc.setting.comfyOpen.mutationOptions());

  /* 安装形态：fs-only 的毫秒级判据 —— 不进状态轮询，与首屏同批发出。
   * 本页读它只为一件事：说清「将按哪个安装形态启动」，以及路径没配时给出口。 */
  const comfyInstanceQ = useQuery(trpc.setting.comfyInstance.queryOptions());

  /* 状态查询：**事件驱动为主、低频轮询兜底**（与搬迁前同一口径 —— 5s 那一拍
   * 的原话是「外部拉起的实例要被及时认出来」，而这件事现在有更直接的答案：
   * 服务端一认出变化就经 `/api/comfy/state` 推过来，变化一到立刻重问一次）。 */
  const comfyStatusQ = useQuery(
    trpc.setting.comfyStatus.queryOptions(undefined, {
      refetchInterval: COMFY_STATUS_FALLBACK_MS,
      refetchIntervalInBackground: false,
    }),
  );

  /* 服务端「运行态变了」的订阅：变化一到就重问一次状态。三条门控都与
   * 「此刻重问有没有意义」对齐（见 `use-comfy-state-events`）。
   * `refetch` 不走 `void`：`fireAndForget` 是库里唯一允许悬空 Promise 的出口。 */
  useComfyStateEvents({
    paused: comfyOpening || comfyStarting,
    /* 刻意不另开日志：这条失败（重问状态没成）自己就有可见出口 —— 状态行留在
     * 上一次的结论上、30s 兜底轮询随后再试一次，用户看得到结果；而它最常见的
     * 成因（服务正在重启）每重启一次打一行只是噪声。 */
    onChange: () => fireAndForget(comfyStatusQ.refetch(), () => undefined),
  });

  /* ── 启动 / 关闭 ───────────────────────────────────────── */
  const startComfy = useCallback(async () => {
    setComfyStarting(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await comfyStartM.mutateAsync({});
          await comfyStatusQ.refetch();
          // 启动后形态可能变（用户刚在设置页改了路径）：重判一次，页上的
          // 「按哪个形态启动」不会停在旧结论上。
          await comfyInstanceQ.refetch();
          /* 端点返回 `{ ok, detail }` 的信封（服务端自己探过启动结果），
           * 交给出口按同一口径读 —— 调用处不再写 `result.ok ? "ok" : "err"`。 */
          return result;
        },
        {
          failureText: "启动 ComfyUI 失败",
          report: (kind, text) => (kind === "ok" ? toast.success(text) : toast.error(text)),
        },
      );
    } finally {
      setComfyStarting(false);
    }
  }, [comfyStartM, comfyStatusQ, comfyInstanceQ, toast]);

  const stopComfy = useCallback(async () => {
    setComfyStopping(true);
    try {
      await runAsyncAction(
        async () => {
          const result = await comfyStopM.mutateAsync();
          await comfyStatusQ.refetch();
          return result;
        },
        {
          failureText: "关闭 ComfyUI 失败",
          report: (kind, text) => (kind === "ok" ? toast.success(text) : toast.error(text)),
        },
      );
    } finally {
      setComfyStopping(false);
    }
  }, [comfyStopM, comfyStatusQ, toast]);

  /* ── 打开（页签内嵌 / 浏览器）───────────────────────────── */
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
        toast.success(`已在新浏览器页签打开 ComfyUI（${cached}）`);
        return;
      }
      setComfyOpening(true);
      try {
        const fresh = await comfyStatusQ.refetch();
        const base = fresh.data?.base ?? null;
        if (!base) {
          toast.error("ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看");
          return;
        }
        window.open(base, "_blank", "noopener,noreferrer");
        toast.success(`已在新浏览器页签打开 ComfyUI（${base}）`);
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
            return {
              detail: "ComfyUI 未在运行，请先点「启动 ComfyUI」再打开查看",
              ok: false,
            };
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
            blockedReason: decision.target === "blocked" ? decision.detail : null,
            closable: true,
            id: "comfyui",
            label: "ComfyUI",
            url: decision.embedUrl,
            /* 不可嵌时把地址一并带进说明：用户能复制到浏览器自查，也能判断
             * 是外壳拦的还是 ComfyUI 自己拦的（ISSUE #310）。 */
            blockedUrl: decision.target === "blocked" ? decision.base : null,
          });
          return {
            detail: decision.detail,
            ok: decision.target === "embed",
          };
        },
        {
          failureText: "打开 ComfyUI 失败",
          report: (kind, text) => (kind === "ok" ? toast.success(text) : toast.error(text)),
        },
      );
    } finally {
      setComfyOpening(false);
      // 无论成败都刷新状态行，修正探测抖动（如进程查询超时）造成的「未运行」显示。
      await comfyStatusQ.refetch();
    }
  }, [comfyStatusQ, toast]);

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
    report: (kind, text) => (kind === "ok" ? toast.success(text) : toast.error(text)),
    target: "browser",
  });
  const openComfyInBrowser = useCallback(async () => {
    await openComfyInBrowserAction.run(async () => {
      await comfyStatusQ.refetch();
      return comfyOpenM.mutateAsync();
    });
  }, [openComfyInBrowserAction, comfyOpenM, comfyStatusQ]);

  /* ── 启动日志 ────────────────────────────────────────────
   * 追加不轮转的文件（多次启动的行混在一起），服务端按会话横幅切分后回
   * 「会话列表 + 选中会话正文」。`active` = 正在启动 → 每秒跟随本次启动；
   * 否则挂载 / 刷新时取一次。 */
  const comfyLogActive = comfyStarting || !!comfyStatusQ.data?.starting;
  const comfyLog = useRuntimeLogSource({
    active: comfyLogActive,
    source: "comfyui-runtime",
  });

  const status = comfyStatusQ.data;

  return {
    /** 运行态（四态投影见 `comfyui-control-config`）。 */
    status: status
      ? {
          base: status.base ?? null,
          port: status.port ?? 0,
          probing: !!status.probing,
          starting: !!status.starting,
          stopping: !!status.stopping,
          up: !!status.up,
          via: status.via ?? null,
          /* 库里已保存的路径（服务端 `comfyStatus` 一直有这一格，此前视图没收）：
           * 它是启动动作**实际会用的那一条**，写在页上让「改了没保存」当场可见。 */
          path: status.path ?? "",
        }
      : null,
    /** 安装形态（路径没配时为 null，视图据此给「去设置」出口）。 */
    browserOpening: openComfyInBrowserAction.busy,
    instance: comfyInstanceQ.data ?? null,
    openComfy,
    openComfyInBrowser,
    opening: comfyOpening,
    startComfy,
    starting: comfyStarting,
    stopComfy,
    stopping: comfyStopping,
    /** 「立刻再问一次」—— 状态本身事件驱动，这颗是「我不信刚才那一拍」的出口。 */
    refreshStatus: async () => {
      await comfyStatusQ.refetch();
    },
    /* `active` = 「正在跟随本次启动」，由本 hook 的判据给（RuntimeLogBox 用它
     * 显示「跟随中」并决定刷新按钮的语义）。 */
    log: { ...comfyLog, active: comfyLogActive },
  };
}

export type ComfyuiControlController = ReturnType<typeof useComfyuiControl>;
