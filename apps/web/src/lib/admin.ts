import { supabase } from './supabaseClient';

/**
 * Returns true if the current authenticated user is an admin.
 * Uses the public.is_admin() RPC (schema source of truth).
 */
export async function getIsAdmin(): Promise<boolean> {
  const { data: sess, error: sessErr } = await supabase.auth.getSession();
  if (sessErr) throw sessErr;
  const uid = sess.session?.user.id;
  if (!uid) return false;

  const { data, error } = await supabase.rpc('is_admin');
  if (error) throw error;
  return Boolean(data);
}
