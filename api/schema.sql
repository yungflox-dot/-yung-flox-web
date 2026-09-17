create table if not exists orders (
  order_id uuid primary key,
  beat text not null,
  license text not null,
  amount numeric(12,2) not null,
  email text not null,
  customer_name text,
  provider text not null,
  provider_payment_id text,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  paid_at timestamptz
);

alter table orders enable row level security;
-- El backend usa service_role. No expongas esta clave al frontend.
