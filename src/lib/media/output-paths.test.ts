/**
 * `output-paths.ts` 单测：任务产物布局与越界判据。
 *
 * 这一层是「一个形状、三条出口」（落盘目录 / 产物 URL / 删除目标）的唯一定义，
 * 所以用例的分工不是把行覆盖凑满，而是把两类真事故各自钉住：
 *  1. **分叉** —— project 任务与非 project 任务的布局必须和 `executor-finalize`
 *     落盘时一致（历史上 `task.delete` 只认 `<taskId>`，项目任务的产物目录
 *     于是永远删不掉）；
 *  2. **越界** —— 形状为 `../` 的 id 必须返回 null，而不是一个能交给
 *     `fs.rm(..., { recursive: true })` 的路径（历史上落盘侧完全没有包含校验，
 *     客户端生成的 projectId 可以直接把产物写到产物根之外）。
 *
 * 平台中立：期望值一律用 `path.join` / `path.resolve` 现算，不写死 `/` 或 `\`
 * ——用例在 win32 上跑，但判据本身不能只在 win32 成立。
 */
import path from "path";
import { describe, expect, it } from "vitest";

import {
  generatedRoot,
  isWithinGeneratedRoot,
  taskOutputDir,
  taskOutputSegments,
  taskOutputUrl,
} from "./output-paths";

/** 与真实 cwd 无关的假根：判据是纯字符串形状，给它什么根都该同判。 */
const ROOT = path.resolve(path.sep + "output-root");

describe("generatedRoot", () => {
  it("显式 cwd → <cwd>/public/generated（解析后的绝对路径）", () => {
    expect(generatedRoot("/srv/app")).toBe(
      path.resolve("/srv/app", "public", "generated"),
    );
  });

  it("缺省用 process.cwd()，与 /api/generated/[...path] 的根同一算法", () => {
    expect(generatedRoot()).toBe(
      path.resolve(process.cwd(), "public", "generated"),
    );
  });
});

describe("isWithinGeneratedRoot", () => {
  it("等于根 / 直接子级 / 深层子级 → true", () => {
    expect(isWithinGeneratedRoot(ROOT, ROOT)).toBe(true);
    expect(isWithinGeneratedRoot(path.join(ROOT, "t1"), ROOT)).toBe(true);
    expect(
      isWithinGeneratedRoot(path.join(ROOT, "projects", "p1", "t1"), ROOT),
    ).toBe(true);
  });

  it("同级前缀目录（generatedX）→ false：判据必须用分隔符收边界", () => {
    expect(isWithinGeneratedRoot(ROOT + "X", ROOT)).toBe(false);
  });

  it("根之外（父级与兄弟目录）→ false", () => {
    expect(
      isWithinGeneratedRoot(path.resolve(ROOT, "..", "elsewhere"), ROOT),
    ).toBe(false);
  });

  it("缺省 root 用 process.cwd() 下的产物根", () => {
    const root = generatedRoot();
    expect(isWithinGeneratedRoot(path.join(root, "t1"))).toBe(true);
    expect(isWithinGeneratedRoot(path.resolve(root, "..", "public"))).toBe(
      false,
    );
  });
});

describe("taskOutputSegments", () => {
  it("有 projectId → projects/<pid>/<tid>（落盘与 localPath 共用这一形状）", () => {
    expect(taskOutputSegments("t1", "p1")).toEqual(["projects", "p1", "t1"]);
  });

  it("无 / 空 projectId → 只 <tid>", () => {
    expect(taskOutputSegments("t1")).toEqual(["t1"]);
    expect(taskOutputSegments("t1", null)).toEqual(["t1"]);
    expect(taskOutputSegments("t1", "")).toEqual(["t1"]);
  });
});

describe("taskOutputUrl", () => {
  it("项目任务 → /api/generated/projects/<pid>/<tid>", () => {
    expect(taskOutputUrl("t1", "p1")).toBe("/api/generated/projects/p1/t1");
  });

  it("普通任务 → /api/generated/<tid>", () => {
    expect(taskOutputUrl("t1", null)).toBe("/api/generated/t1");
  });
});

describe("taskOutputDir", () => {
  it("磁盘与 URL 同源：两条出口都由同一份 segments 派生", () => {
    expect(taskOutputDir("t1", "p1", ROOT)).toBe(
      path.resolve(ROOT, "projects", "p1", "t1"),
    );
    // 改布局时这条会跟着红 —— 历史上「一处认 projects、一处不认」就是这么漏的
    expect(taskOutputUrl("t1", "p1").split("/").slice(3)).toEqual(
      taskOutputSegments("t1", "p1"),
    );
  });

  it("缺省 root → 落在 process.cwd() 的产物根下", () => {
    expect(taskOutputDir("t1")).toBe(path.resolve(generatedRoot(), "t1"));
  });

  it("taskId 穿越 → null（不许把根外的目录交给 fs.rm）", () => {
    expect(taskOutputDir(path.join("..", "..", "evil"), null, ROOT)).toBeNull();
  });

  it("projectId 穿越 → null（projectId 由客户端生成，落盘侧同样在闸内）", () => {
    expect(taskOutputDir("t1", path.join("..", "..", "evil"), ROOT)).toBeNull();
  });

  it("解析结果「就是根本身」→ null：空串与 . 都不算一个任务目录", () => {
    expect(taskOutputDir("", null, ROOT)).toBeNull();
    expect(taskOutputDir(".", null, ROOT)).toBeNull();
    // 带上 projects 前缀之后，`.` 落在 projects 之下，是合法子路径而不是根
    expect(taskOutputDir(".", "p1", ROOT)).toBe(
      path.resolve(ROOT, "projects", "p1", "."),
    );
  });

  it("绝对形态的 taskId（path.resolve 会直接丢掉 root）→ null", () => {
    expect(
      taskOutputDir(path.resolve(path.sep + "elsewhere"), null, ROOT),
    ).toBe(null);
  });
});
