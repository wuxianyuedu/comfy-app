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
  contractInputTypeInfo,
  contractModeLabel,
  customInputKindLabel,
  isModeContractCustomized,
} from "../mode-contract-config";
import type { ModeContractEditorController } from "../hooks/use-mode-contract-editor";
import { Button } from "~/components/ui/button";
import { Disclosure } from "~/components/ui/disclosure";
import { Hint } from "~/components/ui/hint";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { DataLocationBadge } from "~/components/data-location/DataLocationBadge";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ContractInputCatalog } from "./ContractInputCatalog";
import { ContractRequiredToggle } from "../ContractRequiredBadge";
import { ModeContractModeNav } from "./ModeContractModeNav";

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
            unsavedMode={controller.dirty ? mode : null}
          />
        </nav>

        {/* 右栏：当前模式的编辑区（自己的滚动条）。 */}
        <div className="custom-scrollbar min-h-0 min-w-0 flex-1 overflow-y-auto pb-6">
          {draft ? (
            <ModeContractDraftPanel controller={controller} draft={draft} />
          ) : (
            <p className="text-muted-foreground pt-2 text-sm">
              从左侧选一条模式，配置它对外有哪些统一输入。
            </p>
          )}
        </div>
      </div>

      {/* 修改即自动保存（#3949 需求 1）：草稿有改动就自动落本机覆盖，
          不再有「保存模式契约」按钮与切换确认弹窗。 */}
    </div>
  );
}

/**
 * 当前模式契约的编辑区 —— 输入口清单 + 参数库 + 保存。
 * 抽成局部组件只为让 `ModeContractEditorView` 那层只剩「布局」（规范 §12.13）。
 */
function ModeContractDraftPanel({
  controller,
  draft,
}: {
  controller: ModeContractEditorController;
  draft: ModeContract;
}) {
  const { nextReferenceImageId } = controller;
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
          「必填」表示这条模式
          <span className="text-ink font-medium">少不得</span>
          这个口：本地工作流缺它的落点时，「工坊封装」会判为未配置
          （工坊驱动不起来）。哪些口必填按模式配，不写死在代码里 ——
          例如纯文生图把「提示词」标成必填、「负向提示词」标成可选（点口名旁的徽标就能翻面）。
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

      {/* 输出类别不再是契约的一格（ISSUE #4072）：模式本身已按类别区分
          （左栏就按类别分组），再让用户为每个模式挑一次是重复选择。 */}

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
      {/* 修改即自动保存（#3949 需求 1）：本机覆盖不再要手动点保存；失败在此可见（#3637）。 */}
      <p className="text-muted-foreground text-2xs">
        修改即自动保存到本机应用数据（data/workshop-mode-contracts.json），无需手动保存；{" "}
        <span className="tabular-nums">
          {controller.saving
            ? "正在保存…"
            : controller.saveError === null
              ? controller.dirty
                ? "有修改待自动保存。"
                : controller.saved
                  ? "已自动保存。"
                  : ""
              : ""}
        </span>
      </p>
      {controller.saveError !== null && (
        <p className="bg-danger/10 text-danger-strong rounded-lg px-3 py-2 text-xs">
          自动保存失败：{controller.saveError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
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
        {/* 契约有两层，各存在一处（ISSUE #3625）：本机覆盖跟着这台机器走、项目默认
            入库跟代码走（运行期只读不写，ISSUE #5001）。徽标说清「数据落在哪儿」，
            迁移时才不会只搬走一半。 */}
        <DataLocationBadge id="mode-contract-local" />
        <DataLocationBadge id="mode-contract-project" />
      </div>
    </section>
  );
}

/** 输入口清单里的一行：序号 + 名称（悬停给类型，`size` 展开到组成，ISSUE #3762）
 *  + 调序 / 必填·可选（徽标即开关，ISSUE #4072）/ 移除。 */
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
  const typeInfo = contractInputTypeInfo(input, draft.customInputs ?? []);
  const required = controller.isRequired(input);

  return (
    <div className="border-border bg-bg flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="flex min-w-0 items-center gap-2">
        {/* 类型与描述分两行（ISSUE #3778）：类型值用英文（与口 id 同一语言），
            描述另起一行；无类型信息（未知口）时只给描述一行。 */}
        <Hint
          label={
            <span>
              {typeInfo.type !== "" && <span className="block">类型：{typeInfo.type}</span>}
              <span className="block">{typeInfo.description}</span>
            </span>
          }
          wrap
        >
          <span className="text-ink min-w-0 cursor-help text-sm">
            <span className="text-muted-foreground mr-1 tabular-nums">{index + 1}.</span>
            <LabelWithId id={input} label={label} />
            {kind && (
              <span className="text-muted-foreground bg-subtle border-border-strong text-2xs ml-2 rounded border px-1.5 py-0.5">
                {customInputKindLabel(kind)}
              </span>
            )}
          </span>
        </Hint>
        {/* 必填 / 可选：徽标即开关（点一下改这个口的「必备」状态）。此前那一格
            是「勾选框 + 一句固定的『必备』」—— 勾上写「必备」、没勾也写
            「必备」，读的人看不出「没勾 = 可选」。 */}
        <Hint
          label="必备口：本地工作流缺它的落点时，工坊里驱动不起来（点一下改这一口必不必备）"
          wrap
        >
          <ContractRequiredToggle
            onToggle={() => {
              controller.toggleRequired(input);
            }}
            required={required}
            srLabel={label}
          />
        </Hint>
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
