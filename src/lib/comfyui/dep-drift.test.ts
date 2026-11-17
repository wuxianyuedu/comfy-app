// dep-drift 单测：requirements.txt 锁包解析 / dist-info 版本扫描 / 差异判定 /
// 预警文案 / 端到端核对（真实临时目录，覆盖 Windows 与 POSIX 两种 venv 布局）。
// 解析与比对用注入 io 的假数据逐条锁；端到端用例验证「读不到任何一环就返回
// null、绝不抛错」的兜底纪律（ISSUE #4192）。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDepDriftWarning,
  checkComfyDepDrift,
  findDepDrift,
  normalizePkgName,
  parsePinnedRequirements,
  readInstalledVersions,
  type DepDriftIo,
} from "./dep-drift";

const tmpRoots: Array<string> = [];

function makeTmpDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "comfy-dep-drift-"));
  tmpRoots.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tmpRoots.splice(0)) {
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

/** 在 venv 环境根下按 Windows 布局造一个 site-packages，并写入 dist-info。 */
function makeWinSitePackages(envRoot: string, packages: Array<[string, string]>): string {
  const sp = path.join(envRoot, "Lib", "site-packages");
  for (const [name, version] of packages) {
    const dir = path.join(sp, `${name}-${version}.dist-info`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "METADATA"),
      `Metadata-Version: 2.1\nName: ${name}\nVersion: ${version}\n`,
    );
  }
  return sp;
}

describe("parsePinnedRequirements", () => {
  it("只收 == 精确锁定；注释 / 空行 / 选项行 / 区间 / 裸包名 / 环境标记都跳过", () => {
    const content = [
      "# 整行注释",
      "",
      "comfy-aimdo==0.6.0",
      "comfy-kitchen==0.2.41 # 行内注释",
      "torch==2.10.0+cu130",
      "Pillow>=10.1.0",
      "pydantic~=2.0",
      "comfy-angle",
      "-i https://pypi.example/simple",
      "some-pkg==1.0 ; python_version < '3.12'",
      "extra-pkg[cli]==2.3.4",
    ].join("\n");
    expect(parsePinnedRequirements(content)).toEqual([
      { name: "comfy-aimdo", version: "0.6.0" },
      { name: "comfy-kitchen", version: "0.2.41" },
      { name: "torch", version: "2.10.0+cu130" },
      { name: "some-pkg", version: "1.0" },
      { name: "extra-pkg", version: "2.3.4" },
    ]);
  });

  it("包名按 PEP 503 规范化：大小写与 -_. 折叠成同一形态", () => {
    expect(normalizePkgName("Comfy_Aimdo")).toBe("comfy-aimdo");
    expect(normalizePkgName("comfy--aimdo")).toBe("comfy-aimdo");
  });
});

describe("readInstalledVersions", () => {
  it("从 dist-info/METADATA 读 Name/Version，跳过非 dist-info 与读不到的条目", () => {
    const io: DepDriftIo = {
      exists: () => true,
      readDirNames: () => [
        "comfy_aimdo-0.5.6.dist-info",
        "torch-2.10.0+cu130.dist-info",
        "junk",
        "broken-1.0.dist-info",
      ],
      readFile: (p) => {
        if (p.includes("broken-1.0")) {
          throw new Error("EACCES");
        }
        if (p.includes("comfy_aimdo")) {
          return "Name: comfy-aimdo\nVersion: 0.5.6\n";
        }
        return "Metadata-Version: 2.1\nName: torch\nVersion: 2.10.0+cu130\n";
      },
    };
    const versions = readInstalledVersions("/sp", io);
    expect(versions.get("comfy-aimdo")).toBe("0.5.6");
    expect(versions.get("torch")).toBe("2.10.0+cu130");
    expect(versions.has("junk")).toBe(false);
  });

  it("目录读不了时返回空表，不抛错", () => {
    const io: DepDriftIo = {
      exists: () => true,
      readDirNames: () => {
        throw new Error("ENOENT");
      },
      readFile: () => "",
    };
    expect(readInstalledVersions("/sp", io).size).toBe(0);
  });
});

describe("findDepDrift", () => {
  it("版本落后与缺失都算脱节；版本一致的锁包不进差异面", () => {
    const drift = findDepDrift(
      [
        { name: "comfy-aimdo", version: "0.6.0" },
        { name: "comfy-angle", version: "0.1.0" },
        { name: "comfy-kitchen", version: "0.2.41" },
      ],
      new Map([
        ["comfy-aimdo", "0.5.6"],
        ["comfy-kitchen", "0.2.41"],
      ]),
    );
    expect(drift).toEqual([
      { name: "comfy-aimdo", required: "0.6.0", installed: "0.5.6" },
      { name: "comfy-angle", required: "0.1.0", installed: null },
    ]);
  });
});

