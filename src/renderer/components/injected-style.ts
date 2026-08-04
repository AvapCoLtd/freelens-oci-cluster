/** 拡張が注入する<style>の定義。idはDOM上の重複判定に使うためグローバルに一意にする。 */
export interface InjectedStyle {
  id: string;
  css: string;
}

/** 拡張機能の有効化時に呼ぶ。既に注入済みなら何もしない(冪等)。 */
export function ensureInjectedStyle(id: string, css: string): void {
  if (typeof document === "undefined" || document.getElementById(id)) return;
  const style = document.createElement("style");
  style.id = id;
  style.textContent = css;
  document.head.appendChild(style);
}

/** 拡張機能の無効化時に呼ぶ。未注入なら何もしない(冪等)。 */
export function removeInjectedStyle(id: string): void {
  document.getElementById(id)?.remove();
}
