import { describe, expect, it } from "vitest";

import {
  DEFAULT_IMAGE_MIME,
  contentTypeForPath,
  extForMime,
  extOfPath,
  mimeForExt,
  stemOfPath,
} from "./mime-ext";

describe("mimeForExt", () => {
  it("带点 / 不带点 / 大小写都能取到", () => {
    expect(mimeForExt(".png")).toBe("image/png");
    expect(mimeForExt("png")).toBe("image/png");
    expect(mimeForExt("PNG")).toBe("image/png");
  });

  it("六份旧表的并集都在（收口前各缺一半）", () => {
    /* 这三条是「同一份文件在两条路径上得到不同 MIME」的直接证据。 */
    expect(mimeForExt("avif")).toBe("image/avif");
    expect(mimeForExt("webp")).toBe("image/webp");
    expect(mimeForExt("bmp")).toBe("image/bmp");
  });

  it("非媒体与未知返回 null（由调用处决定兜底）", () => {
    expect(mimeForExt("txt")).toBeNull();
    expect(mimeForExt("json")).toBeNull();
    expect(mimeForExt("")).toBeNull();
    expect(mimeForExt(null)).toBeNull();
    expect(mimeForExt(undefined)).toBeNull();
  });
});

describe("extForMime", () => {
  it("带参数 / 大小写的 content-type 先切干净", () => {
    expect(extForMime("image/png")).toBe("png");
    expect(extForMime("image/png; charset=utf-8")).toBe("png");
    expect(extForMime("IMAGE/JPEG")).toBe("jpg");
  });

  it("jpeg 归到 jpg 一个后缀（表是手写的，不是反转出来的）", () => {
    expect(extForMime("image/jpeg")).toBe("jpg");
    expect(extForMime("image/svg+xml")).toBe("svg");
  });

  it("未知 MIME 返回 null（调用处显式给兜底，差异才看得见）", () => {
    expect(extForMime("application/octet-stream")).toBeNull();
    expect(extForMime("")).toBeNull();
    expect(extForMime(null)).toBeNull();
  });
});

describe("extOfPath", () => {
  it("取最后一段的最后一个点之后的内容（小写）", () => {
    expect(extOfPath("a/b/c.PNG")).toBe("png");
    expect(extOfPath("clip.mp4?download=1")).toBe("mp4");
    expect(extOfPath("x.tar.gz")).toBe("gz");
  });

  it("没有点 / 点是段首（隐藏文件）都返回空", () => {
    expect(extOfPath("README")).toBe("");
    expect(extOfPath(".gitignore")).toBe("");
    expect(extOfPath("a/b/.env")).toBe("");
    expect(extOfPath("")).toBe("");
    expect(extOfPath(null)).toBe("");
  });

  it("hash / Windows 反斜杠路径同样切干净", () => {
    expect(extOfPath("a/b.pNg#frag")).toBe("png");
    expect(extOfPath("C:\\\\dir\\\\clip.MP4")).toBe("mp4");
  });
});

describe("stemOfPath", () => {
  it("剥掉后缀（交给 extOfPath 单独给出）", () => {
    expect(stemOfPath("bgm.mp3")).toBe("bgm");
    expect(stemOfPath("a/b/c.tar.gz")).toBe("c.tar");
  });

  it("没有后缀时原样返回 —— 收口前 bgm 路由正是踩了这个", () => {
    /* 收口前的写法 `slice(0, len - ext.length - 1)` 在「没有后缀」时会多切
     * 一个字符，只是它把后缀又拼了一次，表现成 `name.mp3.mp3`。 */
    expect(stemOfPath("README")).toBe("README");
    expect(stemOfPath(".gitignore")).toBe(".gitignore");
  });

  it("空值 / 目录形态都给空串", () => {
    expect(stemOfPath("")).toBe("");
    expect(stemOfPath(null)).toBe("");
    expect(stemOfPath("a/b/")).toBe("");
  });
});

describe("contentTypeForPath", () => {
  it("媒体档走 mimeForExt 的结果", () => {
    expect(contentTypeForPath("/x/a.png")).toBe("image/png");
    expect(contentTypeForPath("/x/a.mp4")).toBe("video/mp4");
  });

  it("非媒体档（api/generated 的域需求）在这里也只有一处定义", () => {
    expect(contentTypeForPath("/x/a.txt")).toBe("text/plain; charset=utf-8");
    expect(contentTypeForPath("/x/a.json")).toBe(
      "application/json; charset=utf-8",
    );
  });

  it("日志类文本也走 text/plain（md / log 与 txt 同档）", () => {
    expect(contentTypeForPath("/x/a.md")).toBe("text/plain; charset=utf-8");
    expect(contentTypeForPath("/x/a.log")).toBe("text/plain; charset=utf-8");
  });

  it("未知类型是「我不知道」（octet-stream），不是「当图片看」", () => {
    expect(contentTypeForPath("/x/a.bin")).toBe("application/octet-stream");
    expect(DEFAULT_IMAGE_MIME).toBe("image/png");
  });
});
