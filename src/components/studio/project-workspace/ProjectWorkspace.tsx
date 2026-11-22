"use client";

// 项目页容器（ISSUE #4765）：一个项目一个页签。项目内的去处 —— 画布 / 工坊六阶段
//（剧本·角色卡·场景分镜·镜头生图·视频生成·成片合成）/ 资源库 / 产出 / 成片 ——
// 全部收进左侧列表（`ProjectSectionRail`）在本页内切换，不再各开一个页签。
// 已到访的分区保持挂载、用 CSS 显隐切换（与 `WorkspaceViewStack` 同一约定：
// 切走不卸载、切回不重开 —— 画布编辑态 / 工坊草稿 / 成片时间线都不因切换丢失）。
// 工坊六段**共用一个** `WorkshopPipeline` 实例（受控阶段游标），不是每段挂一份 ——
// 多实例会各持一份草稿状态互相覆盖。

import { useCallback, useEffect, useState } from "react";

import { subscribeAppEvent } from "~/lib/app-events";
import { useToast } from "~/components/studio/ToastProvider";
import { ConfirmDialog } from "~/components/ui/confirm-dialog";
import { ProjectHomePage } from "~/components/studio/project-home";
import {
  FilmStudio,
  ProjectCanvas,
  ProjectOutputs,
  ResourceLibrary,
  WorkshopPipeline,
} from "~/components/studio/LazyViews";
import { useProjectHome } from "../project-home/hooks/use-project-home";
import type { WorkspaceView } from "../NavItems";
import type { Tab } from "~/components/workshop/stage-config";
import { ProjectSectionRail } from "./ProjectSectionRail";
import {
  isWorkshopSection,
  peekPendingSection,
  toProjectSection,
  type ProjectSection,
} from "./project-sections";

export type ProjectWorkspaceProps = {
  /** 工作流库「使用」动作的一次性载荷消费：进画布分区放完节点后清掉。 */
  onConsumePendingWorkflow: () => void;
  /** 删除本项目（上层负责：删本地+服务端、关页签、刷新活跃项目）。 */
  onDeleteProject: (projectId: string) => void;
  /** 旧的视图级跳转入口（项目主页入口卡 / 状态卡「去工坊继续」）—— 上层翻译成分区。 */
  onNavigate: (view: WorkspaceView) => void;
  /** 工作流库「使用」动作的一次性载荷：进画布分区时放一个 workflow 节点。 */
  pendingWorkflow: { id: string; name: string; taskType: string } | null;
  /** 当前项目 id —— 页签绑定的那一个（多项目页签同场时各渲染各的，不读全局活跃）。 */
  projectId: string;
  projectName: string;
};

/** 分区 → 挂载键：工坊六段共用一把（一个 WorkshopPipeline 实例），其余各一把。 */
function mountKeyOf(section: ProjectSection): string {
  return isWorkshopSection(section) ? "workshop" : section;
}

