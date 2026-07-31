export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center bg-bg">
      <div className="flex flex-col items-center gap-4 text-muted">
        <span className="h-9 w-9 animate-spin rounded-full border-2 border-border border-t-primary" />
        <p className="text-sm">加载中…</p>
      </div>
    </div>
  );
}
