"use client";

/**
 * `CharacterEditDialog` — 手工创建 / 编辑角色档案（ISSUE #5009）：
 * `characterLibrary.create` / `characterLibrary.update` 的界面消费方。
 * 新建（`initial` 为空）填名字 / 原型 / 性别 / 描述；编辑时名字锁定
 * （名字是 (用户, 名字) 唯一键，改名走单独诉求）；描述改动后标签由服务端重提。
 */
import { useState } from "react";

import { FieldLabel } from "~/components/ui/field";
import { Input } from "~/components/ui/input";
import { SelectChip } from "~/components/ui/select-chip";
import { Textarea } from "~/components/ui/textarea";

import { CharacterDialogShell } from "./CharacterDialogShell";

/** 手工建档的表单值（create / update 共用一份形状）。 */
export type CharacterFormValues = {
  archetype: string;
  description: string;
  gender: string;
  name: string;
};

export type CharacterEditDialogProps = {
  /** 编辑目标（详情行）；null / 缺省 = 新建。 */
  initial?: { archetype: string; description: string; gender: string; name: string } | null;
  onClose: () => void;
  /** 提交（create 或 update 由调用方按 initial 有无分流）；成功返回 true 以关弹窗。 */
  onSubmit: (values: CharacterFormValues) => Promise<boolean>;
  open: boolean;
  pending: boolean;
};

const GENDER_OPTIONS = ["女", "男", "不公开"] as const;

export function CharacterEditDialog({
  initial = null,
  onClose,
  onSubmit,
  open,
  pending,
}: CharacterEditDialogProps) {
  const [name, setName] = useState(initial?.name ?? "");
  const [archetype, setArchetype] = useState(initial?.archetype ?? "");
  const [gender, setGender] = useState(initial?.gender ?? GENDER_OPTIONS[0]);
  const [description, setDescription] = useState(initial?.description ?? "");
  const editing = initial !== null;

  const submitDisabled = pending || name.trim() === "" || description.trim() === "";

  return (
    <CharacterDialogShell
      description="描述越具体，提取出的特征标签越准，生成的立绘也越贴设定（外形 / 发色发型 / 瞳色 / 服饰 / 配饰 / 性格 / 能力 / 背景）。"
      onClose={onClose}
      onSubmit={() => {
        void onSubmit({
          archetype: archetype.trim(),
          description: description.trim(),
          gender,
          name: name.trim(),
        });
      }}
      open={open}
      pending={pending}
      submitDisabled={submitDisabled}
      submitLabel={editing ? "保存修改" : "创建角色"}
      title={editing ? `编辑角色「${initial?.name ?? ""}」` : "新建角色"}
      width="max-w-xl"
    >
      <div className="flex flex-col gap-2.5">
        <FieldLabel className="flex flex-col gap-1">
          <span className="text-ink-strong text-xs font-medium">名字</span>
          <Input
            aria-label="角色名"
            className="h-8 text-xs"
            disabled={editing}
            onChange={(event) => {
              setName(event.target.value);
            }}
            placeholder="如：樱井小樱"
            value={name}
          />
        </FieldLabel>
        <FieldLabel className="flex flex-col gap-1">
          <span className="text-ink-strong text-xs font-medium">原型 / 职业</span>
          <Input
            aria-label="原型或职业"
            className="h-8 text-xs"
            onChange={(event) => {
              setArchetype(event.target.value);
            }}
            placeholder="如：魔法少女 / 机甲驾驶员 / 巫女"
            value={archetype}
          />
        </FieldLabel>
        <div>
          <p className="text-ink-strong mb-1 text-xs font-medium">性别</p>
          <div className="flex flex-wrap gap-1.5">
            {GENDER_OPTIONS.map((option) => (
              <SelectChip
                key={option}
                onClick={() => {
                  setGender(option);
                }}
                selected={gender === option}
                shape="pill"
              >
                <span>{option}</span>
              </SelectChip>
            ))}
          </div>
        </div>
        <FieldLabel className="flex flex-col gap-1">
          <span className="text-ink-strong text-xs font-medium">详细描述</span>
          <Textarea
            aria-label="角色详细描述"
            className="custom-scrollbar min-h-28 text-xs"
            onChange={(event) => {
              setDescription(event.target.value);
            }}
            placeholder="例：银白色的长发梳成双马尾，金色的瞳孔，头顶猫耳；性格傲娇，穿水手服；能召唤星光护盾……"
            value={description}
          />
        </FieldLabel>
      </div>
    </CharacterDialogShell>
  );
}
