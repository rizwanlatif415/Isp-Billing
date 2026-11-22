-- ISP Billing Manager schema. Run in Supabase SQL Editor.
create extension if not exists pgcrypto;
create table if not exists public.profiles (
 id uuid primary key references auth.users(id) on delete cascade,
 full_name text not null default '',
 role text not null default 'admin' check (role in ('admin','collector')),
 created_at timestamptz not null default now()
);
create table if not exists public.areas (
 id uuid primary key default gen_random_uuid(),
 name text not null unique,
 created_at timestamptz not null default now()
);
create table if not exists public.customers (
 id uuid primary key default gen_random_uuid(),
 customer_code text unique,
 name text not null,
 father_name text,
 username text not null unique,
 phone text,
 area text,
 package_name text,
 monthly_fee numeric(12,2) not null default 0 check(monthly_fee>=0),
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
create table if not exists public.bills (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id),
 billing_month text not null,
 amount numeric(12,2) not null check(amount>=0),
 paid_amount numeric(12,2) not null default 0 check(paid_amount>=0),
 created_at timestamptz not null default now(),
 unique(customer_id,billing_month)
);
create table if not exists public.payments (
 id uuid primary key default gen_random_uuid(),
 customer_id uuid not null references public.customers(id),
 bill_id uuid not null references public.bills(id),
 amount numeric(12,2) not null check(amount>0),
 paid_at date not null default current_date,
 method text not null default 'Cash',
 reference text,
 received_by uuid references auth.users(id),
 created_at timestamptz not null default now()
);
create index if not exists customers_area_idx on public.customers(area);
create index if not exists bills_month_idx on public.bills(billing_month);
create index if not exists payments_paid_at_idx on public.payments(paid_at desc);

alter table public.profiles enable row level security;
alter table public.areas enable row level security;
alter table public.customers enable row level security;
alter table public.bills enable row level security;
alter table public.payments enable row level security;

-- Drop starter policies first so this script can upgrade an existing Phase 1 database.
drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "areas staff all" on public.areas;
drop policy if exists "customers staff all" on public.customers;
drop policy if exists "bills staff all" on public.bills;
drop policy if exists "payments staff all" on public.payments;

-- Authenticated ISP staff can access shared ISP billing data.
create policy "profiles read own" on public.profiles for select to authenticated using (id=auth.uid());
create policy "areas staff all" on public.areas for all to authenticated using (true) with check (true);
create policy "customers staff all" on public.customers for all to authenticated using (true) with check (true);
create policy "bills staff all" on public.bills for all to authenticated using (true) with check (true);
create policy "payments staff all" on public.payments for all to authenticated using (true) with check (true);

-- Create profile rows after creating Auth users. Replace UUIDs with real auth.users IDs.
-- insert into public.profiles(id,full_name,role) values ('AUTH-USER-UUID','Admin','admin');

-- Phase 2 upgrades: collector attribution, role-based policies, indexes and atomic payment RPC.
alter table public.payments add column if not exists received_by uuid references auth.users(id);
alter table public.payments add column if not exists client_key text;
create unique index if not exists payments_client_key_uidx on public.payments(client_key) where client_key is not null;
create index if not exists payments_collector_date_idx on public.payments(received_by, paid_at desc);
create index if not exists bills_customer_month_idx on public.bills(customer_id, billing_month);
create index if not exists customers_username_idx on public.customers(username);

create or replace function public.current_staff_role()
returns text language sql stable security definer set search_path=public
as $$ select role from public.profiles where id=auth.uid() $$;

-- Remove the starter's broad write policies before applying role-specific access.
drop policy if exists "profiles read own" on public.profiles;
drop policy if exists "areas staff all" on public.areas;
drop policy if exists "customers staff all" on public.customers;
drop policy if exists "bills staff all" on public.bills;
drop policy if exists "payments staff all" on public.payments;
create policy "profiles self or admin read" on public.profiles for select to authenticated
 using (id=auth.uid() or public.current_staff_role()='admin');
create policy "admin manages profiles" on public.profiles for all to authenticated
 using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
create policy "admin manages areas" on public.areas for all to authenticated
 using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
create policy "staff reads areas" on public.areas for select to authenticated using (public.current_staff_role() in ('admin','collector'));
create policy "admin manages customers" on public.customers for all to authenticated
 using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
create policy "collectors read customers" on public.customers for select to authenticated using (public.current_staff_role()='collector');
create policy "staff reads bills" on public.bills for select to authenticated using (public.current_staff_role() in ('admin','collector'));
create policy "admin manages bills" on public.bills for all to authenticated
 using (public.current_staff_role()='admin') with check (public.current_staff_role()='admin');
create policy "staff reads payments" on public.payments for select to authenticated using (public.current_staff_role()='admin' or received_by=auth.uid());
create policy "staff inserts own payments" on public.payments for insert to authenticated
 with check (received_by=auth.uid() and public.current_staff_role() in ('admin','collector'));

-- A single transaction prevents a payment being saved without updating its bill.
drop function if exists public.record_payment(uuid,uuid,numeric,date,text,text);
drop function if exists public.record_payment(uuid,uuid,numeric,date,text,text,text);
create or replace function public.record_payment(
 p_customer_id uuid, p_bill_id uuid default null, p_amount numeric default 0,
 p_paid_at date default current_date, p_method text default 'Cash', p_reference text default null, p_client_key text default null
) returns public.payments
language plpgsql security definer set search_path=public
as $$
declare v_bill public.bills; v_payment public.payments; v_month text;
begin
 if auth.uid() is null or public.current_staff_role() not in ('admin','collector') then
   raise exception 'Not authorized to record payments';
 end if;
 if p_client_key is not null then select * into v_payment from public.payments where client_key=p_client_key; if found then return v_payment; end if; end if;
 if p_amount is null or p_amount<=0 then raise exception 'Payment amount must be greater than zero'; end if;
 if not exists(select 1 from public.customers where id=p_customer_id) then raise exception 'Customer not found'; end if;
 if p_bill_id is not null then
   select * into v_bill from public.bills where id=p_bill_id and customer_id=p_customer_id for update;
   if not found then raise exception 'Selected bill not found for this customer'; end if;
 else
   v_month=to_char(coalesce(p_paid_at,current_date),'YYYY-MM');
   insert into public.bills(customer_id,billing_month,amount,paid_amount)
   select id,v_month,monthly_fee,0 from public.customers where id=p_customer_id
   on conflict(customer_id,billing_month) do nothing;
   select * into v_bill from public.bills where customer_id=p_customer_id and billing_month=v_month for update;
 end if;
 if p_amount > greatest(0,v_bill.amount-v_bill.paid_amount) then raise exception 'Payment exceeds outstanding bill balance'; end if;
 insert into public.payments(customer_id,bill_id,amount,paid_at,method,reference,received_by,client_key)
 values(p_customer_id,v_bill.id,p_amount,coalesce(p_paid_at,current_date),coalesce(p_method,'Cash'),p_reference,auth.uid(),p_client_key) returning * into v_payment;
 update public.bills set paid_amount=paid_amount+p_amount where id=v_bill.id;
 return v_payment;
end $$;
revoke all on function public.record_payment(uuid,uuid,numeric,date,text,text,text) from public;
grant execute on function public.record_payment(uuid,uuid,numeric,date,text,text,text) to authenticated;
