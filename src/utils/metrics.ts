import {
  Registry,
  Counter,
  Histogram,
  Gauge,
  collectDefaultMetrics,
} from "prom-client";

export const register = new Registry();

collectDefaultMetrics({ register });

export const httpRequestDuration = new Histogram({
  name: "http_request_duration",
  help: "Duration of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const httpRequestsTotal = new Counter({
  name: "total_http_requests",
  help: "Total number of HTTP requests",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const deployTotal = new Counter({
  name: "total_deployments",
  help: "Total deployment attempts",
  labelNames: ["status"],
  registers: [register],
});

export const deployStageDuration = new Histogram({
  name: "deploy_stage_duration",
  help: "Duration of each deployment pipeline stage",
  labelNames: ["stage"],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [register],
});

export const deployQueueDepth = new Gauge({
  name: "deploy_queue_depth",
  help: "Current number of jobs in the deploy queue",
  registers: [register],
});

export const deployQueueWaitTime = new Histogram({
  name: "deploy_queue_wait_time",
  help: "Time a deploy job spends waiting in queue before execution",
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

export const vmCount = new Gauge({
  name: "active_vm_count",
  help: "Number of currently active VMs",
  labelNames: ["function_id", "state"],
  registers: [register],
});

export const vmCreationTime = new Histogram({
  name: "vm_creation_time",
  help: "Time to create and restore a VM from snapshot",
  buckets: [0.1, 0.25, 0.5, 1, 2, 5],
  registers: [register],
});

export const vmCreationTotal = new Counter({
  name: "total_vm_created",
  help: "Total VMs created",
  labelNames: ["status"],
  registers: [register],
});

export const vmCleanupTotal = new Counter({
  name: "total_vm_cleanups",
  help: "Total VMs cleaned up",
  registers: [register],
});

export const invocationTotal = new Counter({
  name: "total_invocations",
  help: "Total function invocations",
  labelNames: ["function_id", "status"],
  registers: [register],
});

export const invocationTime = new Histogram({
  name: "invocation_time",
  help: "End-to-end function invocation time",
  labelNames: ["function_id"],
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const invocationQueueDepth = new Gauge({
  name: "invocation_queue_depth",
  help: "Current request queue depth per function",
  labelNames: ["function_id"],
  registers: [register],
});

export const vsockConnectionTime = new Histogram({
  name: "vsock_connection_time",
  help: "Time to establish vsock connection",
  buckets: [0.01, 0.05, 0.1, 0.25, 0.5, 1, 2],
  registers: [register],
});

export const vsockErrors = new Counter({
  name: "vsock_errors_total",
  help: "Total vsock connection/read errors",
  labelNames: ["error_type"],
  registers: [register],
});

export const schedulerEnqueueDuration = new Histogram({
  name: "scheduler_enqueue_duration_seconds",
  help: "Time spent in enqueueRequest (registration + queue push)",
  buckets: [0.00001, 0.00005, 0.0001, 0.0005, 0.001, 0.005, 0.01],
  registers: [register],
});

export const schedulerDrainCycleDuration = new Histogram({
  name: "scheduler_drain_cycle_duration_seconds",
  help: "Wall-clock time of a single drainBatch() call",
  buckets: [0.0001, 0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5],
  registers: [register],
});

export const schedulerDispatchDuration = new Histogram({
  name: "scheduler_dispatch_overhead_seconds",
  help: "Overhead per dispatch (dequeue + state transition, excludes sendRequest)",
  buckets: [0.000001, 0.000005, 0.00001, 0.00005, 0.0001, 0.0005],
  registers: [register],
});

export const schedulerVmLookupDuration = new Histogram({
  name: "scheduler_vm_lookup_duration_seconds",
  help: "Time to find a ready VM from the readyVms index",
  buckets: [0.000001, 0.000005, 0.00001, 0.00005, 0.0001],
  registers: [register],
});

export const schedulerVmProvisionDuration = new Histogram({
  name: "scheduler_vm_provision_duration_seconds",
  help: "End-to-end time for async VM provisioning (createVm call)",
  buckets: [0.1, 0.25, 0.5, 1, 2, 5, 10],
  registers: [register],
});

export const schedulerDrainIterations = new Histogram({
  name: "scheduler_drain_iterations",
  help: "Number of dispatch iterations per drainBatch() call",
  buckets: [1, 5, 10, 25, 50, 100, 250, 512],
  registers: [register],
});

export const schedulerQueueWaitTime = new Histogram({
  name: "scheduler_queue_wait_time_seconds",
  help: "Time a request spends waiting in the scheduler queue before dispatch",
  labelNames: ["function_id"],
  buckets: [0.001, 0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
  registers: [register],
});

export const execSessionsActive = new Gauge({
  name: "exec_sessions_active",
  help: "Active sessions",
  registers: [register],
});

export const execSessionDurationSeconds = new Histogram({
  name: "exec_session_duration_seconds",
  help: "Session lifetime",
  buckets: [1, 5, 30, 60, 300, 900, 1800, 3600],
  registers: [register],
});

export const execMessageTotal = new Counter({
  name: "exec_message_total",
  help: "Messages by type + status",
  labelNames: ["type", "status"],
  registers: [register],
});

export const execMessageDurationSeconds = new Histogram({
  name: "exec_message_duration_seconds",
  help: "Message round-trip time",
  labelNames: ["type"],
  buckets: [0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30, 60],
  registers: [register],
});

export const execProcessExitCode = new Counter({
  name: "exec_process_exit_code",
  help: "Exit codes by command",
  labelNames: ["command", "exit_code"],
  registers: [register],
});

export const execWorkspaceBytesWritten = new Counter({
  name: "exec_workspace_bytes_written",
  help: "Bytes written to workspaces",
  registers: [register],
});
