"use client";

/**
 * `use-workshop-pipeline` 的两个挂载期 effect 拆分件（§12.13 函数长度：
 * 主管线函数 505 行，这两块各答一件事且只依赖注入的 setter / 回写口）。
 *
 *   · `useWorkshopBootstrapData` —— 首挂载三路拉取：技能列表（风格卡）、
 *     API 直连通道脱敏视图、工作流库可选清单；作废守卫用 beginStaleRun
 *     （规范 16 §16.2.4.34），三个请求各自落地自己的 set。
 *   · `useWorkshopTaskRecovery` —— 恢复失联任务（刷新 / 切走页签后重挂载）：
 *     草稿把 status / clipStatus=running 与任务 id 一起持久化，但观察循环活在
 *     内存里——重挂载后没有任何人再订阅那条 SSE，镜头会永远停在「生成中」。
 *     恢复前先查 task 表真值：已终态 → 直接回写产物 / 失败态；仍在跑 → 重订阅
 *     等 done 帧；查无真值 → 如实按失败收尾。生图（taskId / status）与视频
 *     （clipTaskId / clipStatus）各认各的字段。
 */
import { useEffect, useRef } from "react";

import { beginStaleRun } from "~/lib/stale-run";
import {
  fetchApiChannels,
  fetchTaskSnapshot,
  fetchWorkshopStyles,
  fetchWorkshopWorkflows,
} from "~/lib/workshop/generation-client";
import type { Shot, StyleRef } from "~/lib/workshop/types";
import type { WorkshopDraft } from "~/lib/workshop/draft-store";
import type { ApiChannelsView } from "~/lib/workshop/api-channel-shared";
import type { WorkshopWorkflowOption } from "~/lib/workshop/generation-client";

export function useWorkshopBootstrapData(input: {
  setStyles: (styles: StyleRef[]) => void;
  setApiChannels: (channels: ApiChannelsView | null) => void;
  setWorkflowOptions: (workflows: WorkshopWorkflowOption[]) => void;
}) {
  const { setStyles, setApiChannels, setWorkflowOptions } = input;
  /* 卸载守卫用 beginStaleRun（规范 16 §16.2.4.34）：本 effect 里三个请求各自
   * 落地自己的 set，组件若在请求返回前卸载，写状态既白跑也让旧闭包再多活
   * 一会儿（且并发渲染下还可能与后一轮交叠）。 */
  useEffect(() => {
    const guard = beginStaleRun();
    void (async () => {
      // 技能列表（风格卡）；失败按「没有技能」处理，不打断其余两路。
      try {
        const list = await fetchWorkshopStyles();
        guard.commit(() => setStyles(list));
      } catch {
        /* 失败就是空列表，界面走各自的空态 */
      }
    })();
    // API 直连通道(生图/视频)的脱敏配置视图;失败按未配置处理。
    void fetchApiChannels()
      .then((channels) => guard.commit(() => setApiChannels(channels)))
      .catch(() => undefined);
    // 工作流库列表：工坊「生成资源」里可选择用哪个工作流生成（ISSUE #145）。
    void fetchWorkshopWorkflows()
      .then((workflows) => guard.commit(() => setWorkflowOptions(workflows)))
      .catch(() => undefined);
    return () => guard.dispose();
    /* 三个 setter 都是主钩 useState 的稳定引用：依赖列全也不会重跑，
     *  「只挂载执行一次」的语义不变（显式列出是为满足 exhaustive-deps）。 */
  }, [setApiChannels, setStyles, setWorkflowOptions]);
}

export function useWorkshopTaskRecovery(input: {
  /** 每次渲染后同步的最新草稿（镜头列表从它读，避免闭包捕获旧 state）。 */
  latestDraftRef: { current: WorkshopDraft };
  setShots: (updater: (prev: Shot[]) => Shot[]) => void;
  setNotice: (message: string | null) => void;
  /** 重订阅入口（`useWorkshopGeneration` 的 watchShotTask 原样传入）。 */
  watchShotTask: (
    shotId: string,
    taskId: string,
    target?: "image" | "video",
  ) => Promise<void>;
}) {
  const { latestDraftRef, setShots, setNotice, watchShotTask } = input;
  const resumedRef = useRef(false);

  useEffect(() => {
    if (resumedRef.current) return;
    resumedRef.current = true;
    /** 恢复一个失联任务：查真值 → 已终态直接回写，仍在跑才重订阅。 */
    const resumeTask = (
      shotId: string,
      taskId: string,
      target: "image" | "video",
    ) => {
      void (async () => {
        const snapshot = await fetchTaskSnapshot(taskId);
        /* 恢复是异步的：期间用户可能对同一镜头重新发起（任务 id 已换）。
         * 回写只认「仍归属本任务」的镜头，不覆盖新一轮生成的状态。 */
        const patchIfOwned = (p: Partial<Shot>) =>
          setShots((prev) =>
            prev.map((item) => {
              if (item.id !== shotId) return item;
              const owned =
                target === "video"
                  ? item.clipTaskId === taskId
                  : item.taskId === taskId;
              return owned ? { ...item, ...p } : item;
            }),
          );
        const isVideo = target === "video";
        if (!snapshot) {
          patchIfOwned(
            isVideo ? { clipStatus: "failed" } : { status: "failed" },
          );
          return;
        }
        if (snapshot.status === "SUCCEEDED") {
          /* 产物以任务真值回写（SSE 重订阅拿不到已完成任务的产物）。 */
          const output = snapshot.outputs.find(
            (o) => o.kind === (isVideo ? "video" : "image"),
          );
          if (output) {
            patchIfOwned(
              isVideo
                ? { clipUrl: output.url, clipStatus: "done" }
                : { imageUrl: output.url, status: "done" },
            );
          } else {
            patchIfOwned(
              isVideo ? { clipStatus: "failed" } : { status: "failed" },
            );
            setNotice(
              isVideo
                ? "视频任务已完成但没有产出文件，请重新生成该片段"
                : "任务已完成但没有产出文件，请重新生成该镜头",
            );
          }
          return;
        }
        if (snapshot.status === "FAILED" || snapshot.status === "CANCELLED") {
          patchIfOwned(
            isVideo ? { clipStatus: "failed" } : { status: "failed" },
          );
          if (snapshot.error) {
            setNotice(
              `${isVideo ? "视频" : "镜头"}生成失败：${snapshot.error}`,
            );
          }
          return;
        }
        /* 仍在跑（RUNNING / QUEUED）：重订阅，等 live 的 done 帧回写。 */
        await watchShotTask(shotId, taskId, target);
      })();
    };
    for (const shot of latestDraftRef.current.shots) {
      if (shot.status === "running" && shot.taskId) {
        resumeTask(shot.id, shot.taskId, "image");
      } else if (shot.clipStatus === "running" && shot.clipTaskId) {
        resumeTask(shot.id, shot.clipTaskId, "video");
      }
    }
    // 仅挂载执行一次；镜头列表经 ref 读取（惰性初始化在首渲染已完成）
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
