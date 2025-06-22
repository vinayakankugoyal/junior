'use client';

import { useState, useEffect } from 'react';
import { Task, apiClient } from '@/lib/api';
import { usePolling } from '@/hooks/usePolling';

interface TasksListProps {
  refreshTrigger?: number;
  onTaskClick?: (task: Task) => void;
}

type FilterType = 'all' | 'running' | 'completed';

export default function TasksList({ refreshTrigger, onTaskClick }: TasksListProps) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<FilterType>('all');

  const fetchTasks = async () => {
    try {
      setError(null);
      let response;
      
      switch (filter) {
        case 'running':
          response = await apiClient.listRunningTasks();
          break;
        case 'completed':
          response = await apiClient.listCompletedTasks();
          break;
        default:
          response = await apiClient.listAllTasks();
      }
      
      setTasks(response.tasks);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch tasks');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTasks();
  }, [filter, refreshTrigger]);

  usePolling(fetchTasks, {
    interval: 2000,
    enabled: tasks.some(task => task.status === 'running')
  });

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'running':
        return 'bg-yellow-100 text-yellow-800';
      case 'completed':
        return 'bg-green-100 text-green-800';
      case 'failed':
        return 'bg-red-100 text-red-800';
      default:
        return 'bg-gray-100 text-gray-800';
    }
  };

  const formatTime = (timeString: string) => {
    return new Date(timeString).toLocaleString();
  };

  const getDuration = (startTime: string, endTime: string | null) => {
    const start = new Date(startTime);
    const end = endTime ? new Date(endTime) : new Date();
    const diffMs = end.getTime() - start.getTime();
    const diffSeconds = Math.floor(diffMs / 1000);
    
    if (diffSeconds < 60) {
      return `${diffSeconds}s`;
    } else if (diffSeconds < 3600) {
      return `${Math.floor(diffSeconds / 60)}m ${diffSeconds % 60}s`;
    } else {
      const hours = Math.floor(diffSeconds / 3600);
      const minutes = Math.floor((diffSeconds % 3600) / 60);
      return `${hours}h ${minutes}m`;
    }
  };

  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow-md p-6">
        <div className="animate-pulse">Loading tasks...</div>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex justify-between items-center mb-6">
        <h2 className="text-xl text-gray-900 font-semibold">Tasks</h2>
        <button
          onClick={fetchTasks}
          className="px-3 py-1 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
        >
          Refresh
        </button>
      </div>

      <div className="flex gap-2 mb-4">
        {(['all', 'running', 'completed'] as FilterType[]).map((filterType) => (
          <button
            key={filterType}
            onClick={() => setFilter(filterType)}
            className={`px-3 py-1 text-sm rounded-md transition-colors ${
              filter === filterType
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 hover:bg-gray-200 text-gray-700'
            }`}
          >
            {filterType.charAt(0).toUpperCase() + filterType.slice(1)}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
          {error}
        </div>
      )}

      {tasks.length === 0 ? (
        <div className="text-gray-700 text-center py-8">
          No tasks found
        </div>
      ) : (
        <div className="space-y-3">
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => onTaskClick?.(task)}
              className="border rounded-lg p-4 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="flex justify-between items-start mb-2">
                <div className="text-sm text-gray-700 bg-gray-100 px-2 py-1 rounded flex-1 mr-4">
                  {task.task}
                </div>
                <span className={`px-2 py-1 text-xs font-medium rounded-full ${getStatusColor(task.status)}`}>
                  {task.status}
                </span>
              </div>
              
              <div className="flex justify-between items-center text-xs text-gray-700">
                <span>Started: {formatTime(task.start_time)}</span>
                <span>Duration: {getDuration(task.start_time, task.end_time)}</span>
                {task.return_code !== null && (
                  <span className={task.return_code === 0 ? 'text-green-600' : 'text-red-600'}>
                    Status: {task.return_code}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}