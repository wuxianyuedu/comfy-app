"use client";

/**
 * 「ComfyUI 运行态变化」订阅（sub-hook 下一层，只做接线），由 use-comfyui-control 使用。
 * 页面显示时挂上、变化一到就 refetch；页面走开即摘掉，连接不留在后台。
 * 事件只说「变过」，服务端判定才是结论（同 comfy-liveness-client 的「崩溃是事件、状态要复核」）。
 * `paused` 三来路：首屏配置未就绪、打开查看进行中、启动动作进行中（后两者自己会 refetch）。 */
import { useEffect, useRef } from "react";

import { subscribeComfyStateChanges } from "~/lib/comfy/comfy-state-client";

export function useComfyStateEvents(input: {
  /** 收到变化时的动作：重新问一次状态。 */
  onChange: () => void;
  /** 是否订阅。false = 立刻退订（首屏未就绪 / 正在执行会自己 refetch 的动作）。 */
  paused: boolean;
}): void {
  const { paused, onChange } = input;
  /* 回调走 ref：它每次渲染都是新箭头函数，进依赖数组会让「订阅→退订→再订阅」每次渲染重放；
   * 该链开是发长轮询、关是拆在途请求，重放即请求风暴与服务端连上又断（实测十几轮 ?since=0）。
   * 这里要的只是「变化时跑最新动作」，与 useInterval / useMemo 的 runRef 同一手法。 */
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
