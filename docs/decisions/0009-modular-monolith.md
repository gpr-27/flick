# ADR-0009: Modular monolith

- **Status:** Accepted (2026-10-24)

## Context

One developer has to build, run and explain the whole system.

## Decision

Two deployables in one repo (npm workspaces):

- `apps/api`: Fastify HTTP API, Socket.IO gateway and the dispatcher.
- `apps/worker`: pg-boss jobs only.

Code is split into modules (`messages`, `conversations`, `media`, `gateway`, ...) with plain functions and explicit
dependencies. Shared types live in `packages/contracts`. Modules do not reach into each other's tables.

## Alternatives

- **Microservices.** Network calls, deployments and monitoring for no gain at this size.
- **One process for everything.** Simpler, but jobs and live traffic would compete for the same CPU.

## Trade-offs

A bad API deploy affects HTTP and sockets together. The module borders make a later split possible.

## Consequences

- Few things to run locally: Postgres, Redis, MinIO, API, worker, web.
