"use client";

// ── 「模式契约」编辑器：纯展示视图（规范 17 §17.2 第③层）。两个入口（工坊 / 工作流库）共用同一份表单；契约本身由
// `lib/workshop/model-mode-contract` 定义，展示分组与「已改」判据来自 `mode-contract-config`。
// ISSUE #1870：模式清单收成左侧树形页签（`ModeContractModeNav`，每类可折叠、默认展开），右栏 = 当前模式编辑区，两栏各自滚动。
// 三段口径说明收进可折叠的 `ui/disclosure`（默认收起）；选中态根因与修法见 `ui/select-chip.tsx` 文件头。

import {
  customInputKindOf,
  modeContractInputIdLabel,
  type ModeContract,
} from "~/lib/workshop/model-mode-contract";
import {
  contractModeLabel,
  customInputKindLabel,
  isModeContractCustomized,
} from "../mode-contract-config";
import type { ModeContractEditorController } from "../hooks/use-mode-contract-editor";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { FieldLabel } from "~/components/ui/field";
import { Checkbox } from "~/components/ui/checkbox";
import { Hint } from "~/components/ui/hint";
import { SelectMenu } from "~/components/ui/select-menu";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ContractInputCatalog } from "./ContractInputCatalog";
import { ModeContractModeNav } from "./ModeContractModeNav";

/** 输出类别的唯一取值清单（下拉选项与回写校验共用）。 */
const OUTPUT_OPTIONS: Array<ModeContract["output"]> = ["image", "video", "audio"];

/** 中文展示名 + 机器 id：界面上只写中文时，对不上代码 / 日志 / 配置里的 id。 */
function LabelWithId({ label, id }: { id: string; label: string }) {
  return (
    <>
      {label}
      <span className="text-muted-foreground/60 text-2xs ml-1 font-mono">{id}</span>
    </>
  );
}

