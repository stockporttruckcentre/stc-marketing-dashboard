import './globals.css';
import 'ag-grid-community/styles/ag-grid.css';
import 'ag-grid-community/styles/ag-theme-quartz.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'STC Marketing Dashboard',
  description: 'Stockport Truck Centre - CRM, social, sales, brand',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body>{children}</body>
    </html>
  );
}
