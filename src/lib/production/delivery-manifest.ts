/**
 * 集级交付清单（ISSUE #5217 / FR-SR-05）：`episode.delivery` 是外来 JSON，这里把它
 * 逐字段收窄成可读清单；纯函数，不碰 IO、DB、时钟。字幕与成片同源：清单只记文件 stem，
 * 读出侧按 `generated/films/<stem>.srt` / `.mp4` 解析，不另存一份字幕。
 */
import { asRecord } from "~/lib/is-record";

export type EpisodeDelivery = {
  coverUrl: string | null;
  finalVideoPath: string | null;
  shotVersions: Record<string, number>;
  subtitlePath: string | null;
  synopsis: string;
};

function text(value: unknown): string | null {
  return typeof value === "string" && value !== "" ? value : null;
}

/** 外来 JSON → 受控交付字段；形状不对的字段落空值，不猜、不抛。 */
export function normalizeDelivery(raw: unknown): EpisodeDelivery {
  const rec = asRecord(raw) ?? {};
  const shotVersions: Record<string, number> = {};
  const versions = asRecord(rec.shotVersions);
  if (versions !== null) {
    for (const [id, value] of Object.entries(versions)) {
      if (typeof value === "number" && Number.isFinite(value) && value >= 1) {
        shotVersions[id] = value;
      }
    }
  }
  return {
    coverUrl: text(rec.coverUrl),
    finalVideoPath: text(rec.finalVideoPath),
    shotVersions,
    subtitlePath: text(rec.subtitlePath),
    synopsis: text(rec.synopsis) ?? "",
  };
}

/** SRT 文件 stem（只认单段安全名）；空 = 这一集没有同源字幕。 */
export function srtStemOf(delivery: unknown): string | null {
  const stem = normalizeDelivery(delivery).subtitlePath;
  return stem !== null && /^[A-Za-z0-9_-]+$/.test(stem) ? stem : null;
}

/** 集行 → 只读交付清单（封面缺省回落集行的 coverUrl，简介同理）。 */
export function buildDeliveryManifest(episode: {
  coverUrl?: unknown;
  delivery?: unknown;
  episodeNumber?: unknown;
  id: string;
  synopsis?: unknown;
  title?: unknown;
}): Record<string, unknown> {
  const delivery = normalizeDelivery(episode.delivery);
  return {
    coverUrl: delivery.coverUrl ?? text(episode.coverUrl) ?? "",
    episodeNumber:
      typeof episode.episodeNumber === "number" && Number.isFinite(episode.episodeNumber)
        ? episode.episodeNumber
        : 0,
    finalVideoPath: delivery.finalVideoPath ?? "",
    id: episode.id,
    shotVersions: delivery.shotVersions,
    subtitlePath: delivery.subtitlePath ?? "",
    synopsis: delivery.synopsis === "" ? (text(episode.synopsis) ?? "") : delivery.synopsis,
    title: text(episode.title) ?? "",
  };
}
