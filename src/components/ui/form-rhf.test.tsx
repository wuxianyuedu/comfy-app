/** form-rhf 的两处 Context value 引用稳定性（E4）：`FormField` / `FormItem`
 * 重渲时 value 不该每次换引用，否则字段下所有消费者被连带重渲。用读同一
 * context 的探针记录 value 引用（钉身份，不是文案，规范 11.2）。 */
import { act, cleanup, render, screen } from "@testing-library/react";
import { useContext, useState } from "react";
import { useForm } from "react-hook-form";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Form, FormField, FormItem, FormFieldContext, FormItemContext } from "./form-rhf";

afterEach(cleanup);

const fieldValues: Array<unknown> = [];
const itemValues: Array<unknown> = [];
let bump: () => void = vi.fn();

function FieldProbe() {
  fieldValues.push(useContext(FormFieldContext));
  return <span data-testid="field-probe">字段</span>;
}
function ItemProbe() {
  itemValues.push(useContext(FormItemContext));
  return <span data-testid="item-probe">项</span>;
}

function Wrapper() {
  const [, setTick] = useState(0);
  bump = () => {
    setTick((value) => value + 1);
  };
  const form = useForm<{ name: string }>({ defaultValues: { name: "甲" } });
  return (
    <Form {...form}>
      <FormField
        control={form.control}
        name="name"
        render={() => (
          <FormItem>
            <FieldProbe />
            <ItemProbe />
          </FormItem>
        )}
      />
    </Form>
  );
}

describe("form-rhf 的 Context value", () => {
  it("FormField / FormItem 重渲不改变 value 引用", () => {
    fieldValues.length = 0;
    itemValues.length = 0;
    render(<Wrapper />);
    act(() => {
      bump();
    });

    expect(screen.getByTestId("field-probe")).toBeTruthy();
    expect(screen.getByTestId("item-probe")).toBeTruthy();
    expect(fieldValues.length).toBeGreaterThanOrEqual(2);
    expect(itemValues.length).toBeGreaterThanOrEqual(2);
    for (const value of fieldValues.slice(1)) {
      expect(value).toBe(fieldValues[0]);
    }
    for (const value of itemValues.slice(1)) {
      expect(value).toBe(itemValues[0]);
    }
  });
});
