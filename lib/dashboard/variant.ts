import type { Profile } from '@/lib/types';

/**
 * Which dashboard a person sees.
 *
 * This is the single seam between the dashboard and however permissions
 * end up working. Nothing else in the app may read a variant column, a
 * role, or a capability to decide what the dashboard renders. When the
 * granular permissions panel lands, or when the platform moves, this
 * function changes and no widget does.
 *
 * Today it falls back to `role`, because `profiles.dashboard_variant`
 * does not exist yet and Dave, Dean, Tom and Gareth are all `admin`, so
 * role cannot actually tell a rep from an exec. Everyone therefore lands
 * on the rep view, which is the documented default for an unassigned
 * user. Once the column is added the first branch below starts working
 * with no other change.
 */
export type DashboardVariant = 'rep' | 'exec' | 'support';

export function getDashboardVariant(profile: Pick<Profile, 'role'> & { dashboard_variant?: string | null }): DashboardVariant {
  const explicit = profile.dashboard_variant;
  if (explicit === 'rep' || explicit === 'exec' || explicit === 'support') return explicit;

  // No explicit variant set. Marketers get the support view; everyone
  // else, including unassigned users, gets the rep view.
  if (profile.role === 'marketer') return 'support';
  return 'rep';
}

/** Can this person switch views? An exec who occasionally works a deal needs both. */
export function canSwitchVariant(profile: Pick<Profile, 'role'>): boolean {
  return profile.role === 'admin';
}
