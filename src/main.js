import { createClient } from '@supabase/supabase-js';
import { jsPDF } from 'jspdf';
import * as XLSX from 'xlsx';
import './style.css';

/* ============================================================
   BRANDING  -  yahan se naam / support number badal sakte hain
   ============================================================ */
const BRAND = {
  name: 'BigNet Broadband',
  tag: 'Internet Service Provider',
  supportName: 'Rizwan Net',
  supportPhone: '03003739415'
};
const SUPPORT_LINE = `Complaint & Customer Support: ${BRAND.supportName} ${BRAND.supportPhone}`;

const DEFAULT_TEMPLATE =
`Assalam o Alaikum {name},

{company} ki janib se yaad dehani: aap ke internet ke {months} ke bill ke {balance} baqaya hain.

Barah-e-meharbani apni fees jald ada kar dein taake internet service be-rukawat jari rahe. Agar aap ada kar chuke hain to is message ko nazar-andaz kar dein.

Complaint aur customer support ke liye rabta:
{support_name} {support_phone}

Shukriya - {company}`;

const url = import.meta.env.VITE_SUPABASE_URL, key = import.meta.env.VITE_SUPABASE_ANON_KEY;
const configured = !!(url && key && !url.includes('YOUR-') && !key.includes('YOUR_'));
const sb = configured ? createClient(url, key) : null;

const QUEUE_KEY = 'isp-billing-offline-queue-v2';
const TPL_KEY = 'bignet-wa-template';
const REMINDER_KEY = 'bignet-reminder-log';
const LIMIT = 200; // table rows rendered at once (search/filter to narrow)

/* ---------------- state ---------------- */
let session = null, profile = null, page = 'dashboard';
let customers = [], bills = [], payments = [], areas = [], staff = [];
let cmap = new Map(), balances = new Map();
let liveStarted = false;
const ui = { custQ: '', custArea: '', billQ: '', billStatus: '', billArea: '', billMonth: today().slice(0, 7), remQ: '', remArea: '' };
const app = document.querySelector('#app');
const $ = s => document.querySelector(s);

/* ---------------- helpers ---------------- */
function today() { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
const isAdmin = () => profile?.role === 'admin';
const money = n => 'Rs. ' + Number(n || 0).toLocaleString('en-PK');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const readJSON = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || ''); } catch { return d; } };
const offlineQueue = () => readJSON(QUEUE_KEY, []);
const saveQueue = q => localStorage.setItem(QUEUE_KEY, JSON.stringify(q));
const monthLabel = m => { try { return new Date(m + '-01').toLocaleString('en', { month: 'short', year: 'numeric', timeZone: 'UTC' }); } catch { return m; } };
const due = b => Math.max(0, Number(b.amount) - Number(b.paid_amount || 0));
function statusFor(b) { const paid = Number(b.paid_amount || 0), amt = Number(b.amount || 0); return paid >= amt ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid'; }
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function toast(msg) {
  let el = $('#toast'); if (el) el.remove();
  el = document.createElement('div'); el.id = 'toast'; el.textContent = msg; document.body.append(el);
  setTimeout(() => el.remove(), 3800);
}
function modal(html) {
  const el = document.createElement('div'); el.className = 'modal-back';
  el.innerHTML = `<div class="modal">${html}</div>`; document.body.append(el);
  el.addEventListener('mousedown', e => { if (e.target === el) el.remove(); });
  return el;
}

const ICONS = {
  grid: '<rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/>',
  users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  card: '<rect x="1" y="4" width="22" height="16" rx="2"/><line x1="1" y1="10" x2="23" y2="10"/>',
  chart: '<line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/>',
  pin: '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
  upload: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  printer: '<polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
  wa: '<path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  sun: '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>',
  out: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  wifi: '<path d="M5 12.55a11 11 0 0 1 14.08 0"/><path d="M1.42 9a16 16 0 0 1 21.16 0"/><path d="M8.53 16.11a6 6 0 0 1 6.95 0"/><line x1="12" y1="20" x2="12.01" y2="20"/>',
  refresh: '<polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>',
  alert: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>'
};
const ic = n => `<svg class="ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONS[n]}</svg>`;
const brandHtml = () => `<div class="brand"><div class="logo">${ic('wifi')}</div><div><b>${esc(BRAND.name)}</b><small>${esc(BRAND.tag)}</small></div></div>`;

/* ---------------- data loading ---------------- */
// Supabase returns max 1000 rows per request, so large tables are fetched page by page.
async function fetchAll(table, orderCol, asc = false) {
  const out = [], size = 1000;
  for (let from = 0; ; from += size) {
    const { data, error } = await sb.from(table).select('*').order(orderCol, { ascending: asc }).order('id').range(from, from + size - 1);
    if (error) throw error;
    out.push(...data);
    if (data.length < size) break;
  }
  return out;
}
async function loadData() {
  const [c, b, p, a, st] = await Promise.all([
    fetchAll('customers', 'created_at'),
    fetchAll('bills', 'created_at'),
    fetchAll('payments', 'paid_at'),
    sb.from('areas').select('*').order('name'),
    isAdmin() ? sb.from('profiles').select('id,full_name,role,created_at').order('full_name')
      : sb.from('profiles').select('id,full_name,role,created_at').eq('id', session.user.id)
  ]);
  if (a.error) throw a.error; if (st.error) throw st.error;
  customers = c; bills = b; payments = p; areas = a.data || []; staff = st.data || [];
  cmap = new Map(customers.map(x => [x.id, x]));
  balances = new Map();
  for (const x of bills) {
    x.customers = cmap.get(x.customer_id);
    const d = due(x); if (d > 0) balances.set(x.customer_id, (balances.get(x.customer_id) || 0) + d);
  }
  for (const x of payments) x.customers = cmap.get(x.customer_id);
}
async function refresh() { try { await loadData(); render(); } catch (e) { toast(e.message); } }
const refreshSoon = debounce(refresh, 900);

/* ---------------- WhatsApp ---------------- */
function waNumber(v) {
  let d = String(v ?? '').split(/[,;/]/)[0].replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.startsWith('92') && d.length === 12) return d;
  if (d.startsWith('0') && d.length === 11) return '92' + d.slice(1);
  if (d.length === 10 && d.startsWith('3')) return '92' + d;
  return d.length >= 11 ? d : '';
}
function openWhatsApp(phone, msg) {
  const n = waNumber(phone);
  if (!n) { toast('Is customer ka mobile number missing ya ghalat hai'); return false; }
  window.open(`https://wa.me/${n}?text=${encodeURIComponent(msg)}`, '_blank', 'noopener');
  return true;
}
const getTemplate = () => localStorage.getItem(TPL_KEY) || DEFAULT_TEMPLATE;
const fill = (t, v) => t.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m);
const baseVars = () => ({ company: BRAND.name, support_name: BRAND.supportName, support_phone: BRAND.supportPhone });
function pendingList() {
  const m = new Map();
  for (const b of bills) {
    const d = due(b); if (d <= 0) continue;
    let e = m.get(b.customer_id);
    if (!e) { const c = cmap.get(b.customer_id); if (!c) continue; e = { c, balance: 0, months: [] }; m.set(b.customer_id, e); }
    e.balance += d; e.months.push(b.billing_month);
  }
  return [...m.values()].map(e => ({ ...e, months: e.months.sort() })).sort((a, b) => b.balance - a.balance);
}
function reminderMessage(e) {
  return fill(getTemplate(), { ...baseVars(), name: e.c.name, balance: money(e.balance), months: e.months.map(monthLabel).join(', ') });
}
const reminderLog = () => readJSON(REMINDER_KEY, {});
function sendReminder(customerId) {
  const e = pendingList().find(x => x.c.id === customerId);
  if (!e) return toast('Is customer ka koi baqaya nahi');
  if (openWhatsApp(e.c.phone, reminderMessage(e))) {
    const log = reminderLog(); log[customerId] = today(); localStorage.setItem(REMINDER_KEY, JSON.stringify(log));
    if (page === 'reminders') updateList();
  }
}
function sendReceiptWhatsApp(paymentId) {
  const p = payments.find(x => x.id === paymentId); if (!p) return;
  const c = cmap.get(p.customer_id), left = balances.get(p.customer_id) || 0;
  const msg = `Assalam o Alaikum ${c?.name || ''},\n\n${BRAND.name} ko aap ki ${money(p.amount)} ki payment ${String(p.paid_at).slice(0, 10)} ko mausool ho gayi hai. Shukriya!\n` +
    (left > 0 ? `Baqaya raqam: ${money(left)}\n` : 'Aap ka koi baqaya nahi.\n') +
    `\nComplaint aur customer support ke liye:\n${BRAND.supportName} ${BRAND.supportPhone}`;
  openWhatsApp(c?.phone, msg);
}

