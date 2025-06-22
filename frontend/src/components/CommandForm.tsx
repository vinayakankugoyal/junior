'use client';

import { useState } from 'react';
import { apiClient } from '@/lib/api';
import { useGitHubAuth } from '@/contexts/GitHubAuthContext';
import GitHubAuth from './GitHubAuth';

interface TaskFormProps {
  onTaskSubmitted?: (taskId: string) => void;
}

export default function TaskForm({ onTaskSubmitted }: TaskFormProps) {
  const [task, setTask] = useState('');
  const [selectedRepo, setSelectedRepo] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  
  const { user, repos, isLoading } = useGitHubAuth();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!task.trim() || !selectedRepo) return;

    setIsSubmitting(true);
    setError(null);
    setSuccess(null);

    try {
      const response = await apiClient.executeTask(task.trim(), selectedRepo);
      setSuccess(`Task submitted successfully! ID: ${response.task_id}`);
      setTask('');
      onTaskSubmitted?.(response.task_id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to execute task');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <h2 className="text-xl font-semibold text-gray-900 mb-4">Submit Coding Task</h2>
      
      {/* GitHub Authentication Section */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg">
        <h3 className="text-sm font-medium text-gray-700 mb-2">GitHub Integration</h3>
        <GitHubAuth />
      </div>
      
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Repository Selection */}
        <div>
          <label htmlFor="repo" className="block text-sm font-medium text-gray-700 mb-2">
            Select Repository <span className="text-red-500">*</span>
          </label>
          {user && repos.length > 0 ? (
            <select
              id="repo"
              value={selectedRepo}
              onChange={(e) => setSelectedRepo(e.target.value)}
              className="text-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              disabled={isSubmitting || isLoading}
              required
            >
              <option value="">Choose a repository...</option>
              {repos.map((repo) => (
                <option key={repo.id} value={repo.full_name}>
                  {repo.full_name} {repo.private ? '(Private)' : ''}
                  {repo.description ? ` - ${repo.description.substring(0, 60)}${repo.description.length > 60 ? '...' : ''}` : ''}
                </option>
              ))}
            </select>
          ) : (
            <div className="p-3 bg-yellow-50 border border-yellow-200 rounded-md">
              <p className="text-sm text-yellow-800">
                {!user ? 'Please connect your GitHub account to select a repository.' : 
                 isLoading ? 'Loading repositories...' :
                 'No repositories found. Please make sure you have access to at least one repository.'}
              </p>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-1">
            A repository must be selected to provide context for the coding task
          </p>
        </div>

        <div>
          <label htmlFor="task" className="block text-sm font-medium text-gray-700 mb-2">
            Coding Task
          </label>
          <textarea
            id="task"
            value={task}
            onChange={(e) => setTask(e.target.value)}
            placeholder="Describe your coding task (e.g., 'Create a React component for a user profile', 'Write a Python function to sort a list')"
            className="text-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-vertical"
            rows={4}
            disabled={isSubmitting}
          />
        </div>

        <button
          type="submit"
          disabled={isSubmitting || !task.trim() || !selectedRepo || !user}
          className="w-full bg-blue-600 text-white py-2 px-4 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? 'Processing...' : 
           !user ? 'Connect GitHub to Submit' :
           !selectedRepo ? 'Select Repository to Submit' :
           'Submit Task'}
        </button>
      </form>

      {error && (
        <div className="mt-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {success && (
        <div className="mt-4 p-3 bg-green-100 border border-green-400 text-green-700 rounded">
          {success}
        </div>
      )}
    </div>
  );
}