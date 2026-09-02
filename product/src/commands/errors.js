export class CommandError extends Error {
  constructor(message, code = "command.invalid", details = null) {
    super(message);
    this.name = "CommandError";
    this.code = code;
    this.details = details;
  }
}

export class TransactionError extends Error {
  constructor(issues) {
    super("Transaction failed project validation.");
    this.name = "TransactionError";
    this.code = "transaction.validation_failed";
    this.issues = issues;
  }
}
