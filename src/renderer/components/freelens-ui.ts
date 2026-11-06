import { Renderer } from "@freelensapp/extensions";
import type * as React from "react";

export const { Icon, Checkbox, SearchInput, Notifications } = Renderer.Component;

// 拡張APIの型に無いprops(small)を渡すため、公式型のまま使えない。
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
