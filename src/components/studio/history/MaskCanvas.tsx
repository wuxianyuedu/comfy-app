"use client";

// 蒙版画布（#2483 · FR-QA-09）：局部重绘的「人画蒙版」最小实现——黑底白笔，
// 白色 = 要重绘的区域。导出 PNG dataURL 交由上层上传进 ComfyUI input 目录。
// 只做画笔粗细三档 + 清除，不做选区 / 羽化（精细工具是 ComfyUI 原生界面的领地）。
import { useCallback, useEffect, useRef, useState } from "react";

import { Button } from "~/components/ui/button";

const BRUSH_SIZES = /* SAFETY: 类型断言已复核 */ [8, 20, 40] as const;

export interface MaskCanvasProps {
  disabled?: boolean;
  onChange: (dataUrl: string | null) => void;
  /** 当前蒙版（PNG dataURL）；外部清空（重置）时传 null 触发重绘底色。 */
  value: string | null;
}

export function MaskCanvas({ value, onChange, disabled }: MaskCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawingRef = useRef(false);
  const lastPointRef = useRef<{ x: number; y: number } | null>(null);
  const [brush, setBrush] = useState<number>(20);

  const paintBase = useCallback((canvas: HTMLCanvasElement) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return;
    }
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }, []);

  // 底色只画一次 + 外部清空（value 从非 null 变 null）时重画。
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    if (value === null) {
      paintBase(canvas);
    }
  }, [value, paintBase]);

  const pointOf = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return null;
    }
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  };

  const strokeTo = (point: { x: number; y: number }) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) {
      return;
    }
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = brush;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    const from = lastPointRef.current ?? point;
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(point.x, point.y);
    ctx.stroke();
    lastPointRef.current = point;
  };

  return (
    <div className="flex flex-col gap-2">
      <canvas
        aria-label="重绘蒙版画布（白色为要重绘的区域）"
        className={
          "border-border-strong bg-panel-deep touch-none rounded-lg border " +
          (disabled ? "opacity-50" : "cursor-crosshair")
        }
        height={288}
        onPointerDown={(e) => {
          if (disabled) {
            return;
          }
          e.currentTarget.setPointerCapture(e.pointerId);
          drawingRef.current = true;
          const point = pointOf(e);
          if (point) {
            strokeTo(point);
          }
        }}
        onPointerMove={(e) => {
          if (!drawingRef.current || disabled) {
            return;
          }
          const point = pointOf(e);
          if (point) {
            strokeTo(point);
          }
        }}
        onPointerUp={() => {
          if (!drawingRef.current) {
            return;
          }
          drawingRef.current = false;
          lastPointRef.current = null;
          const canvas = canvasRef.current;
          if (canvas) {
            onChange(canvas.toDataURL("image/png"));
          }
        }}
        ref={canvasRef}
        width={288}
      />
      <div className="flex items-center gap-2">
        <span className="text-ink-faint text-2xs">画笔</span>
        {BRUSH_SIZES.map((size) => (
          <Button
            aria-label={`${size} 像素画笔`}
            className="text-2xs h-6 px-2"
            disabled={disabled}
            key={size}
            onClick={() => setBrush(size)}
            size="sm"
            type="button"
            variant={brush === size ? "secondary" : "ghost"}
          >
            {size}
          </Button>
        ))}
        <Button
          aria-label="清空蒙版"
          className="text-2xs h-6 px-2"
          disabled={disabled}
          onClick={() => {
            const canvas = canvasRef.current;
            if (!canvas) {
              return;
            }
            paintBase(canvas);
            onChange(null);
          }}
          size="sm"
          type="button"
          variant="ghost"
        >
          清空
        </Button>
        <span className="text-ink-fainter text-2xs">白色 = 重绘区域</span>
      </div>
    </div>
  );
}
