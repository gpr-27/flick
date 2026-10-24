# ADR-0015: Fastify for the HTTP API

- **Status:** Accepted (2026-10-24)
- **Related:** ADR-0001, ADR-0009

## Context

We need an HTTP server for REST routes, upload hand-offs and health checks. Socket.IO attaches to the same server.

## Decision

Use **Fastify** with zod schemas from `packages/contracts` for request and response validation.

## Alternatives

- **Express.** It works, but validation, typing and async errors need add-ons.
- **NestJS.** Heavy, with decorators and many concepts to explain.

## Trade-offs

A smaller ecosystem than Express. Fastify's plugin model needs a short learning step.

## Consequences

- Routes are small functions. Validation errors come out in one consistent shape.
