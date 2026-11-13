import createMiddleware from "next-intl/middleware";
import { routing } from "./i18n/routing";

// Next.js 16: `proxy.ts` replaces `middleware.ts`.
export default createMiddleware(routing);

export const config = {
  // Match all pathnames except API routes, Next.js internals and static files.
  matcher: "/((?!api|trpc|_next|_vercel|.*\\..*).*)",
};
