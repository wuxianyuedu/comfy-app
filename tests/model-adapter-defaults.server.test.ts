/**
 * 模型适配器的「项目默认」（ISSUE #3951）：基线读取 / 生效档合并 / 保存为项目默认。
 *
 * 全部走临时根目录（用假件 `scripts/dev-launcher.mjs` 钉住「开发检出」判据，
 * 与 `dev-checkout.server` 的唯一判据同形），一次也不碰真实检出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

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

const defaultsFile = () => path.join(root, "src", "lib", "workshop", "model-adapter-defaults.json");

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
  it("文件不在 ⇒ 编译进包的快照（入库基线原样）", async () => {
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
  });

  it("文件在场 ⇒ 现读磁盘（写完即生效，不必重启）", async () => {
    fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
    fs.writeFileSync(
      defaultsFile(),
      JSON.stringify({ version: 1, models: { M1: docWith("SHOT", "x") } }),
      "utf8",
    );
    const docs = await readModelAdapterDefaultDocs(root);
    expect(docs.M1?.adapters[0]?.inputs[0]?.field).toBe("x");
  });

  it("坏文件 ⇒ 回落快照（半截 JSON 不打断内置适配器）", async () => {
    fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
    fs.writeFileSync(defaultsFile(), "{ 半截", "utf8");
    expect(await readModelAdapterDefaultDocs(root)).toEqual(bundledExpected);
  });
});

describe("effectiveModelAdaptersDoc", () => {
  it("基线没有这条模型 ⇒ 原样返回 DB 存档", async () => {
    const db = docWith("SHOT", "z");
    expect(await effectiveModelAdaptersDoc("M9", db, root)).toEqual(db);
  });

  it("逐模式合并：基线打底、DB 同名模式压过（DB 只改一个模式，其余吃基线）", async () => {
    fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
    fs.writeFileSync(
      defaultsFile(),
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
    fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
    fs.writeFileSync(
      defaultsFile(),
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
      expect(fs.existsSync(path.join(bare, "src"))).toBe(false);
    } finally {
      fs.rmSync(bare, { recursive: true, force: true });
    }
  });

  it("写入 + 归一化（端点补根斜杠）+ 保留其他模型", async () => {
    fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
    fs.writeFileSync(
      defaultsFile(),
      JSON.stringify({ version: 1, models: { OTHER: docWith("VIDEO", "keep") } }),
      "utf8",
    );
    const { doc, relPath } = await saveModelAdaptersAsDefaults(
      "M1",
      {
        endpointPath: "v1",
        adapters: [{ mode: "shot", inputs: [{ type: "prompt", field: "p" }], outputField: "url" }],
      },
      root,
    );
    expect(relPath).toBe("src/lib/workshop/model-adapter-defaults.json");
    expect(doc.endpointPath).toBe("/v1");
    const raw: unknown = JSON.parse(fs.readFileSync(defaultsFile(), "utf8"));
    /* 整份精确比对（键序无关）：写进去的就是「原有模型原样 + 本次这一条归一化」。 */
    expect(raw).toEqual({
      version: 1,
      models: {
        OTHER: docWith("VIDEO", "keep"),
        M1: docWith("SHOT", "p", "/v1"),
      },
    });
  });
});
