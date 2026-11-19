"use client";

/* ── 「页面跑着上一版代码」提示的挂载容器（规范 17 §17.2 第④层容器）────
 * 根布局挂一次：① 注册应用内送达器（toast + 消息中心）给 ~/lib/stale-store-notify；
 * ② 启动构建标识观测（探测在 hooks/use-code-update-watch）。自愈重启会同时触发探活
 * 「断开→恢复」与本组件「已自动重启」，合并成一条可行动消息（撤前者）；只对启动器发起
 * 的重启合并（reason !== null），手动重启/崩溃的记录不撤。 */

import { useEffect } from "react";

import { useToast } from "~/components/studio/ToastProvider";
import {
  useMessageCenterStore,
  type MessageKind,
} from "~/components/message-center/message-center-store";
import { registerStaleStoreDeliver } from "~/lib/shell/stale-store-notify";
import type { DepsFreshnessState } from "~/lib/shell/code-update-since-load";

import { useCodeUpdateWatch } from "./hooks/use-code-update-watch";

/** 消息中心的类型：属于「代码更新 / 运行态」这一族，与本地更新检测同色。 */
const MESSAGE_KIND = "update";

/**
 * 把启动器注入的重启原因（与人话归因）翻成用户可读的标题 + 正文。
 * 导出供组件工作台注入层（`.storybook/message-center-sources.tsx`）现算，
 * 不手抄第二份文案（两处各写一遍，改一处就漂）。
 */
export function describeDevServerRestart(
  reason: string | null,
  detail: string | null = null,
): {
  body: string;
  title: string;
} {
  if (reason === "route-404-heal") {
    /* 运行期自愈时页面连的是被换掉的旧进程，必须给出「按 Ctrl+R 重载」，
     * 否则接口恢复了仍会被旧页面的陈旧模块卡住。`detail` 只是文案：拿不到
     * 时退化成陈述现象，不编成因——归因猜错会带偏排查（同
     * `app-service-exit` 的 `describeAppServiceStart` 那条口径）。 */
    return {
      title: "应用服务已自动重启",
      body:
        `检测到${
          detail ?? "接口层持续返回 404"
        }，已自动清空编译缓存并重启应用服务一次，接口现已恢复。\n` +
        "请按 Ctrl+R 重载当前页面：这个页面是重启前由旧进程送来的，" +
        "继续用可能出现按钮点了没反应这类陈旧模块现象。\n" +
        "无需手动操作；若反复出现，可在终端重启一次开发服务。",
    };
  }
  if (reason === "stale-route-table") {
    return {
      title: "应用服务已自动重启",
      body:
        "启动时检测到路由表与源码不一致（部分接口无响应），" +
        "已自动清空编译缓存并重启应用服务一次，现已恢复正常。" +
        "无需你手动操作；若反复出现，可在终端重启一次开发服务。",
    };
  }
  return {
    title: "应用服务已重启",
    body: "本地开发服务（dev server）重启了一次。进行中的生成任务连接可能已断开，可在执行记录里回看。",
  };
}

/** 依赖面各形态的「为什么」（与 `DepsFreshnessState` 一一对应）。 */
const DEPS_STALE_WHY: Record<DepsFreshnessState, string> = {
  drift: "安装时的依赖清单与仓库 pnpm-lock.yaml 已不一致（多半是刚拉到的新代码动了依赖面）",
  "no-install": "本地依赖没有装好（缺安装记录）",
  unresolved: "本地依赖树里有个别声明的依赖解析不到（树停在它们被加入之前）",
  fresh: "依赖面与代码一致",
};

/**
 * 「依赖面已落后于代码」那一档的文案（`state` 给出具体形态）。
 * 导出理由同 `describeDevServerRestart`（story 侧现算、不手抄）。只给「怎么做」而不
 * 承诺自动做：重装依赖会锁住正在使用的原生模块（硬规则 9），必须先停服务，应用内做不到。
 */
export function describeDepsStale(state: DepsFreshnessState): {
  body: string;
  title: string;
} {
  return {
    title: "依赖与代码不一致，需重装依赖",
    body:
      `${DEPS_STALE_WHY[state]}。\n` +
      "请在**关掉应用窗口之后**，于项目目录依次执行：\n" +
      "  1. pnpm deps:guard（确认应用服务确实已停）\n" +
      "  2. pnpm install\n" +
      "然后重新双击启动入口。\n" +
      "应用内无法替你完成这一步：重装依赖会锁住正在使用的原生模块，必须先停服务。\n" +
      "不重装的后果是：新代码引用的依赖解析不到，接口会持续报错。",
  };
}

/* ── 通知合并：一次自愈只留一条可行动消息 ──────────────────────────────── */

/**
 * 回溯窗口：构建标识 30s 一拍，`restartReason` 最早也要等下一拍才被看见；
 * 而那条「断开 → 恢复」在探活 2s 一拍下很快落下。120s 足够覆盖这个错位，
 * 又不至于把更早的、另一次事件的记录一并卷进来。
 */
const SELF_HEAL_MERGE_WINDOW_MS = 120_000;

/** 「断开 / 恢复」这两档只有 `use-app-service-message-log` 在生产（见 store 注释）。 */
const HEAL_PAIR_KINDS: ReadonlyArray<MessageKind> = ["offline", "restart"];

/**
 * 撤掉同一场自愈留下的「断开 / 恢复」两条。
 * 判据「kind ∈ {offline, restart} 且在窗口内」：这两档只有 use-app-service-message-log
 * 一个生产方，窗口内的它们必然是这场重启的伴生产物；拍序反转会漏撤「恢复」（不丢信息）。
 */
function dropHealPairFromCenter(now: number): void {
  const store = useMessageCenterStore.getState();
  for (const message of store.messages) {
    if (!HEAL_PAIR_KINDS.includes(message.kind)) {
      continue;
    }
    if (now - message.time > SELF_HEAL_MERGE_WINDOW_MS) {
      continue;
    }
    store.remove(message.id);
  }
}

export function CodeUpdateWatcher() {
  const toast = useToast();

  useCodeUpdateWatch({
    onDevServerRestart: (reason, detail) => {
      /* 只对启动器发起的自愈做合并（见文件头）；用户手动重启那一族没有 reason，
       * 它的「断开 → 恢复」是要留的记录。 */
      if (reason !== null) {
        dropHealPairFromCenter(Date.now());
      }
      const { title, body } = describeDevServerRestart(reason, detail);
      toast.info(title, `${body}（可到消息中心查看）`, 8000);
      useMessageCenterStore.getState().push({
        kind: MESSAGE_KIND,
        title,
        body,
      });
    },
    onDepsStale: (state) => {
      const { title, body } = describeDepsStale(state);
      toast.info(title, `${body}（可到消息中心查看）`, 12_000);
      useMessageCenterStore.getState().push({
        kind: MESSAGE_KIND,
        title,
        body,
      });
    },
  });

  useEffect(() => {
    registerStaleStoreDeliver((notification) => {
      /* 安静、不抢焦点；稍长的展示时间，因为这句话是要照着做的。 */
      toast.info(
        notification.title,
        `${notification.summary}（约 8 秒后收起，可到消息中心查看完整步骤）`,
        8000,
      );
      useMessageCenterStore.getState().push({
        kind: MESSAGE_KIND,
        title: notification.title,
        body: notification.body,
      });
    });
    return () => {
      registerStaleStoreDeliver(null);
    };
  }, [toast]);

  return null;
}
