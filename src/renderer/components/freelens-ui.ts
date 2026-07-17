import { Renderer } from "@freelensapp/extensions";
import type * as React from "react";

// Renderer.Component.*は@freelensapp/core 1.10.3の型定義でexport * asの入れ子経由でanyに潰れる
// (Common.Store.ExtensionStoreと同根の既知の不具合。実体は正しいコンポーネントのためキャストする)。
export interface IconProps {
  material?: string;
  tooltip?: React.ReactNode;
  interactive?: boolean;
  small?: boolean;
  disabled?: boolean;
  onClick?: (event: React.MouseEvent) => void;
}
export const Icon = Renderer.Component.Icon as unknown as React.ComponentType<IconProps>;

export interface BadgeProps {
  label?: React.ReactNode;
  small?: boolean;
  style?: React.CSSProperties;
  className?: string;
}
export const Badge = Renderer.Component.Badge as unknown as React.ComponentType<BadgeProps>;

export interface ButtonProps {
  label?: React.ReactNode;
  primary?: boolean;
  accent?: boolean;
  plain?: boolean;
  small?: boolean;
  disabled?: boolean;
  waiting?: boolean;
  onClick?: (event: React.MouseEvent) => void;
}
export const Button = Renderer.Component.Button as unknown as React.ComponentType<ButtonProps>;
