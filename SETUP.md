# BigNet Broadband — Billing & Recovery Manager (Phase 4)

Responsive ISP billing PWA for PC and mobile. Includes customer records, monthly bills, payment collection, customer ledger, PDF receipts, collector attribution, recovery reports, light/dark theme, role-based access and an offline payment queue.

## Requirements
- Node.js LTS
- A Supabase project
- HTTPS hosting for installable PWA use

## 1. Configure Supabase
1. Create a project at https://supabase.com.
2. Open SQL Editor and run the complete `supabase/schema.sql` file.
3. In Authentication > Users, create an Admin account and a separate account for every collector.
4. Copy each user's UUID. Add profiles using SQL, replacing UUIDs and names:

```sql
insert into public.profiles(id, full_name, role) values ('ADMIN-UUID', 'ISP Admin', 'admin');
insert into public.profiles(id, full_name, role) values ('COLLECTOR-UUID', 'Collector 1', 'collector');
```

Use `admin` only for trusted administrators and `collector` for field collection staff. Admins can read the staff directory; collectors can read their own profile.

5. Copy Project URL and anon/public key from Project Settings > API.

## 2. Configure and run on Windows
Extract the ZIP. Open Command Prompt in the extracted folder:

```bash
npm install
copy .env.example .env
```

Edit `.env`:

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

Then run `npm run dev`. For production run `npm run build` and deploy the generated `dist` folder to a static HTTPS host. Never expose a Supabase `service_role` key in this frontend.

## 3. Roles
- **Admin:** manage customers and areas, generate monthly bills, view staff and all recovery reports.
- **Collector:** view customer and bill information, record payments, view their own payment history.
- Create authentication users in Supabase Dashboard, then add their matching `profiles` row. The Staff page is a staff directory, not an Auth-user provisioning console.

## 4. Offline collection
When the app is already opened on a device, payment entries made while offline are stored in that browser's local storage queue. When internet returns, the app attempts to submit queued payments using the atomic `record_payment` database function. The Dashboard also has a manual sync action.

**Important:** Offline queue entries exist only on the device/browser where entered. Do not clear browser data or uninstall the PWA before sync completes. A queued payment is not yet in the shared database and is not a confirmed server receipt until it syncs. Avoid entering the same payment on another device.

## 5. Daily workflow
1. Admin adds areas and customers.
2. Admin generates monthly bills.
3. Collectors sign in using their own accounts and record customer payments.
4. PDF receipts can be downloaded after a successful online payment.
5. Admin reviews collector-wise recovery under Recovery reports.

Monthly bills are generated automatically the first time an Admin signs in during a new month (and can also be generated manually). This is login-triggered automation, not a background scheduled job.

## 6. Operational notes
- PC/mobile live synchronization uses Supabase Realtime.
- `record_payment` records the payment and updates the bill in one database transaction.
- The app is designed for thousands of customer rows, but hosting/database performance depends on the Supabase plan, network and query volume. The current frontend fetches customer/bill/payment collections; consider server-side pagination before substantially larger deployments.
- This is not a MikroTik/PPPoE suspension system. WhatsApp reminders open WhatsApp with a ready-made message and you press Send for each customer (fully automatic sending needs the paid WhatsApp Business API).
- Test with dummy customers and payments before live use. Back up Supabase regularly.

## 7. Phase 3 features (BigNet Broadband)
- **Branding:** name, tagline and the support number printed on every bill/receipt are set in the `BRAND` block at the top of `src/main.js` (Rizwan Net 03003739415).
- **Excel import (Admin):** Customers > *Import from Excel*. Accepts .xlsx/.xls/.csv. Download the sample template from the same dialog. Required columns: Name, Username. Optional: Customer ID, Father Name, Mobile, Area, Package, Monthly Fee. Existing usernames can be updated or skipped; missing Areas are created automatically.
- **WhatsApp reminders:** Reminders page lists every customer with pending fees. The WhatsApp button opens a chat with an auto-written message (name, pending months, balance, support number). Edit the message under *Reminder message template*. Mobile numbers are accepted as 03xx..., +92... or 92...
- **Printing:** Bills and receipts print on a 210x100 mm slip (bulk print: 3 bills per A4 page). Before printing you can edit the customer name and add a note; the edit applies to the print only.
- **No database change:** `supabase/schema.sql` is unchanged from Phase 2.

## 8. Phase 4 changes
- **Professional login page** aur naya **dashboard** (recovery progress, recent payments, highest pending balances).
- **Customer address:** Customers list, profile, Add/Edit form aur Excel import (column `Address`) mein address shamil hai.
  **Zaroori:** purane database par `supabase/phase4-address.sql` Supabase SQL Editor mein *ek dafa* run karein, warna customer save/import par error aayega.
- **Bill / receipt print:** ab sirf **customer ka naam** aur **fees** print hoti hai (area, phone, username, package nahi). Print se pehle **naam aur fees dono edit** ho sakte hain; ye tabdeeli sirf print par hoti hai, database mein nahi.
- Bill par fees ka default: baqaya (is mahine + pichla) agar kuch baqi hai, warna mahine ki fee.
