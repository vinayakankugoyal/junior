'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';

interface GitHubUser {
  login: string;
  name: string;
  avatar_url: string;
  email?: string;
}

interface GitHubRepo {
  id: number;
  name: string;
  full_name: string;
  description?: string;
  private: boolean;
  html_url: string;
  language?: string;
  updated_at: string;
}

interface GitHubAuthContextType {
  user: GitHubUser | null;
  repos: GitHubRepo[];
  isLoading: boolean;
  error: string | null;
  refreshRepos: () => Promise<void>;
}

const GitHubAuthContext = createContext<GitHubAuthContextType | undefined>(undefined);

export function useGitHubAuth() {
  const context = useContext(GitHubAuthContext);
  if (context === undefined) {
    throw new Error('useGitHubAuth must be used within a GitHubAuthProvider');
  }
  return context;
}

interface GitHubAuthProviderProps {
  children: React.ReactNode;
}

export function GitHubAuthProvider({ children }: GitHubAuthProviderProps) {
  const { data: session, status } = useSession();
  const [user, setUser] = useState<GitHubUser | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fetch user data when session is available
  useEffect(() => {
    if (session?.accessToken) {
      fetchUser();
      fetchRepos();
    } else if (status === 'unauthenticated') {
      setUser(null);
      setRepos([]);
      setError(null);
    }
  }, [session, status]);

  const fetchUser = async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    setError(null);
    
    try {
      const response = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': `token ${session.accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch user data');
      }

      const userData = await response.json();
      setUser(userData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch user data');
    } finally {
      setIsLoading(false);
    }
  };

  const fetchRepos = async () => {
    if (!session?.accessToken) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch user's repos (both owned and collaborator)
      const response = await fetch('https://api.github.com/user/repos?type=owner&per_page=100', {
        headers: {
          'Authorization': `token ${session.accessToken}`,
          'Accept': 'application/vnd.github.v3+json',
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch repositories');
      }

      const reposData = await response.json();
      setRepos(reposData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch repositories');
    } finally {
      setIsLoading(false);
    }
  };

  const refreshRepos = async () => {
    await fetchRepos();
  };

  const contextValue: GitHubAuthContextType = {
    user,
    repos,
    isLoading: isLoading || status === 'loading',
    error,
    refreshRepos,
  };

  return (
    <GitHubAuthContext.Provider value={contextValue}>
      {children}
    </GitHubAuthContext.Provider>
  );
}