export function ModeContractEditorView({
  controller,
}: {
  controller: ModeContractEditorController;
}) {
  const { mode, draft, stored } = controller;

  return (
    /* 两栏分屏：高度由外层 `WorkspaceFrame` 给，这里只是把它切成一左一右。
       `min-h-0` 让两栏都能在自己的滚动条里收缩（缺了它 flex 子项不会缩到内容以外）。 */
    <div className="flex h-full min-h-0 flex-col">
      {/* 页头走 `ui/page-header`（规范 03 §3.10 / 16 §16.2.4.73）。屏名已由页签给出，
          故按 ISSUE #1693 不传可见 `title`（退成 `sr-only`），契约口径说明挂成页眉
          右侧问号的悬浮「说明」（`viewHelp()`）。**不自绘关闭按钮**：「关」由页签承担。
          横向留白只在这一层（`px-4 sm:px-8`）；上内距收成 `pt-4 sm:pt-5`（ISSUE #1871：
          换 `WorkspaceFrame` 后外壳不再给内距，而页眉可见内容只有 sr-only 屏名）。 */}
      <div className="px-4 sm:px-8">
        <PageHeader className="pt-4 pb-3 sm:pt-5" srTitle={pageHeaderTitle("mode-contract")} />
      </div>

      <div className="flex min-h-0 flex-1 gap-6 px-4 pb-5 sm:px-8">
        {/* 左栏：分类树（自己的滚动条，不推正文）。 */}
        <nav
          aria-label="模式契约导航"
          className="custom-scrollbar w-48 shrink-0 overflow-y-auto pb-2"
        >
          {/* 树的可见名（也是这一屏的稳定内容锚点）—— 不与 `aria-label` 重复，
              后者说的是「这个导航区块叫什么」，这里说的是「选什么」。 */}
          <SectionLabel>选择要配置的模式</SectionLabel>
          <ModeContractModeNav
            activeMode={mode}
            onSelect={controller.selectMode}
            storedCustomized={(code) =>
              isModeContractCustomized(code, stored, controller.configured)
            }
          />
        </nav>

        {/* 右栏：当前模式的编辑区（自己的滚动条）。 */}
        <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-6">
          {draft ? (
            <ModeContractDraftPanel controller={controller} draft={draft} />
          ) : (
            <p className="text-muted-foreground pt-2 text-sm">
              从左侧选一条模式，配置它对外有哪些统一输入 / 输出。
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * 当前模式契约的编辑区 —— 输入口清单 + 参数库 + 输出类别 + 保存。
 * 抽成局部组件只为让 `ModeContractEditorView` 那层只剩「布局」（规范 §12.13）。
 */
function ModeContractDraftPanel({
  controller,
  draft,
}: {
  controller: ModeContractEditorController;
  draft: ModeContract;
}) {
  const { saving, saved, nextReferenceImageId } = controller;
  /* 「还原默认」只对真改过的模式出现：判据与左栏「已改」徽标同源（内容比较）。 */
  const customized = isModeContractCustomized(draft.mode, controller.stored, controller.configured);

  return (
    <section className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4">
      <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
        <h4 className="text-ink text-sm font-semibold">
          {contractModeLabel(draft.mode)} 的统一对外参数
          <span className="text-muted-foreground/60 text-2xs ml-1.5 font-mono">{draft.mode}</span>
        </h4>
      </div>

      {/* 口径说明：回答「这套规则怎么理解」，不是「这一步填什么」——
          因此默认收起，不占正文最靠上的位置（用户要看时一次展开看全）。 */}
      <Disclosure
        className="text-muted-foreground hover:text-ink text-xs"
        marker="chevron"
        panelClassName="text-muted-foreground mt-2 flex flex-col gap-2 text-xs"
        trigger={<>口径说明（必备口、尺寸的两类写法）</>}
      >
        <p>
          「必备」表示这条模式
          <span className="text-ink font-medium">少不得</span>
          这个口：本地工作流缺它的落点时，「工坊封装」会判为未配置
          （工坊驱动不起来）。哪些口必备按模式配，不写死在代码里 ——
          例如纯文生图把「提示词」勾必备、「负向提示词」不勾。
        </p>
        <p>
          「尺寸」是两类等价的写法，在尺寸选择器里任选其一：比例 + 分辨率（1k / 2k / 4k），或 比例 +
          百万像素 + 倍数（8 / 16 / 32 / 64）。选「分辨率」时工坊按场景尺寸表换算成「百万像素 +
          倍数」 再下发，两种写法落到工作流 / 远端接口上的效果一致。
        </p>
        <p>
          输入口（按顺序作为工坊对该模式的统一输入）—— 本地工作流在
          「画布节点」为每个口配落点，远端模型在「模型适配」里为每个口配 请求字段。
        </p>
      </Disclosure>

      <div>
        <SectionLabel hint="顺序即工坊对外的参数顺序">输入口</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {draft.inputs.map((input, i) => (
            <ContractInputRow
              controller={controller}
              draft={draft}
              index={i}
              input={input}
              key={input}
            />
          ))}
        </div>
      </div>

      {/* 参数库：全部预制口 + 自定义口（浏览 + 增删改都在这一块）。 */}
      <ContractInputCatalog
        customInputs={draft.customInputs ?? []}
        inputs={draft.inputs}
        onAddCustom={controller.addCustomInput}
        onAddPredefined={(type) => {
          controller.appendInput(
            type === "reference-image" ? (nextReferenceImageId ?? "reference-image") : type,
          );
        }}
        onRemoveCustom={controller.removeInput}
        onRenameCustom={controller.renameCustomInput}
      />

      <div>
        <SectionLabel>输出类别</SectionLabel>
        <SelectMenu
          aria-label="该模式的输出类别"
          className="text-xs"
          labels={{
            image: "图片（image）",
            video: "视频（video）",
            audio: "音频（audio）",
          }}
          onChange={(value) => {
            const output = OUTPUT_OPTIONS.find((item) => item === value);
            if (output !== undefined) {
              controller.setOutput(output);
            }
          }}
          options={OUTPUT_OPTIONS}
          value={draft.output}
        />
      </div>

      {!draft.inputs.includes("prompt") && (
        <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
          契约里没有「提示词」口 —— 工坊生成的提示词将无处可落， 保存后该模式无法被工坊驱动。
        </p>
      )}
      {!controller.hasAnyRequired && (
        <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
          一个必备口都没勾 —— 这条模式下任何工作流都会被判为「工坊可用」，
          缺任何口都不再提示。若你不是有意如此，给承载生成输入的那个口勾上。
        </p>
      )}
      {saved && (
        <p className="bg-success/10 text-success-strong rounded-lg px-3 py-2 text-xs">
          已保存 —— 工坊与工作流库读的是同一份注册表，另一处刷新后即生效。
          <span className="text-ink font-medium">
            {controller.savedKind === "project"
              ? "已写入项目默认（src/lib/workshop/mode-contract-defaults.json）：本进程立即生效，不必重启；提交后每个检出与桌包都是这一份。"
              : "改动只落在这台机器上，不会跟着代码走。"}
          </span>
        </p>
      )}
      {/* 失败要有用户可见出口（#3637）：此前保存失败只静默转圈，改动不生效也不提示。 */}
      {controller.saveError !== null && (
        <p className="bg-danger/10 text-danger-strong rounded-lg px-3 py-2 text-xs">
          保存失败：{controller.saveError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={saving}
          onClick={() => {
            void controller.save();
          }}
          variant="primary-solid"
        >
          {saving ? "保存中…" : "保存模式契约"}
        </Button>
        {customized && (
          <Button
            disabled={controller.resetting}
            onClick={() => {
              void controller.resetToDefault();
            }}
            variant="outline"
          >
            {controller.resetting ? "还原中…" : "还原默认"}
          </Button>
        )}
        {/* 只在开发检出出现：正式包没有源码可写，「项目默认」无从谈起（ISSUE #3396）。 */}
        {controller.projectDefaultEditable && (
          <Button
            disabled={controller.savingProjectDefaults}
            onClick={() => {
              void controller.saveAsProjectDefault();
            }}
            variant="outline"
          >
            {controller.savingProjectDefaults ? "写入中…" : "保存为项目默认（跟代码走）"}
          </Button>
        )}
        {/* 契约有两层，各存在一处（ISSUE #3625）：本机覆盖跟着这台机器走、项目默认
            入库跟代码走。徽标说清「保存落到哪儿」，迁移时才不会只搬走一半。 */}
        <DataLocationBadge id="mode-contract-local" />
        <DataLocationBadge id="mode-contract-project" />
      </div>
    </section>
  );
}

/** 输入口清单里的一行：序号 + 名称 + 调序 / 必备 / 移除。 */
function ContractInputRow({
  controller,
  draft,
  input,
  index,
}: {
  controller: ModeContractEditorController;
  draft: ModeContract;
  index: number;
  input: ModeContract["inputs"][number];
}) {
  const label = modeContractInputIdLabel(input, draft.customInputs);
  const kind = customInputKindOf(input);

  return (
    <div className="border-border bg-bg flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="text-ink min-w-0 text-sm">
        <span className="text-muted-foreground mr-1 tabular-nums">{index + 1}.</span>
        <LabelWithId id={input} label={label} />
        {kind && (
          <span className="text-muted-foreground bg-subtle border-border-strong text-2xs ml-2 rounded border px-1.5 py-0.5">
            {customInputKindLabel(kind)}
          </span>
        )}
      </span>
      <span className="flex shrink-0 items-center gap-1.5">
        {/* 顺序**就是**工坊对外的参数顺序（序号即数组下标），
            所以调序改的是契约本身，不是界面偏好。 */}
        <span className="flex items-center gap-0.5">
          <Button
            aria-label={`上移 ${label}`}
            className="text-muted-foreground/70 hover:text-ink disabled:opacity-25"
            disabled={index === 0}
            onClick={() => {
              controller.moveInput(input, -1);
            }}
            size="icon-sm"
            variant="ghost"
          >
            ↑
          </Button>
          <Button
            aria-label={`下移 ${label}`}
            className="text-muted-foreground/70 hover:text-ink disabled:opacity-25"
            disabled={index === draft.inputs.length - 1}
            onClick={() => {
              controller.moveInput(input, 1);
            }}
            size="icon-sm"
            variant="ghost"
          >
            ↓
          </Button>
        </span>
        <FieldLabel
          className="text-muted-foreground flex cursor-pointer items-center gap-1.5 text-xs"
          title="必备口：本地工作流缺它的落点时，工坊里驱动不起来"
        >
          <Checkbox
            checked={controller.isRequired(input)}
            className="size-4"
            onCheckedChange={() => {
              controller.toggleRequired(input);
            }}
          />
          必备
        </FieldLabel>
        {/* 最后一口禁删的说明走 Hint（P82：不用原生 title=）；禁用态弹不出
            原因，按组件口径挂 wrap 锚点。 */}
        <Hint
          label={
            draft.inputs.length <= 1
              ? "至少保留一个输入口：空清单的契约保存不了，工坊也驱动不起来"
              : undefined
          }
          wrap
        >
          <Button
            aria-label={`移除 ${label}`}
            className="text-muted-foreground/60 hover:text-danger-strong disabled:opacity-25"
            disabled={draft.inputs.length <= 1}
            onClick={() => {
              controller.removeInput(input);
            }}
            size="icon-sm"
            variant="ghost"
          >
            ✕
          </Button>
        </Hint>
      </span>
    </div>
  );
}
