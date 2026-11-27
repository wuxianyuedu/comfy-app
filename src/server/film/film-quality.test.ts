/**
 * 成片质量闸（ISSUE #5214）：ffprobe 形状归一与硬错判定的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import { checkFilmQuality, ffprobeArgs, parseProbe } from "./film-quality";

const good = {
  width: 1280,
  height: 720,
  duration: 12.5,
  hasVideo: true,
  hasAudio: true,
};

describe("parseProbe", () => {
  it("逐字段校验外部 JSON，字符串时长也收", () => {
    expect(
      parseProbe({
        streams: [
          { codec_type: "video", width: 1280, height: 720, duration: "12.5" },
          { codec_type: "audio" },
        ],
      }),
    ).toEqual(good);
  });
  it("形状不对落 null/false，不猜", () => {
    expect(parseProbe(null)).toEqual({
      width: null,
      height: null,
      duration: null,
      hasVideo: false,
      hasAudio: false,
    });
  });
});

describe("checkFilmQuality", () => {
  it("正常片 0 问题", () => {
    expect(checkFilmQuality(good, { width: 1280, height: 720 })).toEqual([]);
  });
  it("缺片 / 无视频流 / 时长 0 / 分辨率不符都点名", () => {
    const issues = checkFilmQuality(
      { ...good, width: 640, duration: 0, hasVideo: false },
      { width: 1280, height: 720 },
      [2],
    );
    expect(issues.join(" ")).toContain("缺片");
    expect(issues.join(" ")).toContain("没有视频流");
    expect(issues.join(" ")).toContain("时长为 0");
    expect(issues.join(" ")).toContain("640 ≠ 目标 1280");
  });
});

describe("ffprobeArgs", () => {
  it("静默 JSON 输出 + 流与格式", () => {
    expect(ffprobeArgs("a.mp4")).toEqual([
      "-v",
      "quiet",
      "-print_format",
      "json",
      "-show_format",
      "-show_streams",
      "a.mp4",
    ]);
  });
});
