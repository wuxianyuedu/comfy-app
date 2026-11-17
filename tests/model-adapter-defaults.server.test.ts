/**
 * 模型适配器的「项目默认」（ISSUE #3951；#4171 起落点迁出 src）：基线读取 /
 * 生效档合并 / 保存为项目默认 / 存量搬迁。
 *
 * 全部走临时根目录（用假件 `scripts/dev-launcher.mjs` 钉住「开发检出」判据，
 * 与 `dev-checkout.server` 的唯一判据同形），一次也不碰真实检出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { isRecord } from "../src/lib/is-record";
import {
  effectiveModelAdaptersDoc,
  parseModelAdapterDefaults,
  readModelAdapterDefaultDocs,
  saveModelAdaptersAsDefaults,
} from "../src/lib/workshop/model-adapter-defaults.server";
import bundledDefaultsJson from "../src/lib/workshop/model-adapter-defaults.json";

/* 快照期望从**入库的那份 JSON**现场解析 —— 基线文件随业务演进（模型条目会增加），
 * 用例钉的是「回落的是编译进包的那份」，不是「它永远为空」。 */
const bundledExpected = parseModelAdapterDefaults(bundledDefaultsJson);

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-defaults-"));
  /* 「开发检出」判据 = `scripts/dev-launcher.mjs` 在场（dev-checkout.server 的唯一判据）。 */
  fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
  fs.writeFileSync(path.join(root, "scripts", "dev-launcher.mjs"), "// 测试假件\n");
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

/** 旧落点（src 编译源）——#4171 起运行期不再写它，只作存量搬迁的判据。 */
const srcDefaultsFile = () =>
  path.join(root, "src", "lib", "workshop", "model-adapter-defaults.json");

/** 新落点（本机项目默认覆盖，data/ 下、不入库）。 */
const runtimeDefaultsFile = () =>
  path.join(root, "data", "workshop-model-adapter-project-defaults.json");

const docWith = (mode: string, field: string, endpointPath = "") => ({
  endpointPath,
  adapters: [{ mode, inputs: [{ type: "prompt" as const, field }], outputField: "url" }],
});

describe("parseModelAdapterDefaults", () => {
  it("逐模型归一化；空适配器清单视为没配（不入表）", () => {
    const parsed = parseModelAdapterDefaults({
      version: 1,
      models: {
        M1: docWith("SHOT", "x"),
        M2: { endpointPath: "", adapters: [] },
        M3: { 不是: "合法形状" },
      },
    });
    expect(Object.keys(parsed)).toEqual(["M1"]);
    expect(parsed.M1?.adapters[0]?.inputs[0]?.field).toBe("x");
  });

  it("根不是对象 / 缺 models ⇒ 空表（坏文件不打断内置适配器）", () => {
    expect(parseModelAdapterDefaults(null)).toEqual({});
    expect(parseModelAdapterDefaults({ nope: 1 })).toEqual({});
  });
});

describe("readModelAdapterDefaultDocs", () => {
  it("运行时覆盖不在 ⇒ 编译进包的快照（入库基线原样）", async () => {
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
  });

  it("运行时覆盖在场 ⇒ 现读磁盘（写完即生效，不必重启），逐模型压过快照", async () => {
    fs.mkdirSync(path.dirname(runtimeDefaultsFile()), { recursive: true });
    fs.writeFileSync(
      runtimeDefaultsFile(),
      JSON.stringify({ version: 1, models: { M1: docWith("SHOT", "x") } }),
      "utf8",
    );
    const docs = await readModelAdapterDefaultDocs(root);
    expect(docs.M1?.adapters[0]?.inputs[0]?.field).toBe("x");
    /* 逐模型兜底：覆盖里没有的模型仍回落编译快照（后续 PR 往编译源加的
     * 模型不被本机旧副本遮住）。 */
    for (const [name, doc] of Object.entries(bundledExpected)) {
      expect(docs[name]).toEqual(doc);
    }
  });

  it("运行时覆盖是坏文件 ⇒ 回落快照（半截 JSON 不打断内置适配器）", async () => {
    fs.mkdirSync(path.dirname(runtimeDefaultsFile()), { recursive: true });
    fs.writeFileSync(runtimeDefaultsFile(), "{ 半截", "utf8");
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
  });
});

