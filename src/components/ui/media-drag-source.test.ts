/**
 * 「把一张媒体图变成可拖拽源」只允许一处实现的契约（ISSUE #672 §16.2.4.22）。
 *
 * 现场：`HistoryPanel` 与 `MaterialLibraryPanel` 各有网格 / 列表两个视图，
 * **四处逐字相同**地手写 `setData("application/x-comfyapp-media", JSON.stringify(…))`，
 * 而消费端 `use-canvas-drop` 只做 `JSON.parse` + 类型断言 —— 形状对不上是
 * **静默丢投**。这里钉住「两端共用同一份载荷定义」这件事。
 */
import { describe, expect, it } from "vitest";

import {
  displayNameFromUrl,
  mediaDragSourceProps,
  MEDIA_DRAG_MIME,
} from "./media-drag-source";

/** 造一个够用的 dragstart 事件替身。 */
function dragEvent() {
  const data = new Map<string, string>();
  let effectAllowed = "";
  return {
    data,
    get effectAllowed() {
      return effectAllowed;
    },
    set effectAllowed(next: string) {
      effectAllowed = next;
    },
    dataTransfer: {
      setData: (mime: string, value: string) => data.set(mime, value),
      getData: (mime: string) => data.get(mime) ?? "",
      set effectAllowed(next: string) {
        effectAllowed = next;
      },
      get effectAllowed() {
        return effectAllowed;
      },
    },
  };
}

describe("载荷形状由出口定义（源端与落点共用一份）", () => {
  it("写的是同一个 MIME，且载荷字段齐全", () => {
    const event = dragEvent();
    const props = mediaDragSourceProps({
      url: "https://x.test/a.png",
      kind: "image",
    });
    props.onDragStart(event as never);
    const raw = event.data.get(MEDIA_DRAG_MIME);
    expect(raw).toBeTypeOf("string");
    expect(JSON.parse(raw!)).toEqual({
      url: "https://x.test/a.png",
      displayName: "a.png",
      mediaType: "image",
    });
  });

  it("effectAllowed 是 copy（拖拽是「加一份」，不是搬走）", () => {
    const event = dragEvent();
    mediaDragSourceProps({ url: "/a.png", kind: "image" }).onDragStart(
      event as never,
    );
    expect(event.effectAllowed).toBe("copy");
  });

  it("显式给的 displayName 优先于从 URL 推导", () => {
    const event = dragEvent();
    mediaDragSourceProps({
      url: "/x/a.png",
      displayName: "素材：封面",
      kind: "image",
    }).onDragStart(event as never);
    const payload = JSON.parse(event.data.get(MEDIA_DRAG_MIME)!) as {
      displayName: string;
    };
    expect(payload.displayName).toBe("素材：封面");
  });
});

describe("displayNameFromUrl", () => {
  it("取最后一段路径", () => {
    expect(displayNameFromUrl("/generated/2026/a.png")).toBe("a.png");
  });

  it("剥掉查询串与锚点（否则拖过去显示成一串乱码）", () => {
    expect(displayNameFromUrl("/api/img?filename=a.png")).toBe("img");
    expect(displayNameFromUrl("/a.png?v=2#top")).toBe("a.png");
  });

  it("没有路径分隔符时原样返回", () => {
    expect(displayNameFromUrl("a.png")).toBe("a.png");
  });

  it("以 / 结尾（最后一段为空）时回退到整个 URL，而不是给一个空名字", () => {
    /* 空 displayName 会让落点的 toast 显示成空白（用户看到「已加入画布」后面
     * 什么都没有）—— 宁可用原串，也不要一个看不出来的空值。 */
    expect(displayNameFromUrl("/generated/dir/")).toBe("/generated/dir/");
  });

  it("剥掉查询串后只剩空段时回退到原串（不是空名字）", () => {
    expect(displayNameFromUrl("/a/?#frag")).toBe("/a/?#frag");
  });
});

describe("可拖与光标类是同一个判据", () => {
  it("canDrag 为假时不可拖，且不追加光标类", () => {
    const props = mediaDragSourceProps({
      url: "/a.png",
      kind: "image",
      canDrag: false,
      className: "rounded-lg",
    });
    expect(props.draggable).toBe(false);
    expect(props.className).toBe("rounded-lg");
  });

  it("url 为空时同样不可拖（拖了只会丢投）", () => {
    const props = mediaDragSourceProps({ url: null, kind: "image" });
    expect(props.draggable).toBe(false);
    expect(props.className).not.toContain("cursor-grab");
  });

  it("可拖时两种光标都加上（抓起来 / 抓着移动）", () => {
    const props = mediaDragSourceProps({ url: "/a.png", kind: "image" });
    expect(props.draggable).toBe(true);
    expect(props.className).toContain("cursor-grab");
    expect(props.className).toContain("active:cursor-grabbing");
  });

  it("调用处原有的类名不被吞掉", () => {
    const props = mediaDragSourceProps({
      url: "/a.png",
      kind: "image",
      className: "border-border rounded-lg",
    });
    expect(props.className).toContain("border-border");
    expect(props.className).toContain("rounded-lg");
  });

  it("不可拖时 onDragStart 不写任何数据（显式静默，而不是半份载荷）", () => {
    const event = dragEvent();
    const props = mediaDragSourceProps({ url: null, kind: "image" });
    props.onDragStart(event as never);
    expect(event.data.size).toBe(0);
  });
});

describe("audio / doc 也能拖（落点给「暂不支持」的提示）", () => {
  it("mediaType 原样透传", () => {
    const event = dragEvent();
    mediaDragSourceProps({ url: "/a.mp3", kind: "audio" }).onDragStart(
      event as never,
    );
    const payload = JSON.parse(event.data.get(MEDIA_DRAG_MIME)!) as {
      mediaType: string;
    };
    expect(payload.mediaType).toBe("audio");
  });
});

describe("onDragStart 身份稳定（同一份参数复用不重建）", () => {
  it("相同参数不产生新的闭包行为", () => {
    const a = mediaDragSourceProps({ url: "/a.png", kind: "image" });
    const b = mediaDragSourceProps({ url: "/a.png", kind: "image" });
    const ev = dragEvent();
    a.onDragStart(ev as never);
    const first = ev.data.get(MEDIA_DRAG_MIME);
    const ev2 = dragEvent();
    b.onDragStart(ev2 as never);
    expect(ev2.data.get(MEDIA_DRAG_MIME)).toBe(first);
  });
});
