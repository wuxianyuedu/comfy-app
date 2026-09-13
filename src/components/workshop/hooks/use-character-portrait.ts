"use client";

// ── 角色定妆照会话（规范 17 §17.2 第②层）────────────────────────────────────
// 定妆照生成是长耗时异步流程：切走页签只卸载 stage 组件，故 busy / 进度 / 日志
// 与提取会话一样收在工坊 controller 里（见 use-workshop-pipeline 的挂载点），
// 生成中切页签再切回，进度与候选都不丢。
// 候选本身写在角色对象上（随草稿持久化），本 hook 只负责编排与过程状态。

import React from "react";

import { errorMessage } from "~/lib/error-message";
import {
  appendPortraitLog,
  makePortraitLog,
  withPortraitCandidate,
  withSelectedPortrait,
  withoutPortraitCandidate,
  type PortraitLogEntry,
} from "~/lib/workshop/character-portrait";
import {
  generateLocalPortrait,
  generateRemotePortrait,
  generateWorkflowPortrait,
  importPortraitFile,
  type PortraitRequest,
} from "~/lib/workshop/character-portrait-client";
import { persistGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { Character, CharacterPortrait } from "~/lib/workshop/types";
import {
  DEFAULT_SHOT_SIZE,
  shotSizeToParam,
  type ShotSizeState,
} from "../shot-size-config";

/** 定妆照生成通道：本机 ComfyUI 工作流 / 远端 API 直连。 */
export type PortraitChannel = "local" | "remote";

export interface PortraitSession {
  /** 会话消息（状态 / 错误 / 日志 / 进度）归属的角色 id；空串 = 还没发起过。
   *  跑完之后继续保留，好让发起的那张角色卡还能看到自己的结果与日志。 */
  focusCharacterId: string;
  /** 是否正在生成（同一时刻只跑一个任务） */
  busy: boolean;
  /** 是否正在导入图片 */
  importing: boolean;
  channel: PortraitChannel;
  /** 远端通道使用的模型名（设置页「远端模型」kind=image 的条目；空串 = 未选） */
  remoteModel: string;
  /** 本地通道使用的工作流（工作流库中已配置对外参数的条目；空串 = 内置 txt2img） */
  localWorkflowId: string;
  /** 定妆照尺寸（复用镜头生图的比例 / 像素 / 对齐三段选择） */
  size: ShotSizeState;
  /** 本机任务的完成度 0~100；远端为一次性请求，不提供进度 */
  progress: number;
  /** 本次生成实际调用的「通道 · 模型」标签，用于进度与结果文案 */
  modelLabel: string;
  status: string;
  error: string;
  log: PortraitLogEntry[];
}

export interface PortraitSessionActions {
  /** 更新用户选择（通道 / 尺寸） */
  patch: (
    p: Partial<
      Pick<PortraitSession, "channel" | "size" | "remoteModel" | "localWorkflowId">
    >,
  ) => void;
  appendLog: (entry: PortraitLogEntry) => void;
  /** 按角色提示词生成一张定妆照，结果作为新候选并入该角色。
   *  overrides.remoteModel：本次使用的设置页「远端模型」名（远端通道）。 */
  generate: (
    character: Character,
    overrides?: {
      remoteModel?: string;
      localWorkflowId?: string;
      localLabel?: string;
    },
  ) => Promise<void>;
  /** 外部导入一张现成定妆照（写进素材库「角色」分类） */
  importFile: (character: Character, file: File) => Promise<void>;
  /** 把候选里的一张定为定妆照（后续分镜图的参考图） */
  select: (characterId: string, url: string) => void;
  /** 删除一张候选 */
  remove: (characterId: string, url: string) => void;
}

function initialSession(): PortraitSession {
  return {
    focusCharacterId: "",
    busy: false,
    importing: false,
    channel: "local",
    remoteModel: "",
    localWorkflowId: "",
    size: DEFAULT_SHOT_SIZE,
    progress: 0,
    modelLabel: "",
    status: "",
    error: "",
    log: [],
  };
}

export function useCharacterPortrait(opts: {
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  /** 本地通道当前选定的 checkpoint（右侧「生成资源」里切换） */
  checkpoint: string;
  /** 工坊项目 id：导入的定妆照落到素材库的本项目目录 */
  projectId: string;
}): [PortraitSession, PortraitSessionActions] {
  const { setCharacters, checkpoint, projectId } = opts;
  const [session, setSession] = React.useState<PortraitSession>(initialSession);

  const patch = React.useCallback(
    (p: Partial<
      Pick<PortraitSession, "channel" | "size" | "remoteModel" | "localWorkflowId">
    >) =>
      setSession((prev) => ({ ...prev, ...p })),
    [],
  );

  const appendLog = React.useCallback(
    (entry: PortraitLogEntry) => {
      setSession((prev) => ({ ...prev, log: appendPortraitLog(prev.log, entry) }));
      // 生成日志异步落一份到 log/workshop/（fire-and-forget，失败不影响生成）
      persistGenerationLogs("portrait", [
        { ts: entry.ts, kind: entry.level, summary: entry.text },
      ]);
    },
    [],
  );

  /** 候选写入统一走角色列表的更新（函数式更新，不依赖 characters 快照）。 */
  const addCandidate = React.useCallback(
    (characterId: string, candidate: CharacterPortrait) => {
      setCharacters((prev) =>
        prev.map((item) =>
          item.id === characterId ? withPortraitCandidate(item, candidate) : item,
        ),
      );
    },
    [setCharacters],
  );

  const select = React.useCallback(
    (characterId: string, url: string) => {
      setCharacters((prev) =>
        prev.map((item) =>
          item.id === characterId ? withSelectedPortrait(item, url) : item,
        ),
      );
    },
    [setCharacters],
  );

  const remove = React.useCallback(
    (characterId: string, url: string) => {
      setCharacters((prev) =>
        prev.map((item) =>
          item.id === characterId ? withoutPortraitCandidate(item, url) : item,
        ),
      );
    },
    [setCharacters],
  );

  const generate = React.useCallback(
    async (
      character: Character,
      overrides?: {
        remoteModel?: string;
        localWorkflowId?: string;
        localLabel?: string;
      },
    ) => {
      if (session.busy) return;
      const prompt = character.positivePrompt.trim();
      if (!prompt) {
        setSession((prev) => ({
          ...prev,
          status: "",
          error: "该角色还没有生成提示词，请先补全角色信息（外貌 / 服装等会自动合成提示词）",
        }));
        return;
      }
      const channel = session.channel;
      if (channel === "local" && !checkpoint) {
        setSession((prev) => ({
          ...prev,
          status: "",
          error: "本地通道需要先选 Checkpoint（右侧「生成资源」里选择）",
        }));
        return;
      }
      const size = shotSizeToParam(session.size);
      const label = character.name || "该角色";
      const remoteModel = (overrides?.remoteModel ?? session.remoteModel).trim();
      const localWorkflowId = (
        overrides?.localWorkflowId ?? session.localWorkflowId
      ).trim();
      const localLabel = (overrides?.localLabel ?? "").trim();
      const modelLabel =
        channel === "local"
          ? localWorkflowId
            ? `本地 · ${localLabel || "库工作流"}`
            : `本地 · ${checkpoint}`
          : remoteModel
            ? `远端 API · ${remoteModel}`
            : "远端 API";
      setSession((prev) => ({
        ...prev,
        busy: true,
        focusCharacterId: character.id,
        progress: 0,
        modelLabel,
        status: "",
        error: "",
        log: [
          makePortraitLog(
            "info",
            `开始为「${label}」生成定妆照（${modelLabel} · ${size}）`,
          ),
        ],
      }));
      const req: PortraitRequest = {
        prompt,
        negative: character.negativePrompt || undefined,
        size,
      };
      try {
        if (channel === "local") {
          const { taskId, url } = localWorkflowId
            ? await generateWorkflowPortrait(
                req,
                { workflowId: localWorkflowId },
                {
                  onProgress: (pct) =>
                    setSession((prev) =>
                      prev.focusCharacterId === character.id
                        ? { ...prev, progress: pct }
                        : prev,
                    ),
                  onLog: (entry) => {
                    if (entry.level === "progress") return;
                    appendLog(
                      makePortraitLog(
                        entry.level === "error" ? "error" : "info",
                        entry.msg,
                      ),
                    );
                  },
                },
              )
            : await generateLocalPortrait(
                req,
                { checkpoint, params: character.params },
            {
              onProgress: (pct) =>
                setSession((prev) =>
                  prev.focusCharacterId === character.id
                    ? { ...prev, progress: pct }
                    : prev,
                ),
              /* 逐步骤日志量很大，只保留有信息量的行（进度百分比用进度条表达）。 */
              onLog: (entry) => {
                if (entry.level === "progress") return;
                appendLog(
                  makePortraitLog(
                    entry.level === "error" ? "error" : "info",
                    entry.msg,
                  ),
                );
              },
            },
          );
          addCandidate(character.id, {
            url,
            source: "local",
            model: checkpoint,
            taskId,
            createdAt: Date.now(),
          });
          setSession((prev) => ({
            ...prev,
            progress: 100,
            status: `已生成一张定妆照（${modelLabel}），可在下方候选里挑选`,
          }));
          appendLog(
            makePortraitLog("success", `定妆照生成完成（任务 ${taskId.slice(0, 12)}…）`),
          );
        } else {
          const url = await generateRemotePortrait(
            req,
            {
              projectId,
              name: `${label}-定妆照-${Date.now()}`,
              ...(remoteModel ? { model: remoteModel } : {}),
              sizeState: session.size,
            },
          );
          addCandidate(character.id, {
            url,
            source: "remote",
            ...(remoteModel ? { model: remoteModel } : {}),
            createdAt: Date.now(),
          });
          setSession((prev) => ({
            ...prev,
            status: `已生成一张定妆照（${modelLabel}），可在下方候选里挑选`,
          }));
          appendLog(makePortraitLog("success", "远端 API 返回图片完成"));
        }
      } catch (e: unknown) {
        const message = errorMessage(e, "定妆照生成失败");
        setSession((prev) => ({ ...prev, error: message }));
        appendLog(makePortraitLog("error", message));
      } finally {
        // focusCharacterId 保留：让发起本次生成的角色卡继续展示状态与日志。
        setSession((prev) => ({ ...prev, busy: false }));
      }
    },
    [
      session.busy,
      session.channel,
      session.size,
      session.remoteModel,
      session.localWorkflowId,
      checkpoint,
      projectId,
      addCandidate,
      appendLog,
    ],
  );

  const importFile = React.useCallback(
    async (character: Character, file: File) => {
      if (!file.type.startsWith("image/")) {
        setSession((prev) => ({ ...prev, status: "", error: "只能导入图片文件" }));
        return;
      }
      setSession((prev) => ({
        ...prev,
        importing: true,
        focusCharacterId: character.id,
        status: "",
        error: "",
      }));
      try {
        const url = await importPortraitFile(file, { projectId });
        addCandidate(character.id, { url, source: "import", createdAt: Date.now() });
        setSession((prev) => ({
          ...prev,
          status: `已导入 ${file.name}，可在下方候选里挑选`,
        }));
      } catch (e: unknown) {
        setSession((prev) => ({ ...prev, error: errorMessage(e, "导入定妆照失败") }));
      } finally {
        setSession((prev) => ({ ...prev, importing: false }));
      }
    },
    [projectId, addCandidate],
  );

  return [session, { patch, appendLog, generate, importFile, select, remove }];
}
