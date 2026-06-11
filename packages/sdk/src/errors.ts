export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

export class CapabilityUnavailableError extends Error {
  constructor(message = "Capability unavailable") {
    super(message);
    this.name = "CapabilityUnavailableError";
  }
}
