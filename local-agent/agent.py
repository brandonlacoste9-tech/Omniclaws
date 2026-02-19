#!/usr/bin/env python3
"""
Omniclaws Local Agent - Poll for tasks, execute via Ollama, return results.
Zero API costs, 100% profit margin.
"""

import json
import subprocess
import time

try:
    import requests
except ImportError:
    print("Install requests: pip install requests")
    exit(1)

OMNICLAWS_URL = "https://omniclaws.brandonlacoste9.workers.dev"
AGENT_ID = "north-pc-1"
AGENT_SECRET = "agent-51b7b9936b964209897ac5511ef36142"
OLLAMA_URL = "http://localhost:11434/api/generate"
OLLAMA_MODEL = "llama2"
POLL_INTERVAL_SEC = 10


def poll_tasks():
    """Poll for pending tasks assigned to this agent."""
    resp = requests.get(
        f"{OMNICLAWS_URL}/agent/poll",
        params={"agentId": AGENT_ID, "secret": AGENT_SECRET},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    return data.get("tasks", [])


def execute_ollama(prompt: str) -> str:
    """Call local Ollama to generate response."""
    payload = {
        "model": OLLAMA_MODEL,
        "prompt": prompt,
        "stream": False,
    }
    try:
        result = subprocess.run(
            ["curl", "-s", OLLAMA_URL, "-d", json.dumps(payload)],
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode != 0:
            return f"Error: {result.stderr or 'Ollama failed'}"
        out = json.loads(result.stdout)
        return out.get("response", "")
    except subprocess.TimeoutExpired:
        return "Error: Ollama timeout"
    except json.JSONDecodeError as e:
        return f"Error: Invalid Ollama response - {e}"
    except FileNotFoundError:
        resp = requests.post(OLLAMA_URL, json=payload, timeout=120)
        if resp.ok:
            return resp.json().get("response", "")
        return f"Error: Ollama {resp.status_code}"


def complete_task(task_id: str, result: str) -> dict:
    """Submit task result to Omniclaws."""
    resp = requests.post(
        f"{OMNICLAWS_URL}/agent/complete",
        json={
            "taskId": task_id,
            "result": result,
            "agentId": AGENT_ID,
            "secret": AGENT_SECRET,
        },
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def main():
    print(f"Omniclaws Local Agent - {AGENT_ID}")
    print(f"Polling {OMNICLAWS_URL} every {POLL_INTERVAL_SEC}s")
    print("Press Ctrl+C to stop\n")

    while True:
        try:
            tasks = poll_tasks()
            for task in tasks:
                task_id = task.get("id", "?")
                payload = task.get("payload", {})
                prompt = payload.get("prompt", "Hello, respond briefly.")

                print(f"Executing task {task_id}...")
                result = execute_ollama(prompt)
                complete_task(task_id, result)
                print(f"Task {task_id} completed. Earned $0.50")
        except requests.exceptions.RequestException as e:
            print(f"Error: {e}")
        except Exception as e:
            print(f"Error: {e}")
        time.sleep(POLL_INTERVAL_SEC)


if __name__ == "__main__":
    main()
