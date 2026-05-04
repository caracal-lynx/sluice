export class PipelineError extends Error {
  constructor(message: string, public readonly cause?: unknown) {
    super(message);
    this.name = this.constructor.name;
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }
}
export class ConfigError extends PipelineError {}
export class SourceError extends PipelineError {}
export class StagingError extends PipelineError {}
export class DQError extends PipelineError {}
export class PipelineDQError extends DQError {
  constructor(
    public readonly criticalCount: number,
    public readonly reportPath: string,
  ) {
    super(`Pipeline halted: ${criticalCount} critical DQ violations. See ${reportPath}`);
  }
}
export class TransformError extends PipelineError {}
export class ExpressionError extends TransformError {}
export class LoadError extends PipelineError {}
export class EnrichError extends PipelineError {}
