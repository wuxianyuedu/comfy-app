// 项目分区注册表（ISSUE #4765）：视图 → 分区映射、未知字符串收窄、工坊分区判据、
// 「待落地分区」的登记/兜底。纯函数层，无渲染。

import { describe, expect, it } from "vitest";

import {
  isWorkshopSection,
  peekPendingSection,
  requestProjectSection,
  sectionFromView,
  toProjectSection,
} from "./project-sections";

describe("sectionFromView（旧视图 id → 项目页分区）", () => {
  it("项目级视图各落到对应分区", () => {
    expect(sectionFromView("project")).toBe("overview");
    expect(sectionFromView("canvas")).toBe("canvas");
    expect(sectionFromView("workshop")).toBe("script");
    expect(sectionFromView("library")).toBe("library");
    expect(sectionFromView("outputs")).toBe("outputs");
    expect(sectionFromView("film")).toBe("film");
  });

  it("全局视图不该被送进来；兜底落概览（不抛）", () => {
    expect(sectionFromView("home")).toBe("overview");
    expect(sectionFromView("models")).toBe("overview");
  });
});

describe("toProjectSection（事件载荷只到 string，白名单在这里收窄）", () => {
  it("合法分区原样收回，未知值交回 null", () => {
    expect(toProjectSection("canvas")).toBe("canvas");
    expect(toProjectSection("render")).toBe("render");
    expect(toProjectSection("nope")).toBeNull();
    expect(toProjectSection("")).toBeNull();
  });
});

describe("isWorkshopSection（六段共用一个懒加载容器的判据）", () => {
  it("工坊六段为真，其余为假", () => {
    expect(isWorkshopSection("script")).toBe(true);
    expect(isWorkshopSection("character")).toBe(true);
    expect(isWorkshopSection("storyboard")).toBe(true);
    expect(isWorkshopSection("shots")).toBe(true);
    expect(isWorkshopSection("video")).toBe(true);
    expect(isWorkshopSection("render")).toBe(true);
    expect(isWorkshopSection("canvas")).toBe(false);
    expect(isWorkshopSection("overview")).toBe(false);
    expect(isWorkshopSection("film")).toBe(false);
  });
});

describe("待落地分区（导航事件可能早于容器挂载，登记兜底）", () => {
  it("request 之后 peek 读得到；没登记过的项目回落 overview", () => {
    expect(peekPendingSection("proj_never")).toBe("overview");
    requestProjectSection("proj_pending", "canvas");
    expect(peekPendingSection("proj_pending")).toBe("canvas");
    /* 覆写取最后一次请求。 */
    requestProjectSection("proj_pending", "film");
    expect(peekPendingSection("proj_pending")).toBe("film");
  });
});
