// Kit tokens load first so globals.css still wins at :root for the three
// colliding names. See the header of kit-tokens.css.
import './kit-tokens.css';
import './globals.css';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type { Metadata } from 'next';
import { Toasts } from '@/components/kit/toast';

export const metadata: Metadata = {
  title: 'STC Marketing Dashboard',
  description: 'Stockport Truck Centre - CRM, social, sales, brand',
  // app/icon.png + app/apple-icon.png are auto-detected by Next.js App Router
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
      {/* Apply theme before paint - reads cookie set by middleware/profile */}
      <script dangerouslySetInnerHTML={{ __html: `
        try {
          var t = document.cookie.match(/stc_theme=(dark|light)/);
          document.documentElement.setAttribute('data-theme', t ? t[1] : 'dark');
        } catch(e) { document.documentElement.setAttribute('data-theme', 'dark'); }
      ` }} />
      {/* Every screen, not just the dashboard.

          This started in the dashboard layout, which meant the customer
          export page, at /export rather than /dashboard, had no provider
          above it. `useToast` returns a no-op outside one by design, so
          pressing Word confirmed nothing and raised nothing: the export
          downloaded and the screen said the same as it had before.

          It renders nothing until something is said, so there is no cost
          to it being here. */}
      <Toasts>{children}</Toasts></body>
    </html>
  );
}
