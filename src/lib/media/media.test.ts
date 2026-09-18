import { describe, it, expect } from "vitest";
import { isVideo } from "./media";

describe("isVideo 视频源判定", () => {
  it("五种受支持的视频扩展名判定为视频", () => {
    expect(isVideo("clip.mp4")).toBe(true);
    expect(isVideo("clip.webm")).toBe(true);
    expect(isVideo("clip.ogg")).toBe(true);
    expect(isVideo("clip.m4v")).toBe(true);
    expect(isVideo("clip.mov")).toBe(true);
  });

  it("扩展名大小写不敏感", () => {
    expect(isVideo("clip.MP4")).toBe(true);
    expect(isVideo("clip.WebM")).toBe(true);
    expect(isVideo("clip.MOV")).toBe(true);
  });

  it("URL 路径中的视频扩展名判定为视频", () => {
    expect(isVideo("https://cdn.example.com/v/clip.mp4")).toBe(true);
    expect(isVideo("/abs/path/clip.webm")).toBe(true);
  });

  it("gif 是动画图片而非视频", () => {
    expect(isVideo("anim.gif")).toBe(false);
    expect(isVideo("anim.GIF")).toBe(false);
  });

  it("常见图片扩展名不是视频", () => {
    expect(isVideo("img.jpg")).toBe(false);
    expect(isVideo("img.jpeg")).toBe(false);
    expect(isVideo("img.png")).toBe(false);
    expect(isVideo("img.webp")).toBe(false);
    expect(isVideo("img.avif")).toBe(false);
    expect(isVideo("img.svg")).toBe(false);
  });

  it("空串、undefined 与 null 返回 false", () => {
    expect(isVideo("")).toBe(false);
    expect(isVideo(undefined)).toBe(false);
    expect(isVideo(null)).toBe(false);
  });

  it("裸扩展名(无点分隔)不是视频", () => {
    expect(isVideo("mp4")).toBe(false);
    expect(isVideo("filemp4")).toBe(false);
  });

  it("扩展名后还有查询串、hash 或其他后缀时不是视频", () => {
    expect(isVideo("clip.mp4?download=1")).toBe(false);
    expect(isVideo("clip.mp4#t=5")).toBe(false);
    expect(isVideo("clip.mp4.exe")).toBe(false);
    expect(isVideo("stream.m3u8")).toBe(false);
  });

  it("非字符串类型的空值兜底不影响正常路径", () => {
    // 正常路径回归:真实 URL 与本地路径
    expect(isVideo("file:///D:/media/demo.mov")).toBe(true);
    expect(isVideo("C:\\media\\demo.mp4")).toBe(true);
  });
});
