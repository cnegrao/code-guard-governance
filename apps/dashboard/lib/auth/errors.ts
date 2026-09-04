export class AuthPublicError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "AuthPublicError";
  }
}

export const INVALID_CREDENTIALS_MESSAGE = "Invalid email or password";
export const ACCOUNT_INACTIVE_MESSAGE = "Account is not active";
export const EMAIL_EXISTS_MESSAGE = "A user with this email already exists";
export const GENERIC_AUTH_ERROR_MESSAGE =
  "Unable to process your request. Please try again later.";