/* ---------------- PDF: bill & receipt ---------------- */
const NAVY = [11, 31, 58], BLUE = [23, 105, 170], GRAY = [110, 122, 138], INK = [22, 38, 58];
function billData(b, nameOverride, note) {
  const c = cmap.get(b.customer_id) || {};
  const prev = bills.filter(x => x.customer_id === b.customer_id && x.billing_month < b.billing_month).reduce((s, x) => s + due(x), 0);
  return {
    kind: 'bill', no: String(b.id).slice(0, 8).toUpperCase(), date: today(),
    name: nameOverride ?? c.name ?? '', username: c.username || '-', area: c.area || '-', phone: c.phone || '-', pkg: c.package_name || '-',
    month: b.billing_month, amount: Number(b.amount), received: Number(b.paid_amount || 0), prev, total: due(b) + prev, status: statusFor(b), note: note || ''
  };
}
function receiptData(p, nameOverride, note) {
  const c = cmap.get(p.customer_id) || {}, b = bills.find(x => x.id === p.bill_id);
  return {
    kind: 'receipt', no: String(p.id).slice(0, 8).toUpperCase(), date: String(p.paid_at).slice(0, 10),
    name: nameOverride ?? c.name ?? '', username: c.username || '-', area: c.area || '-', phone: c.phone || '-', pkg: c.package_name || '-',
    month: b?.billing_month || String(p.paid_at).slice(0, 7), amount: Number(p.amount), method: p.method || 'Cash', reference: p.reference || '-',
    balanceAfter: b ? due(b) : 0, note: note || ''
  };
}
function drawBlock(doc, y, d) {
  const W = 210, isBill = d.kind === 'bill';
  doc.setFillColor(...NAVY); doc.rect(0, y, W, 21, 'F');
  doc.setFillColor(...BLUE); doc.rect(0, y + 21, W, 1.4, 'F');
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(18); doc.text(BRAND.name, 10, y + 11.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(190, 205, 222); doc.text(BRAND.tag, 10, y + 17);
  doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
  doc.text(isBill ? 'INTERNET BILL' : 'PAYMENT RECEIPT', W - 10, y + 10, { align: 'right' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(190, 205, 222);
  doc.text(`${isBill ? 'Bill' : 'Receipt'} No: ${d.no}   |   Date: ${d.date}`, W - 10, y + 16.5, { align: 'right' });

  // left: customer details
  let ly = y + 30;
  doc.setTextColor(...GRAY); doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.text(isBill ? 'BILLED TO' : 'RECEIVED FROM', 10, ly);
  doc.setTextColor(...INK); doc.setFontSize(13); doc.text(doc.splitTextToSize(String(d.name || '-'), 98)[0], 10, ly + 6.5);
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9.5);
  [`User ID: ${d.username}`, `Area: ${d.area}`, `Mobile: ${d.phone}`, `Package: ${d.pkg}`].forEach((t, i) => doc.text(doc.splitTextToSize(t, 98)[0], 10, ly + 13 + i * 5.6));
  let sy = ly + 13 + 4 * 5.6 + 1;
  if (d.note) { doc.setFont('helvetica', 'italic'); doc.setFontSize(9); doc.setTextColor(...GRAY); doc.text(doc.splitTextToSize(d.note, 98)[0], 10, sy); sy += 6; }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(10);
  if (isBill) {
    const col = d.status === 'Paid' ? [24, 115, 67] : d.status === 'Partial' ? [52, 87, 166] : [196, 100, 10];
    doc.setTextColor(...col); doc.text(`STATUS: ${d.status.toUpperCase()}`, 10, sy + 2);
  } else { doc.setTextColor(24, 115, 67); doc.text('PAYMENT RECEIVED - THANK YOU', 10, sy + 2); }

  // right: amounts
  const rows = isBill
    ? [['Billing month', monthLabel(d.month)], ['Monthly charges', money(d.amount)], ['Received', money(d.received)], ['Previous balance', money(d.prev)]]
    : [['Billing month', monthLabel(d.month)], ['Payment method', d.method], ['Reference', String(d.reference).slice(0, 26)], ['Balance remaining', money(d.balanceAfter)]];
  const hi = isBill ? ['TOTAL PAYABLE', money(d.total)] : ['AMOUNT RECEIVED', money(d.amount)];
  const rx = 116, rr = 200; let ry = y + 28;
  doc.setFontSize(9.5);
  rows.forEach(([l, v]) => {
    doc.setFont('helvetica', 'normal'); doc.setTextColor(...GRAY); doc.text(l, rx, ry + 4.5);
    doc.setFont('helvetica', 'bold'); doc.setTextColor(...INK); doc.text(String(v), rr, ry + 4.5, { align: 'right' });
    doc.setDrawColor(227, 233, 240); doc.line(rx, ry + 7, rr, ry + 7); ry += 8;
  });
  doc.setFillColor(232, 241, 250); doc.roundedRect(rx - 3, ry + 1, rr - rx + 6, 11, 2, 2, 'F');
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9.5); doc.setTextColor(...BLUE); doc.text(hi[0], rx, ry + 8);
  doc.setFontSize(12.5); doc.setTextColor(...NAVY); doc.text(hi[1], rr, ry + 8.3, { align: 'right' });

  // footer (support number on every bill/receipt)
  doc.setDrawColor(...BLUE); doc.setLineWidth(0.4); doc.line(10, y + 80, W - 10, y + 80); doc.setLineWidth(0.2);
  doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.setTextColor(...NAVY); doc.text(SUPPORT_LINE, W / 2, y + 87, { align: 'center' });
  doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); doc.setTextColor(...GRAY);
  doc.text(isBill ? `Please pay your bill on time to keep your internet service uninterrupted. Thank you for choosing ${BRAND.name}.`
    : `This is a computer generated receipt. Thank you for choosing ${BRAND.name}.`, W / 2, y + 93, { align: 'center' });
}
function makeDoc(items) {
  const single = items.length === 1;
  const doc = single ? new jsPDF({ orientation: 'landscape', unit: 'mm', format: [210, 100] }) : new jsPDF({ unit: 'mm', format: 'a4' });
  items.forEach((d, i) => {
    if (single) return drawBlock(doc, 0, d);
    const slot = i % 3; if (i > 0 && slot === 0) doc.addPage();
    drawBlock(doc, slot * 99, d);
    if (slot < 2) { doc.setDrawColor(170, 170, 170); doc.setLineDashPattern([1.5, 1.5], 0); doc.line(0, (slot + 1) * 99, 210, (slot + 1) * 99); doc.setLineDashPattern([], 0); }
  });
  return doc;
}
function printDoc(doc) {
  doc.autoPrint();
  const w = window.open(doc.output('bloburl'), '_blank');
  if (!w) { toast('Popup block hai - PDF download ho raha hai'); doc.save('BigNet-Print.pdf'); }
}
// Print dialog: customer name (and an optional note) can be edited before printing.
function printDialog(kind, rec) {
  const base = kind === 'bill' ? billData(rec) : receiptData(rec);
  const el = modal(`<h2>${kind === 'bill' ? 'Print bill' : 'Print receipt'}</h2>
    <p class="muted">Print se pehle customer ka naam badal sakte hain. Ye tabdeeli sirf is print par hogi, customer record mein nahi.</p>
    <div class="field" style="margin-top:14px"><label>Customer name (print par)</label><input id="pName" value="${esc(base.name)}"></div>
    <div class="field" style="margin-top:12px"><label>Note / due date (optional)</label><input id="pNote" placeholder="e.g. Last date: 10 ${monthLabel(today().slice(0, 7))}"></div>
    <div class="notice info">PDF mein naam English/Roman likhein - Urdu script PDF mein sahi nazar nahi aati.</div>
    <div class="modal-actions"><button class="secondary" data-close>Close</button><button class="secondary" id="pDl">${ic('download')} Download PDF</button><button id="pPrint">${ic('printer')} Print</button></div>`);
  const build = () => { const d = { ...base, name: el.querySelector('#pName').value.trim() || base.name, note: el.querySelector('#pNote').value.trim() }; return makeDoc([d]); };
  el.querySelector('#pPrint').onclick = () => printDoc(build());
  el.querySelector('#pDl').onclick = () => build().save(`BigNet-${kind}-${base.no}.pdf`);
}
function printBillsBulk() {
  const list = filteredBills();
  if (!list.length) return toast('Print karne ke liye koi bill nahi');
  if (list.length > 600 && !confirm(`${list.length} bills ka PDF banega. Jari rakhein?`)) return;
  const sorted = [...list].sort((a, b) => String(a.customers?.area || '').localeCompare(String(b.customers?.area || '')) || String(a.customers?.name || '').localeCompare(String(b.customers?.name || '')));
  toast(`${sorted.length} bills ka PDF ban raha hai...`);
  setTimeout(() => printDoc(makeDoc(sorted.map(b => billData(b)))), 60);
}

