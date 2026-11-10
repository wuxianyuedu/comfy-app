import * as React from "react";
import { Input as InputPrimitive } from "@base-ui/react/input";

import { cn } from "~/lib/utils";

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  /* focus 只换 border、不出 ring（docs/DESIGN.md「输入」行的签字口径）；aria-invalid 的 ring 是错误信号，保留。
   *
   * ⚠️ **基类不许带 `dark:bg-*` 底色**（ISSUE #3519）：变体规则在产物里排在基础
   * utility **之后**、特异性又相同（`:where()` 不计权）⇒ 它会**压掉调用点写的
   * 底色**。此前基类带 `dark:bg-input/30`，于是深色主题下**所有**输入框的底色
   * 都是「30% 描边色叠在容器上」：设置页写在 className 里的 `bg-surface-2` 从未
   * 生效，卡片上的字段底色与卡片只差 1.04:1、卡片内一行里的数字框底色与行底
   * **逐像素相同**（框直接消失）。底色归调用点所有，基类只给「无底色」这一档
   * （`bg-transparent`）+ 描边；要填色的调用点写 `bg-surface-2`（那一档已改到
   * 阶梯第三级，见 `globals.css` 的注释）。
   * 禁用态的 `disabled:bg-*` 是**状态**变体、不参与常态底色，保留。 */
  return (
    <InputPrimitive
      className={cn(
        "border-input file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring disabled:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 h-8 w-full min-w-0 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 aria-invalid:ring-3 md:text-sm",
        className,
      )}
      data-slot="input"
      type={type}
      {...props}
    />
  );
}

export { Input };
