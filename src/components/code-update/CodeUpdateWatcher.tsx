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
 */

import { useEffect } from "react";

import { useToast } from "~/components/studio/ToastProvider";
import { useMessageCenterStore } from "~/components/message-center/message-center-store";
import { registerStaleStoreDeliver } from "~/lib/shell/stale-store-notify";

import { useCodeUpdateWatch } from "./hooks/use-code-update-watch";

/** 消息中心的类型：属于「代码更新」这一族，与本地更新检测同色。 */
const MESSAGE_KIND = "update";

export function CodeUpdateWatcher() {
  const toast = useToast();

  useCodeUpdateWatch();

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
    return () => registerStaleStoreDeliver(null);
  }, [toast]);

  return null;
}
