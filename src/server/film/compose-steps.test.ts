/**
 * `compose-steps` 纯函数契约测试。
 *
 * 重点锁住「两份孪生 ffmpeg 参数合并为一」：带字幕与无字幕两次调用只差
 * `subtitles=` 滤镜，其余编码参数必须逐字相同——此前它们是手抄的两段数组，
 * 改一段忘改另一段就会让有无字幕走出不同的编码参数。
 */
import { describe, expect, it } from "vitest";
import {
  buildNormalizeArgs,
  buildSegmentVf,
  buildSrtBody,
  clipPathOf,
} from "./compose-steps";

describe("buildSegmentVf", () => {
  it("拼出 scale/pad/fps + 首尾淡入淡出的滤镜串", () => {
    const vf = buildSegmentVf({
      width: 1280,
      height: 720,
      fps: 24,
      fadeOut: 2.7,
    });
    expect(vf).toContain("scale=1280:720:force_original_aspect_ratio=decrease");
    expect(vf).toContain("pad=1280:720:(1280-iw)/2:(720-ih)/2");
    expect(vf).toContain("fps=24");
    expect(vf).toContain("fade=t=in:st=0:d=0.3");
    // fadeOut 按两位小数写（number-format）
    expect(vf).toContain("fade=t=out:st=2.70:d=0.3");
  });
});

describe("buildSrtBody", () => {
  it("产出一条字幕：0 → 镜头整秒，含文本", () => {
    expect(buildSrtBody({ text: "开场", dur: 3.9 })).toBe(
      "1\n00:00:00,000 --> 00:00:03,000\n开场\n",
    );
  });
});

describe("buildNormalizeArgs", () => {
  const base = {
    clip: "/abs/a.mp4",
    vf: "scale=1:1",
    dur: 2,
    out: "/tmp/seg_0.mp4",
  };

  it("带字幕时接 subtitles 滤镜，且转义路径", () => {
    const args = buildNormalizeArgs({ ...base, srtPath: "/tmp/seg_0.srt" });
    const vfIdx = args.indexOf("-vf");
    expect(args[vfIdx + 1]).toContain(",subtitles='/tmp/seg_0.srt'");
  });

  it("无字幕（srtPath=null）时不接 subtitles 滤镜", () => {
    const args = buildNormalizeArgs({ ...base, srtPath: null });
    const vfIdx = args.indexOf("-vf");
    expect(args[vfIdx + 1]).toBe("scale=1:1");
    expect(args.join(" ")).not.toContain("subtitles");
  });

  it("两份调用的编码参数逐字一致，仅差 subtitles（证明孪生已合并）", () => {
    const withSub = buildNormalizeArgs({ ...base, srtPath: "/tmp/seg_0.srt" });
    const without = buildNormalizeArgs({ ...base, srtPath: null });
    // 除 -vf 那一项，其余参数完全相同
    const vfIdx = withSub.indexOf("-vf");
    expect(withSub.filter((_, i) => i !== vfIdx + 1)).toEqual(
      without.filter((_, i) => i !== vfIdx + 1),
    );
  });
});

describe("clipPathOf", () => {
  it("把 /api/... 形式的 videoPath 折成 cwd/public 下的绝对路径", () => {
    // path.join 按平台分隔符拼接，断言前统一成正斜杠（生产行为不变）。
    const joined = clipPathOf("/proj", "/api/generated/films/x.mp4").replace(
      /\\/g,
      "/",
    );
    expect(joined).toBe("/proj/public/api/generated/films/x.mp4");
  });
});
