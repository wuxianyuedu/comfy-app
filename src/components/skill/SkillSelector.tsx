"use client";

import React from "react";
import { api } from "~/trpc/react";

/* ── Types ──────────────────────────────────────────────── */
export interface SkillData {
  id: string;
  name: string;
  slug: string;
  description: string;
  icon: string;
  category: string;
  promptTemplate: string;
  negativePrompt?: string;
  defaultParams?: Record<string, unknown>;
  recommendedModel?: string;
  tags: string[];
  coverUrl?: string;
  isBuiltIn: boolean;
  sortOrder: number;
}

export interface CategorySummary {
  id: string;
  label: string;
  count: number;
}

/* ── SkillCard ──────────────────────────────────────────── */
interface SkillCardProps {
  skill: SkillData;
  selected?: boolean;
  onClick: (skill: SkillData) => void;
}

export function SkillCard({ skill, selected, onClick }: SkillCardProps) {
  return (
    <button
      type="button"
      onClick={() => onClick(skill)}
      className={`group relative flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all duration-200
        ${
          selected
            ? "bg-purple-500/15 border-purple-400/40 shadow-[0_0_20px_rgba(168,85,247,0.12)]"
            : "bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06] hover:border-white/[0.12]"
        }
        border backdrop-blur-sm cursor-pointer w-full`}
      aria-pressed={selected}
    >
      {/* Icon */}
      <span className="flex-shrink-0 flex items-center justify-center w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500/20 to-blue-500/20 text-xl leading-none">
        {skill.icon}
      </span>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white/90 truncate group-hover:text-white transition-colors">
          {skill.name}
        </p>
        <p className="text-xs text-white/35 truncate mt-0.5 font-mono">
          /{skill.slug}
        </p>
      </div>

      {/* Selected indicator */}
      {selected && (
        <span className="flex-shrink-0 w-5 h-5 rounded-full bg-purple-500 flex items-center justify-center">
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </span>
      )}
    </button>
  );
}

/* ── SkillSelector ──────────────────────────────────────── */
interface SkillSelectorProps {
  /** Called when user selects or deselects a skill */
  onSelect?: (skill: SkillData | null) => void;
  /** Pre-selected skill ID */
  value?: string | null;
  /** Classname for outer container */
  className?: string;
}

export function SkillSelector({ onSelect, value, className = "" }: SkillSelectorProps) {
  const [activeCat, setActiveCat] = React.useState<string>("all");
  const [search, setSearch] = React.useState("");
  const [displaySkills, setDisplaySkills] = React.useState<SkillData[]>([]);

  const queryParams = React.useMemo(() => {
    const p: { category?: string; q?: string } = {};
    if (activeCat !== "all") p.category = activeCat;
    if (search) p.q = search;
    return p;
  }, [activeCat, search]);

  const skillsQ = api.skill.list.useQuery(queryParams);
  // 用 useMemo 稳定引用：data 未就绪时 ?? [] 每次渲染都是新数组，
  // 直接作为 useEffect 依赖会触发「setState → 重渲染 → 新引用 → setState」死循环
  const skills = React.useMemo(
    () => (skillsQ.data?.skills ?? []) as SkillData[],
    [skillsQ.data]
  );
  const categories = React.useMemo(
    () => (skillsQ.data?.categories ?? []) as CategorySummary[],
    [skillsQ.data]
  );
  const loading = skillsQ.isLoading;

  // Sync display skills when API data changes（引用守卫：仅数据真变化时同步）
  const prevSkillsRef = React.useRef<SkillData[]>(skills);
  React.useEffect(() => {
    if (prevSkillsRef.current !== skills) {
      prevSkillsRef.current = skills;
      setDisplaySkills(skills);
    }
  }, [skills]);

  // Shuffle ("换一批")
  const handleShuffle = () => {
    setDisplaySkills((prev) => [...prev].sort(() => Math.random() - 0.5));
  };

  // Current selection
  const selectedSkill = skills.find((s) => s.id === value) ?? null;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-sm text-white/60 flex-shrink-0">用 Skill</span>
          <span className="text-xs text-white/30 hidden sm:inline">开启创作灵感</span>
        </div>
        <button
          type="button"
          onClick={handleShuffle}
          className="flex-shrink-0 text-xs text-white/35 hover:text-white/60 transition-colors flex items-center gap-1"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          换一批
        </button>
      </div>

      {/* Search */}
      <div className="relative">
        <svg
          className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/25"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
        <input
          type="text"
          placeholder="搜索技能..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-white/[0.03] border border-white/[0.06] rounded-lg pl-9 pr-3 py-2 text-sm text-white/80 placeholder:text-white/25 focus:outline-none focus:border-purple-400/30 focus:bg-white/[0.05] transition-all"
        />
      </div>

      {/* Category tabs */}
      {categories.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-hide">
          <CatTab
            label="全部"
            active={activeCat === "all"}
            onClick={() => setActiveCat("all")}
            count={skills.length}
          />
          {categories.map((cat) => (
            <CatTab
              key={cat.id}
              label={cat.label}
              active={activeCat === cat.id}
              onClick={() => setActiveCat(cat.id)}
              count={cat.count}
            />
          ))}
        </div>
      )}

      {/* Card Grid */}
      {loading ? (
        <div className="grid grid-cols-2 gap-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl px-4 py-3 bg-white/[0.02] border border-white/[0.04] animate-pulse">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-white/[0.05]" />
                <div className="flex-1 space-y-2">
                  <div className="h-3.5 w-24 rounded bg-white/[0.05]" />
                  <div className="h-3 w-32 rounded bg-white/[0.04]" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : displaySkills.length === 0 ? (
        <div className="text-center py-8 text-sm text-white/25">
          {search ? "没有匹配的技能" : "暂无技能"}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2 max-h-[320px] overflow-y-auto pr-0.5 scrollbar-thin">
          {displaySkills.map((skill) => (
            <SkillCard
              key={skill.id}
              skill={skill}
              selected={value === skill.id}
              onClick={(s) => {
                if (value === s.id) {
                  onSelect?.(null);
                } else {
                  onSelect?.(s);
                }
              }}
            />
          ))}
        </div>
      )}

      {/* Active skill summary bar */}
      {selectedSkill && (
        <div className="flex items-center gap-2 rounded-lg bg-purple-500/10 border border-purple-400/20 px-3 py-2">
          <span className="text-sm">{selectedSkill.icon}</span>
          <span className="text-xs text-purple-300/80 flex-1 truncate">
            已选：{selectedSkill.name}
          </span>
          <button
            type="button"
            onClick={() => onSelect?.(null)}
            className="text-white/30 hover:text-white/60 transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Category Tab (internal) ───────────────────────────── */
function CatTab({
  label,
  active,
  onClick,
  count,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-shrink-0 px-3 py-1 rounded-full text-xs transition-all whitespace-nowrap
        ${
          active
            ? "bg-purple-500/20 text-purple-300 border border-purple-400/25"
            : "bg-white/[0.03] text-white/40 border border-transparent hover:text-white/60 hover:bg-white/[0.06]"
        }`}
    >
      {label}
      {count != null && (
        <span className={`ml-1 ${active ? "text-purple-400/60" : "text-white/25"}`}>
          {count}
        </span>
      )}
    </button>
  );
}

export default SkillSelector;
