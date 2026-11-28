/** 代码驱动影片（CodeFilm）的 MCP 工具注册。
 *
 * 从 `buildWorkshopMcpServer` 拆出（函数长度硬闸 §12.13）：这三个工具与工坊会话
 * 工具同住一个 server，但归属 codefilm 域，注册逻辑独立成文件。
 *
 * 纯 Node 宿主可用：这里只引不带 `server-only` 的模块（编译走 mcp-compile 的
 * workshop 平行实现），入队仍在应用内 `codeFilm.render`，不在 MCP 重建执行栈。 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { codeFilmContractSchema } from "~/lib/codefilm/contract-schema";
import { checkContract } from "~/lib/codefilm/qa-rules";
import { contractToShots } from "~/lib/codefilm/contract-to-shots";
import { contractToRuns } from "~/lib/codefilm/contract-to-runs";
import { mcpCompileContract } from "~/server/codefilm/mcp-compile";

/** 与 workshop-mcp 的 `json` 同形：把结果包成 MCP 的 text content。 */
function json(value: unknown): { content: Array<{ text: string; type: "text" }> } {
  return {
    content: [{ text: JSON.stringify(value, null, 2), type: "text" }],
  };
}

/** 把三个 codefilm 工具注册到给定的 MCP server。 */
export function registerCodeFilmTools(server: McpServer): void {
  server.registerTool(
    "codefilm_generate_contract",
    {
      title: "生成制片合同",
      description:
        "把剧本文本交给 LLM 编译为制片合同（共享地图 + 镜头表 + 时间轴 + 动作节拍），最多 3 次有界 QA 修复重试。返回合同 JSON；入队请用应用内 codeFilm.render。",
      inputSchema: {
        scriptMarkdown: z.string().min(1).describe("剧本文本或灵感梗概"),
        title: z.string().optional().describe("作品标题"),
        tone: z.string().optional().describe("基调"),
      },
    },
    async (args) =>
      json(await mcpCompileContract(args.scriptMarkdown, { title: args.title, tone: args.tone })),
  );

  server.registerTool(
    "codefilm_validate_contract",
    {
      title: "校验制片合同",
      description:
        "对制片合同跑静态 QA：时间轴连续性、实体引用可解析、动作节拍顺序、镜头/帧数上限。返回逐条字段路径，不抛错。",
      inputSchema: { contract: z.unknown().describe("制片合同 JSON") },
    },
    (args) => {
      const parsed = codeFilmContractSchema.safeParse(args.contract);
      if (!parsed.success) {
        return json({
          ok: false,
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      return json(checkContract(parsed.data));
    },
  );

  server.registerTool(
    "codefilm_preview_shots",
    {
      title: "预览合同镜头",
      description:
        "把制片合同翻译成工坊镜头表与逐镜生成入参（不落库、不入队），供入队前核对分镜与动作编排。",
      inputSchema: {
        contract: z.unknown().describe("制片合同 JSON"),
        fps: z.number().int().positive().optional(),
      },
    },
    (args) => {
      const parsed = codeFilmContractSchema.safeParse(args.contract);
      if (!parsed.success) {
        return json({
          error: "合同不合法",
          issues: parsed.error.issues.map((issue) => ({
            path: issue.path.join("."),
            message: issue.message,
          })),
        });
      }
      const report = checkContract(parsed.data);
      if (!report.ok) {
        return json({ error: "合同未通过静态 QA", issues: report.issues });
      }
      return json({
        shots: contractToShots(parsed.data),
        runs: contractToRuns(parsed.data, { fps: args.fps }),
      });
    },
  );
}
