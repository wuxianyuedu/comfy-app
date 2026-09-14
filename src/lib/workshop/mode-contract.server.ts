// ── 工坊模式契约注册表：服务端存储（JSON 文件，规范 §17.2 服务端层）──────
// 每种模式的统一输入 / 输出是工坊全局配置（本地工作流按它配落点、远端模型
// 按它建适配器），改动低频、体量小 —— 与 workshop-api-settings 同款 JSON
// 文件存储（data/workshop-mode-contracts.json），不走 DB 迁移。
// 未存储的模式回落内置默认（builtInModeContract），升级零破坏。

import "server-only";

import { promises as fs } from "fs";
import path from "path";

import {
  parseModeContracts,
  type ModeContract,
} from "./model-mode-contract";

const FILE = path.join(process.cwd(), "data", "workshop-mode-contracts.json");

/** 读取用户自定义的模式契约（只含改过的模式；坏数据按空处理）。 */
export async function loadModeContracts(): Promise<ModeContract[]> {
  try {
    const raw = await fs.readFile(FILE, "utf8");
    return parseModeContracts(JSON.parse(raw));
  } catch {
    return [];
  }
}

/** 保存整份用户自定义模式契约（归一化后覆盖）。 */
export async function saveModeContracts(
  contracts: ModeContract[],
): Promise<ModeContract[]> {
  const normalized = parseModeContracts(contracts);
  await fs.mkdir(path.dirname(FILE), { recursive: true });
  await fs.writeFile(FILE, JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}
