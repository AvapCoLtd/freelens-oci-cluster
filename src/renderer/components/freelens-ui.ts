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

export interface CheckboxProps {
  label?: React.ReactNode;
  value?: boolean;
  disabled?: boolean;
  inline?: boolean;
  onChange?: (value: boolean, event: React.ChangeEvent<HTMLInputElement>) => void;
}
export const Checkbox = Renderer.Component.Checkbox as unknown as React.ComponentType<CheckboxProps>;

export interface SearchInputProps {
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  compact?: boolean;
  showClearIcon?: boolean;
  onClear?: () => void;
}
export const SearchInput = Renderer.Component.SearchInput as unknown as React.ComponentType<SearchInputProps>;
