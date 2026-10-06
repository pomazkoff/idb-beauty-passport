/**
 * Standalone-режим (ТЗ 8.1). Авторизация:
 *  ?token=<JWT>        — Bearer для AUTH_MODE=jwt
 *  ?customer=<id>      — X-Customer-Id для dev-режима (по умолчанию "demo")
 *  ?version=<v>&admin=<ADMIN_TOKEN> — предпросмотр черновика из конструктора
 */
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";
import "./styles.css";

const params = new URLSearchParams(location.search);
const apiBase = (import.meta.env.VITE_API_BASE as string | undefined) ?? "http://localhost:3000";
const token = params.get("token") ?? undefined;
const customerId = token ? undefined : (params.get("customer") ?? "demo");
const previewVersion = params.get("version") ?? undefined;
const adminToken = params.get("admin") ?? undefined;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App apiBase={apiBase} auth={{ token, customerId, previewVersion, adminToken }} />
  </StrictMode>,
);
