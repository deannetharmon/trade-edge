# Trade Edge Engineering Principles

## Purpose

This document defines how Trade Edge should be built as the application grows.

## Core Principles

### 1. Keep business logic outside React components

React components should render UI and wire user interactions. Trading logic, task orchestration, command routing, and calculations should live in plain TypeScript modules where possible.

### 2. Providers expose services; they do not implement business logic

Providers should mount and expose services such as TaskManager and CommandBus. They should not become workflow engines.

### 3. Separate intent from execution state

The Command Bus answers: what should happen?

The Task Manager answers: what is happening now?

Do not merge those responsibilities.

### 4. Keep infrastructure dependency-light

Avoid unnecessary libraries for small internal infrastructure. Prefer clear, testable TypeScript.

### 5. Preserve scope discipline

Each ticket should implement only what the ticket requires. Do not opportunistically implement future roadmap items.

### 6. Prefer reviewable changes

Large architectural changes should be broken into small commits and reviewed before moving on.

### 7. Every long-term architecture decision should have an ADR

Use `docs/decisions/` for decisions that affect product behavior, architecture, future workflows, or safety boundaries.

### 8. AI-generated recommendations must be explainable

Future AI workflows should produce reviewable reasoning, inputs, and outputs.

### 9. Paper-mode and live execution must remain clearly separated

Trade Edge must not silently cross from recommendation or paper-mode behavior into live execution behavior.

### 10. Existing behavior should remain stable unless the ticket explicitly changes it

Infrastructure tickets should not introduce visible UI changes or alter existing workflows unless that is the stated purpose.
