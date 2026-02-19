# Omniclaws Local Agent

Run AI tasks locally with Ollama - zero API costs, 100% profit margin.

## Setup

1. **Register your agent:**
   ```powershell
   Invoke-RestMethod -Uri "https://omniclaws.brandonlacoste9.workers.dev/agent/register" -Method POST -ContentType "application/json" -Body '{"agentId":"north-pc-1","name":"Northern Alliance Local","capabilities":["ollama"]}'
   ```
   Copy the `secret` from the response.

2. **Edit `agent.py`:** Set `AGENT_ID` and `AGENT_SECRET`.

3. **Start Ollama:**
   ```bash
   ollama serve
   ollama pull llama2
   ```

4. **Run the agent:**
   ```bash
   pip install requests
   python agent.py
   ```

## Submit a test task

```powershell
Invoke-RestMethod -Uri "https://omniclaws.brandonlacoste9.workers.dev/agent/submit" -Method POST -ContentType "application/json" -Body '{"userId":"test-user","agentId":"north-pc-1","prompt":"What is 2+2?"}'
```

The agent will pick it up within 10 seconds and return the result.
