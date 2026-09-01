/* =============================================================
   The team, and what each of them may do.

   From the business:

     turn Team into a generic team member overview with their details,
     more a handy page allowing admin to become role/permission
     management hub ... ensure only admins can see all settings and
     other roles see settings and admin features relative to their role

   ---- Why every one of these is an RPC and none is a table write ----

   Because the guards are in the database and nowhere else can hold
   them. Removing the last administrator, granting a capability whose
   prerequisite is missing, taking your own access away: each of those
   is a question about rows this browser cannot see, answered inside the
   same transaction as the write. A check in this file would be a second
   copy of a rule, and a second copy of a rule is a rule that disagrees
   with itself within the month.

   So nothing here decides anything. This is the shape of the call and
   the shape of the answer, and the reason is that two screens make the
   same calls: a person's own settings, and the team hub.

   ---- Errors come back as sentences ----

   Every refusal in migration 073 is written to be read by the person
   who hit it, and each one says what to do instead. Passing the message
   through unchanged is deliberate: rewriting it here would mean two
   places to keep in step, and the vaguer of the two would win.
   ============================================================= */
import type { Capability, CapabilityScope } from '@/lib/platform/permissions/catalog';

/** The narrowest slice of the client any of this needs. */
type Rpc = {
  rpc: (name: string, args?: Record<string, unknown>) =>
    PromiseLike<{ data: unknown; error: unknown }>;
};

export type Outcome<T> = { ok: true; value: T } | { ok: false; why: string };

function failed(error: unknown): { ok: false; why: string } {
  const message = (error as { message?: string })?.message;
  return { ok: false, why: message ? String(message) : 'That did not go through.' };
}

/* ---------- the directory ---------- */

/**
 * One row per person.
 *
 * `capabilities` and `overrides` are null for anybody who may not
 * manage users, because a team directory is a phone list and how many
 * permissions everybody holds is a map of the building. The function
 * decides that, not this file: a screen that filtered them out would
 * still have had them on the wire.
 */
export type TeamMember = {
  id: string;
  full_name: string | null;
  email: string | null;
  job_title: string | null;
  photo_url: string | null;
  location: string | null;
  department: string | null;
  manager: string | null;
  /** The legacy column. Still the answer for most accounts. */
  role: string;
  /** The template, where they are on one. */
  role_template: string | null;
  template_slug: string | null;
  is_active: boolean;
  capabilities: number | null;
  overrides: number | null;
  joined: string | null;
};

export async function loadTeam(client: Rpc): Promise<Outcome<TeamMember[]>> {
  const { data, error } = await client.rpc('team_directory');
  if (error) return failed(error);
  return { ok: true, value: (data ?? []) as TeamMember[] };
}

/* ---------- what somebody can do ---------- */

/** One capability, resolved, with where the answer came from. */
export type ResolvedCapability = {
  key: Capability;
  label: string;
  description: string;
  area: string;
  feature: string;
  granted: boolean;
  /** "from your role", "granted to you specifically", and so on. */
  source: string;
};

export async function loadMyCapabilities(client: Rpc): Promise<Outcome<ResolvedCapability[]>> {
  const { data, error } = await client.rpc('my_capabilities');
  if (error) return failed(error);
  return { ok: true, value: (data ?? []) as ResolvedCapability[] };
}

/**
 * The same question about somebody else. Administrators only.
 *
 * `source` is a sentence rather than a flag, and the three states the
 * screen switches on are read back out of it by `overrideState` below.
 * That is not this file being clever: `capability_report` has said it
 * that way since migration 053 and it is what the audit screen renders,
 * so adding a boolean beside it would be two answers to one question.
 */
export type CapabilityLine = {
  key: Capability;
  label: string;
  description: string;
  area: string;
  feature: string;
  danger: 'routine' | 'sensitive' | 'destructive';
  granted: boolean;
  /** 'granted to this person', 'from their role', and the rest. */
  source: string;
  scope: CapabilityScope | null;
  reason: string | null;
  granted_by: string | null;
  expires_at: string | null;
};

export async function loadCapabilitiesFor(
  client: Rpc, user: string,
): Promise<Outcome<CapabilityLine[]>> {
  const { data, error } = await client.rpc('capability_report', { p_user: user });
  if (error) return failed(error);
  return { ok: true, value: (data ?? []) as CapabilityLine[] };
}

/* ---------- the four writes ---------- */

/**
 * Grant, refuse, or clear one capability for one person.
 *
 * Three states rather than two, and the third is the one that matters.
 * `null` removes the override so their role decides again, which is the
 * only way back from a mistake that does not leave an explicit refusal
 * on the record forever.
 */
export async function setCapability(
  client: Rpc,
  user: string,
  capability: Capability,
  granted: boolean | null,
  reason?: string,
  scope?: CapabilityScope | null,
): Promise<Outcome<{ who: string; holds: boolean }>> {
  const { data, error } = await client.rpc('admin_set_capability', {
    p_user: user,
    p_capability: capability,
    p_granted: granted,
    p_reason: reason ?? null,
    p_scope: scope ?? null,
    p_expires: null,
  });
  if (error) return failed(error);
  return { ok: true, value: (data ?? {}) as { who: string; holds: boolean } };
}

