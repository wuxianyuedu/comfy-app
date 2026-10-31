"use client";

/* ── 「页面跑着上一版代码」提示的挂载容器（规范 17 §17.2 第④层容器）────
 * 根布局挂一次，自身渲染空节点。职责只有两件：
 *   ① 把应用内送达器（toast + 消息中心）注册给 ~/lib/stale-store-notify，
 *      供最底层的 store 调用点（WorkflowStores.callStoreAction）跨层上报；
 *   ② 启动构建标识观测（真正的探测/轮询在 hooks/use-code-update-watch）。
 *
 * 为什么送达必须同时有 toast 和消息中心：toast 一闪而过，而这句指引的读者
 * 是「正在被白屏卡住、急着继续干活」的人——他很可能错过那 3 秒。消息中心
 * 留底（未读计数挂在底部状态栏铃铛上），随时能翻回来看完整的「怎么办」。
 * 这与本地更新检测（UpdateCheckProvider）的送达口径一致。
 *
 * ## 一次自愈重启只给一条可行动消息（通知合并）
 *
 * 启动器自愈重启（清缓存 + 冷编译，≥10s 的服务不可用）会**同时**触发两条链路：
 *   · `use-dev-server-liveness`（2s 一拍）必然看到「断开 → 恢复」，由
 *     `use-app-service-message-log` 记下两条；
 *   · 本组件的构建标识观测（30s 一拍）拿到 `restartReason` / `restartDetail`，
 *     记下「已自动重启」。
 * 三条消息讲的是同一件事，而用户只需要一条**能照着做**的。这里在记重启消息的
 * 同时**撤掉**那条链路刚落下的「断开 / 恢复」两条（判据见
 * `dropHealPairFromCenter`），把原因、时间与下一步收进这一条里。
 *
 * 合并只对**启动器发起的**重启做：`reason !== null` 才意味着这是我们自己按下的
 * 自愈（`stale-route-table` / `route-404-heal`）。用户手动重启 / 崩溃那一类没有
 * reason，而它们的「断开 → 恢复」本身就是要留的记录，不该撤。
 */

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
 *
 * 导出是给组件工作台的注入层用的（`.storybook/message-center-sources.tsx`）：
 * 消息中心里那条「应用服务已重启」的文案**住在这里**，story 侧现算它、
 * 不手抄第二份（同一份文案两处各写一遍，改一处就漂）。这不是为了 story 而
 * 改生产代码的行为 —— 只是把一个本来就该被复用的纯函数露出来。
 */
export function describeDevServerRestart(
  reason: string | null,
  detail: string | null = null,
): {
  body: string;
  title: string;
} {
  if (reason === "route-404-heal") {
    /* 运行期自愈：故障发生时页面**已经在跑**，所以页面自己连着的是被换掉的那个
     * 旧进程 —— 这一条必须给出「按 Ctrl+R 重载」这个下一步，否则用户看到服务
     * 恢复了（接口通了）却仍可能被旧页面里的陈旧模块卡住。
     *
     * `detail` 是启动器懒归因给出的一句话（「本次代码更新改了路由结构…」）。
     * 它**只是文案**：拿不到（git 不可用 / 未提交改动 / 偶发失效）时退化成陈述
     * 现象（「接口层持续返回 404」），不编一个成因 —— 归因猜错会把排查引向另一条
     * 路（同 `app-service-exit` 的 `describeAppServiceStart` 那条口径）。 */
    return {
      body:
        `检测到${
          detail ?? "接口层持续返回 404"
        }，已自动清空编译缓存并重启应用服务一次，接口现已恢复。\n` +
        "请按 Ctrl+R 重载当前页面：这个页面是重启前由旧进程送来的，" +
        "继续用可能出现按钮点了没反应这类陈旧模块现象。\n" +
        "无需手动操作；若反复出现，可在终端重启一次开发服务。",
      title: "应用服务已自动重启",
    };
  }
  if (reason === "stale-route-table") {
    return {
      body:
        "启动时检测到路由表与源码不一致（部分接口无响应），" +
        "已自动清空编译缓存并重启应用服务一次，现已恢复正常。" +
        "无需你手动操作；若反复出现，可在终端重启一次开发服务。",
      title: "应用服务已自动重启",
    };
  }
  return {
    body: "本地开发服务（dev server）重启了一次。进行中的生成任务连接可能已断开，可在执行记录里回看。",
    title: "应用服务已重启",
  };
}

