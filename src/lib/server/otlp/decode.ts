/**
 * Dependency-free decoder for OTLP `ExportTraceServiceRequest` payloads, in both
 * OTLP/HTTP wire formats: protobuf (the OpenInference/OTel exporter default) and
 * JSON. We deliberately avoid an OTel SDK dependency — the proto subset uprox
 * needs is small and its field numbers are stable — and decode the protobuf wire
 * format directly into the flat {@link ParsedSpan} rows the trace store uses.
 *
 *   span      ParsedSpan and the helpers both readers share
 *   protobuf  the hand-rolled protobuf wire reader
 *   json      the OTLP/JSON reader
 */
export type { ParsedSpan } from './span';
export { parseOtlpProtobuf } from './protobuf';
export { parseOtlpJson } from './json';
