import { supabase } from './supabaseClient';

/**
 * Returns true if the current authenticated user is an admin.
 * Uses the profiles.is_admin flag.
 */
export async function getIsAdmin(): Promise<boolean> {
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;
  const uid = sess.session?.user.id;
  if (!uid) return false;

  const { data, error } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
  if (error) throw error;
  return !!data?.is_admin;
}
