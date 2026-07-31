import { prisma } from "./db";
import { listModels } from "./comfyui/client";

// Folders on disk (ComfyUI) → our Model.type.
const FOLDERS: { type: string; folder: string }[] = [
  { type: "CHECKPOINT", folder: "checkpoints" },
  { type: "LORA", folder: "loras" },
  { type: "VAE", folder: "vae" },
  { type: "CONTROLNET", folder: "controlnet" },
  { type: "EMBEDDING", folder: "embeddings" },
  { type: "UPSCALE", folder: "upscale_models" },
];

export function baseFromName(name: string): string {
  const n = name.toLowerCase();
  if (n.includes("illustrious") || n.includes("sdxl")) return "SDXL";
  if (n.includes("flux")) return "Flux";
  if (n.includes("sd1.5") || n.includes("sd_1.5") || n.includes("sd15")) return "SD1.5";
  if (n.includes("pony")) return "Pony";
  return "未知";
}

// Sync the on-disk ComfyUI models into our registry. Returns count synced.
export async function syncModels(): Promise<number> {
  const seen = new Set<string>();
  for (const f of FOLDERS) {
    const files = await listModels(f.folder);
    for (const fileName of files) {
      seen.add(fileName);
      const name = fileName.replace(/\.[^.]+$/, "");
      await prisma.model.upsert({
        where: { fileName },
        create: {
          fileName,
          name,
          type: f.type,
          baseModel: baseFromName(name),
          isAvailable: true,
          source: "LOCAL",
        },
        update: {
          isAvailable: true,
          name,
          baseModel: baseFromName(name),
        },
      });
    }
  }
  if (seen.size) {
    await prisma.model.updateMany({
      where: { fileName: { notIn: Array.from(seen) }, source: "LOCAL" },
      data: { isAvailable: false },
    });
  }
  return seen.size;
}
