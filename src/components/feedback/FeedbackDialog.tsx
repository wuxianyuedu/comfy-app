"use client";

/* ── 「运行反馈」弹窗（规范 17 第③层视图）──────────────────────────────
 * 纯展示 + 组合 ui 基元：一切状态与动作从 useFeedbackDialog 的 controller 取，
 * 组件自身不发请求、不写业务规则。图片选择用 ui/file-picker 的 useFilePicker。
 */

import { ImagePlus, X, Clipboard, ExternalLink, FileText } from "lucide-react";

import { Button } from "~/components/ui/button";
import { Checkbox } from "~/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "~/components/ui/dialog";
import { Label } from "~/components/ui/label";
import { MediaThumbnail } from "~/components/ui/media-thumbnail";
import { Spinner } from "~/components/ui/spinner";
import { Textarea } from "~/components/ui/textarea";
import { useFilePicker } from "~/components/ui/file-picker";
import { type FeedbackController } from "./hooks/use-feedback-dialog";

type FeedbackDialogProps = {
  controller: FeedbackController;
  onClose: () => void;
  open: boolean;
};

export function FeedbackDialog({ controller: c, onClose, open }: FeedbackDialogProps) {
  const picker = useFilePicker({
    accept: "image/png,image/jpeg,image/webp,image/gif",
    onPick: (file) => c.addImage(file),
  });

  return (
    <Dialog
      onOpenChange={(next) => {
        if (!next) {
          c.close();
          onClose();
        }
      }}
      open={open}
    >
      <DialogContent className="w-xl">
        <DialogHeader>
          <DialogTitle>反馈应用运行问题</DialogTitle>
          <DialogDescription>
            填清遇到的问题，附上截图与运行日志；应用会把这些收成一份本机反馈包，并生成好 Issue
            正文，你复制后粘贴到仓库新建 Issue 页即可提交。
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="feedback-description">问题描述</Label>
            <Textarea
              className="min-h-28"
              id="feedback-description"
              onChange={(event) => c.setDescription(event.target.value)}
              placeholder="例如：点了生成后界面一直转圈，日志里最后一行是……期望是……"
              value={c.description}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <Label>截图</Label>
            <div className="flex flex-wrap items-center gap-2">
              {c.images.map((image, index) => (
                <div
                  className="border-border relative h-16 w-16 overflow-hidden rounded-md border"
                  key={`${image.name}-${index}`}
                >
                  <MediaThumbnail
                    alt={`截图 ${index + 1}`}
                    className="h-full w-full object-cover"
                    src={image.dataUrl}
                  />
                  <Button
                    aria-label={`移除截图 ${index + 1}`}
                    className="absolute top-0.5 right-0.5 size-5 rounded-full p-0"
                    onClick={() => c.removeImage(index)}
                    size="icon-sm"
                    variant="secondary"
                  >
                    <X size={11} />
                  </Button>
                </div>
              ))}
              <Button disabled={!c.canAddImage} onClick={picker.open} size="sm" variant="outline">
                <ImagePlus data-icon="inline-start" size={14} />
                添加截图
              </Button>
              <picker.Input />
            </div>
            <p className="text-ink-muted text-2xs">
              最多 6 张 PNG / JPG / WebP / GIF，单张不超过 10MB。
            </p>
          </div>

          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={c.includeDiagnostics}
              onCheckedChange={(value) => c.setIncludeDiagnostics(value === true)}
            />
            <span>附带运行日志诊断包（推荐，排障最有用的一段现场）</span>
          </label>
        </div>

        {c.result?.ok === true && (
          <div className="border-success-strong/30 bg-success/5 flex flex-col gap-1.5 rounded-lg border p-3">
            <p className="text-success-strong flex items-center gap-1.5 text-sm font-medium">
              <FileText size={14} />
              反馈包已保存
            </p>
            <p className="text-ink-muted text-2xs break-all">{c.result.packagePath}</p>
            <p className="text-ink-soft text-xs">
              含 {c.result.imageCount} 张截图
              {c.result.diagnosticsIncluded ? " + 诊断日志" : ""}；下一步：复制正文 → 打开新建 Issue
              页 → 粘贴提交，并把反馈包里的截图 / 诊断包一并上传。
            </p>
          </div>
        )}

        <DialogFooter>
          <Button
            disabled={!c.result?.ok || c.submitting}
            onClick={c.copyIssueBody}
            variant="outline"
          >
            <Clipboard data-icon="inline-start" size={14} />
            复制 Issue 正文
          </Button>
          <Button
            disabled={!c.result?.ok || c.submitting}
            onClick={c.openIssuePage}
            variant="outline"
          >
            <ExternalLink data-icon="inline-start" size={14} />
            打开新建 Issue 页
          </Button>
          <Button disabled={c.submitting || c.description.trim() === ""} onClick={c.submit}>
            {c.submitting && <Spinner data-icon="inline-start" />}
            {c.submitting ? "正在打包…" : "生成反馈包"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
