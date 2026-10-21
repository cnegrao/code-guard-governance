"use client";

import { useEffect, useState } from "react";

export type AuditReadState<T> =
  | { state: "loading" }
  | { state: "loaded"; data: T }
  | { state: "unauthenticated" | "denied" | "unavailable" | "invalid" | "not_found" };

export function useAuditRead<T>(url: string, revision = 0): AuditReadState<T> {
  const key = `${revision}:${url}`;
  const [result, setResult] = useState<{ key: string; value: AuditReadState<T> }>({ key, value: { state: "loading" } });
  useEffect(() => {
    const controller = new AbortController();
    let current = true;
    setResult({ key, value: { state: "loading" } });
    void (async () => {
      let value: AuditReadState<T>;
      try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (response.ok) value = { state: "loaded", data: await response.json() as T };
        else value = { state: response.status === 401 ? "unauthenticated" : response.status === 403 ? "denied"
          : response.status === 400 ? "invalid" : response.status === 404 ? "not_found" : "unavailable" };
      } catch {
        value = { state: "unavailable" };
      }
      if (current) setResult({ key, value });
    })();
    return () => { current = false; controller.abort(); };
  }, [key, url]);
  // Mask the prior request synchronously, before effects run after a URL/refresh change.
  return result.key === key ? result.value : { state: "loading" };
}
