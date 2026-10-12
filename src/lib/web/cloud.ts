import { createClient, type Session } from '@supabase/supabase-js';
import { create } from 'zustand';
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const cloud = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true } }) : null;
export const useAccount = create<{ session: Session | null; admin: boolean; sync: string }> (() => ({ session: null, admin: false, sync: cloud ? 'Connecting…' : 'Saved on this device' }));
export async function initAccount() {
  if (!cloud) return;
  const { data, error } = await cloud.auth.getSession();
  if (error) throw error;
  useAccount.setState({session: data.session,sync:data.session ? "Signed in" : "Saved on this device"});
  if (data.session) {
    const { data: role, error: roleError } = await cloud.from('admins').select('user_id').eq('user_id', data.session.user.id).maybeSingle();
    if (roleError) useAccount.setState({sync: 'Backend setup required'});
    useAccount.setState({admin: !!role});
  }
  cloud.auth.onAuthStateChange((_event, session) => { useAccount.setState({session}); });
}
export async function cloudRequest<T>(route: string, body: unknown, signal?: AbortSignal): Promise<T> {
  if (!cloud) throw new Error('Online services are not connected yet. Reading and your vocabulary work on this device.');
  const {data} = await cloud.auth.getSession();
  if (!data.session) throw new Error('Sign in to use AI and natural voice.');
  const response = await fetch(`/api/${route}`, {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${data.session.access_token}`}, body: JSON.stringify(body), signal});
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || 'Online service unavailable.');
  return result as T;
}
