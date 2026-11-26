"use client";

/* 角色卡展示回归：全标签（无 +N 截断）、原型与名字同行、状态徽标保留。 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import { TooltipProvider } from "~/components/ui/tooltip";

import { CharacterCard } from "./CharacterCard";
import type { CharacterListItem } from "./hooks/use-character-library";

afterEach(cleanup);

const character: CharacterListItem = {
  archetype: "魔法师",
  createdAt: "2026-01-01T00:00:00.000Z",
  description: "一位来自北方雪原的施法者。",
  gender: "女",
  height: 1024,
  id: "char-1",
  name: "一个非常非常长的名字用于验证原型不会被挤没",
  portraitCount: 1,
  portraitUrl: "",
  qualityIssues: [],
  qualityScore: 88,
  source: "seed",
  status: "ready",
  taskId: null,
  tags: ["标签一", "标签二", "标签三", "标签四", "标签五"],
  width: 768,
};

function renderCard() {
  return render(
    <TooltipProvider delay={0}>
      <CharacterCard
        character={character}
        onOpenDetail={() => undefined}
        onRemove={() => undefined}
      />
    </TooltipProvider>,
  );
}

describe("CharacterCard 卡片信息（ISSUE #5009 后续）", () => {
  it("五枚标签全部渲染，没有 +N 截断", () => {
    renderCard();
    const tags = screen.getByTestId("character-tags");
    expect(tags).toHaveTextContent("标签一");
    expect(tags).toHaveTextContent("标签二");
    expect(tags).toHaveTextContent("标签三");
    expect(tags).toHaveTextContent("标签四");
    expect(tags).toHaveTextContent("标签五");
    expect(screen.queryByText(/^\+\d+$/)).toBeNull();
  });

  it("名字与原型徽标同处一行容器，长名字不会把原型挤到下一行", () => {
    renderCard();
    const row = screen.getByTestId("character-name-row");
    expect(row).toHaveTextContent(character.name);
    expect(row).toHaveTextContent("魔法师");
    expect(screen.getByTestId("character-archetype").className).toContain("shrink-0");
  });

  it("状态徽标与质量分保持在信息区", () => {
    renderCard();
    expect(screen.getByText("已就绪")).toBeTruthy();
    expect(screen.getByText("质量 88")).toBeTruthy();
  });

  it("生成中的卡给出单条取消入口，点击把角色 id 上报给 controller", () => {
    const onCancelGeneration = vi.fn();
    render(
      <TooltipProvider delay={0}>
        <CharacterCard
          character={{ ...character, status: "generating", taskId: "task-1" }}
          onCancelGeneration={onCancelGeneration}
          onOpenDetail={() => undefined}
          onRemove={() => undefined}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByLabelText(`取消生成 ${character.name}`));
    expect(onCancelGeneration).toHaveBeenCalledWith(character.id);
  });
});
