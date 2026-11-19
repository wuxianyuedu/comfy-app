"use client";

import { useId, type ReactNode } from "react";

import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { cn } from "~/lib/utils";

/**
 * FormField —— 「标签 + 控件 + 校验错误」这一行的唯一出口（规范 16 §16.2.4.26），`~/components/ui/field` 官方基元的薄封装。收口时全库 15 处各写一份，三件套一样但度量语言四套，且**没有一处**把 `<label>` 与控件关联、**没有一处**把错误文案 id 关联给控件、错误行位置也不稳定。
 * 本组件一次给全：`htmlFor` 由 `id` 派生（`useId` 兜底），错误态自动上 `aria-invalid` 与 `aria-describedby`（由 `error` 存在性决定），错误行有稳定 id（与 `aria-describedby` 同源）；保留项目色板与必填 `*`，**外部 API 完全不变**。
 * 不做的事：不接管控件（`children` 可为任意节点，要 ARIA 用 render-prop）；不判校验（字段级规则住 `~/lib/<domain>/*-schema.ts`，集合级住 controller）；不管布局（整行外边距由调用处 `className` 给）。
 */
export type FormFieldA11y = {
  /** 有错误时才有：错误行的 `id`。 */
  "aria-describedby"?: string;
  /** 有错误时才有：`true`。 */
  "aria-invalid"?: true;
  /** 控件的 `id`（给 `htmlFor` 用）。 */
  id: string;
};

export function FormField({
  label,
  id,
  error,
  hint,
  required,
  children,
  className,
  labelClassName,
  errorClassName,
}: {
  /**
   * 控件。给函数时收到 `{ id, aria-invalid, aria-describedby }`。
   * **可省略** —— 行编辑器这类「标签 + 说明文字，控件在别处」的落点
   * 只用一个带 `hint` 的标签行即可（不省略就得写 `children={<></>}`）。
   */
  children?: ReactNode | ((a11y: FormFieldA11y) => ReactNode);
  className?: string;
  /** 字段级错误文案。给了才渲染错误行并自动上 ARIA。 */
  error?: string | null;
  errorClassName?: string;
  /** 常驻说明（`<p>` 挂在控件下方），位于错误行**之上** —— 错误更靠下、更靠
   *  近下一次交互，符合「先解释、再报错」的阅读顺序。 */
  hint?: ReactNode;
  /**
   * 控件的 `id`。不给则由 `useId` 生成 —— 生成的那份只在**没有** `htmlFor`
   * 关联价值时才可接受（如标签行只是装饰），多数调用处应显式给一个稳定 id
   * （E2E 与 Playwright 也按它定位）。
   */
  id?: string;
  /** 标签文案。给 `null` 时不渲染标签行（但**要**保留 `aria-label` 就自己加）。 */
  label: ReactNode;
  labelClassName?: string;
  /** 是否必填：标签右侧给一个 `*`（无错误时的静态标记）。 */
  required?: boolean;
}) {
  /* `useId` 不能有条件调用，所以无条件取一次；`id` 给了就用给的。
   * `useId` 的产物含 `:`（React 19 起是 `«r0»` 之类），直接当 DOM id 是合法的，
   * 但不能拿去做 CSS 选择器 —— 本组件只把它交给 `htmlFor` / `aria-*`。 */
  const autoId = useId();
  const fieldId = id ?? autoId;
  const errorId =
    error !== undefined && error !== null && error !== "" ? `${fieldId}-error` : undefined;

  const a11y: FormFieldA11y = {
    id: fieldId,
    /* SAFETY: 类型断言已复核 */
    ...(error !== undefined && error !== null && error !== ""
      ? { "aria-invalid": true as const }
      : {}),
    ...(errorId === undefined ? {} : { "aria-describedby": errorId }),
  };

  /* `htmlFor` 只在**真的接得上**时才给：`children` 是 render-prop 时，`fieldId` 由调用处 spread 到控件上，箭头指得到；否则标签点不动、读屏器读出孤立标签文本，比不给 `htmlFor` 更坏。
   * 这一档的理由是「标签行 + 说明文字，控件在别处」（如 `FilmStudioPropertyPanel` 的只读展示行、`LLMContext` 的按钮组：多个按钮没有一个能被 `htmlFor` 指到）；这类场景的 `label` 是**小标题**不是字段标签，语义上也不该带 `htmlFor`。 */
  const wiresControl = typeof children === "function";

  return (
    <Field className={cn("min-w-0 gap-0", className)}>
      {label !== null && label !== undefined && (
        <FieldLabel
          {...(wiresControl ? { htmlFor: fieldId } : {})}
          className={cn("text-ink/80 mb-1.5 block w-full text-sm font-medium", labelClassName)}
        >
          {label}
          {required === true && (
            <span aria-hidden className="text-danger-strong ml-0.5">
              *
            </span>
          )}
        </FieldLabel>
      )}
      {typeof children === "function" ? children(a11y) : (children ?? null)}
      {hint !== null && hint !== undefined && (
        <FieldDescription className="text-2xs leading-relaxed">{hint}</FieldDescription>
      )}
      {error !== null && error !== undefined && error !== "" && (
        <FieldError
          className={cn("text-danger-strong text-2xs mt-1 font-normal", errorClassName)}
          id={errorId}
        >
          {error}
        </FieldError>
      )}
    </Field>
  );
}
