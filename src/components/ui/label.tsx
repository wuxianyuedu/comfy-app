"use client";

import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * 原生 `<label>` 的薄封装（shadcn 原版 + 项目色）。⚠️ `jsx-a11y/label-has-associated-control` 看不穿 `{...props}` 转发：`htmlFor` 经展开落到 `<label>`，规则只读 JSX 这一处，故整条组件化 label 族登记为方言（关闭该规则），不是本文件豁免。
 * 关联由 `FormField`（一次给全 `htmlFor` / `id`，`check-form-field-wiring.cjs` 在钩子里守）与 `FieldLabel`（base-ui `group-has-*` / `peer-*`）两处守。
 */
function Label({ className, ...props }: React.ComponentProps<"label">) {
  return (
    <label
      className={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        className,
      )}
      data-slot="label"
      {...props}
    />
  );
}

export { Label };
