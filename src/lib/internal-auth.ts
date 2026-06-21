import { env } from "./env.js";

export function hasAdminAccess(adminKey: string | undefined): boolean {
  return Boolean(env.INTERNAL_ADMIN_API_KEY && adminKey === env.INTERNAL_ADMIN_API_KEY);
}