/* ---------------- views ---------------- */
const PAGE_TITLES = { dashboard: 'Dashboard', customers: 'Customers', billing: 'Billing', reminders: 'Fee Reminders', collections: 'Collections', reports: 'Recovery Reports', areas: 'Areas', staff: 'Staff' };
function nav() {
  const pend = pendingList().length;
  const links = [['dashboard', 'grid', 'Dashboard'], ['customers', 'users', 'Customers'], ['billing', 'file', 'Billing'], ['reminders', 'bell', 'Reminders'], ['collections', 'card', 'Collections'], ['reports', 'chart', 'Recovery reports']];
  if (isAdmin()) links.push(['areas', 'pin', 'Areas'], ['staff', 'users', 'Staff']);
  return `<aside class="side">${brandHtml()}<div class="nav">${links.map(([k, i, v]) => `<button class="${page === k ? 'active' : ''}" data-act="nav" data-page="${k}">${ic(i)} ${v}${k === 'reminders' && pend ? `<span class="badge">${pend}</span>` : ''}</button>`).join('')}</div>
  <div class="side-foot">Complaint &amp; Support<b>${esc(BRAND.supportName)} ${esc(BRAND.supportPhone)}</b></div></aside>`;
}
function shell(body) {
  app.innerHTML = `<div class="shell">${nav()}<section class="main"><header class="top"><strong>${PAGE_TITLES[page] || ''}</strong><div class="right"><span class="chip user"><b>${esc(profile?.full_name || session.user.email)}</b> ${esc(profile?.role || '')}</span><button class="secondary sm" data-act="theme">${ic('sun')} Theme</button><button class="secondary sm" data-act="logout">${ic('out')} Sign out</button></div></header><main class="content">${body}</main></section></div>`;
}
const head = (title, sub, actions = '') => `<div class="page-head"><div><h2>${title}</h2><p>${sub}</p></div><div class="actions">${actions}</div></div>`;
const statCard = (label, value, icon, tone = '') => `<div class="stat"><div class="si ${tone}">${ic(icon)}</div><div><small>${label}</small><strong>${value}</strong></div></div>`;

function dashboard() {
  const month = today().slice(0, 7), current = bills.filter(b => b.billing_month === month);
  const cnt = s => current.filter(b => statusFor(b) === s).length;
  const sumPay = f => payments.filter(f).reduce((s, p) => s + Number(p.amount), 0);
  const outstanding = bills.reduce((s, b) => s + due(b), 0), pend = pendingList().length;
  return `<div class="welcome"><div><h2>${esc(BRAND.name)} - Overview</h2><p>Monthly billing aur recovery ek nazar mein</p></div><span class="sync-state">${navigator.onLine ? '● Online' : '● Offline'} · ${offlineQueue().length} pending sync</span></div>
  <div class="grid">
    ${statCard('Total customers', customers.length.toLocaleString(), 'users')}
    ${statCard('Paid bills (this month)', cnt('Paid'), 'file', 'g')}
    ${statCard('Unpaid bills', cnt('Unpaid'), 'alert', 'o')}
    ${statCard('Partial bills', cnt('Partial'), 'file', 'p')}
    ${statCard("Today's collection", money(sumPay(p => String(p.paid_at).slice(0, 10) === today())), 'card', 'g')}
    ${statCard('Monthly collection', money(sumPay(p => String(p.paid_at).slice(0, 7) === month)), 'chart')}
    ${statCard('Outstanding balance', money(outstanding), 'alert', 'r')}
    ${statCard('Customers to remind', pend, 'bell', 'o')}
  </div>
  <div class="panel"><h3>Quick actions</h3><div class="actions">
    ${isAdmin() ? `<button data-act="new-customer">${ic('plus')} Add customer</button><button class="secondary" data-act="import">${ic('upload')} Import from Excel</button><button class="secondary" data-act="generate">${ic('file')} Generate monthly bills</button>` : ''}
    <button class="secondary" data-act="collect">${ic('card')} Receive payment</button>
    <button class="wa" data-act="nav" data-page="reminders">${ic('wa')} Fee reminders</button>
    <button class="secondary" data-act="sync">${ic('refresh')} Sync pending payments (${offlineQueue().length})</button></div></div>`;
}

