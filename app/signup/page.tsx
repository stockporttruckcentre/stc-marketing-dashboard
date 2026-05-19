'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Loader, AlertCircle, CheckCircle } from 'lucide-react';

export default function SignupPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    });
    setLoading(false);
    if (error) {
      setError(error.message);
      return;
    }
    setSuccess(true);
    setTimeout(() => router.push('/login'), 2000);
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-stc-navy px-4">
      <div className="w-full max-w-md bg-white rounded-2xl shadow-2xl p-8">
        <div className="mb-6 text-center">
          <div className="text-3xl font-bold text-stc-navy">STC</div>
          <div className="text-sm text-gray-600 mt-1">Create account</div>
        </div>

        {success ? (
          <div className="text-center space-y-3 py-6">
            <CheckCircle size={48} className="text-green-500 mx-auto" />
            <p className="font-medium">Account created!</p>
            <p className="text-sm text-gray-600">
              Check your email to confirm, then sign in. An admin will need to grant your role.
            </p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium mb-1">Full name</label>
              <input
                type="text"
                required
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-stc-navy outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Email</label>
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-stc-navy outline-none"
              />
            </div>
            <div>
              <label className="block text-sm font-medium mb-1">Password</label>
              <input
                type="password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-stc-navy outline-none"
              />
              <p className="text-xs text-gray-500 mt-1">Min 8 characters</p>
            </div>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 text-red-800 rounded-lg text-sm">
                <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-stc-navy text-white py-2.5 rounded-lg font-medium hover:bg-stc-navy-light disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {loading && <Loader size={16} className="animate-spin" />}
              Create account
            </button>
          </form>
        )}

        <div className="mt-4 text-center text-sm text-gray-600">
          Already have an account?{' '}
          <Link href="/login" className="text-stc-red font-medium hover:underline">
            Sign in
          </Link>
        </div>
      </div>
    </div>
  );
}
