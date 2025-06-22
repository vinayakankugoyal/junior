#!/usr/bin/env python3
import asyncio
import json
import logging
import os
import requests
import shutil
import sys
import tempfile
import threading
import uuid
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from typing import Dict, List, Optional
import claude_code_sdk
from claude_code_sdk._errors import CLIJSONDecodeError
from git import Repo, InvalidGitRepositoryError

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - [%(filename)s:%(lineno)d] - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout),
        logging.FileHandler('command_server.log')
    ]
)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

class TaskStatus:
    def __init__(self, task_id: str, task: str):
        self.id = task_id
        self.task = task
        self.status = "running"
        self.start_time = datetime.now()
        self.end_time = None
        self.output = ""
        self.error = ""
        self.return_code = None
        self.temp_dir = None

class TaskServer:
    def __init__(self):
        self.tasks: Dict[str, TaskStatus] = {}
        self.lock = threading.Lock()
    
    def execute_task(self, task: str, repository: str = None) -> str:
        task_id = str(uuid.uuid4())
        logger.info(f"Starting task execution - Task ID: {task_id}, Repository: {repository}")
        
        with self.lock:
            task_status = TaskStatus(task_id, task)
            self.tasks[task_id] = task_status
        
        def run_task():
            temp_dir = None
            try:
                logger.info(f"Task {task_id}: Creating temporary directory")
                # Create temporary directory for this task
                temp_dir = tempfile.mkdtemp(prefix=f"task_{task_id[:8]}_")
                logger.info(f"Task {task_id}: Created temp directory: {temp_dir}")
                
                with self.lock:
                    self.tasks[task_id].temp_dir = temp_dir
                
                # Clone the repository into the temp directory
                if repository:
                    logger.info(f"Task {task_id}: Cloning repository {repository}")
                    if not self.clone_repository(repository, temp_dir):
                        logger.error(f"Task {task_id}: Failed to clone repository: {repository}")
                        raise Exception(f"Failed to clone repository: {repository}")
                    logger.info(f"Task {task_id}: Repository cloned successfully")
                else:
                    logger.info(f"Task {task_id}: No repository specified, proceeding with task execution")
                
                # Use Claude Code SDK to execute the coding task
                logger.info(f"Task {task_id}: Starting Claude Code SDK execution")
                async def execute_claude_task():
                    options = claude_code_sdk.ClaudeCodeOptions(
                        cwd=temp_dir,
                        permission_mode="bypassPermissions"
                    )
                    messages = []
                    
                    try:
                        async for message in claude_code_sdk.query(prompt=task, options=options):
                            # Capture message type and content for better rendering
                            message_data = {}

                            match type(message).__name__:
                                case "SystemMessage":
                                    message_data["type"] = "SystemMessage"
                                    message_data["content"] = str(message.data)
                                case "ResultMessage":
                                    message_data["type"] = "ResultMessage"
                                    # Format result message as readable text
                                    result_parts = []
                                    if hasattr(message, 'total_cost_usd') and message.total_cost_usd:
                                        result_parts.append(f"Cost: ${message.total_cost_usd:.4f}")
                                    if hasattr(message, 'duration_ms') and message.duration_ms:
                                        result_parts.append(f"Duration: {message.duration_ms}ms")
                                    if hasattr(message, 'num_turns') and message.num_turns:
                                        result_parts.append(f"Turns: {message.num_turns}")
                                    if hasattr(message, 'is_error') and message.is_error:
                                        result_parts.append("Status: Error")
                                    else:
                                        result_parts.append("Status: Success")
                                    message_data["content"] = " | ".join(result_parts)

                                case "UserMessage":
                                    message_data["type"] = "UserMessage"
                                    message_data["content"] = str(message.content)
                                
                                case "AssistantMessage":
                                    message_data["type"] = "AssistantMessage"
                                    content_data = []
                                    for block in message.content:
                                        match type(block).__name__:
                                            case "TextBlock":
                                                content_data.append(block.text)
                                            case "ToolUseBlock":
                                                # Format tool use more clearly without interfering with code blocks
                                                tool_input = str(block.input) if hasattr(block, 'input') else ""
                                                content_data.append(f"🔧 Using tool: {block.name}")
                                                if block.name == "Write" and hasattr(block, 'input') and 'file_path' in block.input:
                                                    file_path = block.input.get('file_path', 'unknown')
                                                    content_data.append(f"📝 Writing file: {file_path}")
                                                elif tool_input and len(tool_input) < 200:
                                                    content_data.append(f"Input: {tool_input}")
                                            case "ToolResultBlock":
                                                if block.is_error:
                                                    content_data.append(f"❌ Tool Error: {block.content}")
                                                else:
                                                    # Limit tool result output to prevent overwhelming display
                                                    result_content = str(block.content)
                                                    if len(result_content) > 500:
                                                        result_content = result_content[:500] + "... (truncated)"
                                                    content_data.append(f"✅ Tool Result: {result_content}")
                                            case _:
                                                content_data.append(str(block))
                                    message_data["content"] = "\n".join(content_data)
                            
                            messages.append(message_data)
                        
                        logger.info(f"Task {task_id}: SDK execution completed successfully")
                        return messages
                        
                    except CLIJSONDecodeError as e:
                        logger.error(f"Task {task_id}: Claude SDK JSON decode error: {str(e)}")
                        # Return a structured error message for JSON decode issues
                        return [{
                            "type": "ErrorMessage",
                            "content": f"Claude SDK communication error: {str(e)}\n\nThis appears to be a temporary issue with the Claude Code SDK. You can try running the task again."
                        }]
                    except Exception as e:
                        logger.error(f"Task {task_id}: Unexpected error during SDK execution: {str(e)}", exc_info=True)
                        raise
                
                # Run the async function
                logger.info(f"Task {task_id}: Running async Claude task")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                response = loop.run_until_complete(execute_claude_task())
                loop.close()
                logger.info(f"Task {task_id}: Claude task completed successfully")
                
                with self.lock:
                    task_status = self.tasks[task_id]
                    task_status.status = "completed"
                    task_status.end_time = datetime.now()
                    # Store the structured messages as JSON
                    import json
                    task_status.output = json.dumps(response)
                    task_status.return_code = 0
                    logger.info(f"Task {task_id}: Marked as completed successfully")
                    
            except Exception as e:
                logger.error(f"Task {task_id}: Exception occurred - {type(e).__name__}: {str(e)}", exc_info=True)
                with self.lock:
                    task_status = self.tasks[task_id]
                    task_status.status = "failed"
                    task_status.end_time = datetime.now()
                    task_status.error = str(e)
                    task_status.return_code = -1
                    logger.error(f"Task {task_id}: Marked as failed")
            finally:
                # Keep temporary directory for file inspection
                # Note: In production, you may want to implement cleanup after some time
                pass
        
        thread = threading.Thread(target=run_task)
        thread.daemon = True
        thread.start()
        
        return task_id
    
    def get_task_status(self, task_id: str) -> Optional[Dict]:
        logger.debug(f"Getting status for task: {task_id}")
        with self.lock:
            if task_id not in self.tasks:
                logger.warning(f"Task not found: {task_id}")
                return None
            
            task = self.tasks[task_id]
            return {
                "id": task.id,
                "task": task.task,
                "status": task.status,
                "start_time": task.start_time.isoformat(),
                "end_time": task.end_time.isoformat() if task.end_time else None,
                "output": task.output,
                "error": task.error,
                "return_code": task.return_code,
                "temp_dir": task.temp_dir
            }
    
    def list_tasks(self) -> List[Dict]:
        with self.lock:
            result = []
            for task in self.tasks.values():
                result.append({
                    "id": task.id,
                    "task": task.task,
                    "status": task.status,
                    "start_time": task.start_time.isoformat(),
                    "end_time": task.end_time.isoformat() if task.end_time else None,
                    "return_code": task.return_code
                })
            return result
    
    def is_git_repository(self, directory: str) -> bool:
        """Check if a directory is a git repository"""
        try:
            # Check if directory exists
            if not os.path.exists(directory):
                return False
                
            # Try to create a Repo object - this will raise InvalidGitRepositoryError if not a git repo
            Repo(directory)
            return True
        except (InvalidGitRepositoryError, Exception) as e:
            logger.debug(f"Git repository check failed for {directory}: {e}")
            return False

    def get_git_diff(self, directory: str) -> Optional[str]:
        """Get raw git diff output including untracked files"""
        try:
            repo = Repo(directory)
            
            # Build comprehensive diff including staged, unstaged, and untracked files
            diff_parts = []
            
            try:
                # Get staged changes (--cached)
                staged_diff = repo.git.diff('--cached', '--unified=3')
                if staged_diff:
                    diff_parts.append(staged_diff)
                
                # Get unstaged changes (working directory vs index)
                unstaged_diff = repo.git.diff('--unified=3')
                if unstaged_diff:
                    diff_parts.append(unstaged_diff)
                
                # Get untracked files
                untracked_files = repo.untracked_files
                if untracked_files:
                    for file_path in untracked_files:
                        try:
                            # Create a diff-like output for untracked files
                            full_path = os.path.join(directory, file_path)
                            if os.path.isfile(full_path):
                                with open(full_path, 'r', encoding='utf-8') as f:
                                    content = f.read()
                                
                                # Format as a git diff for new file
                                untracked_diff = f"""diff --git a/{file_path} b/{file_path}
new file mode 100644
index 0000000..{('0' * 7)}
--- /dev/null
+++ b/{file_path}
@@ -0,0 +1,{len(content.splitlines())} @@
"""
                                # Add each line with + prefix
                                for line in content.splitlines():
                                    untracked_diff += f"+{line}\n"
                                
                                diff_parts.append(untracked_diff)
                        except (UnicodeDecodeError, PermissionError) as e:
                            logger.debug(f"Skipping untracked file {file_path}: {e}")
                            continue
                
                # Combine all diff parts
                if diff_parts:
                    return '\n'.join(diff_parts)
                else:
                    return None
                    
            except Exception as e:
                logger.warning(f"Error getting detailed diff for {directory}: {e}")
                # Fallback to simple diff
                try:
                    fallback_diff = repo.git.diff('HEAD', '--unified=3')
                    return fallback_diff if fallback_diff else None
                except Exception:
                    return None
            
        except Exception as e:
            logger.error(f"Error getting git diff for {directory}: {e}")
            return None

    def clone_repository(self, repository: str, target_dir: str) -> bool:
        """Clone a GitHub repository to the target directory"""
        try:
            # Parse repository format (owner/repo or full URL)
            if repository.startswith('https://github.com/'):
                repo_url = repository
            elif '/' in repository:
                repo_url = f"https://github.com/{repository}.git"
            else:
                logger.error(f"Invalid repository format: {repository}")
                return False
            
            logger.info(f"Cloning repository {repo_url} to {target_dir}")
            
            # Clone the repository
            Repo.clone_from(repo_url, target_dir)
            logger.info(f"Successfully cloned repository to {target_dir}")
            return True
            
        except Exception as e:
            logger.error(f"Error cloning repository {repository}: {e}", exc_info=True)
            return False

    def get_task_content(self, task_id: str) -> Optional[Dict]:
        """Get task content - returns git diff for git repos, otherwise returns files"""
        logger.debug(f"Getting content for task: {task_id}")
        with self.lock:
            if task_id not in self.tasks:
                logger.warning(f"Task not found when getting content: {task_id}")
                return None
            
            task = self.tasks[task_id]
            temp_dir = task.temp_dir
            
            if not temp_dir or not os.path.exists(temp_dir):
                return {"is_git_repo": False, "content_type": "files", "content": []}
            
            try:
                is_git = self.is_git_repository(temp_dir)
                
                if is_git:
                    # Return git diff for git repositories
                    try:
                        diff = self.get_git_diff(temp_dir)
                        return {
                            "is_git_repo": True,
                            "content_type": "diff",
                            "content": diff
                        }
                    except Exception as e:
                        logger.error(f"Error getting git diff for task {task_id}: {e}")
                        return {
                            "is_git_repo": True,
                            "content_type": "diff",
                            "content": None
                        }
                else:
                    # Return files for non-git directories
                    files = []
                    for root, _, filenames in os.walk(temp_dir):
                        for filename in filenames:
                            file_path = os.path.join(root, filename)
                            relative_path = os.path.relpath(file_path, temp_dir)
                            
                            try:
                                with open(file_path, 'r', encoding='utf-8') as f:
                                    content = f.read()
                                
                                # Determine file type based on extension
                                _, ext = os.path.splitext(filename)
                                file_type = ext[1:] if ext else 'text'
                                
                                files.append({
                                    "path": relative_path,
                                    "name": filename,
                                    "type": file_type,
                                    "content": content,
                                    "size": os.path.getsize(file_path)
                                })
                            except (UnicodeDecodeError, PermissionError):
                                # Skip binary files or files we can't read
                                files.append({
                                    "path": relative_path,
                                    "name": filename,
                                    "type": "binary",
                                    "content": "[Binary file]",
                                    "size": os.path.getsize(file_path)
                                })
                    
                    return {
                        "is_git_repo": False,
                        "content_type": "files",
                        "content": files
                    }
            except Exception as e:
                logger.error(f"Error in get_task_content for task {task_id}: {e}", exc_info=True)
                return {"is_git_repo": False, "content_type": "files", "content": []}

    def delete_task(self, task_id: str) -> bool:
        """Delete a task and clean up its temporary directory"""
        logger.info(f"Deleting task: {task_id}")
        with self.lock:
            if task_id not in self.tasks:
                logger.warning(f"Task not found for deletion: {task_id}")
                return False
            
            task = self.tasks[task_id]
            temp_dir = task.temp_dir
            
            # Clean up temporary directory if it exists
            if temp_dir and os.path.exists(temp_dir):
                try:
                    logger.info(f"Cleaning up temp directory: {temp_dir}")
                    shutil.rmtree(temp_dir)
                    logger.info(f"Successfully cleaned up temp directory: {temp_dir}")
                except Exception as e:
                    logger.error(f"Error cleaning up temp directory {temp_dir}: {e}", exc_info=True)
                    # Continue with task deletion even if cleanup fails
            
            # Remove task from memory
            del self.tasks[task_id]
            logger.info(f"Task {task_id} deleted successfully")
            return True

    def create_pull_request(self, task_id: str, github_token: str, pr_title: str = None, pr_body: str = None) -> Dict:
        """Create a pull request for the task changes"""
        logger.info(f"Creating pull request for task: {task_id}")
        
        with self.lock:
            if task_id not in self.tasks:
                logger.warning(f"Task not found for PR creation: {task_id}")
                return {"error": "Task not found", "success": False}
            
            task = self.tasks[task_id]
            temp_dir = task.temp_dir
            
            if not temp_dir or not os.path.exists(temp_dir):
                return {"error": "Task directory not found", "success": False}
            
            if not self.is_git_repository(temp_dir):
                return {"error": "Task is not in a git repository", "success": False}
        
        try:
            repo = Repo(temp_dir)
            
            # Get the remote origin URL to extract owner/repo
            try:
                origin_url = repo.remotes.origin.url
                logger.info(f"Repository origin URL: {origin_url}")
                
                # Parse GitHub repository info from URL
                if 'github.com' in origin_url:
                    if origin_url.startswith('https://github.com/'):
                        repo_path = origin_url.replace('https://github.com/', '').replace('.git', '')
                    elif origin_url.startswith('git@github.com:'):
                        repo_path = origin_url.replace('git@github.com:', '').replace('.git', '')
                    else:
                        return {"error": "Unable to parse GitHub repository URL", "success": False}
                    
                    owner, repo_name = repo_path.split('/', 1)
                else:
                    return {"error": "Repository is not hosted on GitHub", "success": False}
                    
            except Exception as e:
                logger.error(f"Error getting repository info: {e}")
                return {"error": "Unable to get repository information", "success": False}
            
            # Check if there are any changes to commit
            if repo.is_dirty() or repo.untracked_files:
                # Create a new branch
                branch_name = f"task-{task_id[:8]}-{int(datetime.now().timestamp())}"
                logger.info(f"Creating branch: {branch_name}")
                
                try:
                    # Create and checkout new branch
                    new_branch = repo.create_head(branch_name)
                    new_branch.checkout()
                    
                    # Add all changes
                    repo.git.add(A=True)  # Add all files including untracked
                    
                    # Commit changes
                    commit_message = pr_title or f"Task: {task.task[:60]}..." if len(task.task) > 60 else f"Task: {task.task}"
                    repo.index.commit(commit_message)
                    
                    # Push to remote
                    logger.info(f"Pushing branch {branch_name} to remote")
                    origin = repo.remotes.origin
                    origin.push(refspec=f"{branch_name}:{branch_name}")
                    
                except Exception as e:
                    logger.error(f"Error creating branch and pushing: {e}")
                    return {"error": f"Failed to create branch: {str(e)}", "success": False}
            else:
                return {"error": "No changes to create pull request", "success": False}
            
            # Create pull request using GitHub API
            headers = {
                'Authorization': f'token {github_token}',
                'Accept': 'application/vnd.github.v3+json',
                'Content-Type': 'application/json'
            }
            
            # Default PR title and body if not provided
            if not pr_title:
                pr_title = f"AI Generated Changes: {task.task[:60]}..." if len(task.task) > 60 else f"AI Generated Changes: {task.task}"
            
            if not pr_body:
                pr_body = f"""## AI Generated Changes

**Task:** {task.task}

**Task ID:** {task_id}

This pull request contains changes generated by an AI coding assistant.

### Changes Summary
This PR includes the modifications made to fulfill the requested task.

---
*Generated automatically by Junior AI Assistant*"""
            
            pr_data = {
                'title': pr_title,
                'body': pr_body,
                'head': branch_name,
                'base': 'main'  # Try main first
            }
            
            api_url = f'https://api.github.com/repos/{owner}/{repo_name}/pulls'
            logger.info(f"Creating PR via GitHub API: {api_url}")
            
            response = requests.post(api_url, headers=headers, json=pr_data)
            
            # If main branch doesn't exist, try master
            if response.status_code == 422 and 'base' in response.text:
                logger.info("Main branch not found, trying master branch")
                pr_data['base'] = 'master'
                response = requests.post(api_url, headers=headers, json=pr_data)
            
            if response.status_code == 201:
                pr_info = response.json()
                logger.info(f"Pull request created successfully: {pr_info['html_url']}")
                return {
                    "success": True,
                    "pr_url": pr_info['html_url'],
                    "pr_number": pr_info['number'],
                    "branch_name": branch_name,
                    "message": "Pull request created successfully"
                }
            else:
                logger.error(f"GitHub API error: {response.status_code} - {response.text}")
                return {
                    "error": f"GitHub API error: {response.status_code} - {response.json().get('message', 'Unknown error')}",
                    "success": False
                }
                
        except Exception as e:
            logger.error(f"Error creating pull request for task {task_id}: {e}", exc_info=True)
            return {"error": f"Failed to create pull request: {str(e)}", "success": False}

