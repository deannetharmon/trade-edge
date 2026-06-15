// middleware.ts
export { default } from 'next-auth/middleware';

export const config = {
  matcher: [
    '/portfolio/:path*',
    '/engine/:path*',
    '/screener/:path*',
    '/rinse-repeat/:path*',
    '/trade-log/:path*',
    '/performance/:path*',
  ],
};
