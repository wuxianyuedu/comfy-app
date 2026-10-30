"use client";

/** 系列角色库面板（FR-SR-03，#2508 切片 2）。纯视图：取数/变更全部来自 `useSeriesOrganizer`（逻辑层，规范 17 / 硬闸 S3）；落地「跨集复用：引用而非拷贝」——系列角色库增改删、本集关联、与 production.characters 双向同步（提升/注入，按 name 幂等合并）。 */

import { useMemo, useState } from "react";
import { Button } from "~/components/ui/button";
import { FieldLabel } from "~/components/ui/field";
import { textHandler } from "~/lib/form-props";
import { cn } from "~/lib/utils";
import type { SeriesOrganizerController } from "./hooks/use-series-organizer";

type SeriesCharacterLibraryProps = {
  /** 逻辑层 controller（来自 `useSeriesOrganizer`）。 */
  c: SeriesOrganizerController;
  /** 当前项目 id（来自 workspace 的活跃项目），提供时展示提升/注入按钮。 */
  projectId?: string;
};

export const SeriesCharacterLibrary = ({ c, projectId }: SeriesCharacterLibraryProps) => {
  const [newName, setNewName] = useState("");

  const linkedIds = useMemo(
    () => new Set((c.episodeCharacters ?? []).map((l) => l.character.id)),
    [c.episodeCharacters],
  );
  const unlinked = (c.characters ?? []).filter((ch) => !linkedIds.has(ch.id));

  if (c.seriesId === null) {
    return <div className="text-ink-faint text-xs">选择一个系列后，可管理该系列的角色库。</div>;
  }
  const seriesId = c.seriesId;

  return (
    <div className="flex flex-col gap-2">
      <div className="text-ink-muted text-sm font-medium">系列角色库</div>

      {/* 角色列表（可改名 / 删除 / 看被哪些集引用） */}
      <div className="flex flex-col gap-1.5">
        {(c.characters ?? []).map((ch) => {
          const inspected = c.inspectedCharacterId === ch.id;
          const refs = inspected ? (c.characterEpisodes ?? []) : [];
          return (
            <div className="flex flex-col gap-1" key={ch.id}>
              <div className="group border-border flex items-center gap-2 rounded-lg border px-2 py-2">
                <input
                  className="flex-1 bg-transparent text-base outline-none"
                  defaultValue={ch.name}
                  onBlur={(e) => {
                    if (e.target.value && e.target.value !== ch.name) {
                      c.updateCharacter(ch.id, { name: e.target.value });
                    }
                  }}
                  onFocus={() => {
                    c.inspectCharacterEpisodes(ch.id);
                  }}
                />
                <Button
                  className="h-7 px-2 text-xs"
                  onClick={() => {
                    if (inspected) c.clearInspectedCharacter();
                    else c.inspectCharacterEpisodes(ch.id);
                  }}
                  variant="ghost"
                >
                  {inspected ? "收起引用" : "引用"}
                </Button>
                <Button
                  className="text-destructive h-7 px-2 text-xs"
                  onClick={() => {
                    c.deleteCharacter(ch.id);
                  }}
                  variant="ghost"
                >
                  删除
                </Button>
              </div>
              {inspected && (
                <div className="text-ink-faint pl-2 text-xs">
                  {refs.length === 0
                    ? "该角色尚未被任何集引用。"
                    : `该角色被 ${refs.length} 集引用（改动会影响这些集）：${refs
                        .map((r) => `S${r.seasonNumber}E${r.episodeNumber} ${r.title || "未命名"}`)
                        .join("、")}`}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <FieldLabel className="flex flex-1 items-center gap-2">
          <span className="text-ink-faint text-xs">新角色</span>
          <input
            className="border-border bg-surface-1 flex-1 rounded-lg border px-2 py-2 text-base outline-none"
            onChange={textHandler(setNewName)}
            placeholder="名称"
            value={newName}
          />
        </FieldLabel>
        <Button
          className="h-8"
          disabled={!newName.trim() || c.characters === undefined}
          onClick={() => {
            c.createCharacter(seriesId, newName.trim());
            setNewName("");
          }}
          variant="primary-solid"
        >
          新建角色
        </Button>
      </div>

      {/* 本集关联（选中集后） */}
      {c.episodeId !== null &&
        (() => {
          const episodeId = c.episodeId;
          return (
            <div className="border-border flex flex-col gap-2 border-l-2 pl-3">
              <div className="text-ink-muted text-sm font-medium">本集关联角色</div>
              <div className="flex flex-col gap-1.5">
                {(c.episodeCharacters ?? []).map((l) => (
                  <div
                    className="border-border flex items-center gap-2 rounded-lg border px-2 py-2 text-sm"
                    key={l.character.id}
                  >
                    <span className="flex-1">{l.character.name}</span>
                    {l.role && <span className="text-ink-faint text-xs">（{l.role}）</span>}
                    <Button
                      className="h-7 px-2 text-xs"
                      onClick={() => {
                        c.unlinkCharacter(episodeId, l.character.id);
                      }}
                      variant="ghost"
                    >
                      取消关联
                    </Button>
                  </div>
                ))}
                {(c.episodeCharacters ?? []).length === 0 && (
                  <span className="text-ink-faint text-xs">本集尚未关联任何角色。</span>
                )}
              </div>

              {unlinked.length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <div className="text-ink-faint text-xs">关联到本集：</div>
                  <div className="flex flex-wrap gap-1.5">
                    {unlinked.map((ch) => (
                      <Button
                        className={cn("h-7 px-2 text-xs")}
                        key={ch.id}
                        onClick={() => {
                          c.linkCharacter(episodeId, ch.id);
                        }}
                        variant="ghost"
                      >
                        + {ch.name}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })()}

      {/* 双向同步（提供项目时） */}
      {projectId !== undefined && c.episodeId !== null && (
        <div className="border-border flex items-center gap-2 border-t pt-2">
          <Button
            className="h-8"
            onClick={() => {
              c.promoteFromProduction(projectId);
            }}
            variant="primary-solid"
          >
            从项目提升角色
          </Button>
          <Button
            className="h-8"
            onClick={() => {
              c.injectToProduction(projectId);
            }}
            variant="primary-solid"
          >
            注入角色到项目
          </Button>
        </div>
      )}
    </div>
  );
};
