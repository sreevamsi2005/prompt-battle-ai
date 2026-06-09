/**
 * Simple password-based admin auth
 * In production, use a proper auth library
 */
export function isAdminPasswordValid(password: string): boolean {
  const adminPwd = process.env.ADMIN_PASSWORD || "booth2024";
  return password === adminPwd && password.length > 0;
}
