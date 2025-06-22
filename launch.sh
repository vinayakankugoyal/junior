#!/bin/bash
set -e  # Exit immediately if a command exits with a non-zero status

# Launch script for Junior project
# Starts both frontend and backend services

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${BLUE}🚀 Starting Junior Project...${NC}"

# Function to kill background processes on exit
cleanup() {
    echo -e "\n${YELLOW}Shutting down services...${NC}"
    kill $BACKEND_PID 2>/dev/null
    kill $FRONTEND_PID 2>/dev/null
    exit 0
}

# Function to handle errors
error_exit() {
    echo -e "\n${RED}❌ Error: $1${NC}"
    cleanup
    exit 1
}

# Set trap to cleanup on exit and error
trap cleanup SIGINT SIGTERM
trap 'error_exit "Script failed at line $LINENO"' ERR

# Check if required directories exist
if [ ! -d "backend" ]; then
    error_exit "Backend directory not found"
fi

if [ ! -d "frontend" ]; then
    error_exit "Frontend directory not found"
fi

# Start backend server
echo -e "${GREEN}📡 Starting backend server...${NC}"
cd backend
if ! uv run command_server.py > ../backend.log 2>&1 &
then
    error_exit "Failed to start backend server"
fi
BACKEND_PID=$!
cd ..

# Check if backend process is still running
sleep 2
if ! kill -0 $BACKEND_PID 2>/dev/null; then
    echo -e "${RED}Backend server failed to start. Check backend.log for details:${NC}"
    tail backend.log
    error_exit "Backend server startup failed"
fi

# Start frontend server
echo -e "${GREEN}🌐 Starting frontend server...${NC}"
cd frontend
if ! npm run dev > ../frontend.log 2>&1 &
then
    error_exit "Failed to start frontend server"
fi
FRONTEND_PID=$!
cd ..

# Check if frontend process is still running
sleep 3
if ! kill -0 $FRONTEND_PID 2>/dev/null; then
    echo -e "${RED}Frontend server failed to start. Check frontend.log for details:${NC}"
    tail frontend.log
    error_exit "Frontend server startup failed"
fi

echo -e "\n${BLUE}✅ Services started successfully!${NC}"
echo -e "${GREEN}Backend:${NC}  http://localhost:8080"
echo -e "${GREEN}Frontend:${NC} http://localhost:3000"
echo -e "\n${YELLOW}Logs:${NC} backend.log, frontend.log"
echo -e "${YELLOW}Press Ctrl+C to stop all services${NC}"

# Wait for background processes
wait