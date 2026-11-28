/**
 * 成片交付承诺自检与观感判据（ISSUE #5276）：滤镜参数、stderr 解析、承诺比对与
 * 黑帧/静音/幻灯片风险的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  auditArgs,
  checkDeliveryPromise,
  checkFilmAudit,
  parseAudit,
  type DeliveryPromise,
} from "./film-audit";

const promise: DeliveryPromise = {
  expectedDuration: 20,
  expectSubtitle: true,
  hasSubtitle: true,
  height: 720,
  width: 1280,
};

describe("auditArgs", () => {
  it("视频侧黑帧/冻结 + 音频侧静音，一份 ffmpeg 调用跑完", () => {
    expect(auditArgs("f.mp4")).toEqual([
      "-y",
      "-i",
      "f.mp4",
      "-vf",
      "blackdetect=d=0.2:pix_th=0.10,freezedetect=n=-60dB:d=1.5",
      "-af",
      "silencedetect=noise=-50dB:d=0.6",
      "-f",
      "null",
      "-",
    ]);
  });
});

describe("parseAudit", () => {
  it("累计黑帧/静音、取最长冻结段；脏行忽略", () => {
    const result = parseAudit(
      [
        "[blackdetect] black_start:0 black_end:1 black_duration:1",
        "[blackdetect] black_start:5 black_end:5.5 black_duration:0.5",
        "[freezedetect] freeze_start:2 freeze_end:4 freeze_duration:2",
        "[freezedetect] freeze_start:8 freeze_end:8.3 freeze_duration:0.3",
        "[silencedetect] silence_end:3 | silence_duration:3",
        "noise: garbage",
      ].join("\n"),
    );
    expect(result).toEqual({ blackSeconds: 1.5, frozenLongest: 2, silentSeconds: 3 });
  });

  it("没有检测行时全 0", () => {
    expect(parseAudit("")).toEqual({ blackSeconds: 0, frozenLongest: 0, silentSeconds: 0 });
  });
});

describe("checkDeliveryPromise", () => {
  it("时长与字幕都兑现时 0 问题", () => {
    expect(checkDeliveryPromise({ duration: 20 }, promise)).toEqual({ errors: [], warnings: [] });
  });

  it("时长差超阈值与缺字幕都是硬错", () => {
    const result = checkDeliveryPromise({ duration: 5 }, { ...promise, hasSubtitle: false });
    expect(result.errors.join(" ")).toContain("时长 5s 与请求 20s 不符");
    expect(result.errors.join(" ")).toContain("没有字幕内容");
  });

  it("额外字幕只告警不硬拦", () => {
    const result = checkDeliveryPromise({ duration: 20 }, { ...promise, expectSubtitle: false });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toContain("带了字幕内容");
  });
});

describe("checkFilmAudit", () => {
  it("整片全黑 / 全程静音是硬错", () => {
    const result = checkFilmAudit({ blackSeconds: 18, frozenLongest: 0, silentSeconds: 19 }, 20, {
      hasAudio: true,
    });
    expect(result.errors.join(" ")).toContain("几乎全黑");
    expect(result.errors.join(" ")).toContain("几乎全程静音");
  });

  it("转场短黑短静音只告警，不误判成失败", () => {
    const result = checkFilmAudit({ blackSeconds: 0.4, frozenLongest: 0, silentSeconds: 0.6 }, 20, {
      hasAudio: true,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.length).toBe(2);
  });

  it("长冻结段给幻灯片风险提示，但 allow 通过", () => {
    const result = checkFilmAudit({ blackSeconds: 0, frozenLongest: 12, silentSeconds: 0 }, 20, {
      hasAudio: false,
    });
    expect(result.errors).toEqual([]);
    expect(result.warnings.join(" ")).toContain("幻灯片感");
  });
});
