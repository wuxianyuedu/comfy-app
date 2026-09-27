"use client";

// ── 角色定妆照会话（规范 17 §17.2 第②层）────────────────────────────────────
// 定妆照生成是长耗时异步流程：切走页签只卸载 stage 组件，故 busy / 进度 / 日志
// 与提取会话一样收在工坊 controller 里（见 use-workshop-pipeline 的挂载点），
// 生成中切页签再切回，进度与候选都不丢。
// 候选本身写在角色对象上（随草稿持久化），本 hook 只负责编排与过程状态。
//
// 两条硬约束：
//   ① 生成 / 导入共用一把**单飞闸门**（`~/components/ui/use-reentrancy-lock`）——同一时刻只跑一件；
//      渲染用的 busy / importing 只是展示态，不能拿来当并发守卫；
//   ② 结果只回写「**发起时所属项目**」的角色列表（`writeBackCandidate`），
//      项目被换掉时如实告知用户，不静默丢弃一次昂贵的生成。

import React from "react";
import { createThrottleGate } from "~/components/ui/use-throttled-progress";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";

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
  generateRemotePortrait,
  generateWorkflowPortrait,
  importPortraitFile,
  type PortraitRequest,
} from "~/lib/workshop/character-portrait-client";
import { persistGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { Character, CharacterPortrait } from "~/lib/workshop/types";
import {
  DEFAULT_SHOT_SIZE,
  shotSizeSummary,
  type ShotSizeState,
} from "../shot-size-config";

/** 定妆照生成通道：本机 ComfyUI 工作流 / 远端 API 直连。 */
export type PortraitChannel = "local" | "remote";

/** 用户在区块里可以改的会话选项（其余字段由生成流程自己维护）。 */
export type PortraitSessionPatch = Partial<
  Pick<PortraitSession, "channel" | "size" | "remoteModel" | "localWorkflowId">
>;

/** 单次生成的覆盖项：调用方算好的「本次用哪个模型」，不传则回落到会话里的当前选择。
 *  `localLabel` 只进展示文案（工作流库里的模型名），不参与请求组装。 */
export interface PortraitGenerateOverrides {
  /** 本次使用的设置页「远端模型」名（远端通道）。 */
  remoteModel?: string;
  /** 本次使用的工作流库工作流 id（本地通道）。 */
  localWorkflowId?: string;
  /** 本地通道的展示标签（工作流库里的模型名）。 */
  localLabel?: string;
}

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
  /** 本地通道使用的工作流（工作流库中已配置对外参数的条目）—— 本地通道的
   *  唯一可执行来源（内置模板已移除），空串 = 未选。 */
  localWorkflowId: string;
  /** 定妆照尺寸（复用镜头生图的比例 / 像素 / 对齐三段选择） */
  size: ShotSizeState;
  /** 本机任务的完成度 0~100；`null` = 该通道不提供进度（远端为一次性请求）。
   *  不要把「不知道」写成 0：视图对两者的渲染不同（0 是刚起步，null 是不确定）。 */
  progress: number | null;
  /** 本次生成实际调用的「通道 · 模型」标签，用于进度与结果文案 */
  modelLabel: string;
  /** 成功 / 结果提示文案（与 error 互斥展示） */
  status: string;
  /** 本次会话的失败原因（可行动文案）；空串 = 当前没有失败 */
  error: string;
  log: PortraitLogEntry[];
}

export interface PortraitSessionActions {
  /** 更新用户选择（通道 / 尺寸 / 模型）。顺带清掉已不成立的错误提示。 */
  patch: (p: PortraitSessionPatch) => void;
  appendLog: (entry: PortraitLogEntry) => void;
  /** 按角色提示词生成一张定妆照，结果作为新候选并入该角色。
   *  overrides：本次使用的通道模型（不传则用会话里的当前选择）。 */
  generate: (
    character: Character,
    overrides?: PortraitGenerateOverrides,
  ) => Promise<void>;
  /** 外部导入一张现成定妆照（写进素材库「角色」分类） */
  importFile: (character: Character, file: File) => Promise<void>;
  /** 把候选里的一张定为定妆照（后续分镜图的参考图） */
  select: (characterId: string, url: string) => void;
  /** 删除一张候选 */
  remove: (characterId: string, url: string) => void;
}

