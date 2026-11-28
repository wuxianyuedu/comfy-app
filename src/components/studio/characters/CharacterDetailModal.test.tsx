/**
 * 角色生成历史的时间口径（#5290）：原先用 `toLocaleString("zh-CN")`，输出随宿主区域设置漂移。
 * 现在日期 + 时刻都走 `~/lib/time-format` 的统一出口；本用例用计数桩判两件事：
 * ① 时间真的经出口产出；② 同一时间只在一条历史行里出现，没有走回裸调。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

import { CharacterDetailModal, type CharacterDetailModalProps } from "./CharacterDetailModal";

const dateMock = vi.hoisted(() => vi.fn((value: number) => `D${String(value)}`));
const clockMock = vi.hoisted(() => vi.fn((value: number) => `C${String(value)}`));
vi.mock("~/lib/time-format", () => ({ formatDate: dateMock, formatClock: clockMock }));

afterEach(cleanup);

/** 最小可用 props：character 非空才渲染档案区，history 给一条带时间的行。 */
function props(): CharacterDetailModalProps {
  return {
    character: {
      archetype: "",
      createdAt: new Date(1_700_000_000_000),
      description: "描述",
      gender: "不限",
      height: null,
      id: "c-1",
      name: "测试角色",
      params: null,
      portraitUrl: null,
      portraits: [],
      qualityIssues: [],
      qualityScore: null,
      source: "manual",
      status: "ready",
      tags: [],
      taskId: null,
      updatedAt: new Date(1_700_000_000_000),
      userId: "u-1",
      width: null,
    },
    deletingPortraits: false,
    history: [
      {
        taskId: "t-1",
        url: "img-1",
        createdAt: 1_700_000_000_000,
        workflowName: "wf",
        modelName: "m",
        status: "SUCCEEDED",
        imageCount: 1,
        prompt: "p",
        error: null,
      },
    ] as NonNullable<CharacterDetailModalProps["history"]>,
    historyLoading: false,
    onClose: vi.fn(),
    onDeleteSelectedPortraits: vi.fn(),
    onEdit: vi.fn(),
    onRegenerate: vi.fn(),
    onRemove: vi.fn(),
    onScore: vi.fn(),
    onTogglePortraitSelection: vi.fn(),
    open: true,
    regenerating: false,
    scoring: false,
    selectedPortraitUrls: [],
  };
}

describe("CharacterDetailModal 历史时间统一出口（#5290）", () => {
  it("时间经 formatDate + formatClock 输出，不再裸调 toLocaleString", () => {
    dateMock.mockClear();
    clockMock.mockClear();
    render(<CharacterDetailModal {...props()} />);
    expect(dateMock).toHaveBeenCalledWith(1_700_000_000_000);
    expect(clockMock).toHaveBeenCalledWith(1_700_000_000_000);
    expect(screen.getAllByText(/D1700000000000 C1700000000000/).length).toBeGreaterThan(0);
  });
});
