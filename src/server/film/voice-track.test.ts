/**
 * 逐镜配音（ISSUE #5213）：声音归属、TTS 载荷、重试口径与 ffmpeg 混音参数的纯函数契约。
 */
import { describe, expect, it } from "vitest";

import {
  audioPathOfParams,
  buildDialogueMixArgs,
  resolveVoice,
  shouldRetryTts,
  ttsParamsOf,
  type VoiceBinding,
} from "./voice-track";

describe("resolveVoice", () => {
  const characters = [
    { id: "c1", voice: { dialect: "四川话", speed: 1.2, timbre: "女声-A" } },
    { id: "c2", voice: { timbre: "男声-B" } },
  ];

  it("镜头覆写优先于角色绑定", () => {
    expect(resolveVoice(characters, ["c1"], { timbre: "旁白" })).toEqual({ timbre: "旁白" });
  });

  it("按出场顺序取第一个有绑定的角色", () => {
    expect(resolveVoice(characters, ["c2", "c1"], undefined)).toEqual({ timbre: "男声-B" });
  });

  it("没有绑定落空对象，交给工作流默认音色", () => {
    expect(resolveVoice(characters, [], undefined)).toEqual({});
  });

  it("脏值不猜：非对象 / 非数字语速被丢掉", () => {
    expect(resolveVoice([], [], { dialect: 42, speed: -1, timbre: "" })).toEqual({});
  });
});

describe("ttsParamsOf", () => {
  it("只下发有值的字段，文本去空白", () => {
    const voice: VoiceBinding = { dialect: "普通话", speed: 0.9, timbre: "T1" };
    expect(ttsParamsOf({ dialogue: "  你好  ", voice, workflowId: "wf-tts" })).toEqual({
      dialect: "普通话",
      speed: 0.9,
      text: "你好",
      timbre: "T1",
      workflowId: "wf-tts",
    });
  });

  it("空绑定不塞 null / undefined 进载荷", () => {
    expect(ttsParamsOf({ dialogue: "嗯", voice: {} })).toEqual({ text: "嗯" });
  });
});

describe("shouldRetryTts", () => {
  it("瞬时故障在尝试上限内重试", () => {
    expect(shouldRetryTts(0, "Gateway Timeout")).toBe(true);
    expect(shouldRetryTts(1, "ECONNRESET")).toBe(true);
  });

  it("业务失败与超限都不重试", () => {
    expect(shouldRetryTts(0, "工作流不存在")).toBe(false);
    expect(shouldRetryTts(2, "timeout")).toBe(false);
  });
});

describe("buildDialogueMixArgs", () => {
  it("逐镜对白按起点 adelay 对齐，与 BGM 一起 amix", () => {
    const args = buildDialogueMixArgs({
      bgm: "/tmp/bgm.mp3",
      dialogueTracks: [
        { file: "/tmp/a.mp3", start: 0 },
        { file: "/tmp/b.mp3", start: 2.5 },
      ],
      output: "/tmp/out.mp4",
      video: "/tmp/concat.mp4",
    });
    expect(args).toEqual([
      "-y",
      "-i",
      "/tmp/concat.mp4",
      "-i",
      "/tmp/a.mp3",
      "-i",
      "/tmp/b.mp3",
      "-i",
      "/tmp/bgm.mp3",
      "-filter_complex",
      "[1:a]adelay=0|0[d0];[2:a]adelay=2500|2500[d1];[d0][d1][3:a]amix=inputs=3:dropout_transition=0[a]",
      "-map",
      "0:v",
      "-map",
      "[a]",
      "-c:v",
      "copy",
      "-c:a",
      "aac",
      "-shortest",
      "/tmp/out.mp4",
    ]);
  });

  it("静音镜缺席：只有 BGM 时 inputs=1", () => {
    const args = buildDialogueMixArgs({
      bgm: "/tmp/bgm.mp3",
      dialogueTracks: [],
      output: "/tmp/out.mp4",
      video: "/tmp/concat.mp4",
    });
    expect(args).toContain("[1:a]amix=inputs=1:dropout_transition=0[a]");
  });

  it("没有任何音轨时只复制画面", () => {
    const args = buildDialogueMixArgs({
      dialogueTracks: [],
      output: "/tmp/out.mp4",
      video: "/tmp/concat.mp4",
    });
    expect(args).toEqual([
      "-y",
      "-i",
      "/tmp/concat.mp4",
      "-map",
      "0:v",
      "-c",
      "copy",
      "/tmp/out.mp4",
    ]);
  });
});

describe("audioPathOfParams", () => {
  it("只认非空字符串，脏形状当没配音", () => {
    expect(audioPathOfParams({ audioPath: "/api/generated/a.mp3" })).toBe("/api/generated/a.mp3");
    expect(audioPathOfParams({ audioPath: 42 })).toBeNull();
    expect(audioPathOfParams(null)).toBeNull();
  });
});
