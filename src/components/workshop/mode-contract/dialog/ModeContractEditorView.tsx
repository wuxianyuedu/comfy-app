"use client";

// ── 「模式契约」编辑器：纯展示视图（规范 17 §17.2 第③层）────────────────
// 两个入口（工坊 / 工作流库）共用同一份表单：输入口清单 + 输出类别 + 保存。
// 契约本身（口有哪些、口叫什么）由`lib/workshop/model-mode-contract` 定义，
// 展示分组与「已改」判据来自`mode-contract-config`。
//
// ── 本次改版（ISSUE #1870）：模式清单收成**左侧的树形页签** ───────────────
// 改版前模式是**按类别平铺成三排 chip**（实测 22 枚），纵向要吃掉三四行、窗口
// 一窄还反复折行 —— 用户的原话是「模式契约设计成树形页签，现在散放一堆占空间」。
// 现在收成左右两栏：**左栏 = 分类树**（父行是输出类别、子行是模式，见
// `ModeContractModeNav`），**右栏 = 当前模式的编辑区**。两栏各自滚动，
// 模式不再和正文抢纵向空间（与设置页分区导航同一形态，ISSUE #1694）。
//
// **第二刀：每一类可折叠**（同一 ISSUE 的下一条反馈）。树收起来了，但最长的那个
// 类别（图像，11 条模式）仍会把另外两类挤出可视区 —— 现在每个类别的父行是一个
// 折叠开关（默认全部展开），折起来的状态留在 `ModeContractModeNav` 自己那层，
// 这一层（布局）不感知它。左栏的 `custom-scrollbar` 仍在：折起来只省纵向空间，
// 不取消滚动 —— 三类全拼开时它照样可能超出。
//
// ── 上一版（ISSUE #1423）：字号收敛 + 选中态修好 ────────────────────────
//
// **字号**：改版前这一屏实测 **7 种字号 / 63 个文本叶节点，其中 36 个（57%）
// 是 `text-3xs`(10px)** —— 模式 chip 的文案、`必备` 勾选框的字、id 上标、
// 三段「口径说明」的正文全在 10px。用户的原话是「字体太多，有的字体太小
// 看的费劲」。现在：正文与控件 14px（`text-sm`）、副说明 12px（`text-xs`）、
// id 上标 11px（`text-2xs`，这一档是「副说明下的元信息」，不给可读文案用）。
// 10px 那档（「角标 / 极小徽标」）在本屏零使用。
//
// **三段口径说明**（「必备」什么意思 / 「尺寸」两类写法）此前是 10px 正文、
// 每开一个模式都要从上往下读一遍才够到第一个控件。现在收进一条可折叠的
// 「口径说明」（`ui/disclosure`），默认收起、需要时展开 —— 它们回答的是
// 「这套规则怎么理解」，不是「现在这一步填什么」。
//
// **选中态**：改版前模式 chip 的选中分支只写了 `border-primary text-primary
// bg-primary/10`，而 `Button variant="outline"` 自带 `hover:text-foreground`
// —— 划到已选中的那一枚上字色翻白（用户原话：「按钮的选中状态悬浮和非悬浮
// 一个紫色，一个白色」）。根因与修法见 `ui/select-chip.tsx` 文件头。

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
import { SelectMenu } from "~/components/ui/select-menu";
import { PageHeader } from "~/components/ui/page-header";
import { SectionLabel } from "~/components/ui/section-label";
import { pageHeaderTitle } from "~/components/studio/NavItems";
import { ContractInputCatalog } from "./ContractInputCatalog";
import { ModeContractModeNav } from "./ModeContractModeNav";

