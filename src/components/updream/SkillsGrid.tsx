"use client";

import React from "react";
import type { SkillData } from "@/components/skill";
import { AuroraBackground } from "@/components/updream/AuroraBackground";
import { Icon } from "@/components/ui/Icon";
import { api } from "~/trpc/react";

type SkillItem = SkillData;

const CATEGORY_LABELS: Record<string, string> = {
  style: "风格模板",
  video: "视频创作",
  photo: "摄影写真",
  comic: "漫画分镜",
  design: "概念设计",
};

export function SkillsGrid({ onUseSkill }: { onUseSkill?: (skill: SkillItem) => void }) {
  const skillsQ = api.skill.list.useQuery();
  const skills = (skillsQ.data?.skills ?? []) as SkillItem[];
  const loading = skillsQ.isLoading;

  return (
    <div className="h-full overflow-y-auto">
      <AuroraBackground />
      <div className="mx-auto max-w-[1200px] px-4 sm:px-8 py-8 sm:py-10">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-gray-100">技能库</h1>
          <p className="mt-1 text-sm text-gray-500">选择风格模板或创作技能，一键应用到画布开始生成。</p>
        </div>

        {loading ? (
          <p className="text-sm text-gray-500">加载中…</p>
        ) : skills.length === 0 ? (
          <div className="grid min-h-[300px] place-items-center rounded-2xl border border-dashed border-white/[0.08] text-gray-500">
            <div className="text-center">
              <p className="text-lg font-medium text-gray-300">暂无技能</p>
              <p className="mt-1 text-sm">技能模板由系统内置，启用后会显示在这里。</p>
            </div>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
            {skills.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => onUseSkill?.(s)}
                className="group flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 text-left transition-all hover:border-white/[0.14] hover:bg-white/[0.04] hover:shadow-lg hover:shadow-black/30"
              >
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-violet-500/10 text-violet-300">
                  <Icon name={s.icon ?? "sparkles"} size={20} />
                </div>
                <h3 className="u-title">{s.name}</h3>
                <p className="mt-1 line-clamp-2 text-xs text-gray-500">{s.description}</p>
                <span className="mt-3 inline-block w-fit rounded-md bg-white/[0.06] px-2 py-0.5 text-[11px] text-gray-400">
                  {CATEGORY_LABELS[s.category] ?? s.category}
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
