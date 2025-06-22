#!/usr/bin/env python3
import requests
import json
import time

BASE_URL = "http://localhost:8080"

def test_server():
    print("Testing Command Execution Server")
    print("=" * 40)
    
    # Test 1: Submit a quick command
    print("\n1. Testing quick command execution:")
    response = requests.post(f"{BASE_URL}/execute", json={"command": "echo 'Hello World'"})
    if response.status_code == 200:
        data = response.json()
        command_id1 = data["command_id"]
        print(f"   Command submitted: {command_id1}")
        
        # Check status
        time.sleep(1)
        status_response = requests.get(f"{BASE_URL}/status/{command_id1}")
        if status_response.status_code == 200:
            status = status_response.json()
            print(f"   Status: {status['status']}")
            print(f"   Output: {status['output'].strip()}")
    
    # Test 2: Submit a long-running command
    print("\n2. Testing long-running command:")
    response = requests.post(f"{BASE_URL}/execute", json={"command": "sleep 5 && echo 'Long task completed'"})
    if response.status_code == 200:
        data = response.json()
        command_id2 = data["command_id"]
        print(f"   Long command submitted: {command_id2}")
        
        # Check running commands
        running_response = requests.get(f"{BASE_URL}/running")
        if running_response.status_code == 200:
            running = running_response.json()
            print(f"   Currently running commands: {running['count']}")
    
    # Test 3: List all commands
    print("\n3. Listing all commands:")
    all_response = requests.get(f"{BASE_URL}/commands")
    if all_response.status_code == 200:
        all_commands = all_response.json()
        print(f"   Total commands: {all_commands['total']}")
        for cmd in all_commands['commands']:
            print(f"     - {cmd['id'][:8]}... | {cmd['command']} | {cmd['status']}")
    
    # Wait for long command to complete
    print("\n4. Waiting for long command to complete...")
    for i in range(6):
        time.sleep(1)
        status_response = requests.get(f"{BASE_URL}/status/{command_id2}")
        if status_response.status_code == 200:
            status = status_response.json()
            print(f"   Status check {i+1}: {status['status']}")
            if status['status'] != 'running':
                print(f"   Final output: {status['output'].strip()}")
                break
    
    # Test 4: Check completed commands
    print("\n5. Checking completed commands:")
    completed_response = requests.get(f"{BASE_URL}/completed")
    if completed_response.status_code == 200:
        completed = completed_response.json()
        print(f"   Completed commands: {completed['count']}")

if __name__ == "__main__":
    try:
        test_server()
    except requests.exceptions.ConnectionError:
        print("Error: Could not connect to server. Make sure the server is running on port 5000.")
    except Exception as e:
        print(f"Error: {e}")