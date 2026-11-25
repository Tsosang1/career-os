import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import SettingsClient from '@/components/SettingsClient';

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  const [{ data: prefs }, { count: scannedCount }, { data: factors }] =
    await Promise.all([
      supabase
        .from('user_preferences')
        .select('target_role_keywords')
        .eq('user_id', user.id)
        .maybeSingle(),
      supabase
        .from('scanned_emails')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', user.id),
      supabase.auth.mfa.listFactors(),
    ]);

  const verifiedTotp =
    factors?.totp?.find((f) => f.status === 'verified') ?? null;

  return (
    <SettingsClient
      user={{
        id: user.id,
        email: user.email ?? '',
        fullName: user.user_metadata?.full_name ?? '',
      }}
      initialKeywords={prefs?.target_role_keywords ?? []}
      initialScannedCount={scannedCount ?? 0}
      initialMfaFactorId={verifiedTotp?.id ?? null}
    />
  );
}
