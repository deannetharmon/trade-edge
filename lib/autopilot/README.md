# Autopilot Core Modules

This folder contains the paper-mode Autopilot backend foundation.

## Sprint 1A Scope

Sprint 1A includes only core infrastructure:

- Types and models
- Config defaults and validation
- Redis persistence helpers
- Paper account persistence
- Decision log persistence
- Health/state/config API foundations

Sprint 1A intentionally excludes:

- Candidate scanning
- Paper trade execution
- Position management
- Cron execution
- Live order placement

## Safety Rule

No file in this folder may place live orders in Paper Mode v1.0.
