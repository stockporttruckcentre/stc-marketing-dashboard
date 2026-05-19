// Run from project root: node supabase/setup-users.mjs
// Requires env vars:
//   NEXT_PUBLIC_SUPABASE_URL
//   SUPABASE_SERVICE_ROLE_KEY
//
// Creates Tom, Alex, Dave, Dean as admin accounts with password "123".

import { createClient } from '@supabase/supabase-js';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error('Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  process.exit(1);
}

const sb = createClient(url, key, { auth: { persistSession: false } });

const USERS = [
  { email: 'tom@stc-uk.com',  full_name: 'Tom' },
  { email: 'alex@stc-uk.com', full_name: 'Alex' },
  { email: 'dave@stc-uk.com', full_name: 'Dave' },
  { email: 'dean@stc-uk.com', full_name: 'Dean' },
];
const PASSWORD = '123';

for (const u of USERS) {
  // Try create, ignore if already exists
  const { data, error } = await sb.auth.admin.createUser({
    email: u.email,
    password: PASSWORD,
    email_confirm: true,
    user_metadata: { full_name: u.full_name },
  });
  let id = data?.user?.id;
  if (error && !String(error.message).includes('already')) {
    console.error('create', u.email, error.message);
    continue;
  }
  if (!id) {
    // fetch existing
    const { data: list } = await sb.auth.admin.listUsers();
    id = list.users.find((x) => x.email === u.email)?.id;
  }
  if (!id) { console.error('no id for', u.email); continue; }

  // Upsert profile to admin
  const { error: pErr } = await sb.from('profiles').upsert({
    id, email: u.email, full_name: u.full_name, role: 'admin',
  });
  if (pErr) { console.error('profile', u.email, pErr.message); continue; }

  console.log('OK', u.email);
}
console.log('done');
