"use client";

import { useTheme } from "next-themes";
import { Toaster as Sonner, type ToasterProps } from "sonner";
import {
  CircleCheckIcon,
  InfoIcon,
  TriangleAlertIcon,
  OctagonXIcon,
  Loader2Icon,
} from "lucide-react";

type ToasterTheme = NonNullable<ToasterProps["theme"]>;

/** 主题三档白名单：`next-themes` 给的是 string，`sonner` 只认这三档。 */
const TOASTER_THEMES: Record<ToasterTheme, true> = {
  dark: true,
  light: true,
  system: true,
};

function isToasterTheme(value: string): value is ToasterTheme {
  return Object.hasOwn(TOASTER_THEMES, value);
}

function Toaster({ ...props }: ToasterProps) {
  const { theme = "system" } = useTheme();
  const toasterStyle: React.CSSProperties & {
    "--border-radius": string;
    "--normal-bg": string;
    "--normal-border": string;
    "--normal-text": string;
  } = {
    "--normal-bg": "var(--popover)",
    "--normal-text": "var(--popover-foreground)",
    "--normal-border": "var(--border)",
    "--border-radius": "var(--radius)",
  };

  return (
    <Sonner
      className="toaster group"
      icons={{
        success: <CircleCheckIcon className="size-4" />,
        info: <InfoIcon className="size-4" />,
        warning: <TriangleAlertIcon className="size-4" />,
        error: <OctagonXIcon className="size-4" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={toasterStyle}
      theme={isToasterTheme(theme) ? theme : "system"}
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
