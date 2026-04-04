# Firecracker-Based Serverless Runtime

> An AWS Lambda-like execution platform built on Firecracker microVMs — exploring microVM isolation, snapshot-based cold starts, IPC, and multi-tenant scheduling.

---

## Overview

This project is a high-performance serverless execution platform that runs user-submitted functions inside isolated Firecracker microVMs. It demonstrates how modern serverless platforms like AWS Lambda work under the hood, with a focus on low-latency execution, strong isolation, and high throughput.

---

## Features

### MicroVM-Based Isolation

- Each function runs inside a dedicated **Firecracker microVM**
- Minimal attack surface using a custom kernel and rootfs
- Stronger isolation compared to traditional containers

### Snapshot-Based Cold Start Optimization

Pre-initialized VM state is snapshotted and restored on each invocation, dramatically reducing startup time:

| Boot Method | Latency |
|---|---|
| Cold boot | ~200ms |
| Snapshot restore | ~1–5ms |

### High-Performance IPC

- Host ↔ VM communication via **vsock**
- Internal routing via **Unix domain sockets**
- Eliminated per-request connection overhead for better throughput

### Custom Runtime

- Node.js-based runtime executing user handlers
- Deterministic execution model: 1 request → 1 execution → response
- Handles success, errors, and malformed input

### Control Plane & VM Manager

- Manages function deployment and VM lifecycle (create, snapshot, restore, destroy)
- Routes invocations and enforces execution boundaries and resource limits

### Multi-Tenant Scheduling

- Per-function queues with concurrency control
- Fair scheduling across multiple concurrent workloads

---

## Architecture

```
Client Request (HTTP)
        ↓
Control Plane (Node.js)
        ↓
Scheduler / VM Manager
        ↓
Firecracker MicroVM (snapshot restore)
        ↓
Runtime (Node.js)
        ↓
User Handler Execution
        ↓
Response → Client
```

---

## Execution Flow

1. User deploys function code
2. System builds a minimal rootfs containing the user code
3. Firecracker VM boots and the runtime initializes
4. A snapshot of the initialized VM state is created
5. On each invocation:
   - VM is restored from the snapshot
   - Request is sent via vsock
   - Runtime executes the handler
   - Response is returned to the client

---

## Performance

Benchmarked using [`autocannon`](https://github.com/mcollina/autocannon) with 10 concurrent connections over 30 seconds:

| Metric | Result |
|---|---|
| Throughput | ~5,400 req/sec |
| p50 latency | ~1ms |
| p99 latency | ~4ms |
| Total requests | ~164,000 |

**Key optimizations:** snapshot reuse, persistent runtime, reduced IPC overhead.

---

## Tech Stack

| Component | Technology |
|---|---|
| MicroVMs | Firecracker |
| Control plane & runtime | Node.js / Express |
| Virtualization | Linux (KVM, namespaces) |
| Host ↔ VM IPC | vsock |
| Intra-VM IPC | Unix domain sockets |
| Benchmarking | autocannon |

---

## Design Tradeoffs

| Aspect | Decision |
|---|---|
| Latency | Warm execution reuse for low latency |
| Isolation | Strong VM isolation; runtime reuse introduces shared state |
| Throughput | Optimized for high throughput over strict per-request isolation |

---

## Future Improvements

- Warm VM pool for faster horizontal scaling
- Per-function autoscaling
- Rate limiting and priority scheduling
- Distributed execution across multiple hosts
---

## Why This Project Matters

 It demonstrates:

- Deep understanding of **OS-level virtualization**
- Practical use of **Firecracker and microVMs**
- Handling of **real-world concurrency challenges**
- Thoughtful tradeoffs between **latency, isolation, and throughput**
- System design comparable to **production serverless platforms**

---

## Author

**Vivek Jadhav** — [github.com/vivek1504](https://github.com/vivek1504)


