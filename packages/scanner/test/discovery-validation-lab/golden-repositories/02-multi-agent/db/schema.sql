CREATE TABLE public.clients (
  client_id TEXT PRIMARY KEY,
  email_address TEXT NOT NULL,
  segment TEXT NOT NULL
);

CREATE TABLE public.billing_accounts (
  account_id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES public.clients(client_id),
  balance NUMERIC(12, 2) NOT NULL
);
