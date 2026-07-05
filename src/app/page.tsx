"use client";
import { useEffect, useRef } from "react";
import { useAuth } from "@/hooks/useAuth";
import { enterDashboardWindow, enterLoginWindow } from "@/lib/tauri";
import { LoginScreen } from "@/components/auth/LoginScreen";
import { Dashboard } from "@/components/layout/Dashboard";

export default function Home() {
  const { session, loading, signIn, signUp, signOut } = useAuth();
  const wasLoggedIn = useRef(false);

  // Smoothly morph the native window between the compact login shell
  // (450x650) and the full dashboard (1200x800).
  useEffect(() => {
    if (loading) return;
    if (session && !wasLoggedIn.current) {
      wasLoggedIn.current = true;
      void enterDashboardWindow();
    } else if (!session && wasLoggedIn.current) {
      wasLoggedIn.current = false;
      void enterLoginWindow();
    }
  }, [session, loading]);

  if (loading) {
    return (
      <div className="flex h-screen items-center justify-center bg-bg-0">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-edge border-t-accent" />
      </div>
    );
  }

  if (!session) return <LoginScreen signIn={signIn} signUp={signUp} />;
  return (
    <Dashboard
      userId={session.user.id}
      userEmail={session.user.email ?? null}
      signOut={signOut}
    />
  );
}
