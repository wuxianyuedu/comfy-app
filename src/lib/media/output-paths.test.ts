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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, afterAll, afterEach } from "vitest";

import {
  ARTIFACT_URL_PREFIX,
  artifactDirDisplay,
  artifactDiskPath,
  artifactUrl,
  generatedRoot,
  filmBgmRoot,
  filmsRoot,
  isWithinGeneratedRoot,
  legacyGeneratedRoot,
  materialsRoot,
  taskDirFromLocalPath,
  taskOutputDir,
  taskOutputSegments,
  taskOutputUrl,
} from "./output-paths";
import { taxonomyFrom, type ArtifactTaxonomy } from "./artifact-taxonomy";

/** 与真实 cwd 无关的假根：判据是纯字符串形状，给它什么根都该同判。 */
const ROOT = path.resolve(`${path.sep}output-root`);
const TAX: ArtifactTaxonomy = taxonomyFrom({
  mediaType: "image",
  modelName: "MiniMax H3 Image",
  modeCode: "T2I",
});

describe("generatedRoot", () => {
  it("显式 cwd → `<cwd>/generated`（解析后的绝对路径，不在 public/ 下）", () => {
    expect(generatedRoot("/srv/app")).toBe(path.resolve("/srv/app", "generated"));
  });

  it("缺省用 process.cwd()，与 /api/generated/[...path] 的根同一算法", () => {
    expect(generatedRoot()).toBe(path.resolve(process.cwd(), "generated"));
  });

  describe("COMFYAPP_GENERATED_ROOT 覆盖（ISSUE #5207）", () => {
    afterEach(() => {
      delete process.env.COMFYAPP_GENERATED_ROOT;
    });

    it("绝对路径原样、相对路径按 cwd 解析；空串回落默认根", () => {
      process.env.COMFYAPP_GENERATED_ROOT = path.resolve(os.tmpdir(), "shared-generated");
      expect(generatedRoot("/srv/app")).toBe(path.resolve(os.tmpdir(), "shared-generated"));
      process.env.COMFYAPP_GENERATED_ROOT = "shared/artifacts";
      expect(generatedRoot("/srv/app")).toBe(path.resolve("/srv/app", "shared/artifacts"));
      process.env.COMFYAPP_GENERATED_ROOT = "   ";
      expect(generatedRoot("/srv/app")).toBe(path.resolve("/srv/app", "generated"));
    });

    it("派生的子层与地址解析跟随覆盖后的根", () => {
      process.env.COMFYAPP_GENERATED_ROOT = path.resolve(os.tmpdir(), "shared-generated-2");
      const root = generatedRoot("/srv/app");
      expect(materialsRoot(root)).toBe(path.join(root, "materials"));
      expect(artifactDiskPath("/api/generated/a.png", root)).toBe(path.join(root, "a.png"));
    });
  });

  it("根**不在 public/ 下**（台账 A13 的结构性关法：public 由 Next 静态直发、不经 handler）", () => {
    const root = generatedRoot("/srv/app");
    expect(root.startsWith(path.resolve("/srv/app", "public"))).toBe(false);
    // 旧根仍然是唯一一处知道历史落点的定义 —— 迁移与它的判据都从这里取，
    // 别在调用点再拼一遍 "public", "generated"（那条判据见 artifact-layout 那份）。
    expect(legacyGeneratedRoot("/srv/app")).toBe(path.resolve("/srv/app", "public", "generated"));
    expect(legacyGeneratedRoot("/srv/app")).not.toBe(root);
  });
});

describe("isWithinGeneratedRoot", () => {
  it("等于根 / 直接子级 / 深层子级 → true", () => {
    expect(isWithinGeneratedRoot(ROOT, ROOT)).toBe(true);
    expect(isWithinGeneratedRoot(path.join(ROOT, "t1"), ROOT)).toBe(true);
    expect(isWithinGeneratedRoot(path.join(ROOT, "projects", "p1", "t1"), ROOT)).toBe(true);
  });

  it("同级前缀目录（generatedX）→ false：判据必须用分隔符收边界", () => {
    expect(isWithinGeneratedRoot(`${ROOT}X`, ROOT)).toBe(false);
  });

  it("根之外（父级与兄弟目录）→ false", () => {
    expect(isWithinGeneratedRoot(path.resolve(ROOT, "..", "elsewhere"), ROOT)).toBe(false);
  });

  it("缺省 root 用 process.cwd() 下的产物根", () => {
    const root = generatedRoot();
    expect(isWithinGeneratedRoot(path.join(root, "t1"))).toBe(true);
    expect(isWithinGeneratedRoot(path.resolve(root, "..", "public"))).toBe(false);
  });
});

describe("taskOutputSegments", () => {
  it("一律 mediaType / modelName / modeCode / taskId（项目归属只在库里，不进路径）", () => {
    expect(taskOutputSegments(TAX, "t1")).toEqual(["image", "MiniMax_H3_Image", "T2I", "t1"]);
  });

  it("模型名里的空格与危险字符被收成合法段，中文保留", () => {
    const tax = taxonomyFrom({ mediaType: "video", modelName: "模型 /A:B", modeCode: "I2V" });
    expect(taskOutputSegments(tax, "t2")).toEqual(["video", "模型_A_B", "I2V", "t2"]);
  });
});

describe("taskOutputUrl", () => {
  it("每段单独 percent-encode，模型名带空格也能原样落回磁盘", () => {
    expect(taskOutputUrl(TAX, "t1")).toBe("/api/generated/image/MiniMax_H3_Image/T2I/t1");
  });
});

