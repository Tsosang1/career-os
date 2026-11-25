'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';
import CareerOSLogo from '@/components/CareerOSLogo';

export default function LoginPage() {
  const router = useRouter();
  const supabase = createClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [resetSent, setResetSent] = useState(false);

  // TOTP 2FA state
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');

  const handleForgotPassword = async () => {
    setMessage(null);
    setResetSent(false);
    if (!email.trim()) {
      setMessage('Enter your email address first so we can send a reset link.');
      return;
    }
    const { error: resetErr } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo: `${window.location.origin}/auth/reset-password` }
    );
    if (resetErr) {
      setMessage(resetErr.message);
    } else {
      setResetSent(true);
    }
  };

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage(null);
    setResetSent(false);

    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) {
        setMessage(error.message);
      } else {
        setMessage('Account created! If email confirmation is off, you can sign in now.');
        setIsSignUp(false);
      }
      setLoading(false);
      return;
    }

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      setLoading(false);
      return;
    }

    const { data: aalData } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    if (aalData?.nextLevel === 'aal2' && aalData?.currentLevel === 'aal1') {
      const { data: factors } = await supabase.auth.mfa.listFactors();
      const totpFactor = factors?.totp?.find((f) => f.status === 'verified');
      if (totpFactor) {
        setMfaFactorId(totpFactor.id);
        setMfaRequired(true);
        setLoading(false);
        return;
      }
    }

    router.push('/vault');
    router.refresh();
    setLoading(false);
  }

  async function handleVerifyTotp(e: React.FormEvent) {
    e.preventDefault();
    if (!mfaFactorId) return;
    setLoading(true);
    setMessage(null);

    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: mfaFactorId,
    });
    if (chErr || !challenge) {
      setMessage(chErr?.message || '2FA challenge failed.');
      setLoading(false);
      return;
    }

    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: mfaFactorId,
      challengeId: challenge.id,
      code: totpCode.trim(),
    });
    setLoading(false);

    if (verErr) {
      setMessage('Invalid 6-digit code. Try again.');
      return;
    }

    router.push('/vault');
    router.refresh();
  }

  return (
    <div className="min-h-screen bg-[#0B0F17] text-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md bg-[#111827] border border-slate-800 rounded-xl p-8 shadow-xl">
        <div className="flex items-center gap-3 mb-6">
          <CareerOSLogo className="w-9 h-9" />
          <div>
            <h1 className="text-lg font-semibold tracking-tight">
              Career<span className="text-cyan-400">OS</span>
            </h1>
            <p className="text-xs text-slate-400">Personal Application & Vault Workspace</p>
          </div>
        </div>

        {mfaRequired ? (
          <form onSubmit={handleVerifyTotp} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Authenticator Code (2FA)
              </label>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                required
                value={totpCode}
                onChange={(e) => setTotpCode(e.target.value)}
                placeholder="6-digit code"
                className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm focus:outline-none focus:border-cyan-500"
              />
            </div>

            {message && (
              <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                {message}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm transition disabled:opacity-50"
            >
              {loading ? 'Verifying...' : 'Verify & Sign In'}
            </button>
          </form>
        ) : (
          <>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Email</label>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1.5">Password</label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-3.5 py-2.5 rounded-lg bg-[#0B0F17] border border-slate-800 text-sm focus:outline-none focus:border-cyan-500"
                />
              </div>

              {!isSignUp && (
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={handleForgotPassword}
                    className="text-xs text-cyan-400 hover:text-cyan-300 transition"
                  >
                    Forgot password?
                  </button>
                </div>
              )}

              {resetSent && (
                <p className="text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/30 rounded-lg px-3 py-2">
                  Password reset link sent to <span className="font-medium">{email}</span>. Check your inbox.
                </p>
              )}

              {message && (
                <p className="text-xs text-amber-400 bg-amber-500/10 border border-amber-500/20 rounded-lg p-2.5">
                  {message}
                </p>
              )}

              <button
                type="submit"
                disabled={loading}
                className="w-full py-2.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-medium text-sm transition disabled:opacity-50"
              >
                {loading ? 'Working...' : isSignUp ? 'Create Account' : 'Sign In'}
              </button>
            </form>

            <button
              type="button"
              onClick={() => setIsSignUp(!isSignUp)}
              className="mt-5 w-full text-center text-xs text-slate-400 hover:text-slate-200"
            >
              {isSignUp ? 'Already have an account? Sign in' : 'First time here? Create account'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
