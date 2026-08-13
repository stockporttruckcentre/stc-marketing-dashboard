import { NextResponse } from 'next/server';
import { LUSHA_LOCKED } from './permissions';

/* =============================================================
   The Lusha lock, enforced.

   The meeting asked for the company finder to be unclickable at rollout
   until somebody agrees who may spend credits. Hiding the buttons is not
   that: anybody with the browser console open can still POST at the
   route, and the credits come off the same monthly allowance either way.

   So every route that costs money checks here first. The UI gate is
   about not offering something that will not work; this is about the
   money.

   One switch, `LUSHA_LOCKED` in permissions.ts. When the admin panel
   lands it becomes a stored setting and this reads that instead.
   ============================================================= */
export function lushaLockResponse(): NextResponse | null {
  if (!LUSHA_LOCKED) return null;
  return NextResponse.json({
    error: 'Lusha is switched off until a policy is agreed for who can spend credits. Nothing has been charged.',
    locked: true,
  }, { status: 403 });
}
