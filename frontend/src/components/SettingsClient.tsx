'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createClient } from '@/lib/supabase/client';

interface SettingsClientProps {
  user: {
    id: string;
    email: string;
    fullName: string;
  };
  initialKeywords: string[];
  initialScannedCount: number;
  initialMfaFactorId: string | null;
}

export default function SettingsClient({
  user,
  initialKeywords,
  initialScannedCount,
  initialMfaFactorId,
}: SettingsClientProps) {
  const supabase = createClient();
  const router = useRouter();

  // Profile
  const [fullName, setFullName] = useState(user.fullName);
  const [profileMsg, setProfileMsg] = useState<string | null>(null);

  // Password change (requires current password verification)
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [pwStatus, setPwStatus] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);
  const [pwLoading, setPwLoading] = useState(false);

  // TOTP 2FA (Microsoft Authenticator compatible)
  const [mfaFactorId, setMfaFactorId] = useState<string | null>(initialMfaFactorId);
  const [enrollingQr, setEnrollingQr] = useState<string | null>(null);
  const [enrollingSecret, setEnrollingSecret] = useState<string | null>(null);
  const [pendingFactorId, setPendingFactorId] = useState<string | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [mfaMsg, setMfaMsg] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Target Role Keywords
  const [keywords, setKeywords] = useState<string[]>(initialKeywords);
  const [kwInput, setKwInput] = useState('');

  // Gmail Scanned Cache
  const [scannedCount, setScannedCount] = useState(initialScannedCount);
  const [cacheMsg, setCacheMsg] = useState<string | null>(null);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfileMsg(null);
    const { error } = await supabase.auth.updateUser({
      data: { full_name: fullName.trim() },
    });
    setProfileMsg(error ? error.message : 'Profile updated.');
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwStatus(null);

    if (newPassword.length < 8) {
      setPwStatus({ type: 'err', text: 'New password must be at least 8 characters.' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setPwStatus({ type: 'err', text: 'New passwords do not match.' });
      return;
    }

    setPwLoading(true);
    const { error: verifyErr } = await supabase.auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });

    if (verifyErr) {
      setPwLoading(false);
      setPwStatus({ type: 'err', text: 'Current password is incorrect.' });
      return;
    }

    const { error: updateErr } = await supabase.auth.updateUser({
      password: newPassword,
    });
    setPwLoading(false);

    if (updateErr) {
      setPwStatus({ type: 'err', text: updateErr.message });
    } else {
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      setPwStatus({ type: 'ok', text: 'Password updated successfully.' });
    }
  };

  const handleStartMfaEnroll = async () => {
    setMfaMsg(null);
    const { data, error } = await supabase.auth.mfa.enroll({
      factorType: 'totp',
      friendlyName: 'Microsoft Authenticator',
    });
    if (error || !data) {
      setMfaMsg({ type: 'err', text: error?.message || 'Failed to start 2FA setup.' });
      return;
    }
    setPendingFactorId(data.id);
    setEnrollingQr(data.totp.qr_code);
    setEnrollingSecret(data.totp.secret);
  };

  const handleVerifyMfaEnroll = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingFactorId) return;
    setMfaMsg(null);

    const { data: challenge, error: chErr } = await supabase.auth.mfa.challenge({
      factorId: pendingFactorId,
    });
    if (chErr || !challenge) {
      setMfaMsg({ type: 'err', text: chErr?.message || 'Challenge failed.' });
      return;
    }

    const { error: verErr } = await supabase.auth.mfa.verify({
      factorId: pendingFactorId,
      challengeId: challenge.id,
      code: totpCode.trim(),
    });

    if (verErr) {
      setMfaMsg({ type: 'err', text: 'Invalid 6-digit code. Try again.' });
      return;
    }

    setMfaFactorId(pendingFactorId);
    setPendingFactorId(null);
    setEnrollingQr(null);
    setEnrollingSecret(null);
    setTotpCode('');
    setMfaMsg({ type: 'ok', text: 'Two-factor authentication enabled.' });
  };

  const handleDisableMfa = async () => {
    if (!mfaFactorId) return;
    if (!window.confirm('Disable two-factor authentication on your account?')) return;

    const { error } = await supabase.auth.mfa.unenroll({ factorId: mfaFactorId });
    if (error) {
      setMfaMsg({ type: 'err', text: error.message });
    } else {
      setMfaFactorId(null);
      setMfaMsg({ type: 'ok', text: 'Two-factor authentication disabled.' });
    }
  };

  const persistKeywords = async (next: string[]) => {
    setKeywords(next);
    await supabase.from('user_preferences').upsert({
      user_id: user.id,
      target_role_keywords: next,
      updated_at: new Date().toISOString(),
    });
  };

  const handleAddKeyword = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = kwInput.trim();
    if (!clean) return;
    if (!keywords.some((k) => k.toLowerCase() === clean.toLowerCase())) {
      await persistKeywords([...keywords, clean]);
    }
    setKwInput('');
  };

  const handleClearScannedCache = async () => {
    if (!window.confirm('Reset scanned email cache? The next Gmail sync will re-evaluate recent emails.')) {
      return;
    }
    await supabase.from('scanned_emails').delete().eq('user_id', user.id);
    setScannedCount(0);
    setCacheMsg('Scanned email cache cleared.');
  };

  const handleSignOut = async () => {
    await supabase.auth.signOut();
    router.push('/login');
    router.refresh();
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Account & Settings</h1>
            <p className="text-xs text-slate-400 mt-0.5">{user.email}</p>
          </div>
          <div className="flex items-center gap-3">
            <Link
              href="/pipeline"
              className="px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-800 hover:border-slate-700 text-xs text-slate-200 transition"
            >
              ← Back to Pipeline
            </Link>
            <button
              type="button"
              onClick={handleSignOut}
              className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 hover:bg-rose-500/20 text-xs text-rose-300 transition"
            >
              Sign Out
            </button>
          </div>
        </div>

        {/* 1. Profile Details */}
        <section className="rounded-xl bg-slate-900/70 border border-slate-800 p-5">
          <h2 className="text-sm font-semibold text-slate-200">Profile</h2>
          <form onSubmit={handleSaveProfile} className="mt-4 grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">Display Name</label>
              <input
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder="Your name"
                className="w-full rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 outline-none"
              />
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">Email Address</label>
              <input
                type="email"
                value={user.email}
                disabled
                className="w-full rounded-lg bg-slate-950/50 border border-slate-800/70 px-3 py-2 text-sm text-slate-500 cursor-not-allowed"
              />
            </div>
            <div className="sm:col-span-2 flex items-center justify-between">
              <span className="text-xs text-emerald-400">{profileMsg}</span>
              <button
                type="submit"
                className="px-4 py-2 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition"
              >
                Save Profile
              </button>
            </div>
          </form>
        </section>

        {/* 2. Password Verification & Change */}
        <section className="rounded-xl bg-slate-900/70 border border-slate-800 p-5">
          <h2 className="text-sm font-semibold text-slate-200">Change Password</h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Verify your current password before setting a new one.
          </p>
          <form onSubmit={handleChangePassword} className="mt-4 space-y-3">
            <div className="grid sm:grid-cols-3 gap-3">
              <input
                type="password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                placeholder="Current password"
                className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 outline-none"
              />
              <input
                type="password"
                required
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password (8+ chars)"
                className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 outline-none"
              />
              <input
                type="password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirm new password"
                className="rounded-lg bg-slate-950 border border-slate-800 px-3 py-2 text-sm text-slate-100 focus:border-cyan-500 outline-none"
              />
            </div>
            <div className="flex items-center justify-between">
              {pwStatus ? (
                <span
                  className={`text-xs ${
                    pwStatus.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'
                  }`}
                >
                  {pwStatus.text}
                </span>
              ) : (
                <span />
              )}
              <button
                type="submit"
                disabled={pwLoading}
                className="px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-100 font-medium text-xs transition"
              >
                {pwLoading ? 'Verifying...' : 'Update Password'}
              </button>
            </div>
          </form>
        </section>

        {/* 3. Two-Factor Authentication (Microsoft Authenticator / TOTP) */}
        <section className="rounded-xl bg-slate-900/70 border border-slate-800 p-5">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-slate-200">
                Two-Factor Authentication (Authenticator App)
              </h2>
              <p className="text-xs text-slate-400 mt-0.5">
                Protect your account using Microsoft Authenticator or any TOTP app.
              </p>
            </div>
            {mfaFactorId ? (
              <button
                type="button"
                onClick={handleDisableMfa}
                className="px-3 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/30 text-xs text-rose-300 hover:bg-rose-500/20 transition"
              >
                Disable 2FA
              </button>
            ) : (
              !enrollingQr && (
                <button
                  type="button"
                  onClick={handleStartMfaEnroll}
                  className="px-3 py-1.5 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-xs text-cyan-300 hover:bg-cyan-500/25 transition"
                >
                  Enable 2FA
                </button>
              )
            )}
          </div>

          {enrollingQr && (
            <form onSubmit={handleVerifyMfaEnroll} className="mt-4 pt-4 border-t border-slate-800 flex flex-col sm:flex-row gap-4 items-start">
              <img
                src={enrollingQr}
                alt="2FA QR Code"
                className="w-36 h-36 rounded-lg bg-white p-2"
              />
              <div className="space-y-2.5 flex-1">
                <p className="text-xs text-slate-300">
                  Scan this QR code in your Authenticator app, or enter the setup key manually:
                </p>
                <code className="block text-[11px] bg-slate-950 border border-slate-800 rounded px-2.5 py-1.5 text-cyan-300 select-all">
                  {enrollingSecret}
                </code>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    required
                    value={totpCode}
                    onChange={(e) => setTotpCode(e.target.value)}
                    placeholder="6-digit code"
                    className="w-36 rounded-lg bg-slate-950 border border-slate-800 px-3 py-1.5 text-sm text-slate-100 focus:border-cyan-500 outline-none"
                  />
                  <button
                    type="submit"
                    className="px-3.5 py-1.5 rounded-lg bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-semibold text-xs transition"
                  >
                    Verify & Activate
                  </button>
                </div>
              </div>
            </form>
          )}

          {mfaMsg && (
            <p
              className={`text-xs mt-3 ${
                mfaMsg.type === 'ok' ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {mfaMsg.text}
            </p>
          )}
        </section>

        {/* 4. Job Alert Keywords & Gmail Sync Maintenance */}
        <section className="rounded-xl bg-slate-900/70 border border-slate-800 p-5 space-y-4">
          <div>
            <h2 className="text-sm font-semibold text-slate-200">Target Role Keywords</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Keywords used to highlight matching roles in your Incoming Job Alert Leads tray.
            </p>
            <div className="flex flex-wrap items-center gap-1.5 mt-3">
              {keywords.map((kw) => (
                <span
                  key={kw}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs bg-slate-800 text-cyan-300 border border-slate-700"
                >
                  {kw}
                  <button
                    type="button"
                    onClick={() => persistKeywords(keywords.filter((k) => k !== kw))}
                    className="text-slate-400 hover:text-rose-400 ml-1"
                  >
                    ×
                  </button>
                </span>
              ))}
              <form onSubmit={handleAddKeyword}>
                <input
                  type="text"
                  value={kwInput}
                  onChange={(e) => setKwInput(e.target.value)}
                  placeholder="+ Add keyword..."
                  className="bg-slate-950 border border-slate-800 rounded-md px-2.5 py-1 text-xs text-slate-200 focus:border-cyan-500 outline-none w-40"
                />
              </form>
            </div>
          </div>

          <div className="pt-4 border-t border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-semibold text-slate-200">
                Scanned Email Cache ({scannedCount} emails)
              </h3>
              <p className="text-[11px] text-slate-400">
                Prevents non-job emails from being re-sent to the AI classifier.
              </p>
              {cacheMsg && <p className="text-xs text-emerald-400 mt-1">{cacheMsg}</p>}
            </div>
            <button
              type="button"
              onClick={handleClearScannedCache}
              className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-xs text-slate-200 transition"
            >
              Reset Cache
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
