'use client';

import { useSession, signIn, signOut } from 'next-auth/react';
import { useGitHubAuth } from '@/contexts/GitHubAuthContext';

export default function GitHubAuth() {
  const { data: session, status } = useSession();
  const { user, isLoading, error } = useGitHubAuth();

  if (status === 'loading' || isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-gray-600">
        <div className="animate-spin w-4 h-4 border-2 border-gray-300 border-t-blue-600 rounded-full"></div>
        Loading...
      </div>
    );
  }

  if (session && user) {
    return (
      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2">
          <img 
            src={user.avatar_url} 
            alt={user.name || user.login}
            className="w-8 h-8 rounded-full"
          />
          <div className="text-sm">
            <div className="font-medium text-gray-900">{user.name || user.login}</div>
            <div className="text-gray-500">Connected to GitHub</div>
          </div>
        </div>
        <button
          onClick={() => signOut()}
          className="text-sm text-red-600 hover:text-red-700 font-medium"
        >
          Sign Out
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <button
        onClick={() => signIn('github')}
        className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white rounded-md hover:bg-gray-800 transition-colors"
      >
        <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
          <path d="M12 0C5.374 0 0 5.373 0 12 0 17.302 3.438 21.8 8.207 23.387c.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.509 11.509 0 0112 5.803c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.797 24 17.3 24 12c0-6.627-5.373-12-12-12z"/>
        </svg>
        Connect GitHub
      </button>
      {error && (
        <div className="text-sm text-red-600">
          {error}
        </div>
      )}
      <p className="text-xs text-gray-500">
        Connect your GitHub account to access your repositories
      </p>
    </div>
  );
}