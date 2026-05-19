'use client';

import { Suspense, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader, AlertCircle } from 'lucide-react';

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="min-h-screen bg-stc-navy" />}>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const redirectTo = params.get('redirect') || '/dashboard';

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    router.push(redirectTo);
    router.refresh();
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stc-navy px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-6 text-center">
          <div className="text-3xl font-bold text-stc-navy">STC</div>
          <div className="text-sm text-gray-600 mt-1">Marketing Dashboard</div>
        </div>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Email</label>
            <input type="email" required value={email} onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-stc-navy focus:border-stc-navy outline-none"
              placeholder="you@stc-uk.com" />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Password</label>
            <input type="password" required value={password} onChange={(e) => setPassword(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-stc-navy focus:border-stc-navy outline-none" />
          </div>
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm">
              <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          <button type="submit" disabled={loading}
            className="w-full bg-stc-navy text-white py-2.5 rounded-lg font-medium hover:bg-stc-navy-light disabled:opacity-60 flex items-center justify-center gap-2">
            {loading && <Loader size={16} className="animate-spin" />}
            Sign in
          </button>
        </form>
        <div className="mt-4 text-center text-sm text-gray-600">
          Need an account?{' '}
          <Link href="/signup" className="text-stc-red font-medium hover:underline">Sign up</Link>
        </div>
      </div>
    </div>
  );
}
