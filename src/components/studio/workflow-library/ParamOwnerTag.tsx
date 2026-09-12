"use client";

/* 宿主卡片里那一行参数尾部的只读徽标：标出它被哪个对外参数落到。
 *
 * 它与左侧的对外参数卡片互为两端 —— 卡片说「这个对外参数由哪些端口组成」，
 * 徽标说「这一行属于哪个对外参数」。同一份落点事实只在表单行这侧标一次，
 * 卡片不再重复画线，两处就不会表达同一件事两次。
 *
 * 没有任何对外参数落到这一行时不渲染（绝大多数行都是这种情况）。 */

export function ParamOwnerTag({ label }: { label?: string }) {
  if (!label) return null;
  return (
    <span
      className="shrink-0 rounded-[3px] border border-violet-400/30 bg-violet-500/10 px-1.5 py-px text-[9.5px] font-medium text-violet-300"
      title={`该参数是对外参数「${label}」的落点`}
      data-testid="wflib-param-owner"
    >
      {label}
    </span>
  );
}