describe("buildDepDriftWarning", () => {
  it("点名 ComfyUI 版本、逐条列差异并给出可行动修法", () => {
    const text = buildDepDriftWarning({
      comfyuiVersion: "0.45.2",
      drift: [
        { name: "comfy-aimdo", required: "0.6.0", installed: "0.5.6" },
        { name: "comfy-angle", required: "0.1.0", installed: null },
      ],
      requirementsPath: "D:/inst/ComfyUI/requirements.txt",
    });
    expect(text).toContain("v0.45.2");
    expect(text).toContain("comfy-aimdo 需要 0.6.0、实际 0.5.6");
    expect(text).toContain("comfy-angle 需要 0.1.0、实际 未安装");
    expect(text).toContain("pageout_callback");
    expect(text).toContain("pip install -r D:/inst/ComfyUI/requirements.txt");
    expect(text).toContain("pypi.tuna.tsinghua.edu.cn");
  });

  it("版本读不到时不写错误结论，只标注版本未知", () => {
    const text = buildDepDriftWarning({
      comfyuiVersion: null,
      drift: [{ name: "comfy-aimdo", required: "0.6.0", installed: "0.5.6" }],
      requirementsPath: "/r.txt",
    });
    expect(text).toContain("版本未知");
    expect(text).not.toContain("vnull");
  });
});

describe("checkComfyDepDrift", () => {
  it("端到端（Windows venv 布局）：报出落后与缺失，版本一致的锁包不报", () => {
    const root = makeTmpDir();
    const src = path.join(root, "ComfyUI");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(
      path.join(src, "requirements.txt"),
      ["comfy-aimdo==0.6.0", "comfy-kitchen==0.2.41", "comfy-angle==0.1.0"].join("\n"),
    );
    fs.writeFileSync(path.join(src, "comfyui_version.py"), '__version__ = "0.45.2"\n');
    const envRoot = path.join(root, "env");
    makeWinSitePackages(envRoot, [
      ["comfy-aimdo", "0.5.6"],
      ["comfy-kitchen", "0.2.41"],
    ]);

    const report = checkComfyDepDrift(src, path.join(envRoot, "Scripts", "python.exe"));
    expect(report).not.toBeNull();
    expect(report?.comfyuiVersion).toBe("0.45.2");
    expect(report?.drift).toEqual([
      { name: "comfy-aimdo", required: "0.6.0", installed: "0.5.6" },
      { name: "comfy-angle", required: "0.1.0", installed: null },
    ]);
  });

  it("端到端（POSIX venv 布局）：lib/python3.x/site-packages 同样被核对", () => {
    const root = makeTmpDir();
    const src = path.join(root, "ComfyUI");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "requirements.txt"), "comfy-aimdo==0.6.0\n");
    const sp = path.join(root, "env", "lib", "python3.13", "site-packages");
    fs.mkdirSync(path.join(sp, "comfy_aimdo-0.6.0.dist-info"), { recursive: true });
    fs.writeFileSync(
      path.join(sp, "comfy_aimdo-0.6.0.dist-info", "METADATA"),
      "Name: comfy-aimdo\nVersion: 0.6.0\n",
    );

    const report = checkComfyDepDrift(src, path.join(root, "env", "bin", "python"));
    expect(report).not.toBeNull();
    expect(report?.drift).toEqual([]);
  });

  it("没有 requirements.txt / site-packages 找不到 / 读取失败 → 一律 null，不抛错", () => {
    const root = makeTmpDir();
    const src = path.join(root, "ComfyUI");
    fs.mkdirSync(src, { recursive: true });
    // 没有 requirements.txt
    expect(checkComfyDepDrift(src, path.join(root, "env", "Scripts", "python.exe"))).toBeNull();

    // 有 requirements.txt 但解释器环境里没有 site-packages
    fs.writeFileSync(path.join(src, "requirements.txt"), "comfy-aimdo==0.6.0\n");
    expect(checkComfyDepDrift(src, path.join(root, "env", "Scripts", "python.exe"))).toBeNull();

    // 读取 requirements.txt 失败（权限等）→ null
    const throwingIo: DepDriftIo = {
      exists: () => true,
      readFile: () => {
        throw new Error("EACCES");
      },
      readDirNames: () => [],
    };
    expect(
      checkComfyDepDrift(src, path.join(root, "env", "Scripts", "python.exe"), throwingIo),
    ).toBeNull();
  });

  it("requirements.txt 里没有 == 锁包时无从核对 → null", () => {
    const root = makeTmpDir();
    const src = path.join(root, "ComfyUI");
    fs.mkdirSync(src, { recursive: true });
    fs.writeFileSync(path.join(src, "requirements.txt"), "torch\nnumpy>=1.25.0\n");
    const envRoot = path.join(root, "env");
    makeWinSitePackages(envRoot, [["torch", "2.10.0"]]);
    expect(checkComfyDepDrift(src, path.join(envRoot, "Scripts", "python.exe"))).toBeNull();
  });
});
