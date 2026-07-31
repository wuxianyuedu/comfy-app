import { Navbar } from "@/components/layout/navbar";

export default function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <Navbar />
      <main className="mx-auto w-full max-w-[1400px] px-4 pt-6 sm:px-6 lg:px-8">
        {children}
      </main>
      <footer className="mx-auto mt-16 w-full max-w-[1400px] border-t border-border px-4 py-10 text-sm text-muted sm:px-6 lg:px-8">
        <div className="flex flex-col items-start justify-between gap-4 sm:flex-row sm:items-center">
          <p>Comfy-APP · 基于 ComfyUI 的本地 AI 创作平台</p>
          <p className="text-muted">仅供本地创作使用 · 模型与算力来自本机 ComfyUI</p>
        </div>
      </footer>
    </>
  );
}