server = TaskServer()

@app.route('/execute', methods=['POST'])
def execute_task():
    try:
        data = request.get_json()
        logger.info(f"Received execute request: {data}")
        if not data or 'task' not in data:
            logger.warning("Missing 'task' field in request")
            return jsonify({"error": "Missing 'task' field"}), 400
    
        task = data['task']
        repository = data.get('repository')  # Optional repository parameter
        task_id = server.execute_task(task, repository)
        
        logger.info(f"Task submitted successfully with ID: {task_id}")
        return jsonify({
            "task_id": task_id,
            "message": "Task submitted for execution"
        })
    except Exception as e:
        logger.error(f"Error in execute_task endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/status/<task_id>', methods=['GET'])
def get_status(task_id):
    try:
        logger.debug(f"Status request for task: {task_id}")
        status = server.get_task_status(task_id)
        if status is None:
            return jsonify({"error": "Task not found"}), 404
        
        return jsonify(status)
    except Exception as e:
        logger.error(f"Error in get_status endpoint for task {task_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/tasks', methods=['GET'])
def list_tasks():
    try:
        logger.debug("Listing all tasks")
        tasks = server.list_tasks()
        return jsonify({
            "tasks": tasks,
            "total": len(tasks)
        })
    except Exception as e:
        logger.error(f"Error in list_tasks endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/running', methods=['GET'])
def list_running():
    try:
        logger.debug("Listing running tasks")
        all_tasks = server.list_tasks()
        running = [task for task in all_tasks if task['status'] == 'running']
        return jsonify({
            "running_tasks": running,
            "count": len(running)
        })
    except Exception as e:
        logger.error(f"Error in list_running endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/completed', methods=['GET'])
def list_completed():
    try:
        logger.debug("Listing completed tasks")
        all_tasks = server.list_tasks()
        completed = [task for task in all_tasks if task['status'] in ['completed', 'failed']]
        return jsonify({
            "completed_tasks": completed,
            "count": len(completed)
        })
    except Exception as e:
        logger.error(f"Error in list_completed endpoint: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/content/<task_id>', methods=['GET'])
def get_task_content(task_id):
    try:
        logger.debug(f"Content request for task: {task_id}")
        content_data = server.get_task_content(task_id)
        if content_data is None:
            return jsonify({"error": "Task not found"}), 404

        response = {
            "task_id": task_id,
            "is_git_repo": content_data["is_git_repo"],
            "content_type": content_data["content_type"],
            "content": content_data["content"]
        }
        
        # Add count for files content type
        if content_data["content_type"] == "files" and isinstance(content_data["content"], list):
            response["count"] = len(content_data["content"])
        
        return jsonify(response)
    except Exception as e:
        logger.error(f"Error in get_task_content endpoint for task {task_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/delete/<task_id>', methods=['DELETE'])
def delete_task(task_id):
    try:
        logger.info(f"Delete request for task: {task_id}")
        success = server.delete_task(task_id)
        if not success:
            return jsonify({"error": "Task not found"}), 404
        
        return jsonify({
            "message": "Task deleted successfully",
            "task_id": task_id
        })
    except Exception as e:
        logger.error(f"Error in delete_task endpoint for task {task_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

@app.route('/create-pr/<task_id>', methods=['POST'])
def create_pr(task_id):
    try:
        data = request.get_json()
        logger.info(f"PR creation request for task: {task_id}")
        
        if not data:
            return jsonify({"error": "Request body required"}), 400
        
        github_token = data.get('github_token')
        if not github_token:
            return jsonify({"error": "GitHub token is required"}), 400
        
        pr_title = data.get('pr_title')
        pr_body = data.get('pr_body')
        
        result = server.create_pull_request(task_id, github_token, pr_title, pr_body)
        
        if result.get('success'):
            return jsonify(result)
        else:
            return jsonify(result), 400
            
    except Exception as e:
        logger.error(f"Error in create_pr endpoint for task {task_id}: {e}", exc_info=True)
        return jsonify({"error": "Internal server error"}), 500

if __name__ == '__main__':
    logger.info("Coding Task Execution Server starting...")
    logger.info("API Endpoints:")
    logger.info("  POST /execute - Submit a coding task for execution")
    logger.info("  GET /status/<task_id> - Get status of a specific task")
    logger.info("  GET /content/<task_id> - Get task content (git diff for repos, files otherwise)")
    logger.info("  DELETE /delete/<task_id> - Delete a task and clean up its temp directory")
    logger.info("  POST /create-pr/<task_id> - Create a GitHub pull request for task changes")
    logger.info("  GET /tasks - List all tasks")
    logger.info("  GET /running - List running tasks")
    logger.info("  GET /completed - List completed tasks")
    logger.info("")
    logger.info("Using Claude Code SDK for task execution")
    logger.info("Server will run on port 8080")
    
    try:
        app.run(port=8080, debug=False, threaded=True)
    except Exception as e:
        logger.critical(f"Failed to start server: {e}", exc_info=True)
        sys.exit(1)