import { describe, expect, it } from "vitest";

import {
  isFilmRunning,
  formatShotDuration,
  productionShotsToShotList,
} from "./film-studio-config";

describe("isFilmRunning", () => {
  it("解析 / 生成 / 合成三个阶段都算进行中", () => {
    expect(isFilmRunning("PARSING")).toBe(true);
    expect(isFilmRunning("GENERATING")).toBe(true);
    expect(isFilmRunning("COMPOSING")).toBe(true);
  });

  it("完成 / 失败 / 取消不算进行中（决定进度条与「取消」按钮显隐）", () => {
    expect(isFilmRunning("DONE")).toBe(false);
    expect(isFilmRunning("FAILED")).toBe(false);
    expect(isFilmRunning("CANCELLED")).toBe(false);
  });
});

/* 这些断言锁的是**原视图的既有行为**（本轮只搬不改）：一位小数 + 补零到 5 位。
 * 样例数据的 "00:03.2" 与这里的 "003.0" 形态并不一致，属既有视觉问题，另开 PR 处理。 */
describe("formatShotDuration", () => {
  it("一位小数并补零到 5 位", () => {
    expect(formatShotDuration(3)).toBe("003.0");
    expect(formatShotDuration(25)).toBe("025.0");
  });

  it("四舍五入到一位小数", () => {
    expect(formatShotDuration(12.35)).toBe("012.3"); // toFixed 的实际舍入（不是四舍五入到偶数也非进一）
    expect(formatShotDuration(0)).toBe("000.0");
  });

  it("已够 5 位的数值不补零", () => {
    expect(formatShotDuration(123.4)).toBe("123.4");
  });
});

describe("productionShotsToShotList", () => {
  it("映射真实项目镜头：缩略图 / 名称 / 状态大写 / 时长", () => {
    const list = productionShotsToShotList([
      {
        id: "a",
        sceneHeading: "海边",
        imageUrl: "/x.png",
        status: "done",
        duration: 4,
      },
      {
        id: "b",
        prompt: "一只戴头盔的柴犬在奔跑需要很长提示词截断",
        status: "running",
      },
    ]);
    expect(list).toHaveLength(2);
    expect(list[0]).toMatchObject({
      id: "a",
      name: "海边",
      mode: "img2video",
      status: "SUCCEEDED",
      thumbnailUrl: "/x.png",
    });
    expect(list[0]!.duration).toBe("4.0s");
    // 无 sceneHeading → 用 prompt 截断；无 imageUrl → txt2img、无缩略图
    expect(list[1]).toMatchObject({
      name: "一只戴头盔的柴犬在奔跑需要很长提示词截断".slice(0, 24),
      mode: "txt2img",
      status: "RUNNING",
    });
    expect(list[1]!.thumbnailUrl).toBeUndefined();
    expect(list[1]!.duration).toBe("—");
  });

  it("非记录项 / 无 id 项跳过；done/failed/idle/未知状态各自映射", () => {
    const list = productionShotsToShotList([
      "x",
      { noId: 1 },
      { id: "c", status: "failed" },
      { id: "d", status: "weird" },
    ]);
    expect(list.map((s) => s.id)).toEqual(["c", "d"]);
    expect(list[0]!.status).toBe("FAILED");
    expect(list[1]!.status).toBe("IDLE");
  });
});