/* customers */
function filteredCustomers() {
  const q = ui.custQ.toLowerCase();
  return customers.filter(c => (!ui.custArea || c.area === ui.custArea) && (!q || [c.name, c.username, c.phone, c.customer_code].some(v => String(v || '').toLowerCase().includes(q))));
}
function customerTable() {
  const all = filteredCustomers(), list = all.slice(0, LIMIT);
  return `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Username</th><th>Area</th><th>Package</th><th>Monthly fee</th><th>Phone</th><th>Balance</th><th>Actions</th></tr></thead><tbody>${list.map(c => {
    const bal = balances.get(c.id) || 0;
    return `<tr><td><b>${esc(c.name)}</b><br><small class="muted">${esc(c.customer_code || '')}</small></td><td>${esc(c.username)}</td><td>${esc(c.area || '-')}</td><td>${esc(c.package_name || '-')}</td><td>${money(c.monthly_fee)}</td><td>${esc(c.phone || '-')}</td><td>${bal > 0 ? `<span class="pill unpaid">${money(bal)}</span>` : '<span class="pill paid">Clear</span>'}</td>
    <td><div class="btns"><button class="secondary sm" data-act="profile" data-id="${c.id}">Profile</button>${isAdmin() ? `<button class="secondary sm" data-act="edit-customer" data-id="${c.id}">Edit</button>` : ''}<button class="sm" data-act="collect" data-cid="${c.id}">Collect</button>${bal > 0 ? `<button class="wa sm" title="WhatsApp reminder" data-act="wa" data-id="${c.id}">${ic('wa')}</button>` : ''}</div></td></tr>`;
  }).join('') || '<tr><td colspan="8" class="empty">Koi customer nahi mila</td></tr>'}</tbody></table></div>${all.length > LIMIT ? `<div class="more">Pehle ${LIMIT} / ${all.length} customers dikhaye ja rahe hain - search ya area filter use karein.</div>` : ''}`;
}
const areaOptions = sel => areas.map(a => `<option ${sel === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('');
function customersPage() {
  return head('Customers', `${customers.length.toLocaleString()} subscriber records`, isAdmin() ? `<button class="secondary" data-act="import">${ic('upload')} Import from Excel</button><button data-act="new-customer">${ic('plus')} Add customer</button>` : '') +
    `<div class="toolbar"><input data-f="custQ" value="${esc(ui.custQ)}" placeholder="Search name, username, phone or ID"><select data-f="custArea"><option value="">All areas</option>${areaOptions(ui.custArea)}</select></div><div class="panel" style="margin-top:0" id="list">${customerTable()}</div>`;
}

/* billing */
function filteredBills() {
  const q = ui.billQ.toLowerCase();
  return bills.filter(b => {
    const c = b.customers;
    return (!ui.billMonth || b.billing_month === ui.billMonth) && (!ui.billStatus || statusFor(b) === ui.billStatus) && (!ui.billArea || c?.area === ui.billArea) &&
      (!q || [c?.name, c?.username, c?.phone, c?.customer_code].some(v => String(v || '').toLowerCase().includes(q)));
  });
}
function billTable() {
  const all = filteredBills(), list = all.slice(0, LIMIT);
  return `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Month</th><th>Bill</th><th>Received</th><th>Balance</th><th>Status</th><th>Actions</th></tr></thead><tbody>${list.map(b => {
    const d = due(b), st = statusFor(b);
    return `<tr><td><b>${esc(b.customers?.name || 'Customer')}</b><br><small class="muted">${esc(b.customers?.username || '')}</small></td><td>${esc(monthLabel(b.billing_month))}</td><td>${money(b.amount)}</td><td>${money(b.paid_amount)}</td><td>${money(d)}</td><td><span class="pill ${st.toLowerCase()}">${st}</span></td>
    <td><div class="btns">${d > 0 ? `<button class="sm" data-act="collect-bill" data-id="${b.id}">Receive</button>` : ''}<button class="secondary sm" data-act="print-bill" data-id="${b.id}">${ic('printer')} Print</button>${d > 0 ? `<button class="wa sm" title="WhatsApp reminder" data-act="wa" data-id="${b.customer_id}">${ic('wa')}</button>` : ''}</div></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">Koi bill nahi mila</td></tr>'}</tbody></table></div>${all.length > LIMIT ? `<div class="more">Pehle ${LIMIT} / ${all.length} bills dikhaye ja rahe hain - filter use karein.</div>` : ''}`;
}
function billingPage() {
  const months = [...new Set([today().slice(0, 7), ...bills.map(b => b.billing_month)])].sort().reverse();
  return head('Monthly billing', 'Paid, partial aur unpaid bills track karein, aur print nikalein.',
    `<button class="secondary" data-act="print-bills">${ic('printer')} Print filtered bills</button>${isAdmin() ? `<button data-act="generate">${ic('file')} Generate monthly bills</button>` : ''}`) +
    `<div class="toolbar"><input data-f="billQ" value="${esc(ui.billQ)}" placeholder="Search customer"><select data-f="billMonth"><option value="">All months</option>${months.map(m => `<option value="${m}" ${ui.billMonth === m ? 'selected' : ''}>${monthLabel(m)}</option>`).join('')}</select>
    <select data-f="billStatus"><option value="">All statuses</option>${['Paid', 'Unpaid', 'Partial'].map(s => `<option ${ui.billStatus === s ? 'selected' : ''}>${s}</option>`).join('')}</select><select data-f="billArea"><option value="">All areas</option>${areaOptions(ui.billArea)}</select></div>
    <div class="panel" style="margin-top:0" id="list">${billTable()}</div>`;
}

/* reminders */
function filteredPending() {
  const q = ui.remQ.toLowerCase();
  return pendingList().filter(e => (!ui.remArea || e.c.area === ui.remArea) && (!q || [e.c.name, e.c.username, e.c.phone, e.c.customer_code].some(v => String(v || '').toLowerCase().includes(q))));
}
function reminderTable() {
  const all = filteredPending(), list = all.slice(0, LIMIT), log = reminderLog();
  return `<div class="table-wrap"><table><thead><tr><th>Customer</th><th>Area</th><th>Phone</th><th>Pending months</th><th>Balance</th><th>Last reminder</th><th>Action</th></tr></thead><tbody>${list.map(e => {
    const last = log[e.c.id], ok = !!waNumber(e.c.phone);
    return `<tr><td><b>${esc(e.c.name)}</b><br><small class="muted">${esc(e.c.username)}</small></td><td>${esc(e.c.area || '-')}</td><td>${ok ? esc(e.c.phone) : '<span class="pill err">No number</span>'}</td><td>${e.months.map(monthLabel).join(', ')}</td><td><b>${money(e.balance)}</b></td>
    <td>${last ? (last === today() ? '<span class="pill paid">Sent today</span>' : esc(last)) : '<span class="muted">Never</span>'}</td><td><button class="wa sm" data-act="wa" data-id="${e.c.id}" ${ok ? '' : 'disabled'}>${ic('wa')} WhatsApp</button></td></tr>`;
  }).join('') || '<tr><td colspan="7" class="empty">Kisi customer ki fees pending nahi - shabash!</td></tr>'}</tbody></table></div>${all.length > LIMIT ? `<div class="more">Pehle ${LIMIT} / ${all.length} customers dikhaye ja rahe hain.</div>` : ''}`;
}
function remindersPage() {
  const all = pendingList(), total = all.reduce((s, e) => s + e.balance, 0), noPhone = all.filter(e => !waNumber(e.c.phone)).length;
  return head('Fee reminders', 'Jin customers ki fees pending hai unhein WhatsApp par message bhejein. Message khud ban jata hai.', `<button class="wa" data-act="wa-next">${ic('wa')} Agla reminder bhejein</button>`) +
    `<div class="grid g3">${statCard('Pending customers', all.length, 'bell', 'o')}${statCard('Total baqaya', money(total), 'alert', 'r')}${statCard('Bina phone number', noPhone, 'users', 'p')}</div>
    <div class="toolbar"><input data-f="remQ" value="${esc(ui.remQ)}" placeholder="Search name, username, phone"><select data-f="remArea"><option value="">All areas</option>${areaOptions(ui.remArea)}</select></div>
    <div class="panel" style="margin-top:0" id="list">${reminderTable()}</div>
    <details class="tpl panel"><summary>${ic('file')} Reminder message template (edit karein)</summary>
      <p class="muted">Ye placeholders khud bhar jate hain: <code>{name}</code> <code>{balance}</code> <code>{months}</code> <code>{company}</code> <code>{support_name}</code> <code>{support_phone}</code></p>
      <div class="field"><textarea id="tplText">${esc(getTemplate())}</textarea></div>
      <div class="modal-actions" style="justify-content:flex-start"><button data-act="save-tpl">Save message</button><button class="secondary" data-act="reset-tpl">Default par wapis</button></div>
    </details>
    <div class="notice info">WhatsApp har customer ke liye alag chat kholta hai - bas "Send" dabana hota hai. WhatsApp ke rules ki wajah se message bina click ke apne aap nahi bheja ja sakta.</div>`;
}

/* collections / reports / areas / staff */
function collectionsPage() {
  const list = payments.slice(0, LIMIT);
  return head('Collections', 'Payment history aur printable receipts.') + `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Date</th><th>Customer</th><th>Amount</th><th>Method</th><th>Reference</th><th>Actions</th></tr></thead><tbody>${list.map(p => `<tr><td>${esc(String(p.paid_at).slice(0, 10))}</td><td>${esc(p.customers?.name || '-')}</td><td>${money(p.amount)}</td><td>${esc(p.method || 'Cash')}</td><td>${esc(p.reference || '-')}</td>
    <td><div class="btns"><button class="secondary sm" data-act="receipt" data-id="${p.id}">${ic('printer')} Receipt</button><button class="wa sm" title="WhatsApp receipt" data-act="wa-receipt" data-id="${p.id}">${ic('wa')}</button></div></td></tr>`).join('') || '<tr><td colspan="6" class="empty">Abhi koi payment nahi</td></tr>'}</tbody></table></div>${payments.length > LIMIT ? `<div class="more">Pehle ${LIMIT} / ${payments.length} payments dikhaye ja rahe hain.</div>` : ''}</div>`;
}
function reportsPage() {
  const summarize = keyFn => Object.values(payments.reduce((o, p) => { const k = keyFn(p); o[k] ??= { key: k, total: 0, count: 0 }; o[k].total += Number(p.amount); o[k].count++; return o; }, {})).sort((a, b) => b.total - a.total);
  const collectorRows = summarize(p => p.received_by || 'Unassigned').map(r => ({ ...r, name: staff.find(s => s.id === r.key)?.full_name || r.key }));
  const table = (rows, label) => `<div class="table-wrap"><table><thead><tr><th>${label}</th><th>Transactions</th><th>Total recovery</th></tr></thead><tbody>${rows.map(r => `<tr><td>${esc(r.name || r.key)}</td><td>${r.count}</td><td>${money(r.total)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Koi data nahi</td></tr>'}</tbody></table></div>`;
  return head('Recovery reports', 'Daily, monthly, area-wise aur collector-wise recovery.') +
    `<div class="grid">${statCard('Payments recorded', payments.length, 'card')}${statCard('Total recovery', money(payments.reduce((s, p) => s + Number(p.amount), 0)), 'chart', 'g')}${statCard("Today's recovery", money(payments.filter(p => String(p.paid_at).slice(0, 10) === today()).reduce((s, p) => s + Number(p.amount), 0)), 'card', 'g')}${statCard('Offline pending', offlineQueue().length, 'refresh', 'o')}</div>
    <div class="panel"><h3>Collector-wise recovery</h3>${table(collectorRows, 'Collector')}</div><div class="panel"><h3>Monthly recovery</h3>${table(summarize(p => String(p.paid_at).slice(0, 7)), 'Billing month')}</div><div class="panel"><h3>Area-wise recovery</h3>${table(summarize(p => p.customers?.area || 'Unassigned'), 'Customer area')}</div>`;
}
const areasPage = () => head('Areas', 'Areas se customers aur collection routes organize karein.') + `<div class="toolbar"><input id="areaName" placeholder="Naya area"><button data-act="add-area">${ic('plus')} Add area</button></div><div class="panel" style="margin-top:0">${areas.map(a => `<p>${ic('pin')} ${esc(a.name)}</p>`).join('') || 'Abhi koi area nahi.'}</div>`;
const staffPage = () => head('Staff accounts', 'Staff users Supabase Authentication mein banayein, phir SETUP.md ke mutabiq profile add karein.') + `<div class="panel"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Role</th><th>User ID</th></tr></thead><tbody>${staff.map(x => `<tr><td>${esc(x.full_name)}</td><td>${esc(x.role)}</td><td><small>${esc(x.id)}</small></td></tr>`).join('') || '<tr><td colspan="3" class="empty">Koi staff profile nahi</td></tr>'}</tbody></table></div></div>`;

function render() {
  if (!session) return renderLogin();
  const pages = { dashboard, customers: customersPage, billing: billingPage, reminders: remindersPage, collections: collectionsPage, reports: reportsPage, areas: areasPage, staff: staffPage };
  if ((page === 'areas' || page === 'staff') && !isAdmin()) page = 'dashboard';
  shell((pages[page] || dashboard)());
}
// Re-draw only the table so the search box keeps focus while typing.
function updateList() {
  const t = { customers: customerTable, billing: billTable, reminders: reminderTable }[page], box = $('#list');
  if (t && box) box.innerHTML = t();
}

/* ---------------- modals ---------------- */
function customerProfile(c) {
  if (!c) return;
  const cb = bills.filter(b => b.customer_id === c.id), cp = payments.filter(p => p.customer_id === c.id), bal = balances.get(c.id) || 0;
  const el = modal(`<h2>${esc(c.name)}</h2><p class="muted">Customer ledger aur service profile</p>
    <div class="profile-grid"><div><small>PPPoE username</small><b>${esc(c.username)}</b></div><div><small>Customer ID</small><b>${esc(c.customer_code || '-')}</b></div><div><small>Package</small><b>${esc(c.package_name || '-')}</b></div><div><small>Monthly fee</small><b>${money(c.monthly_fee)}</b></div><div><small>Area / phone</small><b>${esc(c.area || '-')} · ${esc(c.phone || '-')}</b></div><div><small>Outstanding</small><b>${money(bal)}</b></div></div>
    <h3>Bill history</h3><div class="table-wrap"><table><thead><tr><th>Month</th><th>Bill</th><th>Received</th><th>Status</th><th></th></tr></thead><tbody>${cb.map(b => `<tr><td>${monthLabel(b.billing_month)}</td><td>${money(b.amount)}</td><td>${money(b.paid_amount)}</td><td><span class="pill ${statusFor(b).toLowerCase()}">${statusFor(b)}</span></td><td><button class="secondary sm" data-act="print-bill" data-id="${b.id}">${ic('printer')} Print</button></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Koi bill nahi</td></tr>'}</tbody></table></div>
    <h3 style="margin-top:16px">Payment history</h3><div class="table-wrap"><table><thead><tr><th>Date</th><th>Amount</th><th>Method</th></tr></thead><tbody>${cp.map(p => `<tr><td>${esc(String(p.paid_at).slice(0, 10))}</td><td>${money(p.amount)}</td><td>${esc(p.method)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Abhi koi payment nahi</td></tr>'}</tbody></table></div>
    <div class="modal-actions">${bal > 0 ? `<button class="wa" data-act="wa" data-id="${c.id}">${ic('wa')} WhatsApp reminder</button>` : ''}<button data-act="collect" data-cid="${c.id}">Receive payment</button><button class="secondary" data-close>Close</button></div>`);
  return el;
}
function customerModal(c = null) {
  if (!isAdmin()) return toast('Sirf admin customer edit kar sakta hai');
  const editing = !!c;
  const f = (n, l, t = 'text', req = false) => `<div class="field"><label>${l}${req ? ' *' : ''}</label><input name="${n}" type="${t}" ${t === 'number' ? 'min="0"' : ''} value="${esc(c?.[n] ?? '')}" ${req ? 'required' : ''}></div>`;
  const el = modal(`<h2>${editing ? 'Edit' : 'Add'} customer</h2><form id="customerForm"><div class="formgrid" style="margin-top:14px">
    ${f('name', 'Customer name', 'text', true)}${f('customer_code', 'Customer ID')}${f('username', 'PPPoE username', 'text', true)}${f('phone', 'Mobile number (03xx...)')}
    <div class="field"><label>Area</label><select name="area"><option value="">Select area</option>${areas.map(a => `<option value="${esc(a.name)}" ${c?.area === a.name ? 'selected' : ''}>${esc(a.name)}</option>`).join('')}</select></div>
    ${f('package_name', 'Package')}${f('monthly_fee', 'Monthly charges', 'number', true)}${f('father_name', 'Father name')}</div>
    <div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button>Save customer</button></div></form>`);
  el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target));
    for (const k of Object.keys(d)) d[k] = typeof d[k] === 'string' ? d[k].trim() : d[k];
    for (const k of ['customer_code', 'phone', 'area', 'package_name', 'father_name']) if (d[k] === '') d[k] = null; // blank code must be NULL (unique column)
    d.monthly_fee = Number(d.monthly_fee); d.updated_at = new Date().toISOString();
    const r = editing ? await sb.from('customers').update(d).eq('id', c.id) : await sb.from('customers').insert(d);
    if (r.error) return toast(r.error.message);
    el.remove(); await refresh(); toast('Customer save ho gaya');
  };
}
function paymentModal(billId = null, customerId = null) {
  const b = billId ? bills.find(x => x.id === billId) : null;
  const c = cmap.get(customerId || b?.customer_id);
  const options = customers.map(x => `<option value="${x.id}" ${c?.id === x.id ? 'selected' : ''}>${esc(x.name)} - ${esc(x.username)}</option>`).join('');
  const targetBill = b || (c ? bills.find(x => x.customer_id === c.id && due(x) > 0) : null);
  const amountDue = targetBill ? due(targetBill) : c?.monthly_fee || 0;
  const el = modal(`<h2>Receive payment</h2><form id="paymentForm"><div class="field" style="margin-top:14px"><label>Customer</label><select name="customer_id" id="payCustomer" required><option value="">Select customer</option>${options}</select></div>
    <div class="field" style="margin-top:12px"><label>Bill</label><select name="bill_id" id="payBill"><option value="">Current month / create bill if needed</option>${bills.filter(x => due(x) > 0).map(x => `<option value="${x.id}" data-customer="${x.customer_id}" ${targetBill?.id === x.id ? 'selected' : ''}>${esc(x.customers?.name || '')} - ${monthLabel(x.billing_month)} - Balance ${money(due(x))}</option>`).join('')}</select></div>
    <div class="field" style="margin-top:12px"><label>Amount received (Rs.)</label><input name="amount" type="number" min="1" step="1" value="${amountDue}" required></div>
    <div class="formgrid" style="margin-top:12px"><div class="field"><label>Payment date</label><input name="paid_at" type="date" value="${today()}" required></div><div class="field"><label>Method</label><select name="method"><option>Cash</option><option>Bank transfer</option><option>JazzCash</option><option>Easypaisa</option></select></div></div>
    <div class="field" style="margin-top:12px"><label>Reference / note</label><input name="reference" placeholder="Optional"></div>
    <div class="modal-actions"><button type="button" class="secondary" data-close>Cancel</button><button>Save payment &amp; receipt</button></div></form>`);
  const cust = el.querySelector('#payCustomer'), bill = el.querySelector('#payBill');
  cust.onchange = () => { const first = bills.find(x => x.customer_id === cust.value && due(x) > 0); bill.value = first ? first.id : ''; };
  bill.onchange = () => { const opt = bill.selectedOptions[0]; if (opt?.dataset.customer) cust.value = opt.dataset.customer; };
  el.querySelector('form').onsubmit = async e => {
    e.preventDefault();
    const d = Object.fromEntries(new FormData(e.target)), amt = Number(d.amount);
    if (!d.customer_id) return toast('Customer select karein');
    if (!Number.isFinite(amt) || amt <= 0) return toast('Sahi amount likhein');
    const payload = { customer_id: d.customer_id, bill_id: d.bill_id || null, amount: amt, paid_at: d.paid_at, method: d.method, reference: d.reference || null, client_key: crypto.randomUUID() };
    if (!navigator.onLine) { const q = offlineQueue(); q.push({ ...payload, local_id: payload.client_key, queued_at: new Date().toISOString() }); saveQueue(q); el.remove(); render(); return toast('Is device par save ho gaya. Internet aane par sync hoga.'); }
    const { data: pay, error } = await sb.rpc('record_payment', { p_customer_id: payload.customer_id, p_bill_id: payload.bill_id, p_amount: payload.amount, p_paid_at: payload.paid_at, p_method: payload.method, p_reference: payload.reference, p_client_key: payload.client_key });
    if (error) return toast(error.message);
    el.remove(); await refresh(); toast('Payment save ho gayi');
    if (pay) printDialog('receipt', payments.find(x => x.id === pay.id) || pay);
  };
}

/* ---------------- Excel import ---------------- */
const ALIASES = {
  name: ['name', 'customername', 'fullname', 'customer', 'subscribername', 'naam'],
  username: ['username', 'pppoe', 'pppoeusername', 'user', 'userid', 'login', 'loginid'],
  phone: ['phone', 'mobile', 'mobileno', 'mobilenumber', 'phoneno', 'phonenumber', 'contact', 'contactno', 'whatsapp', 'cell'],
  area: ['area', 'location', 'zone', 'town', 'village'],
  package_name: ['package', 'packagename', 'plan', 'speed'],
  monthly_fee: ['fee', 'fees', 'monthlyfee', 'monthlycharges', 'charges', 'amount', 'bill', 'price', 'monthlybill'],
  customer_code: ['id', 'customerid', 'customercode', 'code', 'accountno', 'accountnumber', 'clientid'],
  father_name: ['fathername', 'father', 'guardian', 'fathersname']
};
function mapRow(raw) {
  const o = {};
  for (const [k, v] of Object.entries(raw)) {
    const nk = k.toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const [field, list] of Object.entries(ALIASES)) if (list.includes(nk) && o[field] === undefined) o[field] = v;
  }
  return o;
}
function cleanPhone(v) {
  let d = String(v ?? '').split(/[,;/]/)[0].replace(/\D/g, '');
  if (d.startsWith('0092')) d = '0' + d.slice(4); else if (d.startsWith('92') && d.length === 12) d = '0' + d.slice(2); else if (d.length === 10 && d.startsWith('3')) d = '0' + d; // Excel drops the leading 0
  return d;
}
async function readSheet(file) {
  const isCsv = /\.csv$/i.test(file.name);
  const wb = isCsv ? XLSX.read(await file.text(), { type: 'string' }) : XLSX.read(await file.arrayBuffer(), { type: 'array' });
  return XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '', raw: false });
}
function validateImport(rawRows) {
  const existing = new Map(customers.map(c => [c.username, c])), seen = new Set(), rows = [];
  rawRows.forEach((raw, i) => {
    const m = mapRow(raw);
    if (Object.values(raw).every(v => String(v).trim() === '')) return; // blank line
    const feeText = String(m.monthly_fee ?? '').replace(/[^\d.]/g, '');
    const r = {
      line: i + 2, name: String(m.name ?? '').trim(), username: String(m.username ?? '').trim(), phone: cleanPhone(m.phone), area: String(m.area ?? '').trim(),
      package_name: String(m.package_name ?? '').trim(), customer_code: String(m.customer_code ?? '').trim(), father_name: String(m.father_name ?? '').trim(),
      feeBlank: feeText === '', fee: feeText === '' ? 0 : Number(feeText), error: ''
    };
    if (!r.name) r.error = 'Naam missing';
    else if (!r.username) r.error = 'Username missing';
    else if (!Number.isFinite(r.fee)) r.error = 'Fee ghalat';
    else if (seen.has(r.username.toLowerCase())) r.error = 'File mein username dobara hai';
    seen.add(r.username.toLowerCase());
    r.existing = existing.get(r.username) || null;
    rows.push(r);
  });
  return rows;
}
function downloadTemplate() {
  const ws = XLSX.utils.aoa_to_sheet([
    ['Customer ID', 'Name', 'Father Name', 'Username', 'Mobile', 'Area', 'Package', 'Monthly Fee'],
    ['1001', 'Ali Khan', 'Muhammad Khan', 'ali.khan', '03001234567', 'Saddiqabad', '10 Mbps', 1500],
    ['1002', 'Ahmed Raza', 'Raza Ali', 'ahmed.raza', '03211234567', 'Rahim Yar Khan', '5 Mbps', 1000]
  ]);
  ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 22 }, { wch: 18 }, { wch: 15 }, { wch: 18 }, { wch: 14 }, { wch: 13 }];
  const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Customers');
  XLSX.writeFile(wb, 'BigNet-Customers-Template.xlsx');
}
function importModal() {
  if (!isAdmin()) return toast('Sirf admin import kar sakta hai');
  const el = modal(''), body = el.querySelector('.modal');
  const step1 = () => {
    body.innerHTML = `<h2>Excel se customers import karein</h2><p class="muted">.xlsx, .xls ya .csv file. Pehli row mein column ke naam hon (Name, Username, Mobile, Area, Package, Monthly Fee, Customer ID, Father Name).</p>
      <div class="notice info">Zaroori columns: <b>Name</b> aur <b>Username</b>. Jo username pehle se maujood hai uski details update ho sakti hain. Naye Areas khud ban jate hain.</div>
      <div class="dropzone"><b>Excel file select karein</b><br><input type="file" id="impFile" accept=".xlsx,.xls,.csv"></div>
      <div class="modal-actions" style="justify-content:space-between"><button class="secondary" id="tplBtn">${ic('download')} Sample template download</button><button class="secondary" data-close>Close</button></div>`;
    body.querySelector('#tplBtn').onclick = downloadTemplate;
    body.querySelector('#impFile').onchange = async e => {
      const file = e.target.files[0]; if (!file) return;
      try {
        const rows = validateImport(await readSheet(file));
        if (!rows.length) return toast('File mein koi data nahi mila');
        step2(rows, file.name);
      } catch (err) { toast('File parh nahi saka: ' + err.message); }
    };
  };
  const step2 = (rows, fname) => {
    const bad = rows.filter(r => r.error).length, upd = rows.filter(r => !r.error && r.existing).length, fresh = rows.filter(r => !r.error && !r.existing).length;
    body.innerHTML = `<h2>Import preview</h2><p class="muted">${esc(fname)} - ${rows.length} rows</p>
      <div class="sumrow"><span class="pill new">${fresh} naye</span><span class="pill upd">${upd} already maujood</span><span class="pill err">${bad} errors</span></div>
      <div class="table-wrap" style="max-height:300px"><table><thead><tr><th>#</th><th>Name</th><th>Username</th><th>Mobile</th><th>Area</th><th>Fee</th><th>Status</th></tr></thead><tbody>${rows.slice(0, 100).map(r => `<tr><td>${r.line}</td><td>${esc(r.name)}</td><td>${esc(r.username)}</td><td>${esc(r.phone)}</td><td>${esc(r.area)}</td><td>${r.feeBlank ? '-' : money(r.fee)}</td><td>${r.error ? `<span class="pill err">${esc(r.error)}</span>` : r.existing ? '<span class="pill upd">Update</span>' : '<span class="pill new">New</span>'}</td></tr>`).join('')}</tbody></table></div>
      ${rows.length > 100 ? `<div class="more">Pehli 100 rows dikhayi gayi hain. Baqi bhi import hongi.</div>` : ''}
      <div class="formgrid" style="margin-top:14px"><div class="field"><label>Jo customers pehle se hain</label><select id="impMode"><option value="update">Unki details update karein</option><option value="skip">Chhor dein (skip)</option></select></div>
      <div class="field"><label>Is mahine ka bill</label><select id="impBills"><option value="yes">Naye customers ka bill bana dein</option><option value="no">Abhi na banayein</option></select></div></div>
      <div id="impMsg" class="muted" style="margin-top:10px"></div>
      <div class="modal-actions"><button class="secondary" id="impBack">Wapis</button><button id="impGo" ${fresh + upd ? '' : 'disabled'}>${ic('upload')} Import shuru karein</button></div>`;
    body.querySelector('#impBack').onclick = step1;
    body.querySelector('#impGo').onclick = () => runImport(rows, body.querySelector('#impMode').value, body.querySelector('#impBills').value === 'yes');
  };
  const runImport = async (rows, mode, makeBills) => {
    const go = body.querySelector('#impGo'), msg = body.querySelector('#impMsg'); go.disabled = true;
    const todo = rows.filter(r => !r.error && !(r.existing && mode === 'skip'));
    let done = 0;
    try {
      const have = new Set(areas.map(a => a.name)), newAreas = [...new Set(todo.map(r => r.area).filter(a => a && !have.has(a)))];
      if (newAreas.length) { const { error } = await sb.from('areas').upsert(newAreas.map(name => ({ name })), { onConflict: 'name', ignoreDuplicates: true }); if (error) throw error; }
      const payload = todo.map(r => {
        const ex = r.existing, now = new Date().toISOString();
        return {
          customer_code: r.customer_code || ex?.customer_code || null, name: r.name, father_name: r.father_name || ex?.father_name || null, username: r.username,
          phone: r.phone || ex?.phone || null, area: r.area || ex?.area || null, package_name: r.package_name || ex?.package_name || null,
          monthly_fee: r.feeBlank && ex ? Number(ex.monthly_fee) : r.fee, updated_at: now
        };
      });
      for (let i = 0; i < payload.length; i += 200) {
        msg.textContent = `Import ho raha hai... ${done} / ${payload.length}`;
        const { error } = await sb.from('customers').upsert(payload.slice(i, i + 200), { onConflict: 'username' });
        if (error) throw error;
        done += Math.min(200, payload.length - i);
      }
      msg.textContent = 'Data refresh ho raha hai...';
      await loadData();
      if (makeBills) await autoGenerateCurrentMonthBills();
      render();
      body.innerHTML = `<h2>Import mukammal</h2><div class="notice info" style="margin-top:14px"><b>${done}</b> customers import / update ho gaye.${rows.filter(r => r.error).length ? ` ${rows.filter(r => r.error).length} rows errors ki wajah se skip hui.` : ''}</div><div class="modal-actions"><button data-close>Theek hai</button></div>`;
    } catch (err) {
      msg.innerHTML = `<span style="color:var(--red)">Import ruk gaya (${done} customers ho chuke): ${esc(err.message)}</span>`; go.disabled = false;
      if (done) refresh();
    }
  };
  step1();
}