export function ProjectWorkspace({
  projectId,
  projectName,
  onNavigate,
  onDeleteProject,
  pendingWorkflow,
  onConsumePendingWorkflow,
}: ProjectWorkspaceProps) {
  const toast = useToast();
  /* 左列表的阶段状态与项目主页同一份 production 派生（概览分区自己也取一份，
   * 两处口径一致；取数失败各自静默回落空态，与主页既有行为相同）。 */
  const { overview } = useProjectHome();

  /* 当前分区：挂载时先读「这个项目最近被请求过哪个分区」—— 导航事件可能早于
   * 本容器挂载（页签刚打开、懒加载分块未到）发出，广播不补发；之后靠
   * `project:section` 事件跟进（只响应目标是自己这条项目的广播）。 */
  const [section, setSection] = useState<ProjectSection>(() => peekPendingSection(projectId));
  useEffect(
    () =>
      subscribeAppEvent("project:section", (payload) => {
        if (payload.projectId !== undefined && payload.projectId !== projectId) {
          return;
        }
        const next = toProjectSection(payload.section);
        if (next !== null) {
          setSection(next);
        }
      }),
    [projectId],
  );

  /* 已到访分区的挂载集合：进过的分区留驻（隐藏不卸载），没进过的不挂。
   * 「到访过哪些」是历史累积量，不由任何 props 派生 —— 只能在分区变化时补记
   * 一笔（与 workspace 页恢复 active-id 的 effect 同一款豁免：外部状态同步）。 */
  const [mounted, setMounted] = useState<ReadonlySet<string>>(
    () => new Set([mountKeyOf(peekPendingSection(projectId))]),
  );
  useEffect(() => {
    const key = mountKeyOf(section);
    // oxlint-disable-next-line react/set-state-in-effect
    setMounted((prev) => (prev.has(key) ? prev : new Set([...prev, key])));
  }, [section]);

  /* 工坊受控游标：当前分区是工坊段时直接用分区 id；隐藏期间保持最后一次的段
   * （自动保存照常跑，游标不漂）。工坊内部改段（如右栏「去剧本」）同步回分区，
   * 左列表高亮跟着走。 */
  const [lastWorkshopTab, setLastWorkshopTab] = useState<Tab>("script");
  const activeWorkshopTab: Tab = isWorkshopSection(section) ? section : lastWorkshopTab;
  const handleWorkshopTabChange = useCallback((tab: Tab) => {
    setLastWorkshopTab(tab);
    setSection(tab);
  }, []);

  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const handleConfirmDelete = useCallback(() => {
    setConfirmDeleteOpen(false);
    onDeleteProject(projectId);
    toast.success(`已删除项目「${projectName}」`);
  }, [onDeleteProject, projectId, projectName, toast]);

  const renderMounted = (key: string) => {
    if (key === "workshop") {
      return (
        <WorkshopPipeline
          hideStageRail
          onTabChange={handleWorkshopTabChange}
          tab={activeWorkshopTab}
        />
      );
    }
    switch (key) {
      case "canvas": {
        return (
          <ProjectCanvas
            onConsumePending={onConsumePendingWorkflow}
            pendingWorkflow={pendingWorkflow}
          />
        );
      }
      case "film": {
        return <FilmStudio />;
      }
      case "library": {
        return <ResourceLibrary />;
      }
      case "outputs": {
        return <ProjectOutputs />;
      }
      case "overview": {
        return (
          <ProjectHomePage
            onNavigate={onNavigate}
            projectId={projectId}
            projectName={projectName}
          />
        );
      }
      default: {
        return null;
      }
    }
  };

  return (
    <div className="bg-canvas text-ink flex h-full min-h-0">
      <aside className="border-border-subtle bg-sidebar/30 flex w-60 shrink-0 flex-col overflow-y-auto border-r p-3 lg:w-64">
        <ProjectSectionRail
          current={section}
          onDelete={() => {
            setConfirmDeleteOpen(true);
          }}
          onSelect={setSection}
          overview={overview}
        />
      </aside>
      <div className="min-h-0 min-w-0 flex-1">
        {[...mounted].map((key) => {
          const active = mountKeyOf(section) === key;
          return (
            <div aria-hidden={!active} className={active ? "h-full" : "hidden h-full"} key={key}>
              {renderMounted(key)}
            </div>
          );
        })}
      </div>

      {/* 删除确认：文案与「所有项目」屏同族 —— 该项目将连同画布内容一并删除。 */}
      <ConfirmDialog
        cancelLabel="取消"
        confirmLabel="删除项目"
        danger
        description={
          `即将永久删除「${projectName}」。\n` + `该操作不可撤销，画布内的节点与连线将一并丢失。`
        }
        onClose={() => {
          setConfirmDeleteOpen(false);
        }}
        onConfirm={handleConfirmDelete}
        open={confirmDeleteOpen}
        title="删除此画布项目？"
      />
    </div>
  );
}
