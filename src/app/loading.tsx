export default function Loading() {
  return (
    <div className="flex h-screen w-screen items-center justify-center bg-(--color-canvas)">
      <div className="flex flex-col items-center gap-4 text-gray-400">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-violet-500/20 border-t-violet-500" />
        <p className="text-sm">加载中…</p>
      </div>
    </div>
  );
}
