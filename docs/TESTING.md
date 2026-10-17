# Testing Guide

Complete testing setup for ComfyUI MOE infrastructure.

## Quick Start

```bash
cd ~/workspaces/comfy_workflow/infra/scripts

# Install test dependencies
pip install -r requirements.txt

# Run all tests
pytest tests/ -v

# Run with coverage report
pytest tests/ --cov=. --cov-report=html
# → htmlcov/index.html
```

## Test Structure

```
infra/scripts/tests/
├── __init__.py
├── test_pool_manager.py      # Pod orchestration tests
├── test_oauth_handler.py      # OAuth & authentication tests
├── test_mcp_server.py         # MCP tool endpoint tests
└── conftest.py                # Shared fixtures (future)
```

## Test Categories

### Unit Tests (Fast, Mocked)

**Pool Manager** (`test_pool_manager.py`):
- ✅ `test_pool_manager_init` — Initialization
- ✅ `test_create_pod_success` — Pod creation with mock API
- ✅ `test_create_pod_api_error` — Error handling
- ✅ `test_get_pod_status_running` — Status queries
- ✅ `test_stop_pod_success` — Pod lifecycle
- ✅ `test_resume_pod_success` — Resume ops
- ✅ `test_delete_pod_success` — Cleanup
- ✅ `test_get_pool_status_empty` — Empty pool metrics
- ✅ `test_get_pool_status_with_agents` — Pool metrics
- ✅ `test_health_check_agent_healthy` — Health checks
- ✅ `test_health_check_agent_unhealthy` — Error handling

**OAuth Handler** (`test_oauth_handler.py`):
- ✅ `test_get_authorization_url` — OAuth URL generation
- ✅ `test_exchange_code_for_token` — Token exchange
- ✅ `test_get_user_info` — User info fetching
- ✅ `test_create_access_token` — JWT generation
- ✅ `test_create_refresh_token` — Refresh token
- ✅ `test_verify_token_valid` — Token validation
- ✅ `test_verify_token_invalid` — Invalid token handling
- ✅ `test_verify_token_expired` — Expiry handling
- ✅ `test_token_scope_validation` — Scope checking

**Run unit tests:**
```bash
pytest tests/ -m "not integration" -v
```

### Integration Tests (Slow, Real API)

Requires `RUNPOD_API_KEY` environment variable.

**Pool Manager Integration:**
- `test_full_pod_lifecycle` — Create → check → stop → resume → delete

**Run integration tests:**
```bash
export RUNPOD_API_KEY="rpa_..."
pytest tests/ -m integration -v
```

⚠️ **Warning:** Integration tests create real GPU pods and **will incur charges** (~$0.42/hour).

## Mocking Strategy

### HTTP Mocks

All API calls are mocked using `AsyncMock`:

```python
mock_response = AsyncMock()
mock_response.json.return_value = {
    "data": {"pod": {...}}
}

with patch.object(pool_manager.client, "post", return_value=mock_response):
    status = await pool_manager.get_pod_status("pod-id")
```

### Why Mock?
- Tests run instantly (no waiting for RunPod API)
- No API quota consumption
- Deterministic (same response every time)
- Can test error cases easily

### When to Use Real API?
- Final integration test before deploying to production
- Validate RunPod SDK compatibility
- Load testing (how many concurrent pods?)

## Coverage Report

```bash
pytest tests/ --cov=. --cov-report=html
open htmlcov/index.html
```

Coverage targets:
- `pool_manager.py` — **90%+** (core business logic)
- `oauth_handler.py` — **85%+** (auth critical)
- `mcp_server.py` — **75%+** (tool integration)

## Async Testing

All async functions use `@pytest.mark.asyncio`:

```python
@pytest.mark.asyncio
async def test_create_pod_success(pool_manager, sample_pod_config):
    agent = await pool_manager.create_pod(config, "pod-name")
    assert agent.status == "running"
```

**Requirements:**
- `pytest-asyncio` (installed)
- Config in `pytest.ini`: `asyncio_mode = auto`

## Test Data & Fixtures

Reusable test data via pytest fixtures:

```python
@pytest.fixture
def sample_pod_config():
    return PodConfig(
        agent_name="image-gen",
        gpu_type="rtx4090",
        storage_gb=100
    )

def test_create_pod(pool_manager, sample_pod_config):
    # Uses fixture automatically
    agent = await pool_manager.create_pod(sample_pod_config, ...)
```

See top of each test file for all available fixtures.

## Continuous Integration

### GitHub Actions (Future)

```yaml
name: Tests
on: [push, pull_request]
jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v2
      - uses: actions/setup-python@v2
        with: { python-version: 3.11 }
      - run: pip install -r infra/scripts/requirements.txt
      - run: pytest infra/scripts/tests/ -v
      - run: pytest infra/scripts/tests/ --cov --cov-report=xml
      - uses: codecov/codecov-action@v2
```

### Local Pre-commit (Optional)

```bash
# Install pre-commit hooks
pre-commit install

# Tests run automatically on git commit
# Can be skipped with: git commit --no-verify
```

## Common Test Patterns

### Test API Errors

```python
@pytest.mark.asyncio
async def test_api_error_handling(pool_manager):
    mock_response = AsyncMock()
    mock_response.json.return_value = {
        "errors": [{"message": "Quota exceeded"}]
    }
    
    with patch.object(pool_manager.client, "post", return_value=mock_response):
        with pytest.raises(Exception, match="RunPod API error"):
            await pool_manager.create_pod(config, "pod")
```

### Test State Changes

```python
@pytest.mark.asyncio
async def test_pod_state_transition(pool_manager, sample_agent):
    pool_manager.agents[sample_agent.agent_id] = sample_agent
    initial_status = sample_agent.status
    
    await pool_manager.stop_pod(sample_agent.pod_id)
    
    assert sample_agent.status != initial_status
    assert sample_agent.status == "stopped"
```

### Test with Multiple Scenarios

```python
@pytest.mark.parametrize("gpu_type,expected_cost", [
    ("rtx4090", 0.42),
    ("a100", 1.00),
    ("h100", 1.50),
])
async def test_pod_costs(gpu_type, expected_cost):
    # Runs 3 times with different inputs
    assert get_cost(gpu_type) == expected_cost
```

## Debugging Tests

### Verbose Output

```bash
pytest tests/test_pool_manager.py::test_create_pod_success -vv
```

### Print Debug Info

```python
@pytest.mark.asyncio
async def test_with_debug():
    result = await some_async_func()
    print(f"\nDebug: {result}")  # Shows in output with -s
    assert result.status == "running"
```

Run with `-s` to see prints:
```bash
pytest tests/ -s -v
```

### Drop into Debugger

```python
import pdb; pdb.set_trace()
```

Or use pytest's built-in:
```bash
pytest tests/ --pdb
```

## Test Performance

### Timeout

Tests timeout after 30 seconds (see `pytest.ini`):

```bash
pytest tests/ --timeout=60  # Override to 60 seconds
```

### Slow Tests

Mark slow tests and run them separately:

```python
@pytest.mark.slow
async def test_full_pod_lifecycle():
    # Takes > 1 second
    ...
```

Run only fast tests:
```bash
pytest tests/ -m "not slow" -v
```

## Known Issues & Limitations

### Async Context

Some tests need special handling for async context:

```python
# ❌ Won't work (not awaited)
def test_create_pod(pool_manager):
    agent = pool_manager.create_pod(...)  # Missing await

# ✅ Correct
@pytest.mark.asyncio
async def test_create_pod(pool_manager):
    agent = await pool_manager.create_pod(...)
```

### Mocking httpx.AsyncClient

Direct httpx mocking is tricky. Use `patch.object()`:

```python
# ✅ Correct
with patch.object(pool_manager.client, "post", return_value=mock):
    result = await pool_manager.get_pod_status(...)
```

## Future: Test Enhancements

- [ ] MCP server tool endpoint tests
- [ ] FastAPI endpoint integration tests
- [ ] Load testing (1000+ pods)
- [ ] Chaos testing (random API failures)
- [ ] Performance benchmarks

## Questions?

See `CLAUDE.md` for conventions, or check inline test comments.