describe("readModelAdapterDefaultDocs · 存量搬迁（ISSUE #4171）", () => {
  it("旧版写进 src 的用户态 → 首次读取时迁到 data/，内容逐字保留、src 原样不动", async () => {
    const legacy = { version: 1, models: { LEGACY_M: docWith("SHOT", "old", "/legacy") } };
    fs.mkdirSync(path.dirname(srcDefaultsFile()), { recursive: true });
    fs.writeFileSync(srcDefaultsFile(), `${JSON.stringify(legacy, null, 2)}\n`, "utf8");
    /* 与编译快照不同（快照里没有 LEGACY_M 这条）⇒ 判为用户态，迁移。 */
    const docs = await readModelAdapterDefaultDocs(root);
    expect(docs.LEGACY_M?.adapters[0]?.inputs[0]?.field).toBe("old");
    /* 新落点拿到的是遗留文件原文（逐字，含排版）。 */
    expect(fs.readFileSync(runtimeDefaultsFile(), "utf8")).toBe(
      `${JSON.stringify(legacy, null, 2)}\n`,
    );
    /* 迁移只写 runtime：src 文件原样不动（运行期进程不做源码手术，
     * 遗留的工作树 M 由人 git checkout -- 收掉）。 */
    expect(fs.readFileSync(srcDefaultsFile(), "utf8")).toBe(`${JSON.stringify(legacy, null, 2)}\n`);
  });

  it("src 与编译快照一致（就是编译源本体）→ 不迁移，本机不钉住任何东西", async () => {
    fs.mkdirSync(path.dirname(srcDefaultsFile()), { recursive: true });
    fs.writeFileSync(
      srcDefaultsFile(),
      `${JSON.stringify(bundledDefaultsJson, null, 2)}\n`,
      "utf8",
    );
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
    expect(fs.existsSync(runtimeDefaultsFile())).toBe(false);
  });

  it("src 是坏 JSON → 按「没迁移」处理，读侧回落快照", async () => {
    fs.mkdirSync(path.dirname(srcDefaultsFile()), { recursive: true });
    fs.writeFileSync(srcDefaultsFile(), "{ 这不是 JSON", "utf8");
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
    expect(fs.existsSync(runtimeDefaultsFile())).toBe(false);
  });

  it("src 不在 → 不迁移（新检出的常态）", async () => {
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
    expect(fs.existsSync(runtimeDefaultsFile())).toBe(false);
  });
});

describe("effectiveModelAdaptersDoc", () => {
  it("基线没有这条模型 ⇒ 原样返回 DB 存档", async () => {
    const db = docWith("SHOT", "z");
    expect(await effectiveModelAdaptersDoc("M9", db, root)).toEqual(db);
  });

  it("逐模式合并：基线打底、DB 同名模式压过（DB 只改一个模式，其余吃基线）", async () => {
    fs.mkdirSync(path.dirname(runtimeDefaultsFile()), { recursive: true });
    fs.writeFileSync(
      runtimeDefaultsFile(),
      JSON.stringify({
        version: 1,
        models: { M1: docWith("SHOT", "base-shot", "/base") },
      }),
      "utf8",
    );
    const db = {
      endpointPath: "",
      adapters: [
        { mode: "VIDEO", inputs: [{ type: "prompt" as const, field: "z" }], outputField: "url" },
      ],
    };
    const eff = await effectiveModelAdaptersDoc("M1", db, root);
    expect(eff.endpointPath).toBe("/base");
    expect(eff.adapters.map((a) => [a.mode, a.inputs[0]?.field])).toEqual([
      ["SHOT", "base-shot"],
      ["VIDEO", "z"],
    ]);
  });

  it("端点路径 DB 非空优先（本机存档说了算）", async () => {
    fs.mkdirSync(path.dirname(runtimeDefaultsFile()), { recursive: true });
    fs.writeFileSync(
      runtimeDefaultsFile(),
      JSON.stringify({ version: 1, models: { M1: docWith("SHOT", "x", "/base") } }),
      "utf8",
    );
    const eff = await effectiveModelAdaptersDoc("M1", docWith("SHOT", "y", "/mine"), root);
    expect(eff.endpointPath).toBe("/mine");
  });
});

describe("saveModelAdaptersAsDefaults", () => {
  it("非开发检出 ⇒ 大声失败，一个字都不写", async () => {
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-defaults-bare-"));
    try {
      await expect(saveModelAdaptersAsDefaults("M1", docWith("SHOT", "x"), bare)).rejects.toThrow(
        "只在开发检出可用",
      );
      expect(fs.existsSync(path.join(bare, "data"))).toBe(false);
      expect(fs.existsSync(path.join(bare, "src"))).toBe(false);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it("写进本机运行时覆盖（data/）+ 归一化（端点补根斜杠）+ 整份基线合并", async () => {
    /* 既有基线种在**新落点**（旧版写进 src 的那份由存量搬迁负责，写侧不读 src）。 */
    fs.mkdirSync(path.dirname(runtimeDefaultsFile()), { recursive: true });
    fs.writeFileSync(
      runtimeDefaultsFile(),
      JSON.stringify({ version: 1, models: { OTHER: docWith("VIDEO", "keep") } }),
      "utf8",
    );
    const { doc, file, relPath } = await saveModelAdaptersAsDefaults(
      "M1",
      {
        endpointPath: "v1",
        adapters: [{ mode: "shot", inputs: [{ type: "prompt", field: "p" }], outputField: "url" }],
      },
      root,
    );
    expect(relPath).toBe("data/workshop-model-adapter-project-defaults.json");
    expect(file).toBe(runtimeDefaultsFile());
    expect(doc.endpointPath).toBe("/v1");
    const raw: unknown = JSON.parse(fs.readFileSync(runtimeDefaultsFile(), "utf8"));
    /* 写的是整份基线：既有条目（含编译源里的模型）原样保留，本次这一条归一化压上。 */
    if (!isRecord(raw) || !isRecord(raw.models)) {
      throw new Error("落盘内容不是 { version, models } 形状");
    }
    const models = raw.models;
    expect(models.M1).toEqual(docWith("SHOT", "p", "/v1"));
    expect(models.OTHER).toEqual(docWith("VIDEO", "keep"));
    for (const [name, d] of Object.entries(bundledExpected)) {
      expect(models[name]).toEqual(d);
    }
    /* src 那份编译源运行期不再被写。 */
    expect(fs.existsSync(srcDefaultsFile())).toBe(false);
  });
});
