/**
 * 模型适配器的「项目默认」（ISSUE #3951）：基线读取 / 生效档合并。
 * 运行期只读不写（ISSUE #5001），没有「保存为项目默认」的写入方可测。
 *
 * 全部走临时根目录，一次也不碰真实检出。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  effectiveModelAdaptersDoc,
  mergeModelAdapterDefaultDocs,
  parseModelAdapterDefaults,
  readModelAdapterDefaultDocs,
} from "../src/lib/workshop/model-adapter-defaults.server";
import bundledDefaultsJson from "../src/lib/workshop/model-adapter-defaults.json";

/* 快照期望从**入库的那份 JSON**现场解析 —— 基线文件随业务演进（模型条目会增加），
 * 用例钉的是「回落的是编译进包的那份」，不是「它永远为空」。 */
const bundledExpected = parseModelAdapterDefaults(bundledDefaultsJson);

let root: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "adapter-defaults-"));
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

describe("mergeModelAdapterDefaultDocs", () => {
  it("纯函数合并：预读一次基线后可对整批模型复用，逐模型结果与逐条现读一致", async () => {
    fs.mkdirSync(path.dirname(defaultsFile()), { recursive: true });
    fs.writeFileSync(
      defaultsFile(),
      JSON.stringify({ version: 1, models: { M1: docWith("SHOT", "base-shot", "/base") } }),
      "utf8",
    );
    /* 先读一次盘，再对多个模型走纯函数合并（概览批量路径）。 */
    const docs = await readModelAdapterDefaultDocs(root);
    const dbDoc = docWith("SHOT", "db-shot");
    const merged = mergeModelAdapterDefaultDocs("M1", dbDoc, docs);
    const viaAsync = await effectiveModelAdaptersDoc("M1", dbDoc, root);
    expect(merged).toEqual(viaAsync);
    expect(merged.endpointPath).toBe("/base");
    /* 基线里没有的模型原样返回 DB 存档。 */
    expect(mergeModelAdapterDefaultDocs("OTHER", dbDoc, docs)).toEqual(dbDoc);
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
