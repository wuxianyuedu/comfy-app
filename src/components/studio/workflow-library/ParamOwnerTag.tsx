"use client";

import { Hint } from "~/components/ui/hint";

/* 参数行尾部的只读徽标：标出该行被哪个对外参数落到；落点事实只在表单行标一次，
 * 卡片不重复画线。没有任何对外参数落到这一行时不渲染。 */

export function ParamOwnerTag({ label }: { label?: string }) {
  if (label === undefined || label === "") {
    return null;
  }
  return (
    <Hint label={`该参数是对外参数「${label}」的落点`}>
      <span
        className="border-primary/30 bg-primary/10 text-primary-strong shrink-0 rounded-[3px] border px-1.5 py-px text-[9.5px] font-medium"
        data-testid="wflib-param-owner"
      >
        {label}
      </span>
    </Hint>
  );
}
