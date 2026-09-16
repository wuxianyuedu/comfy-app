export function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      {[0, 1, 2].map((index) => (
        <div key={`skeleton-${index}`} className="space-y-1.5">
          <div className="bg-subtle h-2.5 w-16 animate-pulse rounded" />
          <div className="bg-subtle h-8 w-full animate-pulse rounded-lg" />
        </div>
      ))}
    </div>
  );
}