/* ---------------- bills & offline sync ---------------- */
async function autoGenerateCurrentMonthBills() {
  if (!isAdmin() || !customers.length) return;
  const month = today().slice(0, 7), existing = new Set(bills.filter(b => b.billing_month === month).map(b => b.customer_id)), fresh = customers.filter(c => !existing.has(c.id));
  if (!fresh.length) return;
  for (let i = 0; i < fresh.length; i += 500) {
    const { error } = await sb.from('bills').insert(fresh.slice(i, i + 500).map(c => ({ customer_id: c.id, billing_month: month, amount: c.monthly_fee, paid_amount: 0 })));
    if (error) return toast('Automatic bill generation: ' + error.message);
  }
  await loadData();
}
async function generateBills() {
  if (!isAdmin()) return toast('Sirf admin bills bana sakta hai');
  const month = today().slice(0, 7), before = bills.filter(b => b.billing_month === month).length;
  await autoGenerateCurrentMonthBills(); render();
  const made = bills.filter(b => b.billing_month === month).length - before;
  toast(made ? `${made} bills ban gaye (${monthLabel(month)})` : 'Is mahine ke bills pehle se bane hue hain');
}
async function syncOfflineQueue() {
  if (!navigator.onLine) return toast('Internet nahi hai');
  const q = offlineQueue(); if (!q.length) return toast('Koi pending payment nahi');
  let failedAt = q.length;
  for (let i = 0; i < q.length; i++) {
    const it = q[i];
    const { error } = await sb.rpc('record_payment', { p_customer_id: it.customer_id, p_bill_id: it.bill_id, p_amount: it.amount, p_paid_at: it.paid_at, p_method: it.method, p_reference: it.reference, p_client_key: it.local_id });
    if (error) { failedAt = i; toast('Sync ruk gaya: ' + error.message); break; }
  }
  const remaining = q.slice(failedAt); saveQueue(remaining); await refresh();
  if (!remaining.length) toast('Saari offline payments sync ho gayi'); else toast(`${remaining.length} payment(s) abhi pending hain`);
}

