"use client";

import React from "react";
import { ChevronLeft, MessageSquare, Search } from "lucide-react";
import { Icon } from "@/components/ui/icon";

/* ── Updream-style Top Bar ───────────────────────────────
  [<]  ProjectName          ⚡360  👤User  🔍  💬
*/

export interface TopBarProps {
  /** Project / workspace name */
  title?: string;
  /** Called when back arrow clicked */
  onBack?: () => void;
  /** User display name */
  userName?: string;
  /** User avatar URL or initial */
  userAvatar?: string;
  /** Credits/points display (decorative, no real billing) */
  credits?: number;
  /** Search input toggle */
  onSearch?: () => void;
  /** Chat toggle */
  onChat?: () => void;
  /** Extra right-side elements */
  rightExtra?: React.ReactNode;
}

export function TopBar({
  title = "未命名项目",
  onBack,
  userName = "创作者",
  userAvatar,
  credits = 360,
  onSearch,
  onChat,
  rightExtra,
}: TopBarProps) {
  return (
    <div className="flex h-12 w-full items-center justify-between gap-3">
      {/* Left: Back + Title */}
      <div className="flex items-center gap-2.5">
        <button
          type="button"
          onClick={onBack}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-gray-200"
          aria-label="返回"
        >
          <ChevronLeft size={18} />
        </button>
        <h1
          className="max-w-[200px] truncate text-sm font-semibold text-gray-100"
          title={title}
        >
          {title}
        </h1>
      </div>

      {/* Right: Credits + User + Search + Chat */}
      <div className="flex items-center gap-2">
        {/* Credits badge (decorative) */}
        <span className="flex items-center gap-1 rounded-full bg-white/5 px-2.5 py-1 text-xs text-gray-400">
          <Icon name="zap" size={13} className="text-amber-400" />
          {credits}
        </span>

        {/* User */}
        <button
          type="button"
          className="flex items-center gap-2 rounded-lg px-2 py-1 transition-colors hover:bg-white/8"
        >
          {userAvatar ? (
            <img
              src={userAvatar}
              alt=""
              className="h-7 w-7 rounded-full object-cover ring-1 ring-white/10"
            />
          ) : (
            <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/20 text-xs font-medium text-violet-300 ring-1 ring-violet-500/20">
              {(userName?.[0] ?? "U").toUpperCase()}
            </span>
          )}
          <span className="hidden max-w-[80px] truncate text-xs text-gray-300 sm:inline-block">
            {userName}
          </span>
        </button>

        {/* Search */}
        {onSearch && (
          <button
            type="button"
            onClick={onSearch}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-gray-200"
            aria-label="搜索"
          >
            <Search size={16} />
          </button>
        )}

        {/* Chat */}
        {onChat && (
          <button
            type="button"
            onClick={onChat}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/8 hover:text-gray-200"
            aria-label="对话"
          >
            <MessageSquare size={16} />
          </button>
        )}

        {rightExtra}
      </div>
    </div>
  );
}
