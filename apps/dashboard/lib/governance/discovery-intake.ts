import "server-only";
// Compatibility export only. Production machine composition lives in the isolated worker.
// No default service-role ports, HUMAN wrapper or raw-RPC fallback is loaded here.
export * from "../../../discovery-worker/src/discovery-intake";
