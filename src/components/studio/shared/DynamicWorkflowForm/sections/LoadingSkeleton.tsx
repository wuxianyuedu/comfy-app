export function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={`skeleton-${index}`} className="space-y-1.5">
          <div className="h-2.5 w-16 animate-pulse rounded bg-white/6" />
          <div className="h-8 w-full animate-pulse rounded-lg bg-white/4" />
        </div>
      ))}
    </div>
  );
}
