/** Leave the durable tool call pending: execution may have happened without a receipt. */
export class UncertainToolOutcomeError extends Error {}
