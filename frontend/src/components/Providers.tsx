'use client';

import { SessionProvider } from "next-auth/react";
import { GitHubAuthProvider } from '@/contexts/GitHubAuthContext';

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <SessionProvider>
      <GitHubAuthProvider>
        {children}
      </GitHubAuthProvider>
    </SessionProvider>
  );
}