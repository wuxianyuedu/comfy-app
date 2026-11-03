"use client";

/**
 * 「ComfyUI 运行态变化」订阅（sub-hook 的下一层，只做接线）。
 *
 * 由 `use-comfyui-control` 使用：侧栏「ComfyUI」页在显示时挂上这条通道，变化一到
 * 就重新问一次状态（`refetch`）；那一页一走开就摘掉，连接不留在后台
 * （常驻栈里它不渲染时，这个 hook 的效果也被卸载）。
 *
 * 为什么「变化了要重新问」而不是「把变化直接当状态」：事件只说**变过**，
 * 说不清变成了什么 —— 服务端那次判定才是结论（同 `comfy-liveness-client`
 * 的「崩溃是事件、状态要复核」）。一次 `refetch` 拿到的仍是 `comfyStatus`
 * 那一条既有结论，视图层的契约（四态文案 / 按钮禁用）一个字都不用改。
 *
 * `paused` 的三条来路：首屏配置没就绪（与其他状态查询同一门控）、
 * 「打开查看」正在进行、启动动作正在进行 —— 后两者自己会 `refetch`，
 * 此刻再来一发是白跑。
 */
import { useEffect, useRef } from "react";

import { subscribeComfyStateChanges } from "~/lib/comfy/comfy-state-client";

export function useComfyStateEvents(input: {
  /** 收到变化时的动作：重新问一次状态。 */
  onChange: () => void;
  /** 是否订阅。false = 立刻退订（首屏未就绪 / 正在执行会自己 refetch 的动作）。 */
  paused: boolean;
}): void {
  const { paused, onChange } = input;
  /* 回调走 ref：它每次渲染都是新的箭头函数（内联在调用点），进依赖数组会让
   * 「订阅 → 退订 → 再订阅」在每次渲染重放一遍 —— 而那条链的**开**是「发一轮
   * 长轮询」、**关**是「拆掉在途请求」，反复重放的表现是请求风暴与服务端连上
   * 又断（实测：一次断言窗口里就能看到十几轮 `?since=0`）。语义上这里要的也
   * 只是「变化时跑最新的那个动作」，与 `useInterval` / `useMemo` 的 `runRef`
   * 同一手法。 */
  const onChangeRef = useRef(onChange);
  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (paused) {
      return;
    }
    return subscribeComfyStateChanges(() => {
      onChangeRef.current();
    });
  }, [paused]);
}