/* ---------------- events (one delegated handler) ---------------- */
const ACT = {
  nav: d => { page = d.page; render(); },
  theme: () => { const dark = document.documentElement.dataset.theme !== 'dark'; document.documentElement.dataset.theme = dark ? 'dark' : 'light'; localStorage.setItem('isp-theme', dark ? 'dark' : 'light'); },
  logout: async () => { await sb.auth.signOut(); session = null; renderLogin(); },
  'new-customer': () => customerModal(),
  'edit-customer': d => customerModal(cmap.get(d.id)),
  profile: d => customerProfile(cmap.get(d.id)),
  import: () => importModal(),
  generate: generateBills,
  sync: syncOfflineQueue,
  collect: (d, t) => { t.closest('.modal-back')?.remove(); paymentModal(null, d.cid || null); },
  'collect-bill': d => paymentModal(d.id),
  'add-area': async () => { const name = $('#areaName').value.trim(); if (!name) return; const { error } = await sb.from('areas').insert({ name }); if (error) return toast(error.message); await refresh(); },
  wa: d => sendReminder(d.id),
  'wa-next': () => { const log = reminderLog(), next = filteredPending().find(e => waNumber(e.c.phone) && log[e.c.id] !== today()); next ? sendReminder(next.c.id) : toast('Aaj ke saare reminders bhej diye gaye hain'); },
  'wa-receipt': d => sendReceiptWhatsApp(d.id),
  'save-tpl': () => { localStorage.setItem(TPL_KEY, $('#tplText').value); toast('Message template save ho gaya'); },
  'reset-tpl': () => { localStorage.removeItem(TPL_KEY); $('#tplText').value = DEFAULT_TEMPLATE; toast('Default message wapis aa gaya'); },
  'print-bill': d => printDialog('bill', bills.find(b => b.id === d.id)),
  'print-bills': printBillsBulk,
  receipt: d => printDialog('receipt', payments.find(p => p.id === d.id))
};
document.addEventListener('click', e => {
  const close = e.target.closest('[data-close]'); if (close) return close.closest('.modal-back')?.remove();
  const t = e.target.closest('[data-act]'); if (!t) return;
  Promise.resolve(ACT[t.dataset.act]?.(t.dataset, t, e)).catch(err => toast(err.message));
});
document.addEventListener('input', e => {
  const f = e.target.dataset?.f; if (!f) return;
  ui[f] = e.target.value; updateList();
});
document.addEventListener('keydown', e => { if (e.key === 'Escape') { const m = document.querySelectorAll('.modal-back'); m[m.length - 1]?.remove(); } });

