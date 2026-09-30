"use client";

import { Tabs, TabsList, TabsTrigger } from "~/components/ui/tabs";

import { projectTabs, type WorkspaceView } from "./NavItems";

export interface ProjectTabBarProps {
  /** 当前项目内视图（画布 / 工坊 / 资源库 / 产出 / 成片之一），决定哪个页签高亮。 */
  active: WorkspaceView;
  /** 切换项目内视图。 */
  onSelect: (view: WorkspaceView) => void;
  /** 当前项目名（顶部左侧上下文，可空）。 */
  projectName?: string;
}

/**
 * 项目界面顶部的切换器 —— 画布 / 工坊 / 资源库 / 产出 / 成片 在同一个「项目界面」里以标签页互切。
 *
 * 这四项此前散在主页侧栏、靠 `active === "home"` 切换显隐（点别的视图就莫名复现）。
 * 现在它们从全局侧栏移出、收进这里：进入某个项目后，顶部这一排标签就是项目的操作面。
 * 走官方 `ui/tabs` 基元（不自绘 tab 条），受控于当前视图。
 */
export function ProjectTabBar({
  active,
  onSelect,
  projectName,
}: ProjectTabBarProps) {
  return (
    <div className="bg-sidebar/40 border-border flex shrink-0 items-center gap-3 border-b px-4 py-2">
      {projectName ? (
        <span
          className="text-ink-muted max-w-[12rem] min-w-0 truncate text-sm font-medium"
          title={projectName}
        >
          {projectName}
        </span>
      ) : null}
      <Tabs
        value={active}
        onValueChange={(value) => onSelect(value as WorkspaceView)}
      >
        <TabsList variant="line">
          {projectTabs().map((tab) => (
            <TabsTrigger key={tab.id} value={tab.id}>
              {tab.icon}
              <span>{tab.label}</span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
    </div>
  );
}