/** 中文展示名 + 机器 id：界面上只写中文时，对不上代码 / 日志 / 配置里的 id。 */
function LabelWithId({ label, id }: { label: string; id: string }) {
  return (
    <>
      {label}
      <span className="text-muted-foreground/60 text-2xs ml-1 font-mono">
        {id}
      </span>
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
      {/* 页头走 `ui/page-header`（规范 03 §3.10 / 16 §16.2.4.73）。这一屏的屏名已经由
          页签给出，所以按 ISSUE #1693 那一档收：不传可见 `title`（屏名退成 `sr-only`，
          读屏仍按标题跳转），那句契约口径不是每次进屏都要读的、挂成悬浮「说明」——
          由顶栏标题右侧那颗问号承载（`viewHelp()`），页眉因此不再占两行。屏名仍从注册表
          取（`pageHeaderTitle`），与侧栏 / 页签同一个出处。
          **不自绘关闭按钮**：那枚 ✕ 是弹窗时代的产物；契约现在是视图页签，
          「关」由页签自己的关闭按钮承担，这里再画一枚就是两个入口做同一件事。
          横向留白只在这一层（`px-4 sm:px-8`）：页眉与两栏此前各带一枚 `px-5`，
          那是「外壳不给左右」时代的产物，外壳补上留白之后叠在这里是 32+20=52px 一圈。
          **上内距收一档**（ISSUE #1871）：这一屏换 `WorkspaceFrame` 之后，容器上内距
          不再由外壳给、全在这一层 —— 而这枚页眉的可见内容只有 `sr-only` 屏名（没标题、
          没动作），`pt-8 sm:pt-10` 会在页眉之上白留一整条空气。收成 `pt-4 sm:pt-5`，
          与其余文档型视图同一档。 */}
      <div className="px-4 sm:px-8">
        <PageHeader
          className="pt-4 pb-3 sm:pt-5"
          srTitle={pageHeaderTitle("mode-contract")}
        />
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
            storedCustomized={(code) => isModeContractCustomized(code, stored)}
            onSelect={controller.selectMode}
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
 *
 * 抽成一个局部组件只是为了让 `ModeContractEditorView` 那一层只剩「布局」：
 * 两栏怎么摆与里面填什么，是两件改起来互不相干的事（规范 §12.13 函数长度）。
 */
function ModeContractDraftPanel({
  controller,
  draft,
}: {
  controller: ModeContractEditorController;
  draft: ModeContract;
}) {
  const { saving, saved, nextReferenceImageId } = controller;

  return (
    <section className="border-border bg-surface flex flex-col gap-4 rounded-xl border p-4">
      <div className="border-border flex flex-wrap items-baseline justify-between gap-2 border-b pb-2">
        <h4 className="text-ink text-sm font-semibold">
          {contractModeLabel(draft.mode)} 的统一对外参数
          <span className="text-muted-foreground/60 text-2xs ml-1.5 font-mono">
            {draft.mode}
          </span>
        </h4>
      </div>

      {/* 口径说明：回答「这套规则怎么理解」，不是「这一步填什么」——
          因此默认收起，不占正文最靠上的位置（用户要看时一次展开看全）。 */}
      <Disclosure
        marker="chevron"
        className="text-muted-foreground hover:text-ink text-xs"
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
          「尺寸」是两类等价的写法，在尺寸选择器里任选其一：比例 + 分辨率（1k /
          2k / 4k），或 比例 + 百万像素 + 倍数（8 / 16 / 32 /
          64）。选「分辨率」时工坊按场景尺寸表换算成「百万像素 + 倍数」
          再下发，两种写法落到工作流 / 远端接口上的效果一致。
        </p>
        <p>
          输入口（按顺序作为工坊对该模式的统一输入）—— 本地工作流在
          「画布节点」为每个口配落点，远端模型在「模型适配」里为每个口配
          请求字段。
        </p>
      </Disclosure>

      <div>
        <SectionLabel hint="顺序即工坊对外的参数顺序">输入口</SectionLabel>
        <div className="flex flex-col gap-1.5">
          {draft.inputs.map((input, i) => (
            <ContractInputRow
              key={input}
              controller={controller}
              draft={draft}
              input={input}
              index={i}
            />
          ))}
        </div>
      </div>

      {/* 参数库：全部预制口 + 自定义口（浏览 + 增删改都在这一块）。 */}
      <ContractInputCatalog
        inputs={draft.inputs}
        customInputs={draft.customInputs ?? []}
        onAddPredefined={(type) =>
          controller.appendInput(
            type === "reference-image"
              ? (nextReferenceImageId ?? "reference-image")
              : type,
          )
        }
        onAddCustom={controller.addCustomInput}
        onRenameCustom={controller.renameCustomInput}
        onRemoveCustom={controller.removeInput}
      />

      <div>
        <SectionLabel>输出类别</SectionLabel>
        <SelectMenu
          value={draft.output}
          onChange={(value) =>
            controller.setOutput(value as ModeContract["output"])
          }
          options={["image", "video", "audio"]}
          labels={{
            image: "图片（image）",
            video: "视频（video）",
            audio: "音频（audio）",
          }}
          aria-label="该模式的输出类别"
          className="text-xs"
        />
      </div>

      {!draft.inputs.includes("prompt") && (
        <p className="bg-warning/10 text-warning-strong rounded-lg px-3 py-2 text-xs">
          契约里没有「提示词」口 —— 工坊生成的提示词将无处可落，
          保存后该模式无法被工坊驱动。
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
        </p>
      )}

      <div>
        <Button
          variant="primary-solid"
          onClick={() => void controller.save()}
          disabled={saving}
        >
          {saving ? "保存中…" : "保存模式契约"}
        </Button>
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
  input: ModeContract["inputs"][number];
  index: number;
}) {
  const label = modeContractInputIdLabel(input, draft.customInputs);
  const kind = customInputKindOf(input);

  return (
    <div className="border-border bg-bg flex items-center justify-between gap-2 rounded-lg border px-3 py-2">
      <span className="text-ink min-w-0 text-sm">
        <span className="text-muted-foreground mr-1 tabular-nums">
          {index + 1}.
        </span>
        <LabelWithId label={label} id={input} />
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
            variant="ghost"
            size="icon-sm"
            onClick={() => controller.moveInput(input, -1)}
            disabled={index === 0}
            aria-label={`上移 ${label}`}
            className="text-muted-foreground/70 hover:text-ink disabled:opacity-25"
          >
            ↑
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => controller.moveInput(input, 1)}
            disabled={index === draft.inputs.length - 1}
            aria-label={`下移 ${label}`}
            className="text-muted-foreground/70 hover:text-ink disabled:opacity-25"
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
            onCheckedChange={() => controller.toggleRequired(input)}
            className="size-4"
          />
          必备
        </FieldLabel>
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={() => controller.removeInput(input)}
          className="text-muted-foreground/60 hover:text-danger-strong"
          aria-label={`移除 ${label}`}
        >
          ✕
        </Button>
      </span>
    </div>
  );
}