/** 生成 / 导入期间项目被换掉时的归属提示（见 `writeBackCandidate`）。 */
const PROJECT_SWITCHED_NOTICE =
  "定妆照已生成并存入素材库，但期间切换了项目，未并入该角色的候选 —— 请切回原项目后重新生成";

/** 界面日志条目 → 落盘条目（字段名不同：`text` 在磁盘上是 `summary`）。
 *  界面内新增一条日志与落盘必须同一处映射，否则两条通道会各自漂移。 */
function toPersistable(entry: PortraitLogEntry) {
  return { ts: entry.ts, kind: entry.level, summary: entry.text };
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
    progress: null,
    modelLabel: "",
    status: "",
    error: "",
    log: [],
  };
}

export function useCharacterPortrait(opts: {
  setCharacters: React.Dispatch<React.SetStateAction<Character[]>>;
  /** 工坊项目 id：导入的定妆照落到素材库的本项目目录 */
  projectId: string;
}): [PortraitSession, PortraitSessionActions] {
  const { setCharacters, projectId } = opts;
  const [session, setSession] = React.useState<PortraitSession>(initialSession);
  /* 定妆照进度的节流闸门（`~/components/ui/use-throttled-progress`）。 */
  const progressGate = React.useRef(createThrottleGate());

  /* 发起时的项目 id：生成期间若换了项目，`characters` 已经是另一个项目的列表，
   *  被发起的那张角色卡不在里面 —— 此时写回候选会静默落空（图片进了素材库、
   *  界面上却没有候选）。故回写前一律核对归属，见 `writeBackCandidate`。 */
  const projectIdRef = React.useRef(projectId);
  React.useEffect(() => {
    projectIdRef.current = projectId;
  }, [projectId]);

  /* 「有一件任务在跑」的单飞闸门（生成 / 导入共用一把）——判据收在唯一出口里
   *（规范 16 §16.2.4.69）。它同步可见：state 里的 busy / importing 是渲染态，
   *  同一帧内连点两次（或程序化调用）都会读到旧值而放过第二次，两条任务并发
   *  写同一份会话，先完成的那条会把 busy 提前抹掉。 */
  const taskLock = useReentrancyLock();

  /** 门禁 / 校验失败的统一出口：清掉上一轮的成功文案，给出可行动的原因。 */
  const fail = React.useCallback((message: string) => {
    setSession((prev) => ({ ...prev, status: "", error: message }));
  }, []);

  /** 更新用户选择。顺带清掉错误提示：门禁类错误（「还没选模型」）在用户补齐
   *  选择后不再成立，留着红色提示条只会误导；生成失败的详情另有一份在 log 与
   *  log/workshop/ 落盘历史里，清掉提示条不会丢信息。 */
  const patch = React.useCallback(
    (p: PortraitSessionPatch) =>
      setSession((prev) => ({ ...prev, ...p, error: "" })),
    [],
  );

  const appendLog = React.useCallback((entry: PortraitLogEntry) => {
    setSession((prev) => ({
      ...prev,
      log: appendPortraitLog(prev.log, entry),
    }));
    // 生成日志异步落一份到 log/workshop/（fire-and-forget，失败不影响生成）
    persistGenerationLogs("portrait", [toPersistable(entry)]);
  }, []);

  /** 候选写入统一走角色列表的更新（函数式更新，不依赖 characters 快照）。 */
  const addCandidate = React.useCallback(
    (characterId: string, candidate: CharacterPortrait) => {
      setCharacters((prev) =>
        prev.map((item) =>
          item.id === characterId
            ? withPortraitCandidate(item, candidate)
            : item,
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

  /** 候选回写：只在「发起时的项目」仍是当前项目时才写进角色列表；否则保留
   *  素材库里的文件、把原因如实告诉用户 —— 不静默丢弃一次昂贵的生成结果。 */
  const writeBackCandidate = React.useCallback(
    (
      characterId: string,
      candidate: CharacterPortrait,
      originProjectId: string,
    ): boolean => {
      if (projectIdRef.current === originProjectId) {
        addCandidate(characterId, candidate);
        return true;
      }
      fail(PROJECT_SWITCHED_NOTICE);
      appendLog(makePortraitLog("error", PROJECT_SWITCHED_NOTICE));
      return false;
    },
    [addCandidate, appendLog, fail],
  );

  const generate = React.useCallback(
    async (character: Character, overrides?: PortraitGenerateOverrides) => {
      /* 并发守卫用同步闸门，不读 session.busy（它是渲染态）：*/
      if (!taskLock.tryEnter()) return;
      /* 拿到锁之后的每一条路径（含门禁早退）都必须走到 finally 归还 ——
       * 旧实现里「提示词为空 / 未选工作流」的门禁早退直接 return，锁被
       * 永久占住，之后所有生成 / 导入都静默无响应（点了没反应）。 */
      try {
        const prompt = character.positivePrompt.trim();
        if (!prompt) {
          fail(
            "该角色还没有生成提示词，请先补全角色信息（外貌 / 服装等会自动合成提示词）",
          );
          return;
        }
        const channel = session.channel;
        const remoteModel = (
          overrides?.remoteModel ?? session.remoteModel
        ).trim();
        const localWorkflowId = (
          overrides?.localWorkflowId ?? session.localWorkflowId
        ).trim();
        /* 本地通道没有内置模板可回落：必须先选好一个工作流库工作流（自带封装）。
         * 与区块的门禁提示同一口径。 */
        if (channel === "local" && !localWorkflowId) {
          fail(
            "本地通道需要先选模型：上方下拉选工作流库模型（需在库里配置好对外参数）",
          );
          return;
        }
        /* 日志里写「比例 + 档位（+ 倍数）」而不是折算出来的像素 —— 尺寸的表达
         *  就是这两种，具体像素由目标工作流按它自己的口径算。 */
        const size = shotSizeSummary(session.size);
        const label = character.name || "该角色";
        const localLabel = (overrides?.localLabel ?? "").trim();
        const modelLabel =
          channel === "local"
            ? `本地 · ${localLabel || "库工作流"}`
            : remoteModel
              ? `远端 API · ${remoteModel}`
              : "远端 API";
        /* 从这里到第一个 await 之间是同步区：闸门已被上面的 `tryEnter` 占住，
         *  第二次调用必定被那道守卫挡下。 */
        /** 结果归属的项目：与 projectIdRef 比对，防止写进别的项目的角色列表。 */
        const originProjectId = projectId;
        /* 首行（本次用的通道 · 模型 · 尺寸）直接重置成会话日志，不经过 appendLog，
         *  故这里单独落一次盘 —— 否则 log/workshop/ 的历史里只有「完成」没有「开始」，
         *  回看时看不出这一张是用什么参数跑的。 */
        const startLog = makePortraitLog(
          "info",
          `开始为「${label}」生成定妆照（${modelLabel} · ${size}）`,
        );
        persistGenerationLogs("portrait", [toPersistable(startLog)]);
        setSession((prev) => ({
          ...prev,
          busy: true,
          focusCharacterId: character.id,
          /* 远端是一次性请求、不提供进度：这一路用 null 表示「不确定」，
           *  别拿 0 冒充「刚开始」。 */
          progress: channel === "remote" ? null : 0,
          modelLabel,
          status: "",
          error: "",
          log: [startLog],
        }));
        const req: PortraitRequest = {
          prompt,
          negative: character.negativePrompt || undefined,
          /* 尺寸表达原样带过去：三条通道各自要的形状由网络层现算。 */
          size: session.size,
        };
        if (channel === "local") {
          /* 本地通道只有库工作流这条路：内置 txt2img（+ Checkpoint）已移除。 */
          const { taskId, url } = await generateWorkflowPortrait(
            req,
            { workflowId: localWorkflowId },
            {
              onProgress: (pct) => {
                /* 高频回调：节流判据与别处同源（规范 16 §16.2.4.68）；
                 * 「焦点还是不是这个角色」是本域的判据，留在调用处。 */
                if (!progressGate.current.allow(character.id)) return;
                setSession((prev) =>
                  prev.focusCharacterId === character.id
                    ? { ...prev, progress: pct }
                    : prev,
                );
              },
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
          const attached = writeBackCandidate(
            character.id,
            {
              url,
              source: "local",
              ...(localLabel ? { model: localLabel } : {}),
              taskId,
              createdAt: Date.now(),
            },
            originProjectId,
          );
          if (!attached) return;
          setSession((prev) => ({
            ...prev,
            progress: 100,
            status: `已生成一张定妆照（${modelLabel}），可在下方候选里挑选`,
          }));
          appendLog(
            makePortraitLog(
              "success",
              `定妆照生成完成（任务 ${taskId.slice(0, 12)}…）`,
            ),
          );
        } else {
          const url = await generateRemotePortrait(req, {
            projectId,
            name: `${label}-定妆照-${Date.now()}`,
            ...(remoteModel ? { model: remoteModel } : {}),
          });
          const attached = writeBackCandidate(
            character.id,
            {
              url,
              source: "remote",
              ...(remoteModel ? { model: remoteModel } : {}),
              createdAt: Date.now(),
            },
            originProjectId,
          );
          if (!attached) return;
          setSession((prev) => ({
            ...prev,
            status: `已生成一张定妆照（${modelLabel}），可在下方候选里挑选`,
          }));
          appendLog(makePortraitLog("success", "远端 API 返回图片完成"));
        }
      } catch (e: unknown) {
        const message = errorMessage(e, "定妆照生成失败");
        fail(message);
        appendLog(makePortraitLog("error", message));
      } finally {
        /* focusCharacterId 保留：让发起本次生成的角色卡继续展示状态与日志。
         * busy 与锁一起复位：门禁早退（return）也走这里，锁绝不带出函数。 */
        taskLock.exit();
        setSession((prev) => ({ ...prev, busy: false }));
      }
    },
    [
      taskLock,
      session.channel,
      session.size,
      session.remoteModel,
      session.localWorkflowId,
      projectId,
      writeBackCandidate,
      appendLog,
      fail,
    ],
  );

  const importFile = React.useCallback(
    async (character: Character, file: File) => {
      /* 与生成共用同一把锁：导入与生成不允许叠加。 */
      if (!taskLock.tryEnter()) return;
      /* 拿到锁之后的每一条路径（含「非图片文件」的门禁早退）都必须走到
       * finally 归还 —— 旧实现里类型检查失败直接 return，之后所有生成 /
       * 导入都被这把没还的锁静默挡死（同 generate 的回归口径）。 */
      try {
        if (!file.type.startsWith("image/")) {
          fail("只能导入图片文件");
          return;
        }
        const originProjectId = projectId;
        setSession((prev) => ({
          ...prev,
          importing: true,
          focusCharacterId: character.id,
          status: "",
          error: "",
        }));
        const url = await importPortraitFile(file, { projectId });
        const attached = writeBackCandidate(
          character.id,
          { url, source: "import", createdAt: Date.now() },
          originProjectId,
        );
        if (!attached) return;
        setSession((prev) => ({
          ...prev,
          status: `已导入 ${file.name}，可在下方候选里挑选`,
        }));
      } catch (e: unknown) {
        const message = errorMessage(e, "导入定妆照失败");
        fail(message);
        /* 与生成失败同款：导入失败也进执行日志，否则「生成过程」面板与
         *  log/workshop/ 的落盘历史里完全看不到这次失败。 */
        appendLog(makePortraitLog("error", message));
      } finally {
        taskLock.exit();
        setSession((prev) => ({ ...prev, importing: false }));
      }
    },
    [taskLock, projectId, writeBackCandidate, appendLog, fail],
  );

  return [session, { patch, appendLog, generate, importFile, select, remove }];
}
