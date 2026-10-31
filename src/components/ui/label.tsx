"use client";

import * as React from "react";

import { cn } from "~/lib/utils";

/**
 * 原生 `<label>` 的薄封装（shadcn 原版 + 项目色）。
 *
 * ⚠️ **`jsx-a11y/label-has-associated-control` 看不穿 `{...props}` 转发**：
 * `htmlFor` 由调用处传进来、经展开落到 `<label>` 上，而规则只读这一处 JSX
 * —— 它看到一个**没有 `htmlFor`、也没有嵌套控件**的 `<label>`（实测：加
 * `labelComponents` 让它认这个组件名之后，报的就是「A form label must be
 * associated with a control」，`assert` 给 `either` / `htmlFor` 都一样）。
 *
 * 也就是说：**这条规则数不到「组件化的 label」这一档**。本仓的关联由两处守：
 *   · `~/components/ui/form-field` 的 `FormField` —— 一次给全 `htmlFor` / `id`
 *     （`children` 是 render-prop 时把 a11y 落到控件上，判据
 *     `check-form-field-wiring.cjs` 在钩子里守，见规范 16 §16.2.4.26）；
 *   · `~/components/ui/field` 的 `FieldLabel` —— Base UI 的
 *     `group-has-*` / `peer-*` 语义（复选框那类「整行可点」的形态由
 *     `ui/checkbox` 的 children 语义承担）。
 * 所以这一处在台账里登记为**方言**（关掉这一条规则）而不是「本文件豁免」：
 * 豁免的范围是**整个组件化 label 族**，不是这一个文件。
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
