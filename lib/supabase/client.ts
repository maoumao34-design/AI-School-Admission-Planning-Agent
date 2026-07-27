/**
 * Supabase Auth 接入 — 浏览器端 Client（Issue MAO-2）
 *
 * 用于客户端组件的登录/注册/会话读取。配合 lib/supabase/middleware.ts 维护会话 cookie。
 * 密钥仅用 NEXT_PUBLIC_*（可暴露），service_role 绝不在此出现。
 */
import { createBrowserClient } from "@supabase/ssr";

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
