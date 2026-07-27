/**
 * Prisma Client 单例（Issue MAO-2）
 *
 * 服务端 trusted 写 / 迁移后的复杂查询用 Prisma。
 * ⚠️ Prisma 用 service_role / 直连会绕过 RLS：涉及“当前用户数据”时，要么改用
 *   lib/supabase/server.ts（用户 JWT，RLS 生效），要么显式 where: { accountId: userId } 兜底。
 */
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
