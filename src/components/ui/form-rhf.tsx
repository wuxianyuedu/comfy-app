"use client";

/**
 * `form-rhf.tsx` —— react-hook-form（RHF）绑定层 · shadcn `form.tsx` 改名而来。
 *
 * **为何改名**：shadcn 官方装过来时叫 `ui/form.tsx` · 但项目早在本仓库自立的
 * `ui/form-field.tsx` 已经导出了一个同名的 `FormField`（是 `ui/field` 的薄
 * 封装 · 补 `htmlFor` / `aria-describedby` / 错误行三件套 · 见 §16.2.4.26）。
 * 两个 `FormField` 撞名 · 只要有人 import 错模块就会静默用错实现。改名
 * `form-rhf.tsx` 消除遮蔽风险 · 也一眼看出"这是 RHF 那一族"。
 *
 * **为何不删**：`docs/standards/16-shadcn-ui与表单校验.md` §16.2.4.8 与 §16.5
 * 已经把"不接入 RHF · 字段级校验住 `src/lib/<domain>/*-schema.ts` · 集合级
 * 留 controller"作为决策登记 · 并把这份 `form.tsx` 记为"已装、代码保留以便
 * 未来若接入 RHF 时不用重新装"的状态。当前 src 内 **0 消费点**（本会话
 * 摸底确认 · `grep -rn 'ui/form"' src tests` 空返回）· 是**为将来预留**、
 * 不是死代码。真接入 RHF 那天 · 从这里起手 · §16.2.4.8 的叙事也随之更新。
 */
import * as React from "react";
import {
  Controller,
  type ControllerProps,
  type FieldPath,
  type FieldValues,
  FormProvider,
  useFormContext,
} from "react-hook-form";

import { cn } from "~/lib/utils";
import { Label } from "~/components/ui/label";

const Form = FormProvider;

type FormFieldContextValue<
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
> = {
  name: TName;
};

const FormFieldContext = React.createContext<FormFieldContextValue>(
  {} as FormFieldContextValue,
);

const FormField = <
  TFieldValues extends FieldValues = FieldValues,
  TName extends FieldPath<TFieldValues> = FieldPath<TFieldValues>,
>({
  ...props
}: ControllerProps<TFieldValues, TName>) => {
  return (
    <FormFieldContext.Provider value={{ name: props.name }}>
      <Controller {...props} />
    </FormFieldContext.Provider>
  );
};

type FormItemContextValue = {
  id: string;
};

const FormItemContext = React.createContext<FormItemContextValue>(
  {} as FormItemContextValue,
);

function useFormField() {
  const fieldContext = React.useContext(FormFieldContext);
  const itemContext = React.useContext(FormItemContext);
  const { getFieldState, formState } = useFormContext();

  const fieldState = getFieldState(fieldContext.name, formState);

  if (!fieldContext) {
    throw new Error("useFormField should be used within <FormField>");
  }

  const { id } = itemContext;

  return {
    id,
    name: fieldContext.name,
    formItemId: `${id}-form-item`,
    formDescriptionId: `${id}-form-item-description`,
    formMessageId: `${id}-form-item-message`,
    ...fieldState,
  };
}

function FormItem({ className, ...props }: React.ComponentProps<"div">) {
  const id = React.useId();

  return (
    <FormItemContext.Provider value={{ id }}>
      <div
        data-slot="form-item"
        className={cn("grid gap-2", className)}
        {...props}
      />
    </FormItemContext.Provider>
  );
}

function FormLabel({
  className,
  ...props
}: React.ComponentProps<typeof Label>) {
  const { error, formItemId } = useFormField();

  return (
    <Label
      data-slot="form-item-label"
      className={cn(error && "text-destructive", className)}
      htmlFor={formItemId}
      {...props}
    />
  );
}

function FormControl(props: React.PropsWithChildren) {
  const { error, formItemId, formDescriptionId, formMessageId } =
    useFormField();

  const child = React.Children.only(props.children) as React.ReactElement<
    Record<string, unknown>
  >;
  return React.cloneElement(child, {
    id: formItemId,
    "aria-describedby": !error
      ? `${formDescriptionId}`
      : `${formDescriptionId} ${formMessageId}`,
    "aria-invalid": !!error,
  });
}

function FormDescription({ className, ...props }: React.ComponentProps<"p">) {
  const { formDescriptionId } = useFormField();

  return (
    <p
      data-slot="form-item-description"
      id={formDescriptionId}
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  );
}

function FormMessage({ className, ...props }: React.ComponentProps<"p">) {
  const { error, formMessageId } = useFormField();
  const body = error ? String(error?.message ?? "") : props.children;

  if (!body) {
    return null;
  }

  return (
    <p
      data-slot="form-item-message"
      id={formMessageId}
      className={cn("text-destructive text-sm", className)}
      {...props}
    >
      {body}
    </p>
  );
}

export {
  useFormField,
  Form,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  FormField,
};
