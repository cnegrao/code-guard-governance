CREATE TABLE public.patients (
  person_id TEXT PRIMARY KEY,
  contact_email TEXT NOT NULL,
  diagnosis TEXT NOT NULL,
  birth_date DATE NOT NULL
);
