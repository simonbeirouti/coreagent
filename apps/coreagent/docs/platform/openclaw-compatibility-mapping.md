# OpenClaw Compatibility Mapping

CoreAgent supports OpenClaw-style metadata via `manifest.openclaw` during publish validation.

## Supported mappings

| OpenClaw field | CoreAgent field |
| --- | --- |
| `tool_name` | `name` |
| `tool_description` | `description` |
| `tool_runtime` | `runtime` |
| `tool_entrypoint` | `entrypoint` |
| `tool_permissions` | `permissions` |
| `min_app_version` | `compatibility.min_app_version` |
| `max_app_version` | `compatibility.max_app_version` |

## Example

```json
{
  "openclaw": {
    "tool_name": "Repo Scanner",
    "tool_description": "Scans a repo for dependency issues",
    "tool_runtime": "command",
    "tool_entrypoint": "scripts/run.sh",
    "min_app_version": "1.0.0",
    "max_app_version": "2.0.0",
    "tool_permissions": [
      {
        "permission_key": "filesystem.read",
        "required": true,
        "risk_level": "low",
        "permission_scope": { "allowedPaths": ["workspace"] }
      }
    ]
  }
}
```

## Validation behavior

- Unsupported fields inside `openclaw` fail validation with an explicit mapping error.
- Direct request fields remain authoritative; mapped values are normalized before policy checks.
- Compatibility version checks still enforce semver ranges and app runtime constraints.
