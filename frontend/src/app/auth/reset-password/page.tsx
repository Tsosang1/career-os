'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

export default function ResetPasswordPage() {
  const supabase = createClient();
  const router = useRouter();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError('Password must be at least 8 characters.');
      return;
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match.');
      return;
    }

    setLoading(true);
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    setLoading(false);

    if (updateErr) {
      setError(updateErr.message);
      return;
    }

    router.push('/pipeline');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-2xl bg-slate-900/90 border border-slate-800 p-6 shadow-2xl">
        <h1 className="text-xl font-bold text-slate-100">Set New Password</h1>
        <p className="text-xs text-slate-400 mt-1">
          Choose a strong password for your CareerOS account.
        </p>

        <form onSubmit={handleUpdatePassword} className="mt-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              New Password
            </label>
            <input
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Minimum 8 characters"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-300 mb-1">
              Confirm New Password
            </label>
            <input
              type="password"
              required
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="Re-enter password"
              className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 outline-none"
            />
          </div>

          {error && (
            <p className="text-xs text-rose-400 bg-rose-500/10 border border-rose-500/30 rounded-lg px-3 py-2">
              {error}
            </p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full rounded-lg bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-semibold text-sm py-2.5 transition"
          >
            {loading ? 'Updating...' : 'Update Password & Continue'}
          </button>
        </form>
      </div>
    </div>
  );
}
