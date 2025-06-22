'use client';

import { useState } from 'react';
import TaskForm from '@/components/CommandForm';
import TasksList from '@/components/CommandsList';
import TaskDetails from '@/components/CommandDetails';
import { Task } from '@/lib/api';

export default function Home() {
  const [selectedTask, setSelectedTask] = useState<Task | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const handleTaskSubmitted = () => {
    setRefreshTrigger(prev => prev + 1);
  };

  const handleTaskClick = (task: Task) => {
    setSelectedTask(task);
  };

  const handleCloseDetails = () => {
    setSelectedTask(null);
  };

  const handleTaskDeleted = (taskId: string) => {
    // Refresh the task list to remove the deleted task
    setRefreshTrigger(prev => prev + 1);
    // Close the details modal
    setSelectedTask(null);
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="container mx-auto px-4 py-8">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Coding Task Assistant</h1>
          <p className="text-gray-600">Submit coding tasks and get AI-powered solutions in real-time</p>
        </header>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          <div className="space-y-6">
            <TaskForm onTaskSubmitted={handleTaskSubmitted} />
          </div>
          
          <div className="space-y-6">
            <TasksList 
              refreshTrigger={refreshTrigger} 
              onTaskClick={handleTaskClick}
            />
          </div>
        </div>

        {selectedTask && (
          <TaskDetails 
            task={selectedTask} 
            onClose={handleCloseDetails}
            onTaskDeleted={handleTaskDeleted}
          />
        )}
      </div>
    </div>
  );
}
