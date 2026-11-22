-- Phase 4 upgrade: run this ONCE in Supabase SQL Editor (existing database ke liye).
alter table public.customers add column if not exists address text;
