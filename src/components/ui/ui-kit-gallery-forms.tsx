"use client";

import { useState } from "react";
import { Search, X } from "lucide-react";

import { Checkbox } from "~/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "~/components/ui/field";
import { FormField } from "~/components/ui/form-field";
import { Input } from "~/components/ui/input";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "~/components/ui/input-group";
import { Label } from "~/components/ui/label";
import { MultiModeSelect } from "~/components/ui/multi-mode-select";
import { NativeSelect, NativeSelectOption } from "~/components/ui/native-select";
import { NumberField } from "~/components/ui/number-field";
import { RadioGroup, RadioGroupItem } from "~/components/ui/radio-group";
import { RangeSlider } from "~/components/ui/range-slider";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Slider } from "~/components/ui/slider";
import { Switch } from "~/components/ui/switch";
import { Textarea } from "~/components/ui/textarea";
import { GalleryCell, GalleryGrid, GallerySection } from "~/components/ui/ui-kit-gallery-parts";

/**
 * 输入与选择一组的演示（ISSUE #3525）。
 * 输入控件的自有色最薄（`bg-transparent` + 描边），底色实际由调用面给 ——
 * 所以这一组在卡片面上看的是「描边 / 文字 / placeholder」三件，在 token 墙
 * 的 `bg-canvas-deep` 一票再看输入底那层。
 */

/** RangeSlider / NumberField 都是受控件，各包一层小壳持状态。 */
function RangeSliderDemo() {
  const [value, setValue] = useState(64);
  return (
    <RangeSlider aria-label="范围滑杆演示" max={100} min={0} onChange={setValue} value={value} />
  );
}

function NumberFieldDemo() {
  const [value, setValue] = useState(30);
  return <NumberField max={100} min={0} onChange={setValue} value={value} />;
}

export function FormsSection() {
  return (
    <GallerySection
      note="重点看：placeholder / 描边在两态下是否可见，禁用与 invalid 档是否仍能区分。"
      title="输入与选择"
    >
      <GalleryGrid>
        <GalleryCell label="Input">
          <Input placeholder="占位文字" />
          <Input defaultValue="已有内容" />
          <Input defaultValue="禁用" disabled />
          <Input aria-invalid defaultValue="校验失败" />
        </GalleryCell>
        <GalleryCell label="Textarea / Label">
          <Textarea placeholder="多行占位…" rows={2} />
          <Label htmlFor="kit-form-label">一个标签</Label>
        </GalleryCell>
        <GalleryCell label="NativeSelect / Select">
          <NativeSelect aria-label="格式选择演示">
            <NativeSelectOption value="png">PNG</NativeSelectOption>
            <NativeSelectOption value="jpg">JPG</NativeSelectOption>
          </NativeSelect>
          <Select aria-label="尺寸选择演示">
            <SelectTrigger className="w-36">
              <SelectValue placeholder="选一个比例" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="16-9">16:9</SelectItem>
              <SelectItem value="1-1">1:1</SelectItem>
              <SelectItem value="9-16">9:16</SelectItem>
            </SelectContent>
          </Select>
        </GalleryCell>
        <GalleryCell label="Checkbox / Switch">
          <span className="flex items-center gap-2">
            <Checkbox id="kit-cb-1" />
            <Label htmlFor="kit-cb-1">未选中</Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox defaultChecked id="kit-cb-2" />
            <Label htmlFor="kit-cb-2">选中</Label>
          </span>
          <span className="flex items-center gap-2">
            <Checkbox disabled id="kit-cb-3" />
            <Label htmlFor="kit-cb-3">禁用</Label>
          </span>
          <span className="flex items-center gap-2">
            <Switch aria-label="开关演示" />
            <Switch aria-label="开关演示开" defaultChecked />
            <Switch aria-label="开关演示禁用" disabled />
          </span>
        </GalleryCell>
        <GalleryCell label="RadioGroup">
          <RadioGroup defaultValue="a">
            <span className="flex items-center gap-2">
              <RadioGroupItem id="kit-radio-a" value="a" />
              <Label htmlFor="kit-radio-a">方案 A</Label>
            </span>
            <span className="flex items-center gap-2">
              <RadioGroupItem id="kit-radio-b" value="b" />
              <Label htmlFor="kit-radio-b">方案 B</Label>
            </span>
          </RadioGroup>
        </GalleryCell>
        <GalleryCell label="Slider / RangeSlider / NumberField">
          <Slider aria-label="滑杆演示" className="w-44" defaultValue={[36]} />
          <div className="w-44">
            <RangeSliderDemo />
          </div>
          <NumberFieldDemo />
        </GalleryCell>
        <GalleryCell label="InputGroup">
          <InputGroup className="w-60">
            <InputGroupAddon>
              <Search aria-hidden />
            </InputGroupAddon>
            <InputGroupInput placeholder="搜索工作流…" />
            <InputGroupAddon align="inline-end">
              <InputGroupButton aria-label="清除" size="icon-xs">
                <X aria-hidden />
              </InputGroupButton>
            </InputGroupAddon>
          </InputGroup>
        </GalleryCell>
        <GalleryCell label="Field（shadcn 表单骨架）">
          <Field>
            <FieldLabel htmlFor="kit-field-1">提示词强度</FieldLabel>
            <Input defaultValue="0.8" id="kit-field-1" />
            <FieldDescription>行内说明，走 aria-describedby 关联。</FieldDescription>
            <FieldError>数值需要在 0 到 1 之间。</FieldError>
          </Field>
        </GalleryCell>
        <GalleryCell label="FormField（自带标签/错误行）">
          {/* children 走 render-prop（§16.2.4.26）：普通节点形态下 a11y 接线落不到控件上，判据红。 */}
          <FormField error="这个字段必填" id="kit-form-field-1" label="负向提示词">
            {(a11y) => <Input {...a11y} placeholder="留空试试错误行" />}
          </FormField>
        </GalleryCell>
        <GalleryCell label="MultiModeSelect（工作流类型多选）">
          <MultiModeSelect
            defaultMode="T2I"
            modes={["T2I", "I2V", "R2I"]}
            onChange={() => undefined}
          />
        </GalleryCell>
      </GalleryGrid>
    </GallerySection>
  );
}
