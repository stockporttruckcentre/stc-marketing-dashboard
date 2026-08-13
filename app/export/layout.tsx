import type { Metadata } from 'next';

export const metadata: Metadata = { title: 'STC export' };

/**
 * Documents open outside the app chrome.
 *
 * This deliberately does not use the dashboard layout. An export is a
 * standalone document opened in its own tab: the sidebar and top bar are
 * not just unhelpful there, they were being printed into the PDF.
 *
 * Still behind auth: middleware protects /export alongside /dashboard.
 */
export default function ExportLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
