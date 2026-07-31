import { ModelLibrary } from "@/components/model/model-library";
import { ButtonLink } from "@/components/ui/button";

export const metadata = { title: "模型库 · Comfy-APP" };

export default function ModelsPage() {
  return (
    <div className="py-6">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">模型库</h1>
          <p className="mt-1 text-sm text-muted">
            直接调用本机 ComfyUI 已安装的模型，文件名即契约，所见即所得。
          </p>
        </div>
        <ButtonLink href="/create" size="sm">
          去创作
        </ButtonLink>
      </div>
      <ModelLibrary />
    </div>
  );
}
