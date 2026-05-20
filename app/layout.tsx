import './globals.css';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'STC Marketing Dashboard',
  description: 'Stockport Truck Centre - CRM, social, sales, brand',
  icons: { icon: '/icon.png' },
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
      {children}</body>
    </html>
  );
}
