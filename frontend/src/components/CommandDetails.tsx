'use client';

import { useState, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Task, TaskFile, TaskContentResponse, CreatePRRequest, FeedbackRequest, FeedbackHistoryItem, apiClient } from '@/lib/api';
import { usePolling } from '@/hooks/usePolling';
import { parseDiff, Diff, Hunk } from 'react-diff-view';
import 'react-diff-view/style/index.css';

interface TaskDetailsProps {
  task: Task | null;
  onClose: () => void;
  onTaskDeleted?: (taskId: string) => void;
}

export default function TaskDetails({ task, onClose, onTaskDeleted }: TaskDetailsProps) {
  const { data: session } = useSession();
  const [currentTask, setCurrentTask] = useState<Task | null>(task);
  const [taskContent, setTaskContent] = useState<TaskContentResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [filesLoading, setFilesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPRModal, setShowPRModal] = useState(false);
  const [creatingPR, setCreatingPR] = useState(false);
  const [prTitle, setPrTitle] = useState('');
  const [prBody, setPrBody] = useState('');
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [sendingFeedback, setSendingFeedback] = useState(false);
  const [showFeedbackSuccess, setShowFeedbackSuccess] = useState(false);
  const [feedbackTaskId, setFeedbackTaskId] = useState<string | null>(null);

  useEffect(() => {
    setIsMounted(true);
    return () => {
      setIsMounted(false);
    };
  }, []);

  useEffect(() => {
    setCurrentTask(task);
    setTaskContent(null);
    setError(null);
    
    // Refresh task data when user clicks on a task
    if (task?.id) {
      // Wrap async calls to handle potential errors
      const initializeTaskData = async () => {
        try {
          await refreshTaskData();
        } catch (err) {
          console.error('Failed to initialize task data:', err);
        }
        
        try {
          await fetchTaskData();
        } catch (err) {
          console.error('Failed to fetch initial task data:', err);
        }
      };
      
      initializeTaskData();
    }
  }, [task]);

  const refreshTaskData = async () => {
    if (!task?.id || !isMounted) return;

    if (isMounted) {
      setLoading(true);
      setError(null);
    }

    try {
      const updatedTask = await apiClient.getTaskStatus(task.id);
      if (isMounted) {
        setCurrentTask(updatedTask);
      }
    } catch (err) {
      if (isMounted) {
        setError(err instanceof Error ? err.message : 'Failed to refresh task');
      }
    } finally {
      if (isMounted) {
        setLoading(false);
      }
    }
  };

  const fetchTaskData = async () => {
    if (!task?.id || !isMounted) return;

    if (isMounted) {
      setFilesLoading(true);
      setError(null);
    }

    try {
      // Fetch unified content (diff for git repos, files otherwise)
      const contentResponse = await apiClient.getTaskContent(task.id);
      if (isMounted) {
        setTaskContent(contentResponse);
      }
    } catch (err) {
      console.error('Failed to fetch task content:', err);
      if (isMounted) {
        setError(err instanceof Error ? err.message : 'Failed to load task content');
      }
    } finally {
      if (isMounted) {
        setFilesLoading(false);
      }
    }
  };

  const refreshTask = async () => {
    if (!currentTask?.id || !isMounted) return;

    if (isMounted) {
      setLoading(true);
      setError(null);
    }

    try {
      const updatedTask = await apiClient.getTaskStatus(currentTask.id);
      if (isMounted) {
        setCurrentTask(updatedTask);
      }
      
      // Also refresh data when task is refreshed
      try {
        await fetchTaskData();
      } catch (dataErr) {
        console.warn('Failed to refresh task data:', dataErr);
        // Don't fail the whole refresh if data fetch fails
      }
    } catch (err) {
      console.error('Failed to refresh task:', err);
      if (isMounted) {
        setError(err instanceof Error ? err.message : 'Failed to refresh task');
      }
    } finally {
      if (isMounted) {
        setLoading(false);
      }
    }
  };

  const silentRefreshTask = async () => {
    if (!currentTask?.id || !isMounted) return;

    try {
      const updatedTask = await apiClient.getTaskStatus(currentTask.id);
      if (isMounted) {
        // Only update if there are meaningful changes
        const hasChanges = 
          updatedTask.status !== currentTask.status ||
          updatedTask.end_time !== currentTask.end_time ||
          updatedTask.output !== currentTask.output ||
          updatedTask.error !== currentTask.error ||
          JSON.stringify(updatedTask.feedback_history) !== JSON.stringify(currentTask.feedback_history);

        if (hasChanges) {
          setCurrentTask(updatedTask);
          
          // Only refresh content if status changed to completed/failed
          if (updatedTask.status !== currentTask.status && 
              (updatedTask.status === 'completed' || updatedTask.status === 'failed')) {
            try {
              await fetchTaskData();
            } catch (dataErr) {
              console.warn('Failed to refresh task data:', dataErr);
            }
          }
        }
      }
    } catch (err) {
      console.error('Failed to refresh task silently:', err);
      // Don't show error for silent refresh
    }
  };

  usePolling(silentRefreshTask, {
    interval: 1000,
    enabled: currentTask?.status === 'running'
  });

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const confirmDelete = async () => {
    if (!currentTask?.id || !isMounted) return;

    setShowDeleteConfirm(false);
    setDeleting(true);
    setError(null);

    try {
      await apiClient.deleteTask(currentTask.id);
      
      // Notify parent component about deletion
      if (onTaskDeleted) {
        onTaskDeleted(currentTask.id);
      }
      
      // Close the modal
      onClose();
    } catch (err) {
      if (isMounted) {
        setError(err instanceof Error ? err.message : 'Failed to delete task');
      }
    } finally {
      if (isMounted) {
        setDeleting(false);
      }
    }
  };

  const cancelDelete = () => {
    setShowDeleteConfirm(false);
  };

  const handleCreatePR = () => {
    // Set default PR title if not set
    if (!prTitle && currentTask) {
      const defaultTitle = `AI Generated Changes: ${currentTask.task.length > 60 ? currentTask.task.substring(0, 60) + '...' : currentTask.task}`;
      setPrTitle(defaultTitle);
    }
    
    // Set default PR body if not set
    if (!prBody && currentTask) {
      const defaultBody = `## AI Generated Changes

**Task:** ${currentTask.task}

**Task ID:** ${currentTask.id}

This pull request contains changes generated by an AI coding assistant.

### Changes Summary
This PR includes the modifications made to fulfill the requested task.

---
*Generated automatically by Junior AI Assistant*`;
      setPrBody(defaultBody);
    }
    
    setShowPRModal(true);
  };


  const createPullRequest = async () => {
    if (!currentTask?.id || !session?.accessToken) return;

    setCreatingPR(true);
    setError(null);

    try {
      const request: CreatePRRequest = {
        github_token: session.accessToken,
        pr_title: prTitle.trim() || undefined,
        pr_body: prBody.trim() || undefined,
      };

      const response = await apiClient.createPullRequest(currentTask.id, request);
      
      if (response.success && response.pr_url) {
        // Open the PR in a new tab
        window.open(response.pr_url, '_blank');
        
        // Close the modal
        setShowPRModal(false);
        
        // Show success message (you could also show a toast here)
        alert(`Pull request created successfully! PR #${response.pr_number}`);
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create pull request';
      setError(errorMessage);
    } finally {
      setCreatingPR(false);
    }
  };

  const cancelCreatePR = () => {
    setShowPRModal(false);
    setPrTitle('');
    setPrBody('');
  };

  const handleFeedback = () => {
    setShowFeedbackModal(true);
  };

  const sendFeedback = async () => {
    if (!currentTask?.id || !feedback.trim()) return;

    setSendingFeedback(true);
    setError(null);

    try {
      const request: FeedbackRequest = {
        feedback: feedback.trim(),
      };

      const response = await apiClient.sendFeedback(currentTask.id, request);
      
      if (response.success) {
        // Close the modal
        setShowFeedbackModal(false);
        setFeedback('');
        
        // Show success modal
        setFeedbackTaskId(response.feedback_task_id);
        setShowFeedbackSuccess(true);
        
        // Create a new processing task to show in the UI
        const feedbackTask: Task = {
          id: response.feedback_task_id,
          task: `Feedback: ${request.feedback}`,
          status: 'running',
          start_time: new Date().toISOString(),
          end_time: null,
          return_code: null,
          session_id: currentTask.session_id
        };
        
        // Update current task to the feedback task to show processing
        setCurrentTask(feedbackTask);
        setTaskContent(null); // Reset content for new task
        
        // Start polling for the new feedback task
        // The usePolling hook will automatically start polling since status is 'running'
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to send feedback';
      setError(errorMessage);
    } finally {
      setSendingFeedback(false);
    }
  };

  const cancelFeedback = () => {
    setShowFeedbackModal(false);
    setFeedback('');
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

  const getStatusColor = (status: Task['status']) => {
    switch (status) {
      case 'running':
        return 'bg-yellow-100 text-yellow-800 border-yellow-200';
      case 'completed':
        return 'bg-green-100 text-green-800 border-green-200';
      case 'failed':
        return 'bg-red-100 text-red-800 border-red-200';
      default:
        return 'bg-gray-100 text-gray-800 border-gray-200';
    }
  };

  if (!currentTask) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
      <div className="bg-white rounded-lg shadow-xl max-w-4xl w-full max-h-[90vh] overflow-hidden">
        <div className="flex justify-between items-center p-6 border-b">
          <h2 className="text-xl text-gray-900 font-semibold">Task Details</h2>
          <div className="flex gap-2">
            <button
              onClick={refreshTask}
              disabled={loading}
              className="px-3 py-1 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors disabled:opacity-50"
            >
              {loading ? 'Refreshing...' : 'Refresh'}
            </button>
            {currentTask?.session_id && (currentTask?.status === 'completed' || currentTask?.status === 'failed') && (
              <button
                onClick={handleFeedback}
                disabled={sendingFeedback || loading}
                className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
              >
                {sendingFeedback ? 'Sending...' : 'Give Feedback'}
              </button>
            )}
            {taskContent?.is_git_repo && session?.accessToken && (currentTask?.status === 'completed' || currentTask?.status === 'failed') && (
              <button
                onClick={handleCreatePR}
                disabled={creatingPR || loading}
                className="px-3 py-1 text-sm text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
              >
                {creatingPR ? 'Creating PR...' : 'Create PR'}
              </button>
            )}
            <button
              onClick={handleDeleteClick}
              disabled={deleting || loading}
              className="px-3 py-1 text-sm text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50"
            >
              {deleting ? 'Deleting...' : 'Delete'}
            </button>
            <button
              onClick={onClose}
              className="px-3 py-1 text-sm text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Close
            </button>
          </div>
        </div>

        <div className="p-6 overflow-y-auto max-h-[calc(90vh-120px)]">
          {error && (
            <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-6">
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Task</label>
                {currentTask.original_task || currentTask.feedback_history?.length ? (
                  <div className="space-y-3">
                    <div className="block w-full p-3 bg-blue-50 border border-blue-200 rounded-md text-sm">
                      <div className="font-medium text-blue-800 mb-2">Original Task:</div>
                      <div className="text-gray-700">
                        {currentTask.original_task || currentTask.task}
                      </div>
                    </div>
                    {currentTask.feedback_history && currentTask.feedback_history.length > 0 && (
                      <div className="space-y-2">
                        <div className="font-medium text-gray-800 text-sm">Feedback History:</div>
                        {currentTask.feedback_history.map((feedback, index) => (
                          <div key={index} className="block w-full p-3 bg-gray-100 rounded-md text-sm">
                            <div className="flex justify-between items-start mb-2">
                              <div className="font-medium text-gray-800">Feedback #{index + 1}:</div>
                              <div className="text-xs text-gray-500">
                                {new Date(feedback.timestamp).toLocaleString()}
                              </div>
                            </div>
                            <div className="text-gray-700">
                              {feedback.feedback}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="block w-full p-3 bg-gray-100 rounded-md text-sm text-gray-700">
                    {currentTask.task}
                  </div>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <span className={`inline-block px-3 py-1 text-sm font-medium rounded-full border ${getStatusColor(currentTask.status)}`}>
                  {currentTask.status}
                </span>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Task ID</label>
                <code className="block w-full p-2 bg-gray-50 rounded text-xs font-mono text-gray-800">
                  {currentTask.id}
                </code>
              </div>

              {currentTask.session_id && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Session ID</label>
                  <code className="block w-full p-2 bg-gray-50 rounded text-xs font-mono text-gray-800">
                    {currentTask.session_id}
                  </code>
                </div>
              )}
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                <div className="text-sm text-gray-800">
                  {formatTime(currentTask.start_time)}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">End Time</label>
                <div className="text-sm text-gray-800">
                  {currentTask.end_time ? formatTime(currentTask.end_time) : 'Still running'}
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Duration</label>
                <div className="text-sm text-gray-800">
                  {getDuration(currentTask.start_time, currentTask.end_time)}
                </div>
              </div>

              {currentTask.return_code !== null && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status Code</label>
                  <span className={`inline-block px-2 py-1 text-sm font-medium rounded ${
                    currentTask.return_code === 0 
                      ? 'bg-green-100 text-green-800' 
                      : 'bg-red-100 text-red-800'
                  }`}>
                    {currentTask.return_code}
                  </span>
                </div>
              )}

              {currentTask.temp_dir && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Working Directory</label>
                  <code className="block w-full p-2 bg-gray-50 rounded text-xs font-mono text-gray-800 break-all">
                    {currentTask.temp_dir}
                  </code>
                </div>
              )}
            </div>
          </div>

          {currentTask.output && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Task Messages</label>
              <div className="space-y-4">
                {(() => {
                  try {
                    const messages = JSON.parse(currentTask.output);
                    return messages.map((message: { type: string; content: string }, index: number) => (
                      <div key={index} className="border rounded-lg p-4 bg-white">
                        <div className="flex items-center gap-2 mb-2">
                          <span className={`px-2 py-1 text-xs font-medium rounded ${
                            message.type === 'AssistantMessage' ? 'bg-blue-100 text-blue-800' :
                            message.type === 'UserMessage' ? 'bg-green-100 text-green-800' :
                            message.type === 'SystemMessage' ? 'bg-yellow-100 text-yellow-800' :
                            message.type === 'ResultMessage' ? 'bg-purple-100 text-purple-800' :
                            'bg-gray-100 text-gray-800'
                          }`}>
                            {message.type}
                          </span>
                        </div>
                        <div className="prose max-w-none">
                          {(() => {
                            const content = message.content;
                            
                            // Check if content contains code blocks
                            if (content.includes('```')) {
                              return (
                                <div className="whitespace-pre-wrap text-sm">
                                  {(() => {
                                    const parts = content.split('```');
                                    return parts.map((part: string, i: number) => {
                                      if (i % 2 === 0) {
                                        // Regular text content
                                        return part ? (
                                          <div key={i} dangerouslySetInnerHTML={{ __html: part.replace(/\n/g, '<br>') }} />
                                        ) : null;
                                      } else {
                                        // Code block content
                                        const lines = part.split('\n');
                                        const firstLine = lines[0]?.trim() || '';
                                        const language = firstLine || 'text';
                                        const codeContent = lines.slice(firstLine ? 1 : 0).join('\n');
                                        
                                        // Basic language-specific styling
                                        const getLanguageStyles = (lang: string) => {
                                          const normalized = lang.toLowerCase();
                                          switch (normalized) {
                                            case 'javascript':
                                            case 'js':
                                              return 'text-yellow-300';
                                            case 'typescript':
                                            case 'ts':
                                              return 'text-blue-300';
                                            case 'python':
                                            case 'py':
                                              return 'text-green-300';
                                            case 'json':
                                              return 'text-orange-300';
                                            case 'css':
                                              return 'text-pink-300';
                                            case 'html':
                                              return 'text-red-300';
                                            case 'bash':
                                            case 'shell':
                                            case 'sh':
                                              return 'text-cyan-300';
                                            default:
                                              return 'text-green-400';
                                          }
                                        };
                                        
                                        return (
                                          <div key={i} className="my-3">
                                            {language && language !== 'text' && (
                                              <div className="bg-gray-800 text-gray-300 px-3 py-1 text-xs font-mono rounded-t border-b border-gray-700 flex items-center gap-2">
                                                <span className="w-2 h-2 rounded-full bg-green-400"></span>
                                                {language}
                                              </div>
                                            )}
                                            <pre className={`bg-gray-900 p-4 overflow-x-auto font-mono text-sm leading-relaxed ${
                                              language && language !== 'text' ? 'rounded-b' : 'rounded'
                                            } ${getLanguageStyles(language)}`}>
                                              <code className="block">{codeContent}</code>
                                            </pre>
                                          </div>
                                        );
                                      }
                                    }).filter(Boolean);
                                  })()}
                                </div>
                              );
                            } else {
                              return (
                                <div className="whitespace-pre-wrap text-sm text-gray-800">
                                  {content}
                                </div>
                              );
                            }
                          })()}
                        </div>
                      </div>
                    ));
                  } catch {
                    // Fallback to original text rendering if JSON parsing fails
                    return (
                      <div className="w-full p-4 bg-gray-50 text-gray-800 rounded-md text-sm overflow-x-auto whitespace-pre-wrap max-h-80 overflow-y-auto border border-gray-200">
                        {currentTask.output}
                      </div>
                    );
                  }
                })()}
              </div>
            </div>
          )}

          {taskContent?.is_git_repo && taskContent?.content_type === 'diff' && taskContent?.content && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Git Changes</label>
              <div className="border rounded-lg bg-white overflow-hidden">
                <div className="bg-gray-800 text-gray-300 px-4 py-2 text-sm font-mono flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400"></span>
                  <span className="font-medium">Git Diff</span>
                  <span className="text-gray-400">(Repository changes)</span>
                </div>
                <div className="overflow-x-auto bg-white" style={{ color: '#374151' }}>
                  {(() => {
                    try {
                      const diffString = taskContent.content as string;
                      const files = parseDiff(diffString);
                      
                      // Debug: log file types to console
                      console.log('Parsed files:', files.map(f => ({ 
                        oldPath: f.oldPath, 
                        newPath: f.newPath, 
                        type: f.type,
                        hunks: f.hunks.length 
                      })));
                      
                      return (
                        <div className="[&_.diff-gutter]:text-gray-600 [&_.diff-code]:text-gray-800 [&_.diff-code-insert]:text-green-800 [&_.diff-code-delete]:text-red-800">
                          {files.map((file, index) => {
                            // Determine actual file type based on paths and diff content
                            const getFileType = () => {
                              const oldPath = file.oldPath || '/dev/null';
                              const newPath = file.newPath || '/dev/null';
                              
                              if (oldPath === '/dev/null') return 'add';
                              if (newPath === '/dev/null') return 'delete';
                              if (oldPath !== newPath) return 'rename';
                              return 'modify';
                            };
                            
                            const actualFileType = getFileType();
                            
                            return (
                            <div key={index} className="border-b border-gray-200 last:border-b-0">
                              {/* File header */}
                              <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                                <div className="flex items-center gap-2 text-sm font-mono">
                                  <span className="font-semibold text-gray-800">
                                    {(() => {
                                      const oldPath = file.oldPath || '/dev/null';
                                      const newPath = file.newPath || '/dev/null';
                                      
                                      if (actualFileType === 'add') {
                                        return newPath;
                                      } else if (actualFileType === 'delete') {
                                        return oldPath;
                                      } else if (actualFileType === 'rename') {
                                        return `${oldPath} → ${newPath}`;
                                      } else {
                                        return newPath;
                                      }
                                    })()} 
                                  </span>
                                  {actualFileType === 'add' && (
                                    <span className="text-xs px-2 py-1 bg-green-100 text-green-700 rounded">
                                      new file
                                    </span>
                                  )}
                                  {actualFileType === 'delete' && (
                                    <span className="text-xs px-2 py-1 bg-red-100 text-red-700 rounded">
                                      deleted
                                    </span>
                                  )}
                                  {actualFileType === 'rename' && (
                                    <span className="text-xs px-2 py-1 bg-blue-100 text-blue-700 rounded">
                                      renamed
                                    </span>
                                  )}
                                  {actualFileType === 'modify' && (
                                    <span className="text-xs px-2 py-1 bg-yellow-100 text-yellow-700 rounded">
                                      modified
                                    </span>
                                  )}
                                </div>
                              </div>
                              
                              {/* Diff content */}
                              <Diff
                                viewType="split"
                                diffType={actualFileType}
                                hunks={file.hunks}
                              >
                                {(hunks) => hunks.map(hunk => (
                                  <Hunk key={hunk.content} hunk={hunk} />
                                ))}
                              </Diff>
                            </div>
                            );
                          })}
                        </div>
                      );
                    } catch (error) {
                      console.error('Failed to parse diff:', error);
                      // Fallback to plain text display
                      return (
                        <pre className="p-4 overflow-x-auto font-mono text-sm leading-relaxed bg-gray-900 text-green-400">
                          <code className="block">{taskContent.content as string}</code>
                        </pre>
                      );
                    }
                  })()} 
                </div>
              </div>
              {filesLoading && (
                <div className="text-center py-4">
                  <div className="text-sm text-gray-500">Loading diff...</div>
                </div>
              )}
            </div>
          )}

          {taskContent?.is_git_repo && taskContent?.content_type === 'diff' && !taskContent?.content && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Git Status</label>
              <div className="border rounded-lg bg-white overflow-hidden">
                <div className="bg-gray-800 text-gray-300 px-4 py-2 text-sm font-mono flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400"></span>
                  <span className="font-medium">Git Repository</span>
                  <span className="text-gray-400">(No changes detected)</span>
                </div>
                <div className="p-4 text-gray-600 text-sm italic">
                  No changes detected in this git repository. The working directory is clean.
                </div>
              </div>
              {filesLoading && (
                <div className="text-center py-4">
                  <div className="text-sm text-gray-500">Checking for changes...</div>
                </div>
              )}
            </div>
          )}

          {taskContent?.content_type === 'files' && Array.isArray(taskContent?.content) && taskContent.content.length > 0 && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Files Created</label>
              <div className="space-y-4">
                {(taskContent.content as TaskFile[]).map((file, index) => {
                  // Basic language-specific styling
                  const getLanguageStyles = (fileType: string) => {
                    const normalized = fileType.toLowerCase();
                    switch (normalized) {
                      case 'js':
                      case 'javascript':
                        return 'text-yellow-300';
                      case 'ts':
                      case 'typescript':
                        return 'text-blue-300';
                      case 'py':
                      case 'python':
                        return 'text-green-300';
                      case 'json':
                        return 'text-orange-300';
                      case 'css':
                        return 'text-pink-300';
                      case 'html':
                        return 'text-red-300';
                      case 'sh':
                      case 'bash':
                        return 'text-cyan-300';
                      case 'md':
                      case 'markdown':
                        return 'text-gray-300';
                      default:
                        return 'text-green-400';
                    }
                  };

                  return (
                    <div key={index} className="border rounded-lg bg-white overflow-hidden">
                      <div className="bg-gray-800 text-gray-300 px-4 py-2 text-sm font-mono flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-green-400"></span>
                        <span className="font-medium">{file.name}</span>
                        <span className="text-gray-400">({file.path})</span>
                        <span className="ml-auto text-xs text-gray-400">{file.size} bytes</span>
                      </div>
                      {file.type !== 'binary' ? (
                        <pre className={`p-4 overflow-x-auto font-mono text-sm leading-relaxed bg-gray-900 ${getLanguageStyles(file.type)}`}>
                          <code className="block">{file.content}</code>
                        </pre>
                      ) : (
                        <div className="p-4 text-gray-500 text-sm italic">
                          Binary file - content not displayed
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {filesLoading && (
                <div className="text-center py-4">
                  <div className="text-sm text-gray-500">Loading files...</div>
                </div>
              )}
            </div>
          )}

          {currentTask.error && (
            <div className="mb-6">
              <label className="block text-sm font-medium text-gray-700 mb-2">Error</label>
              <pre className="w-full p-4 bg-red-50 text-red-800 rounded-md text-sm font-mono overflow-x-auto whitespace-pre-wrap max-h-60 overflow-y-auto border border-red-200">
                {currentTask.error}
              </pre>
            </div>
          )}
        </div>
      </div>

      {/* Delete Confirmation Modal */}
      {showDeleteConfirm && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-red-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Delete Task</h3>
                  <p className="text-sm text-gray-600">This action cannot be undone</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-gray-700 mb-3">
                  Are you sure you want to delete this task? This will permanently delete the task and clean up its temporary files.
                </p>
                <div className="bg-gray-50 rounded-md p-3">
                  <p className="text-sm font-medium text-gray-700 mb-1">Task:</p>
                  <p className="text-sm text-gray-600 break-words">{currentTask?.task}</p>
                </div>
              </div>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={cancelDelete}
                  className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={confirmDelete}
                  className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors"
                >
                  Delete Task
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Create PR Modal */}
      {showPRModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Create Pull Request</h3>
                  <p className="text-sm text-gray-600">Create a PR with the changes from this task</p>
                </div>
              </div>
              <button
                onClick={cancelCreatePR}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              {error && (
                <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-blue-800">
                      <p>Using your authenticated GitHub account: <span className="font-medium">{session?.user?.name || session?.user?.email}</span></p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Pull Request Title
                  </label>
                  <input
                    type="text"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    placeholder="AI Generated Changes: ..."
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Pull Request Description
                  </label>
                  <textarea
                    value={prBody}
                    onChange={(e) => setPrBody(e.target.value)}
                    placeholder="Description of the changes..."
                    rows={8}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium">Important</p>
                      <ul className="mt-1 list-disc list-inside">
                        <li>This will create a new branch and push changes</li>
                        <li>Make sure you have push access to the repository</li>
                        <li>The PR will be created against the main/master branch</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end p-6 border-t bg-gray-50">
              <button
                onClick={cancelCreatePR}
                disabled={creatingPR}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={createPullRequest}
                disabled={creatingPR}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
              >
                {creatingPR ? 'Creating...' : 'Create Pull Request'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Modal */}
      {showFeedbackModal && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] overflow-hidden">
            <div className="flex justify-between items-center p-6 border-b">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-3.582 8-8 8a8.97 8.97 0 01-4.906-1.524A11.52 11.52 0 014.5 20.5h-.5a1 1 0 01-1-1v-.5c0-3.038 2.462-5.5 5.5-5.5h.5c-.038-.308-.038-.692 0-1H8.5c-3.038 0-5.5-2.462-5.5-5.5V7a1 1 0 011-1h.5l1.416-1.416c.078-.078.15-.165.217-.258C6.633 3.326 8.22 2 10 2s3.367 1.326 3.867 2.326c.067.093.139.18.217.258L15.5 6H16a1 1 0 011 1v.5c0 3.038-2.462 5.5-5.5 5.5H11c.038.308.038.692 0 1h.5c3.038 0 5.5 2.462 5.5 5.5v.5a1 1 0 01-1 1h-.5c-1.19 0-2.353.21-3.456.6A8.97 8.97 0 0113 20c4.418 0 8-3.582 8-8z" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Give Feedback</h3>
                  <p className="text-sm text-gray-600">Continue the conversation with Claude</p>
                </div>
              </div>
              <button
                onClick={cancelFeedback}
                className="text-gray-400 hover:text-gray-600"
              >
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            
            <div className="p-6 overflow-y-auto max-h-[calc(90vh-200px)]">
              {error && (
                <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded">
                  {error}
                </div>
              )}

              <div className="space-y-4">
                <div className="bg-blue-50 border border-blue-200 rounded-md p-3">
                  <div className="flex items-center gap-2">
                    <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div className="text-sm text-blue-800">
                      <p><span className="font-medium">Session ID:</span> {currentTask?.session_id}</p>
                      <p className="mt-1">This will continue the conversation from where the task left off.</p>
                    </div>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Your Feedback or Additional Instructions
                  </label>
                  <textarea
                    value={feedback}
                    onChange={(e) => setFeedback(e.target.value)}
                    placeholder="Please make the following changes..."
                    rows={6}
                    className="text-gray-800 w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                  />
                </div>

                <div className="bg-yellow-50 border border-yellow-200 rounded-md p-3">
                  <div className="flex items-start gap-2">
                    <svg className="w-5 h-5 text-yellow-600 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 15.5c-.77.833.192 2.5 1.732 2.5z" />
                    </svg>
                    <div className="text-sm text-yellow-800">
                      <p className="font-medium">How this works</p>
                      <ul className="mt-1 list-disc list-inside space-y-1">
                        <li>Claude will resume from the exact context where the task ended</li>
                        <li>A new task will be created to track the feedback conversation</li>
                        <li>Changes will be made in the same working directory</li>
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="flex gap-3 justify-end p-6 border-t bg-gray-50">
              <button
                onClick={cancelFeedback}
                disabled={sendingFeedback}
                className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-300 hover:bg-gray-50 rounded-md transition-colors disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={sendFeedback}
                disabled={sendingFeedback || !feedback.trim()}
                className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors disabled:opacity-50"
              >
                {sendingFeedback ? 'Sending...' : 'Send Feedback'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Feedback Success Modal */}
      {showFeedbackSuccess && (
        <div className="fixed inset-0 bg-black bg-opacity-60 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 bg-green-100 rounded-full flex items-center justify-center">
                  <svg className="w-6 h-6 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-gray-900">Feedback Submitted</h3>
                  <p className="text-sm text-gray-600">Your feedback is now being processed</p>
                </div>
              </div>
              
              <div className="mb-6">
                <p className="text-gray-700 mb-3">
                  Your feedback has been successfully submitted and a new task has been created to process it.
                </p>
                <div className="bg-blue-50 rounded-md p-3">
                  <p className="text-sm font-medium text-blue-700 mb-1">New Task ID:</p>
                  <code className="text-sm text-blue-800 font-mono break-all">{feedbackTaskId}</code>
                </div>
                <p className="text-sm text-gray-600 mt-3">
                  Claude will continue the conversation from where the original task left off and make the requested changes.
                </p>
              </div>
              
              <div className="flex gap-3 justify-end">
                <button
                  onClick={() => {
                    setShowFeedbackSuccess(false);
                    setFeedbackTaskId(null);
                  }}
                  className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
                >
                  Got it
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}