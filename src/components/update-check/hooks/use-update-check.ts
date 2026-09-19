"use client";

/* ── 运行期「本地更新」检测的控制器 hook（规范 17 §17.2 第②层）────
 * 唯一职责：按开关（存在共享 store）决定是否轮询 /api/update-check（网络
 * 收敛在 ~/lib/update-check-client），把「脏/分组/进行中」写回 store，并在
 * 「干净→脏」上升沿回调 onDirty（由容器层决定如何弹 toast）。本文件不做
 * localStorage、不 import toast/组件——开关持久化与 UI 提示都在容器层。
 */

import { useCallback, useEffect, useRef } from "react";

import { fetchUpdateCheck } from "~/lib/update-check-client";
import { useInterval } from "~/components/ui/use-interval";
import { useUpdateCheckStore } from "../update-check-store";

/** 需重启类文件的改动频率低，轮询间隔放宽，不打扰、不空转。 */
export const UPDATE_CHECK_POLL_MS = 30_000;

export interface UpdateCheckHookOptions {
  /** 轮询发现「干净→脏」时触发一次（容器层据此弹应用内提示）。 */
  onDirty?: (groups: { key: string; label: string; hint: string }[]) => void;
}

/** 主动检测一次；返回是否真正执行（false = 请求失败/服务端未就绪）。 */
export type CheckNow = () => Promise<boolean>;

export function useUpdateCheck(opts: UpdateCheckHookOptions = {}): {
  checkNow: CheckNow;
} {
  const { onDirty } = opts;
  const enabled = useUpdateCheckStore((s) => s.enabled);
  const applyResult = useUpdateCheckStore((s) => s.applyResult);
  const setChecking = useUpdateCheckStore((s) => s.setChecking);
  const wasDirtyRef = useRef(false);
  const onDirtyRef = useRef(onDirty);
  // ref 须在 effect 里同步：渲染期写 ref 会被 react-hooks/refs 判为
  // 「渲染期访问 ref」，且并发渲染下可能写到被丢弃的那次渲染上。
  useEffect(() => {
    onDirtyRef.current = onDirty;
  }, [onDirty]);

  const checkNow = useCallback(async (): Promise<boolean> => {
    setChecking(true);
    try {
      const payload = await fetchUpdateCheck();
      // 服务端尚未建立基线（首轮）或请求失败：不改变脏态、不提示。
      if (!payload.ok || !payload.armed) return false;
      const dirty = payload.dirty;
      const wasDirty = wasDirtyRef.current;
      wasDirtyRef.current = dirty;
      applyResult(
        payload.groups.filter((g) => g.dirty),
        dirty,
      );
      if (dirty && !wasDirty && onDirtyRef.current) {
        onDirtyRef.current(
          payload.groups.filter((g) => g.dirty).map((g) => ({ ...g })),
        );
      }
      return true;
    } finally {
      setChecking(false);
    }
  }, [applyResult, setChecking]);

  /* 开关开启且前台时轮询，切后台暂停（与 `useComfyStats` 共用同一份实现
   * —— 此前这段逐字抄了两遍，规范 16 §16.2.4.15）。`ms: null` 表示不轮询。 */
  useInterval(checkNow, {
    ms: enabled ? UPDATE_CHECK_POLL_MS : null,
    pauseWhenHidden: true,
  });

  return { checkNow };
}
