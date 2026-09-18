import { describe, it, expect } from "vitest";
import { isAudio, isVideo, kindOf } from "./media-kind";

/*
 * 本用例锁的是「判据唯一」这条契约（ISSUE #571）。
 *
 * 历史形态：同一件事有三份清单，且 `gif` 的口径互相矛盾——
 * `lib/media.ts` 注释明确写「gif 不是视频，`<video>` 解不了会黑屏」，
 * `server/api/routers/task.ts` 却把 gif 判成视频。用例逐条钉住**唯一**口径，
 * 任何一处再长出第二份清单（值不同）都会在这里或调用方用例上暴露。
 */

describe("kindOf 媒体种类推导", () => {
  it("常见图片扩展名 → image", () => {
    for (const name of [
      "a.png",
      "a.jpg",
      "a.jpeg",
      "a.webp",
      "a.bmp",
      "a.avif",
      "a.svg",
    ]) {
      expect(kindOf(name), name).toBe("image");
    }
  });

  it("gif 是图片而非视频（<video> 解不了 GIF，会渲染成黑屏）", () => {
    expect(kindOf("anim.gif")).toBe("image");
    expect(kindOf("anim.GIF")).toBe("image");
    expect(isVideo("anim.gif")).toBe(false);
  });

  it("视频扩展名全集 → video（含 mkv/avi/ogg/m4v）", () => {
    for (const name of [
      "a.mp4",
      "a.webm",
      "a.mov",
      "a.mkv",
      "a.avi",
      "a.ogg",
      "a.m4v",
    ]) {
      expect(kindOf(name), name).toBe("video");
    }
  });

  it("音频扩展名 → audio", () => {
    for (const name of ["a.wav", "a.mp3", "a.flac", "a.m4a", "a.aac"]) {
      expect(kindOf(name), name).toBe("audio");
    }
  });

  it("ogg 归 video（历史 media.ts 的行为，判定顺序即优先级）", () => {
    expect(kindOf("a.ogg")).toBe("video");
    expect(isAudio("a.ogg")).toBe(false);
  });

  it("扩展名大小写不敏感", () => {
    expect(kindOf("A.MP4")).toBe("video");
    expect(kindOf("A.PNG")).toBe("image");
  });

  it("URL 与绝对路径同样按扩展名判定", () => {
    expect(kindOf("https://cdn.example.com/v/clip.mp4")).toBe("video");
    expect(kindOf("/abs/path/clip.webm")).toBe("video");
    expect(kindOf("file:///D:/media/demo.mov")).toBe("video");
    expect(kindOf("C:\\media\\demo.mp4")).toBe("video");
  });

  it("无扩展名 / 未知扩展名 → doc", () => {
    expect(kindOf("README")).toBe("doc");
    expect(kindOf("mp4")).toBe("doc");
    expect(kindOf("filemp4")).toBe("doc");
    expect(kindOf("stream.m3u8")).toBe("doc");
    expect(kindOf("a.mp4.exe")).toBe("doc");
  });

  it("空值兜底为 doc，不抛错", () => {
    expect(kindOf("")).toBe("doc");
    expect(kindOf(undefined)).toBe("doc");
    expect(kindOf(null)).toBe("doc");
  });

  it("扩展名后带查询串/hash 时不猜测（保守回落 doc）", () => {
    /* 只做后缀匹配，故带查询串的 URL 落 doc——这是刻意的：宁可让调用方看到
     * 「未知」，也不要猜错后把 GIF/图片塞进 <video> 渲染成黑屏。 */
    expect(kindOf("clip.mp4?download=1")).toBe("doc");
    expect(kindOf("clip.mp4#t=5")).toBe("doc");
  });
});

describe("isVideo / isAudio 与 kindOf 同源", () => {
  it("两者只是 kindOf 的语法糖，不存在第二份判据", () => {
    const samples = [
      "a.png",
      "a.gif",
      "a.mp4",
      "a.mkv",
      "a.ogg",
      "a.mp3",
      "a.txt",
      "",
    ];
    for (const sample of samples) {
      expect(isVideo(sample), sample).toBe(kindOf(sample) === "video");
      expect(isAudio(sample), sample).toBe(kindOf(sample) === "audio");
    }
  });
});
