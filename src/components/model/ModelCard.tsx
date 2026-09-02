import Link from "next/link";

export type ModelCardData = {
  id: string;
  name: string;
  type: string;
  baseModel?: string;
  cover?: string;
  uses?: number;
  likes?: number;
};

const GRADIENTS = [
  "linear-gradient(135deg,#7C5CFC 0%,#FF5CA8 100%)",
  "linear-gradient(135deg,#5B8DEF 0%,#7C5CFC 100%)",
  "linear-gradient(135deg,#22C55E 0%,#0EA5E9 100%)",
  "linear-gradient(135deg,#F59E0B 0%,#FF5CA8 100%)",
  "linear-gradient(135deg,#EC4899 0%,#8B5CF6 100%)",
  "linear-gradient(135deg,#0EA5E9 0%,#22D3EE 100%)",
];

function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h;
}

const TYPE_LABEL: Record<string, string> = {
  CHECKPOINT: "大模型",
  LORA: "LoRA",
  CONTROLNET: "控制网",
  VAE: "VAE",
  EMBEDDING: "嵌入",
  UPSCALE: "放大",
};

export function ModelCard({ model }: { model: ModelCardData }) {
  const grad = GRADIENTS[hash(model.id) % GRADIENTS.length];
  return (
    <Link href={`/models/${model.id}`} className="group block">
      <div className="relative overflow-hidden rounded-xl border border-border bg-surface transition-shadow group-hover:shadow-[0_8px_30px_rgba(20,20,40,0.10)]">
        <div className="relative aspect-[4/3] w-full overflow-hidden">
          {model.cover ? (
             
            <img src={model.cover} alt={model.name} className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" />
          ) : (
            <div className="h-full w-full transition-transform duration-300 group-hover:scale-105" style={{ background: grad }} />
          )}
          <span className="absolute left-2 top-2 rounded-md bg-black/45 px-2 py-0.5 text-xs font-medium text-white backdrop-blur">
            {TYPE_LABEL[model.type] ?? model.type}
          </span>
        </div>
        <div className="p-3">
          <p className="u-title truncate">{model.name}</p>
          <div className="mt-1 flex items-center justify-between text-xs text-muted-foreground">
            <span>{model.baseModel ?? "SDXL"}</span>
            <span>
              {model.uses ? `${model.uses} 用` : ""}
              {model.likes ? ` · ${model.likes} 赞` : ""}
            </span>
          </div>
        </div>
      </div>
    </Link>
  );
}
