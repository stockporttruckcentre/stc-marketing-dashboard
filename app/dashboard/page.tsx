import { createClient } from '@/lib/supabase/server';
import { getDashboardVariant, canSwitchVariant, type DashboardVariant } from '@/lib/dashboard/variant';
import { RepDashboard } from '@/components/dashboard/RepDashboard';
import { ExecDashboard } from '@/components/dashboard/ExecDashboard';
import { SupportDashboard } from '@/components/dashboard/SupportDashboard';
import { VariantSwitch } from '@/components/dashboard/VariantSwitch';
import type { Profile } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * The dashboard is three separate renders, not one render with widgets
 * hidden. Which one you get comes from getDashboardVariant(), the single
 * seam between this screen and however permissions end up working.
 *
 * Data comes from /api/dashboard/*, never from browser queries. See
 * docs/dashboard-upgrade-plan.md for why that matters.
 */
export default async function DashboardHome({
  searchParams,
}: { searchParams: { view?: string } }) {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  const { data: profileRow } = await supabase
    .from('profiles').select('*').eq('id', user!.id).single();

  const profile = (profileRow ?? {
    id: user!.id,
    email: user!.email!,
    full_name: user!.email!.split('@')[0],
    role: 'viewer',
    theme: 'dark',
    created_at: new Date().toISOString(),
  }) as Profile;

  let variant: DashboardVariant = getDashboardVariant(profile as any);

  // Admins can preview another view. Needed today because role cannot yet
  // tell a rep from an exec, so without this nobody can see the exec
  // dashboard at all. Preview only: it never widens what the API returns,
  // because both routes authorise independently.
  const requested = searchParams.view;
  const maySwitch = canSwitchVariant(profile);
  if (maySwitch && (requested === 'rep' || requested === 'exec' || requested === 'support')) {
    variant = requested;
  }

  return (
    <>
      {maySwitch && <VariantSwitch current={variant} />}
      {variant === 'exec'    && <ExecDashboard profile={profile} />}
      {variant === 'support' && <SupportDashboard profile={profile} />}
      {variant === 'rep'     && <RepDashboard profile={profile} />}
    </>
  );
}
