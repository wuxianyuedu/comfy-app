import type { Meta, StoryObj } from "@storybook/nextjs";
import { useForm } from "react-hook-form";

import { Button } from "~/components/ui/button";
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "~/components/ui/form-rhf";
import { Input } from "~/components/ui/input";

/**
 * `ui/form-rhf` 是 shadcn 的 `form.tsx`（改名为 `form-rhf` 以免与
 * `ui/form-field` 的 `FormField` 撞名，见其文件头）。
 *
 * 它是这一批里**唯一真的需要外部状态**的一个：整族都读 RHF 的
 * `FormProvider` 上下文（`useFormContext()` / `getFieldState()`），
 * 而 `controller` / `register` 都必须挂在一个**真 `useForm()` 实例**上。
 * 所以它的「数据源」不是一份数据，而是**库自己的表单状态** ——
 * 注入层在这里能做的只有一件事：**别造假实例**（`useForm()` 是真的，
 * 校验走真的 resolver，错误由真交互触发），而不是手捏一个 `{ errors: {...} }`。
 *
 * ⚠️ **这是「已装、代码保留以便未来接入 RHF」的预留件**（规范 16 §16.2.4.8）：
 * 当前 `src` 内 **0 消费点**，所以这些 story 的定位是「接入那天的样板」，
 * 不是「某个页面长这样」。这一点写在这里免得被误读成「仓库已经在用 RHF」。
 */
type FormValues = {
  name: string;
  port: string;
};

/** 一份真校验：端口必须是数字。校验器是真的（不是手捏的 `errors` 对象）。 */
function validatePort(value: string): string | true {
  if (value.trim() === "") return "端口不能为空";
  if (!/^\d+$/.test(value.trim())) return "端口只能是数字";
  return true;
}

/**
 * 这一族 story 的 Args：两个字段的**初值**（story 自己起一个 `useForm()`）。
 *
 * 为什么 `component` 不直接写 `Form`：`Form` 是 `FormProvider`（泛型 Provider），
 * 它的 props 是 `{ children, ...formMethods }` —— 把它当 component 会让 Args
 * 变成「一整套 form methods」，而那不是人在画布上调的东西。适配件把「两个初值」
 * 变成 Args 的形状，`useForm()` 实例留在 story 内部。
 */
type StoryArgs = {
  /** 名称字段初值。 */
  defaultName: string;
  /** 端口字段初值。 */
  defaultPort: string;
};

function RhfFormSample({ defaultName, defaultPort }: StoryArgs) {
  const form = useForm<FormValues>({
    defaultValues: { name: defaultName, port: defaultPort },
  });
  return (
    <Form {...form}>
      <form className="flex w-96 flex-col gap-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>工作流名称</FormLabel>
              <FormControl>
                <Input placeholder="例如 角色一致性 · 三视图" {...field} />
              </FormControl>
              <FormDescription>
                同名会被覆盖，保存在工作流库里。
              </FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="port"
          rules={{ validate: validatePort }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>应用端口</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

/**
 * 错误态的那一个样本：**必须是一个组件**，不能写进 `render` 里 ——
 * `useForm()` 是 hook，而 `render` 的参数位置不是 React 组件（ESLint 的
 * `react-hooks/rules-of-hooks` 会把这一条当场拦下，这条报错是对的：
 * 在那种位置调 hook 拿到的实例，生命周期与 React 树对不上）。
 */
function InvalidFormSample() {
  const form = useForm<FormValues>({
    defaultValues: { name: "", port: "abc" },
  });
  return (
    <Form {...form}>
      <form
        className="flex w-96 flex-col gap-5"
        onSubmit={(event) => {
          void form.handleSubmit(() => undefined)(event);
        }}
      >
        <FormField
          control={form.control}
          name="name"
          rules={{ required: "名称不能为空" }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>工作流名称</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )}
        />
        <FormField
          control={form.control}
          name="port"
          rules={{ validate: validatePort }}
          render={({ field }) => (
            <FormItem>
              <FormLabel>应用端口</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormDescription>解析链端口，见启动链路的口径。</FormDescription>
              <FormMessage />
            </FormItem>
          )}
        />
        <Button type="submit" className="w-fit">
          提交
        </Button>
      </form>
    </Form>
  );
}

/** 服务端错误文案那一条的样本（同样必须是组件）。 */
function ServerMessageSample() {
  const form = useForm<FormValues>({
    defaultValues: { name: "角色一致性", port: "3311" },
  });
  return (
    <Form {...form}>
      <form className="flex w-96 flex-col gap-5">
        <FormField
          control={form.control}
          name="name"
          render={({ field }) => (
            <FormItem>
              <FormLabel>工作流名称</FormLabel>
              <FormControl>
                <Input {...field} />
              </FormControl>
              <FormMessage>服务端：名称已被占用</FormMessage>
            </FormItem>
          )}
        />
      </form>
    </Form>
  );
}

const meta = {
  title: "UI/FormRHF",
  component: RhfFormSample,
  parameters: {
    docs: {
      description: {
        component:
          "RHF 绑定层的预留件（规范 16 §16.2.4.8）：src 内 0 消费点，story 的作用是接入那天的样板。",
      },
    },
  },
  args: { defaultPort: "3311", defaultName: "角色一致性" },
  argTypes: {
    defaultPort: { control: { type: "text" }, description: "端口字段初值" },
    defaultName: { control: { type: "text" }, description: "名称字段初值" },
  },
} satisfies Meta<StoryArgs>;

export default meta;

type Story = StoryObj<typeof meta>;

/** 常态：两个字段都合法，看不见错误行。 */
export const Default: Story = {};

/**
 * **错误态，由真交互触发**：点提交（或把端口改成非数字）后 RHF 走真 resolver、
 * `FormMessage` 拿到真 `fieldState.error`，`FormLabel` 随之变红、
 * 控件拿到 `aria-invalid` 与拼好的 `aria-describedby`。
 *
 * 这一条刻意**不在初始值里塞错误** —— 塞进去的话验的是「渲染错误长什么样」，
 * 而不是「校验真的接上了没有」。后者才是这一族存在的意义。
 */
export const ValidationErrors: Story = {
  parameters: {
    docs: { description: { story: "点「提交」看错误行怎么出来。" } },
  },
  render: () => <InvalidFormSample />,
};

/**
 * `FormMessage` 的 `children` 通道：没有 `fieldState.error` 时它渲染 `children`。
 *
 * 为什么这条值得一个 story：它**不是**「错误文案」，而是「后端回来的那条报错」
 *（服务端错误没有 RHF 字段错误可用）。两者同形但来源不同，混用会让
 * 「这次提交为什么失败」变得说不清。
 */
export const ServerMessage: Story = {
  render: () => <ServerMessageSample />,
};
