/**
 * Web-компонент <idb-beauty-quiz> (ТЗ 8.1).
 *
 *   <idb-beauty-quiz api-base="https://beauty-api.iledebeaute.ru" token="<JWT>" inherit-fonts></idb-beauty-quiz>
 *
 * Атрибуты: api-base (обяз.), token | customer-id, inherit-fonts, no-fonts (не подключать Google Fonts).
 * События (CustomEvent, detail = BeautyProfile | undefined, bubbles+composed):
 *   quiz:base-completed · quiz:category-completed · quiz:closed · quiz:analytics (detail = событие аналитики)
 */
import type { BeautyProfile } from "@idb/core";
import { createElement } from "react";
import { type Root, createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import css from "./styles.css?inline";

const FONTS_HREF =
  "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Manrope:wght@300;400;500;600&display=swap";

export class IdbBeautyQuizElement extends HTMLElement {
  static observedAttributes = ["api-base", "token", "customer-id", "inherit-fonts"];
  private root: Root | null = null;
  private mount: HTMLDivElement | null = null;

  connectedCallback() {
    if (!this.shadowRoot) {
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = `:host{display:block;min-height:200px;}${css}`;
      shadow.appendChild(style);
      this.mount = document.createElement("div");
      shadow.appendChild(this.mount);
    }
    if (
      !this.hasAttribute("no-fonts") &&
      !this.hasAttribute("inherit-fonts") &&
      !document.querySelector(`link[href="${FONTS_HREF}"]`)
    ) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = FONTS_HREF;
      document.head.appendChild(link);
    }
    this.render();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.render();
  }

  disconnectedCallback() {
    this.root?.unmount();
    this.root = null;
  }

  private emit(name: string, detail?: unknown) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private render() {
    if (!this.mount) return;
    const apiBase = this.getAttribute("api-base");
    if (!apiBase) {
      this.mount.textContent = "idb-beauty-quiz: не задан атрибут api-base";
      return;
    }
    if (!this.root) this.root = createRoot(this.mount);
    this.root.render(
      createElement(App, {
        apiBase,
        auth: {
          token: this.getAttribute("token") ?? undefined,
          customerId: this.getAttribute("customer-id") ?? undefined,
        },
        inheritFonts: this.hasAttribute("inherit-fonts"),
        events: {
          onBaseCompleted: (p: BeautyProfile) => this.emit("quiz:base-completed", p),
          onCategoryCompleted: (p: BeautyProfile) => this.emit("quiz:category-completed", p),
          onClosed: () => this.emit("quiz:closed"),
          onAnalytics: (e) => this.emit("quiz:analytics", e),
        },
      }),
    );
  }
}

if (typeof customElements !== "undefined" && !customElements.get("idb-beauty-quiz")) {
  customElements.define("idb-beauty-quiz", IdbBeautyQuizElement);
}
