import { revenueScreen } from '@/app/dashboard/revenue/screen';

export const dynamic = 'force-dynamic';

export default function RentalRevenuePage() {
  return revenueScreen('rental', 'S&L');
}
