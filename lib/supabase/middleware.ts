import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request: { headers: request.headers } });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value;
        },
        set(name: string, value: string, options: CookieOptions) {
          request.cookies.set({ name, value, ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value, ...options });
        },
        remove(name: string, options: CookieOptions) {
          request.cookies.set({ name, value: '', ...options });
          response = NextResponse.next({ request: { headers: request.headers } });
          response.cookies.set({ name, value: '', ...options });
        },
      },
    }
  );

  const { data: { user } } = await supabase.auth.getUser();
  const { pathname } = request.nextUrl;

  const isAuthRoute = pathname.startsWith('/login') || pathname.startsWith('/signup') || pathname.startsWith('/auth');
  const isProtected = pathname.startsWith('/dashboard') || pathname.startsWith('/export') || pathname.startsWith('/api');

  /* Two paths a guest reaches without ever signing in: the page they
     answer an invitation on, and the route behind it. Both are keyed on
     a token rather than on a session, so sending an unauthenticated
     visitor to `/login` would send the customer somewhere they have no
     account for and the invitation would go unanswered.

     `/invitation` is not under `/dashboard`, so it is already through.
     `/api/invitation` needs saying out loud, because everything under
     `/api` is protected by default and that default is the right one. */
  const isGuestPath = pathname.startsWith('/api/invitation');

  if (!user && isProtected && !isGuestPath && !pathname.startsWith('/api/health')) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  if (user && isAuthRoute && !pathname.startsWith('/auth')) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    return NextResponse.redirect(url);
  }

  return response;
}
