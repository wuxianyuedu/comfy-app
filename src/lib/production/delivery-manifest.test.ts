/**
 * 集级交付清单（ISSUE #5217）：外来 JSON 的收窄、SRT stem 安全与清单形状的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { buildDeliveryManifest, normalizeDelivery, srtStemOf } from "./delivery-manifest";

describe("normalizeDelivery", () => {
  it("逐字段收窄，版本表只认有限数值", () => {
    expect(
      normalizeDelivery({
        coverUrl: "/api/generated/cover.png",
        finalVideoPath: "/api/generated/films/f1.mp4",
        shotVersions: { s1: 3, s2: "4", s3: -1 },
        subtitlePath: "f1",
        synopsis: "雨夜",
      }),
    ).toEqual({
      coverUrl: "/api/generated/cover.png",
      finalVideoPath: "/api/generated/films/f1.mp4",
      shotVersions: { s1: 3 },
      subtitlePath: "f1",
      synopsis: "雨夜",
    });
  });

  it("脏形状落空值，不抛", () => {
    expect(normalizeDelivery(null)).toEqual({
      coverUrl: null,
      finalVideoPath: null,
      shotVersions: {},
      subtitlePath: null,
      synopsis: "",
    });
  });
});

describe("srtStemOf", () => {
  it("只认单段安全名，路径穿越被拒", () => {
    expect(srtStemOf({ subtitlePath: "film_1" })).toBe("film_1");
    expect(srtStemOf({ subtitlePath: "../../etc/passwd" })).toBeNull();
    expect(srtStemOf({})).toBeNull();
  });
});

describe("buildDeliveryManifest", () => {
  it("清单带集号/路径/镜头版本，封面与简介有确定回落", () => {
    expect(
      buildDeliveryManifest({
        coverUrl: "/api/generated/fallback.png",
        delivery: { finalVideoPath: "f.mp4", shotVersions: { s1: 2 }, subtitlePath: "f" },
        episodeNumber: 3,
        id: "ep_1",
        synopsis: "集简介",
        title: "第三集",
      }),
    ).toEqual({
      coverUrl: "/api/generated/fallback.png",
      episodeNumber: 3,
      finalVideoPath: "f.mp4",
      id: "ep_1",
      shotVersions: { s1: 2 },
      subtitlePath: "f",
      synopsis: "集简介",
      title: "第三集",
    });
  });
});