/** Move somebody onto a role template, or off templates entirely. */
export async function setRoleTemplate(
  client: Rpc, user: string, slug: string | null,
): Promise<Outcome<{ who: string; was: string | null; now: string | null }>> {
  const { data, error } = await client.rpc('admin_set_role_template', {
    p_user: user, p_slug: slug,
  });
  if (error) return failed(error);
  return { ok: true, value: (data ?? {}) as { who: string; was: string | null; now: string | null } };
}

/** Turn an account off, or back on. Never a delete: see the migration. */
export async function setActive(
  client: Rpc, user: string, active: boolean,
): Promise<Outcome<{ who: string; active: boolean }>> {
  const { data, error } = await client.rpc('admin_set_active', {
    p_user: user, p_active: active,
  });
  if (error) return failed(error);
  return { ok: true, value: (data ?? {}) as { who: string; active: boolean } };
}

/** The directory half of somebody else's profile. Not the permission half. */
export async function updateTeamMember(
  client: Rpc,
  user: string,
  patch: { job_title?: string; location?: string; department?: string | null; manager?: string | null },
): Promise<Outcome<true>> {
  const { error } = await client.rpc('admin_update_profile', {
    p_user: user,
    p_job_title: patch.job_title ?? null,
    p_location: patch.location ?? null,
    p_department: patch.department ?? null,
    p_manager: patch.manager ?? null,
  });
  if (error) return failed(error);
  return { ok: true, value: true };
}

/* ---------- somebody's own profile ---------- */

export type MyProfilePatch = {
  full_name?: string;
  job_title?: string;
  location?: string;
  timezone?: string;
  working_hours?: string;
  responsibilities?: string;
  skills?: string[];
  photo_url?: string;
  theme?: 'dark' | 'light';
};

/**
 * The columns a person owns about themselves.
 *
 * An empty string clears a field and an omitted one leaves it alone,
 * which is why every argument goes through explicitly rather than by
 * spreading whatever the form happened to hold. A form that posts one
 * field must not blank the other eight.
 */
export async function updateMyProfile(
  client: Rpc, patch: MyProfilePatch,
): Promise<Outcome<true>> {
  const { error } = await client.rpc('update_my_profile', {
    p_full_name: patch.full_name ?? null,
    p_job_title: patch.job_title ?? null,
    p_location: patch.location ?? null,
    p_timezone: patch.timezone ?? null,
    p_working_hours: patch.working_hours ?? null,
    p_responsibilities: patch.responsibilities ?? null,
    p_skills: patch.skills ?? null,
    p_photo_url: patch.photo_url ?? null,
    p_theme: patch.theme ?? null,
  });
  if (error) return failed(error);
  return { ok: true, value: true };
}

/* ---------- presentation, in one place because two screens read it ---------- */

/**
 * The three states an override can be in, as a word the screen switches
 * on.
 *
 * Read off `source` rather than off a separate column, because
 * `capability_report` has one answer and adding a second would let the
 * two disagree. The two override sentences are matched on the word
 * that carries the meaning, so a later rewording of the rest of the
 * sentence does not silently turn every override into "from their role"
 * and hide the exceptions this whole screen exists to show.
 */
export type OverrideState = 'role' | 'granted' | 'refused';

export function overrideState(line: { source: string }): OverrideState {
  const said = line.source.toLowerCase();
  if (said.startsWith('granted to')) return 'granted';
  if (said.startsWith('refused to')) return 'refused';
  return 'role';
}

/**
 * Why somebody holds a capability, in a sentence.
 *
 * The admin screen and the settings screen ask the same question from
 * opposite sides, and an answer written twice is an answer that
 * eventually contradicts itself in front of the person it is about.
 */
export function whySource(line: { source: string; granted: boolean }): string {
  switch (overrideState(line)) {
    case 'granted': return 'Granted to them specifically';
    case 'refused': return 'Refused to them specifically';
    default:        return line.granted ? 'From their role' : 'Not in their role';
  }
}

/** Group a flat list of capabilities the way the register says to. */
export function byArea<T extends { area: string; feature: string }>(
  lines: T[],
): { area: string; features: { feature: string; items: T[] }[] }[] {
  const areas: { area: string; features: { feature: string; items: T[] }[] }[] = [];
  for (const line of lines) {
    let area = areas.find((a) => a.area === line.area);
    if (!area) { area = { area: line.area, features: [] }; areas.push(area); }
    let feature = area.features.find((f) => f.feature === line.feature);
    if (!feature) { feature = { feature: line.feature, items: [] }; area.features.push(feature); }
    feature.items.push(line);
  }
  return areas;
}

/**
 * What a role is called in a sentence.
 *
 * The legacy column holds four words that were never written to be
 * read: `viewer` is not what anybody calls Rafe. The template name is
 * used where there is one, because somebody deliberately wrote it.
 */
const LEGACY_ROLE: Record<string, string> = {
  admin: 'Administrator',
  marketer: 'Marketing',
  sales: 'Sales',
  viewer: 'Read only',
};

export function roleInWords(member: { role: string; role_template: string | null }): string {
  return member.role_template ?? LEGACY_ROLE[member.role] ?? member.role;
}
