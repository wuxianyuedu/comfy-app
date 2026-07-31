import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getLLMConfig } from "@/lib/llm/server";
import { prisma } from "@/lib/db";
import type { LLMConfigView, LLMProviderType } from "@/lib/llm/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function toView(cfg: {
  provider: string;
  baseUrl: string;
  model: string;
  temperature: number;
  maxTokens: number;
  apiKey?: string | null;
}): LLMConfigView {
  return {
    provider: cfg.provider as LLMProviderType,
    baseUrl: cfg.baseUrl,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    hasApiKey: Boolean(cfg.apiKey),
  };
}

export async function GET() {
  const cfg = await getLLMConfig();
  return NextResponse.json({ config: toView(cfg) });
}

const UpdateSchema = z.object({
  provider: z.enum(["local", "remote"]).optional(),
  baseUrl: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  apiKey: z.string().optional(), // empty string clears it
  temperature: z.number().min(0).max(2).optional(),
  maxTokens: z.number().int().min(16).max(8192).optional(),
});

export async function POST(req: NextRequest) {
  let body: z.infer<typeof UpdateSchema>;
  try {
    body = UpdateSchema.parse(await req.json());
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "配置格式错误" }, { status: 400 });
  }

  const data: Record<string, unknown> = {};
  if (body.provider) data.provider = body.provider;
  if (body.baseUrl) data.baseUrl = body.baseUrl;
  if (body.model) data.model = body.model;
  if (body.temperature != null) data.temperature = body.temperature;
  if (body.maxTokens != null) data.maxTokens = body.maxTokens;
  if (body.apiKey !== undefined) data.apiKey = body.apiKey || null;

  await prisma.llmConfig.upsert({
    where: { id: "singleton" },
    create: {
      id: "singleton",
      provider: body.provider ?? "local",
      baseUrl: body.baseUrl ?? "http://localhost:11434/v1",
      model: body.model ?? "llama3.1",
      apiKey: body.apiKey || null,
      temperature: body.temperature ?? 0.7,
      maxTokens: body.maxTokens ?? 2048,
    },
    update: data,
  });

  const cfg = await getLLMConfig();
  return NextResponse.json({ config: toView(cfg) });
}