describe("taskOutputDir", () => {
  it("磁盘与 URL 同源：两条出口都由同一份 segments 派生", () => {
    expect(taskOutputDir(TAX, "t1", ROOT)).toBe(
      path.resolve(ROOT, "image", "MiniMax_H3_Image", "T2I", "t1"),
    );
    expect(taskOutputUrl(TAX, "t1").split("/").slice(3)).toEqual(taskOutputSegments(TAX, "t1"));
  });

  it("缺省 root → 落在 process.cwd() 的产物根下", () => {
    expect(taskOutputDir(TAX, "t1")).toBe(
      path.resolve(generatedRoot(), "image", "MiniMax_H3_Image", "T2I", "t1"),
    );
  });

  it("taskId 穿越 → null（不许把根外的目录交给 fs.rm）", () => {
    expect(taskOutputDir(TAX, path.join("..", "..", "evil"), ROOT)).toBeNull();
  });

  it("分类维度穿越 → null（模型名等外来值同样在闸内）", () => {
    const evil = taxonomyFrom({ mediaType: "image", modelName: "ok", modeCode: "T2I" });
    evil.mediaType = path.join("..", "..", "evil");
    expect(taskOutputDir(evil, "t1", ROOT)).toBeNull();
  });

  it("绝对形态的 taskId（path.resolve 会直接丢掉 root）→ null", () => {
    expect(taskOutputDir(TAX, path.resolve(`${path.sep}elsewhere`), ROOT)).toBe(null);
  });
});

describe("taskDirFromLocalPath", () => {
  it("新形状与迁移前的旧平铺都反推得到目录", () => {
    expect(taskDirFromLocalPath(`${taskOutputUrl(TAX, "t1")}/img_0.png`, ROOT)).toBe(
      path.resolve(ROOT, "image", "MiniMax_H3_Image", "T2I", "t1"),
    );
    expect(taskDirFromLocalPath("/api/generated/legacy-task/img_0.png", ROOT)).toBe(
      path.resolve(ROOT, "legacy-task"),
    );
  });

  it("空地址 / 越界地址 → null", () => {
    expect(taskDirFromLocalPath(null, ROOT)).toBeNull();
    expect(taskDirFromLocalPath("/api/generated/../../outside/x.png", ROOT)).toBeNull();
  });
});

describe("artifactUrl", () => {
  it("前缀只有一份来源：taskOutputUrl 与它同形", () => {
    expect(taskOutputUrl(TAX, "t1")).toBe(`${ARTIFACT_URL_PREFIX}/image/MiniMax_H3_Image/T2I/t1`);
    expect(ARTIFACT_URL_PREFIX).toBe("/api/generated");
  });
});

describe("artifactDiskPath —— 写侧与读侧必须落在同一个文件上", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "artifact-roundtrip-"));
  const root = path.join(tmp, "generated");

  afterAll(() => {
    // Windows：句柄没关时 rmSync 会 EPERM，按仓库既有做法带重试
    fs.rmSync(tmp, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 100,
    });
  });

  it("执行器落盘的目录里那个文件，用写进库的 localPath 原样取得到", () => {
    const dir = taskOutputDir(TAX, "t-42", root);
    expect(dir).not.toBeNull();
    fs.mkdirSync(dir!, { recursive: true });
    const file = path.join(dir!, "img_0.png");
    fs.writeFileSync(file, "png");
    // 库里的 localPath 就是 executor-finalize 写的那一句
    const localPath = `${taskOutputUrl(TAX, "t-42")}/img_0.png`;
    expect(artifactDiskPath(localPath, root)).toBe(file);
    expect(fs.existsSync(artifactDiskPath(localPath, root)!)).toBe(true);
  });

  it("素材那种「每段都 percent-encode」的地址 decode 回同一个磁盘位置", () => {
    const name = "中文 名%20.png";
    const url = artifactUrl(["materials", "proj_1", "ref", name].map(encodeURIComponent));
    expect(artifactDiskPath(url, root)).toBe(path.join(root, "materials", "proj_1", "ref", name));
  });

  it("坏编码（孤立的 %）判成「不是产物地址」而不是抛 URIError", () => {
    expect(artifactDiskPath("/api/generated/a%zz.png", root)).toBeNull();
  });

  it("残留成绝对路径的一段（resolve 会丢掉 root）→ null", () => {
    expect(artifactDiskPath("/api/generated//etc/passwd", root)).toBeNull();
  });

  it("同级 generatedX 不算根内：判据带 path.sep 边界", () => {
    expect(artifactDiskPath("/api/generated../x", root)).toBeNull();
  });
});

describe("子层位置（materials / films / films+bgm）", () => {
  it("全部从产物根派生，不各拼一份 public/generated", () => {
    expect(materialsRoot(ROOT)).toBe(path.join(ROOT, "materials"));
    expect(filmsRoot(ROOT)).toBe(path.join(ROOT, "films"));
    expect(filmBgmRoot(ROOT)).toBe(path.join(ROOT, "films", "bgm"));
    // 素材的 folderDir 与成片的 bgm 是两个不同的格：越界判据同一份、根不同
    expect(isWithinGeneratedRoot(filmBgmRoot(ROOT), filmsRoot(ROOT))).toBe(true);
    expect(isWithinGeneratedRoot(materialsRoot(ROOT), filmsRoot(ROOT))).toBe(false);
  });
});

describe("artifactDirDisplay（界面向用户说落点时用的那一份形状）", () => {
  it("给出三级分类下的相对落点，且不带 public 那一段", () => {
    expect(artifactDirDisplay(TAX, "t1")).toBe(`generated/image/MiniMax_H3_Image/T2I/t1/`);
    // 界面文案只能来自这里：抄一份字面量就不会随搬迁而红（台账 A13 那三处文案的旧形状）
    expect(artifactDirDisplay(TAX, "t1").startsWith("public/")).toBe(false);
  });
});
