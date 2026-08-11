"use client";

import React, { useState, useCallback } from "react";
import { Icon } from "@/components/ui/Icon";

/* Inline Skill type — avoids importing from API route */
export interface SkillItem {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon?: string;
  category: string;
}

/* ── Skill Panel (Right Panel Tab) ─────────────────────
  "我的技能" list + "添加技能" expandable section.
  Matches updream.cn skill card style.
*/

export interface SkillPanelProps {
  skills: SkillItem[];
  selectedId?: string;
  onSelect?: (skill: SkillItem) => void;
  onManage?: () => void;
  loading?: boolean;
}

export function SkillPanel({
  skills,
  selectedId,
  onSelect,
  onManage,
  loading = false,
}: SkillPanelProps) {
  const [addOpen, setAddOpen] = useState(false);
  const [search, setSearch] = useState("");

  const filtered = skills.filter(
    (s) =>
      s.name.toLowerCase().includes(search.toLowerCase()) ||
      s.description.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="flex flex-col">
      {/* Header row */}
      <div className="flex items-center justify-between border-b border-white/6 px-4 py-3">
        <h3 className="u-title">我的技能</h3>
        {onManage && (
          <button
            type="button"
            onClick={onManage}
            className="text-xs text-gray-500 transition-colors hover:text-violet-300"
          >
            管理
          </button>
        )}
      </div>

      {/* Search */}
      <div className="px-4 pt-3 pb-2">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="搜索技能…"
          className="w-full rounded-lg border border-white/8 bg-white/[0.03] px-3 py-2 text-xs outline-none placeholder:text-gray-600 focus:border-violet-500/30"
        />
      </div>

      {/* Skill cards list */}
      <div className="flex-1 overflow-y-auto px-4 pb-3">
        {loading && (
          <div className="py-8 text-center text-xs text-gray-600">加载中…</div>
        )}

        {!loading && filtered.length === 0 && (
          <div className="py-8 text-center text-xs text-gray-600">
            {search ? "无匹配技能" : "暂无技能"}
          </div>
        )}

        {filtered.map((skill) => {
          const isSelected = skill.id === selectedId;
          return (
            <button
              key={skill.id}
              type="button"
              onClick={() => onSelect?.(skill)}
              className={`mb-2 flex w-full gap-3 rounded-xl p-3 text-left transition-all ${
                isSelected
                  ? "bg-violet-500/10 ring-1 ring-violet-500/20"
                  : "hover:bg-white/[0.03]"
              }`}
            >
              {/* Icon */}
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-white/[0.05] text-violet-300">
                <Icon name={skill.icon ?? "palette"} size={18} />
              </span>

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-100">
                  {skill.name}
                </p>
                <p className="mt-0.5 line-clamp-2 text-xs leading-relaxed text-gray-500">
                  {skill.description}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Add skill section */}
      <div className="border-t border-white/6 px-4 py-3">
        <button
          type="button"
          onClick={() => setAddOpen(!addOpen)}
          className="mb-2 flex w-full items-center gap-2 rounded-lg border border-dashed border-white/10 px-3 py-2 text-xs text-gray-400 transition-colors hover:border-violet-500/30 hover:text-violet-300"
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 5v14M5 12h14" />
          </svg>
          添加技能
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className={`ml-auto transition-transform ${addOpen ? "rotate-180" : ""}`}
          >
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        {addOpen && (
          <div className="grid grid-cols-4 gap-2 rounded-lg bg-white/[0.02] p-2">
            {[
              { icon: "filetext", label: "文档" },
              { icon: "image", label: "图片" },
              { icon: "film", label: "视频" },
              { icon: "music", label: "音乐" },
            ].map((t) => (
              <button
                key={t.label}
                type="button"
                className="flex flex-col items-center gap-1 rounded-lg border border-white/6 py-3 text-xs text-gray-500 transition-colors hover:border-violet-500/20 hover:text-violet-300"
              >
                <Icon name={t.icon} size={18} />
                {t.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
