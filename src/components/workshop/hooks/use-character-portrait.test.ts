// @vitest-environment jsdom
// 「角色定妆照会话」编排层单测（规范 17 §17.4 SOP 第 4 步：优先测逻辑层）。
//
// 这一层此前完全没有用例：纯规则（候选去重 / 上限 / 定妆照回落）由
// `lib/workshop/character-portrait.test.ts` 守着，但**编排本身**没有 —— 门禁文案、
// 候选写回、busy 复位、日志与落盘、并发与项目归属都只能靠人肉读代码。下面逐条钉死。
//
// 用例走真实的 `useState`（宿主 hook 持有 characters），只 mock 网络层三个函数与
// 日志落盘，这样「候选有没有真的写进角色」是断言出来的，而不是断言 mock 调用参数。

import React from "react";
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  generateRemotePortrait,
  generateWorkflowPortrait,
  importPortraitFile,
} from "~/lib/workshop/character-portrait-client";
import { persistGenerationLogs } from "~/lib/workshop/generation-log-client";
import type { Character } from "~/lib/workshop/types";

import { useCharacterPortrait } from "./use-character-portrait";

vi.mock("~/lib/workshop/character-portrait-client", () => ({
  generateWorkflowPortrait: vi.fn(),
  generateRemotePortrait: vi.fn(),
  importPortraitFile: vi.fn(),
}));
vi.mock("~/lib/workshop/generation-log-client", () => ({
  persistGenerationLogs: vi.fn(),
}));

const mockedLocal = vi.mocked(generateWorkflowPortrait);
const mockedRemote = vi.mocked(generateRemotePortrait);
const mockedImport = vi.mocked(importPortraitFile);
const mockedPersist = vi.mocked(persistGenerationLogs);

function makeCharacter(patch: Partial<Character> = {}): Character {
  return {
    id: "c1",
    name: "阿澈",
    ageGender: "",
    appearance: "",
    costume: "",
    personality: "",
    temperament: "",
    styleTags: [],
    positivePrompt: "a young man, cinematic lighting",
    negativePrompt: "",
    params: {},
    ...patch,
  };
}

/** 被测 hook 的宿主：真实持有 characters state，候选写没写进去一目了然。 */
function useHarness(projectId: string) {
  const [characters, setCharacters] = React.useState<Character[]>([
    makeCharacter(),
  ]);
  const [session, actions] = useCharacterPortrait({ setCharacters, projectId });
  return { characters, session, actions };
}

/** 生成永不 resolve 的桩，用来制造「进行中」窗口。 */
function stallLocal() {
  let resolveTask!: (value: { taskId: string; url: string }) => void;
  mockedLocal.mockImplementation(
    () =>
      new Promise<{ taskId: string; url: string }>((resolve) => {
        resolveTask = resolve;
      }),
  );
  return (value: { taskId: string; url: string }) => resolveTask(value);
}

const character = makeCharacter();

beforeEach(() => {
  mockedLocal.mockReset();
  mockedRemote.mockReset();
  mockedImport.mockReset();
  mockedPersist.mockReset();
});

afterEach(cleanup);

