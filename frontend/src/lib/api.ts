const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080';

export interface FeedbackHistoryItem {
  feedback: string;
  timestamp: string;
}

export interface Task {
  id: string;
  task: string;
  status: 'running' | 'completed' | 'failed';
  start_time: string;
  end_time: string | null;
  output?: string;
  error?: string;
  return_code: number | null;
  temp_dir?: string;
  session_id?: string;
  original_task?: string; // For feedback tasks, stores the original task description
  feedback_history?: FeedbackHistoryItem[]; // Array of feedback rounds
}

export interface TaskListResponse {
  tasks: Task[];
  total: number;
}

export interface ExecuteTaskResponse {
  task_id: string;
  message: string;
}

export interface TaskFile {
  path: string;
  name: string;
  type: string;
  content: string;
  size: number;
}

export interface TaskContentResponse {
  task_id: string;
  is_git_repo: boolean;
  content_type: 'files' | 'diff';
  content: TaskFile[] | string | null;
  count?: number; // Only present when content_type is 'files'
}

export interface DeleteTaskResponse {
  message: string;
  task_id: string;
}

export interface CreatePRRequest {
  github_token: string;
  pr_title?: string;
  pr_body?: string;
}

export interface CreatePRResponse {
  success: boolean;
  pr_url?: string;
  pr_number?: number;
  branch_name?: string;
  message?: string;
  error?: string;
}

export interface FeedbackRequest {
  feedback: string;
}

export interface FeedbackResponse {
  success: boolean;
  feedback_task_id: string;
  message: string;
  error?: string;
}

class ApiClient {
  private baseUrl: string;

  constructor(baseUrl: string = API_BASE_URL) {
    this.baseUrl = baseUrl;
  }

  async executeTask(task: string, repository?: string): Promise<ExecuteTaskResponse> {
    const response = await fetch(`${this.baseUrl}/execute`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(repository ? { task, repository } : { task }),
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async getTaskStatus(taskId: string): Promise<Task> {
    const response = await fetch(`${this.baseUrl}/status/${taskId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async listAllTasks(): Promise<TaskListResponse> {
    const response = await fetch(`${this.baseUrl}/tasks`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async listRunningTasks(): Promise<TaskListResponse> {
    const response = await fetch(`${this.baseUrl}/running`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      tasks: data.running_tasks,
      total: data.count,
    };
  }

  async listCompletedTasks(): Promise<TaskListResponse> {
    const response = await fetch(`${this.baseUrl}/completed`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    return {
      tasks: data.completed_tasks,
      total: data.count,
    };
  }

  async getTaskContent(taskId: string): Promise<TaskContentResponse> {
    const response = await fetch(`${this.baseUrl}/content/${taskId}`);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async deleteTask(taskId: string): Promise<DeleteTaskResponse> {
    const response = await fetch(`${this.baseUrl}/delete/${taskId}`, {
      method: 'DELETE',
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async createPullRequest(taskId: string, request: CreatePRRequest): Promise<CreatePRResponse> {
    const response = await fetch(`${this.baseUrl}/create-pr/${taskId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }

  async sendFeedback(taskId: string, request: FeedbackRequest): Promise<FeedbackResponse> {
    const response = await fetch(`${this.baseUrl}/feedback/${taskId}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(request),
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }

    return response.json();
  }
}

export const apiClient = new ApiClient();