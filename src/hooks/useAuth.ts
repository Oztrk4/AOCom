"use client";
import { useCallback, useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { BAN_MESSAGE } from "@/lib/types";

export function useAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });
    if (error) return error.message;

    // Ban gate: passive users authenticate but are immediately rejected.
    const { data: prof } = await supabase
      .from("profiles")
      .select("is_active")
      .eq("id", data.user.id)
      .single();
    if (prof && prof.is_active === false) {
      await supabase.auth.signOut();
      return BAN_MESSAGE;
    }
    return null;
  }, []);

  const signUp = useCallback(
    async (email: string, password: string, nickname: string) => {
      // Registration gate (readable by anon). The DB trigger enforces the
      // same rule server-side; this check supplies the exact message.
      const { data: settings } = await supabase
        .from("system_settings")
        .select("is_registration_open")
        .eq("id", 1)
        .maybeSingle();
      if (settings && settings.is_registration_open === false) {
        return BAN_MESSAGE;
      }

      const { error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nickname } },
      });
      if (error) {
        // The trigger raises when intake closed mid-flight.
        return /registration_closed|Database error/i.test(error.message)
          ? BAN_MESSAGE
          : error.message;
      }
      return null;
    },
    []
  );

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
  }, []);

  return { session, loading, signIn, signUp, signOut };
}
