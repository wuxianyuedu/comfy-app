"use client";

/* ── 「运行反馈」弹窗的 controller（规范 17 第②层）──────────────────────
 * 视图只拿这份 controller 渲染，不含 IO：网络在 ~/lib/feedback/feedback-client，
 * 复制 / 打开的反馈走 ui 的现成出口，浏览器外部动作归 tRPC setting.openExternal。
 * 状态分三块：草稿（描述 / 图片 / 诊断开关）、一次提交的执行态、提交结果。
 */

import { useCallback, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { useTRPC } from "~/trpc/react";
import { useToast } from "~/components/studio/ToastProvider";
import { useExternalAction } from "~/components/ui/use-external-action";
import { useCopyFeedback } from "~/components/ui/use-copy-feedback";
import { useReentrancyLock } from "~/components/ui/use-reentrancy-lock";
import { readFileAsDataUrl } from "~/lib/file-io";
import {
  FEEDBACK_NEW_ISSUE_URL,
  MAX_IMAGES,
  type FeedbackDraft,
} from "~/lib/feedback/feedback-contract";
import { submitFeedback, type FeedbackExportResult } from "~/lib/feedback/feedback-client";

/** 界面里一张待提交的截图（data URL 直接当预览用，不另存一份）。 */
export type FeedbackImage = { dataUrl: string; name: string };

/** 环境信息在浏览器侧采集（纯事实，不含任何口令 / 路径）。 */
function collectEnvironment(): FeedbackDraft["environment"] {
  return {
    appVersion: "",
    platform: typeof navigator === "undefined" ? "未知" : navigator.platform || "未知",
    userAgent: typeof navigator === "undefined" ? "未知" : navigator.userAgent,
    when: new Date().toLocaleString(),
  };
}

export type FeedbackController = {
  /** 添加一张截图；失败给 toast，不打断填写。 */
  addImage: (file: File) => void;
  /** 是否还能再加图。 */
  canAddImage: boolean;
  /** 关闭弹窗（并清掉上一次的失败态）。 */
  close: () => void;
  /** 复制预填正文（成功 / 失败都由 toast 念出来）。 */
  copyIssueBody: () => void;
  /** 当前描述。 */
  description: string;
  /** 已添加的截图。 */
  images: Array<FeedbackImage>;
  /** 诊断日志开关。 */
  includeDiagnostics: boolean;
  /** 打开 CNB 新建 Issue 页（系统默认浏览器，桌面壳内 target=_blank 打不开）。 */
  openIssuePage: () => void;
  /** 删掉第 index 张截图。 */
  removeImage: (index: number) => void;
  /** 上一次提交的结果（null = 还没提交过）。 */
  result: FeedbackExportResult | null;
  /** 改描述。 */
  setDescription: (value: string) => void;
  /** 切换诊断日志开关。 */
  setIncludeDiagnostics: (value: boolean) => void;
  /** 提交反馈（校验 → 落盘 → 给出口）。 */
  submit: () => void;
  /** 本次提交是否正在跑。 */
  submitting: boolean;
};

export function useFeedbackDialog(open: boolean): FeedbackController {
  const toast = useToast();
  const trpc = useTRPC();
  const openExternalM = useMutation(trpc.setting.openExternal.mutationOptions());
  const lock = useReentrancyLock();

  const [description, setDescription] = useState("");
  const [images, setImages] = useState<Array<FeedbackImage>>([]);
  const [includeDiagnostics, setIncludeDiagnostics] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<FeedbackExportResult | null>(null);

  const report = useCallback(
    (kind: "ok" | "err", detail: string) => {
      if (kind === "err") {
        toast.error("打开浏览器失败", detail);
      } else {
        toast.info(detail);
      }
    },
    [toast],
  );
  const external = useExternalAction({ target: "browser", report });
  const copy = useCopyFeedback({
    onSuccess: () => toast.success("已复制 Issue 正文", "粘贴到新建 Issue 页即可提交"),
    onFailure: () => toast.error("复制失败", "剪贴板不可用，请手动选中反馈包里的 issue.md 全文"),
  });

  const addImage = useCallback(
    (file: File) => {
      if (images.length >= MAX_IMAGES) {
        toast.error(`最多 ${MAX_IMAGES} 张截图`, "请先移除一张再添加");
        return;
      }
      void readFileAsDataUrl(file)
        .then((dataUrl) => {
          setImages((prev) =>
            prev.length >= MAX_IMAGES ? prev : [...prev, { dataUrl, name: file.name }],
          );
        })
        .catch(() => toast.error("读取截图失败", "请换一张图片重试"));
    },
    [images.length, toast],
  );

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const submit = useCallback(() => {
    if (!lock.tryEnter()) {
      return;
    }
    if (description.trim() === "") {
      toast.error("请填写问题描述", "说清遇到了什么、期望是什么");
      lock.exit();
      return;
    }
    setSubmitting(true);
    const draft: FeedbackDraft = {
      description,
      images,
      environment: collectEnvironment(),
      includeDiagnostics,
    };
    void submitFeedback(draft)
      .then((res) => {
        setResult(res);
        if (res.ok) {
          toast.success("反馈包已保存到本机", res.relativePath, 6000);
        } else {
          toast.error("保存反馈失败", res.error);
        }
      })
      .finally(() => {
        setSubmitting(false);
        lock.exit();
      });
  }, [description, images, includeDiagnostics, lock, toast]);

  const copyIssueBody = useCallback(() => {
    if (result?.ok === true) {
      copy(result.issueBody);
    }
  }, [copy, result]);

  const openIssuePage = useCallback(() => {
    void external.runWithTarget(FEEDBACK_NEW_ISSUE_URL, (url) =>
      openExternalM.mutateAsync({ url }),
    );
  }, [external, openExternalM]);

  const close = useCallback(() => {
    setResult(null);
  }, []);

  return useMemo(
    () => ({
      close,
      copyIssueBody,
      description,
      includeDiagnostics,
      images,
      canAddImage: images.length < MAX_IMAGES && open,
      openIssuePage,
      result,
      submitting,
      addImage,
      removeImage,
      setDescription,
      setIncludeDiagnostics,
      submit,
    }),
    [
      close,
      copyIssueBody,
      description,
      includeDiagnostics,
      images,
      open,
      openIssuePage,
      result,
      submitting,
      addImage,
      removeImage,
      setIncludeDiagnostics,
      submit,
    ],
  );
}
