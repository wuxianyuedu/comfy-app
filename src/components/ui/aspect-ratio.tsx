import { cn } from "~/lib/utils";

function AspectRatio({
  ratio,
  className,
  ...props
}: React.ComponentProps<"div"> & { ratio: number }) {
  return (
    <div
      className={cn("relative aspect-(--ratio)", className)}
      data-slot="aspect-ratio"
      style={
        /* SAFETY: 类型断言已复核 */ {
          "--ratio": ratio,
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { AspectRatio };
