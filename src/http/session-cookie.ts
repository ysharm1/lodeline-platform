/** Session cookie (adapted from LoadEnergy): opaque token, HttpOnly, Lax, Secure in prod. */
export const SESSION_COOKIE_NAME = "ll_session";

export function sessionCookieOptions(maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: maxAgeSeconds,
  };
}