/* ---------------- auth & startup ---------------- */
window.addEventListener('online', syncOfflineQueue);
window.addEventListener('offline', () => toast('Offline mode: nayi payments is device par save hongi'));
document.documentElement.dataset.theme = localStorage.getItem('isp-theme') || 'light';

function renderLogin() {
  app.innerHTML = `<div class="login-bg"><div class="login">${brandHtml()}<h2>Sign in</h2><p class="muted" style="margin:6px 0 18px">Apne ${esc(BRAND.name)} account se login karein.</p>
    <form id="login"><label>Email</label><input name="email" type="email" required placeholder="admin@example.com"><label>Password</label><input name="password" type="password" required placeholder="Password"><button>Sign in</button></form>
    <div class="notice">${configured ? 'Pehle Supabase Authentication mein user banayein, phir sign in karein.' : 'Setup zaroori hai: .env file mein Supabase URL aur anon key daalein. SETUP.md dekhein.'}</div><p id="loginError" style="color:#c0392b"></p>
    <div class="foot">Complaint &amp; Support: ${esc(BRAND.supportName)} ${esc(BRAND.supportPhone)}</div></div></div>`;
  $('#login').onsubmit = async e => {
    e.preventDefault(); if (!sb) return;
    const { error } = await sb.auth.signInWithPassword(Object.fromEntries(new FormData(e.target)));
    if (error) $('#loginError').textContent = error.message; else await start();
  };
}
async function start() {
  const { data: { session: s } } = await sb.auth.getSession(); session = s; if (!session) return renderLogin();
  const { data: p, error } = await sb.from('profiles').select('*').eq('id', session.user.id).single();
  if (error) {
    app.innerHTML = `<div class="login-bg"><div class="login">${brandHtml()}<h2>Account profile missing</h2><p>SQL setup script chalayein aur is user ka profile banayein.</p><button data-act="logout">Sign out</button></div></div>`;
    return;
  }
  profile = p; await loadData(); await autoGenerateCurrentMonthBills(); render();
  if (!liveStarted) {
    liveStarted = true;
    // Keep PC and mobile screens in sync when any authenticated device changes shared records.
    const ch = sb.channel('bignet-live');
    for (const table of ['customers', 'bills', 'payments', 'areas', 'profiles']) ch.on('postgres_changes', { event: '*', schema: 'public', table }, () => refreshSoon());
    ch.subscribe();
    sb.auth.onAuthStateChange((_ev, s2) => { session = s2; if (!s2) renderLogin(); });
  }
}
if ('serviceWorker' in navigator) window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
if (configured) start().catch(e => { app.innerHTML = `<div class="login-bg"><div class="login"><h2>App load nahi hui</h2><p>${esc(e.message)}</p></div></div>`; }); else renderLogin();