describe("useCharacterPortrait 门禁", () => {
  it("没有提示词：不发请求，给出可行动的提示，busy 保持 false", async () => {
    const { result } = renderHook(() => useHarness("p1"));

    await act(async () => {
      await result.current.actions.generate(
        makeCharacter({ positivePrompt: "   " }),
      );
    });

    expect(mockedLocal).not.toHaveBeenCalled();
    expect(mockedRemote).not.toHaveBeenCalled();
    expect(result.current.session.error).toContain("还没有生成提示词");
    expect(result.current.session.busy).toBe(false);
  });

  it("本地通道未选工作流：拦住并说明去哪儿选（与区块门禁同口径）", async () => {
    const { result } = renderHook(() => useHarness("p1"));

    await act(async () => {
      await result.current.actions.generate(character);
    });

    expect(mockedLocal).not.toHaveBeenCalled();
    expect(result.current.session.error).toContain("本地通道需要先选模型");
  });

  it("用户补齐选择后，旧的门禁错误不再挂着（patch 清错误）", async () => {
    const { result } = renderHook(() => useHarness("p1"));

    await act(async () => {
      await result.current.actions.generate(character);
    });
    expect(result.current.session.error).not.toBe("");

    act(() => {
      result.current.actions.patch({ localWorkflowId: "wf-1" });
    });

    expect(result.current.session.error).toBe("");
    expect(result.current.session.localWorkflowId).toBe("wf-1");
  });

  it("门禁拒绝后锁被归还：下一次合法生成仍能发起（回归：门禁早退曾泄漏锁）", async () => {
    const { result } = renderHook(() => useHarness("p1"));

    /* 第一次：本地通道未选工作流 → 门禁拒绝。旧实现在这里直接 return，
     * 锁被永久占住 —— 之后的 generate / importFile 全部静默无响应。 */
    await act(async () => {
      await result.current.actions.generate(character);
    });
    expect(result.current.session.error).toContain("本地通道需要先选模型");

    /* 第二次：补齐选择后必须能真正发起请求。 */
    mockedLocal.mockResolvedValue({
      taskId: "task-1",
      url: "/api/generated/a.png",
    });
    await act(async () => {
      await result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    expect(mockedLocal).toHaveBeenCalledTimes(1);
    expect(result.current.characters[0]!.portraits ?? []).toHaveLength(1);
    expect(result.current.session.busy).toBe(false);
  });

  it("提示词为空的门禁拒绝同样归还锁（同一把锁的两条早退路径都要走 finally）", async () => {
    const { result } = renderHook(() => useHarness("p1"));

    await act(async () => {
      await result.current.actions.generate(
        makeCharacter({ positivePrompt: "  " }),
      );
    });
    expect(result.current.session.error).toContain("还没有生成提示词");

    mockedLocal.mockResolvedValue({
      taskId: "task-1",
      url: "/api/generated/a.png",
    });
    await act(async () => {
      await result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    expect(mockedLocal).toHaveBeenCalledTimes(1);
  });
});

describe("useCharacterPortrait 生成", () => {
  it("本地成功：候选带 source/taskId 写进角色，第一张自动成为定妆照", async () => {
    mockedLocal.mockResolvedValue({
      taskId: "task-1234567890abc",
      url: "/api/generated/a.png",
    });
    const { result } = renderHook(() => useHarness("p1"));

    await act(async () => {
      await result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
        localLabel: "sdxl",
      });
    });

    expect(mockedLocal).toHaveBeenCalledTimes(1);
    const portraits = result.current.characters[0]!.portraits ?? [];
    expect(portraits).toHaveLength(1);
    expect(portraits[0]).toMatchObject({
      url: "/api/generated/a.png",
      source: "local",
      model: "sdxl",
      taskId: "task-1234567890abc",
    });
    /* 角色还没有定妆照时第一张自动选中 —— 后续分镜图就能拿它当参考图 */
    expect(result.current.characters[0]!.portraitUrl).toBe(
      "/api/generated/a.png",
    );
    expect(result.current.session.busy).toBe(false);
    expect(result.current.session.progress).toBe(100);
    expect(result.current.session.status).toContain("已生成一张定妆照");
    expect(result.current.session.log.map((entry) => entry.level)).toEqual([
      "info",
      "success",
    ]);
    /* 每条日志异步落一份到 log/workshop/，刷新 / 重启后仍可回看。
     * 首行（通道 · 模型 · 尺寸）与完成行都要落盘 —— 只有「完成」没有「开始」时，
     * 回看历史根本看不出这一张是用什么参数跑的。 */
    expect(
      mockedPersist.mock.calls.map(([, entries]) => entries[0]?.kind),
    ).toEqual(["info", "success"]);
  });

  it("本地进行中：进度与执行日志实时进会话，progress 帧不混进日志", async () => {
    let resolveTask!: (value: { taskId: string; url: string }) => void;
    mockedLocal.mockImplementation((_req, _opts, handlers) => {
      handlers?.onLog?.({ t: 1, level: "info", msg: "模型已加载" });
      // progress 帧是进度条语义，不该在「生成过程」里刷屏
      handlers?.onLog?.({ t: 2, level: "progress", msg: "采样中" });
      handlers?.onProgress?.(37);
      return new Promise<{ taskId: string; url: string }>((resolve) => {
        resolveTask = resolve;
      });
    });

    const { result } = renderHook(() => useHarness("p1"));

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    expect(result.current.session.busy).toBe(true);
    expect(result.current.session.progress).toBe(37);
    const texts = result.current.session.log.map((entry) => entry.text);
    expect(texts).toContain("模型已加载");
    expect(texts).not.toContain("采样中");

    await act(async () => {
      resolveTask({ taskId: "task-1", url: "/api/generated/a.png" });
      await pending;
    });
    expect(result.current.session.progress).toBe(100);
  });

  it("远端成功：候选 source=remote，进度全程为 null（该通道不提供进度）", async () => {
    mockedRemote.mockResolvedValue("/api/materials/characters/remote.png");
    const { result } = renderHook(() => useHarness("p1"));

    act(() => {
      result.current.actions.patch({ channel: "remote" });
    });
    await act(async () => {
      await result.current.actions.generate(character, {
        remoteModel: "dall-e-3",
      });
    });

    expect(mockedRemote).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: character.positivePrompt }),
      expect.objectContaining({ projectId: "p1", model: "dall-e-3" }),
    );
    const portraits = result.current.characters[0]!.portraits ?? [];
    expect(portraits[0]).toMatchObject({
      url: "/api/materials/characters/remote.png",
      source: "remote",
      model: "dall-e-3",
    });
    /* 远端一次性请求没有进度可言：null 是「不确定」，不是 0% */
    expect(result.current.session.progress).toBeNull();
  });

  it("失败：错误进 error 与执行日志，busy 复位，不写候选（失败必须有可见出口）", async () => {
    mockedLocal.mockRejectedValue(new Error("连接中断"));
    const { result } = renderHook(() => useHarness("p1"));

    await act(async () => {
      await result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    expect(result.current.session.error).toBe("连接中断");
    expect(result.current.session.busy).toBe(false);
    expect(result.current.characters[0]!.portraits ?? []).toHaveLength(0);
    expect(
      result.current.session.log[result.current.session.log.length - 1],
    ).toMatchObject({ level: "error", text: "连接中断" });
  });

  it("同一时刻只跑一件：第二次 generate 被原子锁挡下（不能只靠 state 的 busy）", async () => {
    const resolve = stallLocal();
    const { result } = renderHook(() => useHarness("p1"));

    let first!: Promise<void>;
    await act(async () => {
      first = result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });
    /* 同一帧内再点一次：此刻 state 里的 busy 还没进入这次闭包，
     * 只有 ref 守卫挡得住 —— 否则两条任务并发写同一份会话。 */
    await act(async () => {
      await result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    expect(mockedLocal).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolve({ taskId: "task-1", url: "/api/generated/a.png" });
      await first;
    });

    expect(result.current.session.busy).toBe(false);
    expect(result.current.characters[0]!.portraits ?? []).toHaveLength(1);
  });

  it("生成期间切了项目：不写回角色候选，并把原因如实告知（不静默丢结果）", async () => {
    const resolve = stallLocal();
    const { result, rerender } = renderHook(
      ({ projectId }: { projectId: string }) => useHarness(projectId),
      { initialProps: { projectId: "p1" } },
    );

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    /* 真实管线里切项目会用目标项目的草稿替换 characters，本用例只把 projectId
     * 换掉：不变式是「归属变了就不写回」，与角色列表是否被替换无关。 */
    rerender({ projectId: "p2" });

    await act(async () => {
      resolve({ taskId: "task-9", url: "/api/generated/a.png" });
      await pending;
    });

    expect(result.current.characters[0]!.portraits ?? []).toHaveLength(0);
    expect(result.current.session.error).toContain("切换了项目");
    expect(result.current.session.busy).toBe(false);
  });
});

describe("useCharacterPortrait 导入", () => {
  it("非图片文件：拒绝并说明，不发请求", async () => {
    const { result } = renderHook(() => useHarness("p1"));
    const file = new File(["x"], "note.txt", { type: "text/plain" });

    await act(async () => {
      await result.current.actions.importFile(character, file);
    });

    expect(mockedImport).not.toHaveBeenCalled();
    expect(result.current.session.error).toBe("只能导入图片文件");
    expect(result.current.session.importing).toBe(false);
  });

  it("非图片被拒后锁被归还：后续合法导入仍能发起（回归：门禁早退曾泄漏锁）", async () => {
    const { result } = renderHook(() => useHarness("p1"));

    const bad = new File(["x"], "note.txt", { type: "text/plain" });
    await act(async () => {
      await result.current.actions.importFile(character, bad);
    });
    expect(result.current.session.error).toBe("只能导入图片文件");

    /* 第二次导入合法文件必须真正发起 —— 旧实现锁没还，这里会静默 return。 */
    mockedImport.mockResolvedValue("/api/materials/characters/up.png");
    const good = new File(["x"], "portrait.png", { type: "image/png" });
    await act(async () => {
      await result.current.actions.importFile(character, good);
    });

    expect(mockedImport).toHaveBeenCalledTimes(1);
    expect(result.current.characters[0]!.portraits ?? []).toHaveLength(1);
    expect(result.current.session.importing).toBe(false);
  });

  it("导入成功：候选 source=import 写进角色，导入来源没有 model 字段", async () => {
    mockedImport.mockResolvedValue("/api/materials/characters/up.png");
    const { result } = renderHook(() => useHarness("p1"));
    const file = new File(["x"], "portrait.png", { type: "image/png" });

    await act(async () => {
      await result.current.actions.importFile(character, file);
    });

    expect(mockedImport).toHaveBeenCalledWith(file, { projectId: "p1" });
    const portraits = result.current.characters[0]!.portraits ?? [];
    expect(portraits[0]).toMatchObject({
      url: "/api/materials/characters/up.png",
      source: "import",
    });
    expect(portraits[0]!.model).toBeUndefined();
    expect(result.current.session.status).toContain("portrait.png");
    expect(result.current.session.importing).toBe(false);
  });

  it("导入失败：错误进 error 与执行日志（回归：旧实现只写 error，历史里看不到）", async () => {
    mockedImport.mockRejectedValue(new Error("素材库写入失败"));
    const { result } = renderHook(() => useHarness("p1"));
    const file = new File(["x"], "portrait.png", { type: "image/png" });

    await act(async () => {
      await result.current.actions.importFile(character, file);
    });

    expect(result.current.session.error).toBe("素材库写入失败");
    expect(
      result.current.session.log[result.current.session.log.length - 1],
    ).toMatchObject({ level: "error", text: "素材库写入失败" });
    expect(mockedPersist).toHaveBeenCalledWith("portrait", [
      expect.objectContaining({ kind: "error", summary: "素材库写入失败" }),
    ]);
    expect(result.current.session.importing).toBe(false);
  });

  it("生成期间导入：导入被同一把锁挡下（两件任务不叠加）", async () => {
    const resolve = stallLocal();
    const { result } = renderHook(() => useHarness("p1"));

    let pending!: Promise<void>;
    await act(async () => {
      pending = result.current.actions.generate(character, {
        localWorkflowId: "wf-1",
      });
    });

    const file = new File(["x"], "portrait.png", { type: "image/png" });
    await act(async () => {
      await result.current.actions.importFile(character, file);
    });
    expect(mockedImport).not.toHaveBeenCalled();

    await act(async () => {
      resolve({ taskId: "task-1", url: "/api/generated/a.png" });
      await pending;
    });
  });
});