/**
 * 「依赖面已落后于代码」那一档的文案（`state` 给出具体形态）。
 *
 * 导出理由同 `describeDevServerRestart`（story 侧现算、不手抄）。
 *
 * ## 为什么这里只给「怎么做」而不承诺能自动做
 *
 * 这一步**应用内做不到**：重装依赖会锁住正在使用的原生模块（`.node`，硬规则 9），
 * 必须先停掉服务。所以文案给的是可执行的两步，而不是一句「已为你修复」——
 * 后者会把用户留在「它说修好了，可数据还是加载不出来」的状态里。
 */
export function describeDepsStale(state: DepsFreshnessState): {
  body: string;
  title: string;
} {
  return {
    body:
      `${DEPS_STALE_WHY[state]}。\n` +
      "请在**关掉应用窗口之后**，于项目目录依次执行：\n" +
      "  1. pnpm deps:guard（确认应用服务确实已停）\n" +
      "  2. pnpm install\n" +
      "然后重新双击启动入口。\n" +
      "应用内无法替你完成这一步：重装依赖会锁住正在使用的原生模块，必须先停服务。\n" +
      "不重装的后果是：新代码引用的依赖解析不到，接口会持续报错。",
    title: "依赖与代码不一致，需重装依赖",
  };
}

/** 依赖面各形态的「为什么」（与 `DepsFreshnessState` 一一对应）。 */
const DEPS_STALE_WHY: Record<DepsFreshnessState, string> = {
  drift: "安装时的依赖清单与仓库 pnpm-lock.yaml 已不一致（多半是刚拉到的新代码动了依赖面）",
  fresh: "依赖面与代码一致",
  "no-install": "本地依赖没有装好（缺安装记录）",
  unresolved: "本地依赖树里有个别声明的依赖解析不到（树停在它们被加入之前）",
};

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
 *
 * 判据是「kind ∈ {offline, restart} 且时间落在窗口内」：这两档在整个应用里只有
 * `use-app-service-message-log` 一个生产方，所以在一次自愈后两分钟内出现的它们
 * **必然**是这一场重启的伴生产物，撤掉不会误伤别的消息。
 *
 * ## 已知边界
 *
 * 若构建标识那一拍比「恢复」更早落下（探活与轮询的错位被极小概率反过来），
 * 撤完后台仍会补上「恢复」那一条 —— 表现是两条消息而非一条。这不会丢信息，
 * 只是没合并干净；不为此再加一层时序协调（那会把两条独立探测链耦在一起，
 * 代价大于这点观感）。同样地，两分钟内的**两次**自愈会被合并成一条 —— 那种
 * 情形本身说明应用在连续复发，把它们并作一句「反复自愈」并不失真。
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
    onDepsStale: (state) => {
      const { body, title } = describeDepsStale(state);
      toast.info(title, `${body}（可到消息中心查看）`, 12_000);
      useMessageCenterStore.getState().push({
        body,
        kind: MESSAGE_KIND,
        title,
      });
    },
    onDevServerRestart: (reason, detail) => {
      /* 只对启动器发起的自愈做合并（见文件头）；用户手动重启那一族没有 reason，
       * 它的「断开 → 恢复」是要留的记录。 */
      if (reason !== null) {
        dropHealPairFromCenter(Date.now());
      }
      const { body, title } = describeDevServerRestart(reason, detail);
      toast.info(title, `${body}（可到消息中心查看）`, 8000);
      useMessageCenterStore.getState().push({
        body,
        kind: MESSAGE_KIND,
        title,
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
        body: notification.body,
        kind: MESSAGE_KIND,
        title: notification.title,
      });
    });
    return () => registerStaleStoreDeliver(null);
  }, [toast]);

  return null;
}
