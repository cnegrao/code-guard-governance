export interface PipelineEvent {
  readonly stage: string;
}

export const pipelineHandler = {
  service: "batch-pipeline",
  handle(event: PipelineEvent): string {
    return `handled:${event.stage}`;
  },
};
