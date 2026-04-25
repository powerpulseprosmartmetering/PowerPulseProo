// BillsPage.jsx — PowerPulsePro Monthly Billing & Reports
// Self-contained, Tailwind-style inline CSS, backend billing API integration
import React, { useState, useMemo, useRef, useEffect } from "react";
import { useNavigate } from 'react-router-dom';

const apiBase = (import.meta.env.VITE_API_BASE_URL
  || (import.meta.env.DEV ? 'http://localhost:5000' : 'https://powerpulseproo-api.onrender.com'))
  .replace(/\/$/, '');

function getAuthToken() {
  const decodeJwtPayload = (token) => {
    try {
      if (!token || typeof token !== 'string') return null;
      const part = token.split('.')[1];
      if (!part) return null;
      const normalized = part.replace(/-/g, '+').replace(/_/g, '/');
      const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
      const json = atob(padded);
      return JSON.parse(json);
    } catch {
      return null;
    }
  };

  const candidates = [
    localStorage.getItem('consumerToken'),
    localStorage.getItem('token'),
    localStorage.getItem('authToken')
  ].filter(Boolean);

  for (const token of candidates) {
    const payload = decodeJwtPayload(token);
    if (payload?.type === 'consumer') {
      return token;
    }
  }

  return null;
}

// --- Mock Data & Configs (Daily usage data for the currently selected month) ---
const deviceId = "PPPRO-001";
import BrandingLogo from '../assets/Logo.jpg';
const today = new Date();
const currentMonth = today.toISOString().slice(0, 7);
const months = Array.from({ length: 12 }, (_, i) => {
  const d = new Date(today.getFullYear(), today.getMonth() - i, 1);
  return d.toISOString().slice(0, 7);
});

// Daily kWh readings for selected month (mock, 30 days)
const dailyKWh = Array.from({ length: 30 }, (_, i) =>
  Math.max(0, Math.round(8 + Math.sin(i / 4) * 2 + Math.random() * 2))
);
// Daily PF (mock)
const dailyPF = Array.from({ length: 30 }, () => 0.95 + Math.random() * 0.03);
// Tariff config (slab)
const tariff = {
  fixedCharge: 120,
  taxPct: 8,
  slabs: [
    { uptoKWh: 100, rate: 4.5 },
    { uptoKWh: 200, rate: 6.5 },
    { rate: 8.0 }, // ∞
  ],
};

function formatDateLabel(value) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }).toUpperCase();
}

function formatAddress(address) {
  if (!address) return 'N/A';
  const parts = [address.street, address.city, address.state, address.pincode].filter(Boolean);
  return parts.length ? parts.join(', ') : 'N/A';
}

function addDays(value, days) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  date.setDate(date.getDate() + days);
  return date;
}

function monthRangeLabel(monthValue) {
  if (!monthValue || !/^\d{4}-\d{2}$/.test(monthValue)) return 'N/A';
  const [year, month] = monthValue.split('-').map(Number);
  const start = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999));
  return `${formatDateLabel(start)} - ${formatDateLabel(end)}`;
}

function sumCharges(tariffDetails) {
  const slabCharges = (tariffDetails?.slabRates || []).reduce((sum, item) => sum + (Number(item.amount) || 0), 0);
  const fixedCharges = Number(tariffDetails?.fixedCharges) || 0;
  const electricityDuty = Number(tariffDetails?.taxes?.electricityDuty) || 0;
  const fuelAdjustment = Number(tariffDetails?.taxes?.fuelAdjustment) || 0;
  const otherCharges = Number(tariffDetails?.taxes?.otherCharges) || 0;
  const totalAmount = slabCharges + fixedCharges + electricityDuty + fuelAdjustment + otherCharges;

  return { slabCharges, fixedCharges, electricityDuty, fuelAdjustment, otherCharges, totalAmount };
}

// --- Helpers & Utilities ---
function formatCurrencyINR(val) {
  const num = Number(val);
  const safeValue = Number.isFinite(num) ? num : 0;
  return `₹${safeValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function applySlabs(kWh, slabs) {
  let remain = kWh, items = [], subtotal = 0, lastUpto = 0;
  for (let i = 0; i < slabs.length; i++) {
    const { uptoKWh, rate } = slabs[i];
    let units = uptoKWh ? Math.min(remain, uptoKWh - lastUpto) : remain;
    let amt = units * rate;
    items.push({ range: uptoKWh ? `${lastUpto + 1}-${uptoKWh}` : `>${lastUpto}`, units, rate, amt });
    subtotal += amt;
    remain -= units;
    lastUpto = uptoKWh || lastUpto + units;
    if (remain <= 0) break;
  }
  return { items, subtotal };
}

function computeTotals(subtotal, fixed, tax, fuelAdj = 0) {
  const taxAmt = (subtotal + fixed) * (tax / 100);
  // Fuel adj is currently 0, but included for completeness
  const fuelAmt = (subtotal + fixed) * (fuelAdj / 100);
  return {
    subtotal,
    fixed,
    taxAmt,
    fuelAmt,
    total: Math.round(subtotal + fixed + taxAmt + fuelAmt),
  };
}

function exportCSV(name, rows) {
  const header = Object.keys(rows[0]).join(",");
  const body = rows.map(r => Object.values(r).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name + ".csv";
  a.click();
  URL.revokeObjectURL(url);
}

function exportPDF(name, data) {
  // Simple print for PDF export demonstration
  window.print();
}

// --- Main Component ---
// Inline style constants used in bill & history tables (previously missing -> caused ReferenceError)
const tableH = { padding: '4px 6px', border: '1px solid #000', textAlign: 'center', fontWeight: 'bold' };
const tableD = { padding: '4px 6px', border: '1px solid #000', textAlign: 'center' };
const billTDL = { padding: '3px 6px', borderBottom: '1px dotted #555', textAlign: 'left' };
const billTDR = { padding: '3px 6px', borderBottom: '1px dotted #555', textAlign: 'right', minWidth: '90px', fontVariantNumeric: 'tabular-nums' };

export default function BillsPage() {
  // --- App State ---
  const navigate = useNavigate();
  const [consumerProfile, setConsumerProfile] = useState(null);
  const [selectedMonth, setSelectedMonth] = useState(() => {
    try {
      const savedMonth = localStorage.getItem('billingSelectedMonth');
      return savedMonth && /^\d{4}-\d{2}$/.test(savedMonth) ? savedMonth : currentMonth;
    } catch {
      return currentMonth;
    }
  });
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [billingHistory, setBillingHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyMessage, setHistoryMessage] = useState('');
  const hasAutoSelectedMonthRef = useRef(false);

  const dataReady = !loading && !historyLoading;

  // --- Style Injection ---
  useEffect(() => {
    if (!document.getElementById('detailed-charts-styles')) {
      const styleTag = document.createElement('style');
      styleTag.id = 'detailed-charts-styles';
      styleTag.innerHTML = COMPONENT_CSS;
      document.head.appendChild(styleTag);
    }

    return () => {
      const tag = document.getElementById('detailed-charts-styles');
      if (tag) tag.remove();
    };
  }, []);

  useEffect(() => {
    const token = getAuthToken();
    if (!token) {
      setHistoryLoading(false);
      setHistoryMessage('Please sign in to view billing history.');
      setBillingHistory([]);
      return;
    }

    let isMounted = true;

    try {
      localStorage.setItem('billingSelectedMonth', selectedMonth);
    } catch {}

    const loadBillingHistory = async (options = {}) => {
      const { silent = false } = options;
      if (!silent) {
        setHistoryLoading(true);
      }
      setHistoryMessage('');

      try {
        const [profileResponse, historyResponse] = await Promise.all([
          fetch(`${apiBase}/api/consumer/profile`, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'Cache-Control': 'no-cache'
            }
          }),
          fetch(`${apiBase}/api/consumer/billing/history?limit=12&month=${encodeURIComponent(selectedMonth)}`, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'Cache-Control': 'no-cache'
            }
          })
        ]);

        const [profilePayload, historyPayload] = await Promise.all([
          profileResponse.json(),
          historyResponse.json()
        ]);

        if (profileResponse.ok && profilePayload?.status === 'success') {
          const freshProfile = profilePayload?.data?.consumer || null;
          if (freshProfile && isMounted) {
            setConsumerProfile(freshProfile);
            localStorage.setItem('consumerProfile', JSON.stringify(freshProfile));
            localStorage.setItem('user', JSON.stringify(freshProfile));
          }
        }

        if (!historyResponse.ok || historyPayload?.status !== 'success') {
          throw new Error(historyPayload?.message || 'Failed to load billing history');
        }

        const history = (historyPayload?.data?.bills || []).map((bill) => ({
          id: bill._id || bill.id || bill.readingPeriod?.billingCycle,
          month: bill.readingPeriod?.billingCycle || (bill.readingPeriod?.startDate ? new Date(bill.readingPeriod.startDate).toISOString().slice(0, 7) : 'N/A'),
          billDate: bill.createdAt || bill.timestamp || bill.readingPeriod?.endDate || null,
          dueDate: addDays(bill.readingPeriod?.endDate || bill.createdAt || bill.timestamp, 15),
          readingPeriod: bill.readingPeriod || null,
          reading: bill.reading || null,
          tariffDetails: bill.tariffDetails || null,
          billAmount: bill.billAmount || sumCharges(bill.tariffDetails),
          amount: Number(bill?.billAmount?.totalAmount ?? sumCharges(bill.tariffDetails).totalAmount ?? 0),
          status: bill.status === 'processed' ? 'Paid' : bill.status === 'disputed' ? 'Disputed' : bill.status === 'corrected' ? 'Corrected' : 'Pending',
          raw: bill
        }));

        if (!isMounted) return;

        history.sort((a, b) => b.month.localeCompare(a.month));
        setBillingHistory(history);

        const selectedBill = history.find((item) => item.month === selectedMonth) || null;
        const latestRealBill = history.find((bill) => !bill?.synthetic && bill?.month && bill.month !== selectedMonth) || null;
        const needsRealBill = selectedBill?.synthetic || !selectedBill;

        if (needsRealBill && latestRealBill?.month && !hasAutoSelectedMonthRef.current) {
          hasAutoSelectedMonthRef.current = true;
          try {
            localStorage.setItem('billingSelectedMonth', latestRealBill.month);
          } catch {}
          setSelectedMonth(latestRealBill.month);
          setHistoryMessage('');
          return;
        }

        if (!hasAutoSelectedMonthRef.current && history.length > 0 && history.every((bill) => bill?.synthetic)) {
          const broadResponse = await fetch(`${apiBase}/api/consumer/billing/history?limit=12`, {
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${token}`,
              'Cache-Control': 'no-cache'
            }
          });
          const broadPayload = await broadResponse.json();
          if (broadResponse.ok && broadPayload?.status === 'success') {
            const broadBills = broadPayload?.data?.bills || [];
            const broadLatestRealBill = broadBills.find((bill) => !bill?.synthetic && bill?.readingPeriod?.billingCycle);
            if (broadLatestRealBill?.readingPeriod?.billingCycle) {
              hasAutoSelectedMonthRef.current = true;
              try {
                localStorage.setItem('billingSelectedMonth', broadLatestRealBill.readingPeriod.billingCycle);
              } catch {}
              setSelectedMonth(broadLatestRealBill.readingPeriod.billingCycle);
              setHistoryMessage('');
              return;
            }
          }
        }

        setHistoryMessage(history.length ? '' : 'No billing records found.');
      } catch (error) {
        if (!isMounted) return;
        console.error('Error fetching billing history:', error);
        setBillingHistory([]);
        setHistoryMessage(error.message || 'Failed to load billing history.');
        setToast({ type: 'error', msg: 'Failed to load billing history.' });
      } finally {
        if (isMounted) {
          setHistoryLoading(false);
        }
      }
    };

    loadBillingHistory();

    const refreshTimer = setInterval(() => {
      loadBillingHistory({ silent: true });
    }, 15000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        loadBillingHistory({ silent: true });
      }
    };

    const onFocus = () => {
      loadBillingHistory({ silent: true });
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      clearInterval(refreshTimer);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
      isMounted = false;
    };
  }, [selectedMonth]);

  const selectedBill = useMemo(() => {
    return billingHistory.find((item) => item.month === selectedMonth) || null;
  }, [billingHistory, selectedMonth]);

  const liveBillAmount = selectedBill?.billAmount?.totalAmount ?? 0;
  const liveBillingParts = selectedBill ? sumCharges(selectedBill.tariffDetails) : sumCharges(null);
  const liveBillAmountDisplay = liveBillAmount || liveBillingParts.totalAmount;
  const consumerName = consumerProfile?.name || selectedBill?.raw?.consumerName || 'N/A';
  const consumerNumber = consumerProfile?.consumerNumber || 'N/A';
  const consumerAddress = formatAddress(consumerProfile?.address);
  const meterId = consumerProfile?.meterDetails?.meterId || 'N/A';
  const tariffPlan = consumerProfile?.tariffPlan || 'N/A';
  const connectionType = consumerProfile?.connectionType || 'N/A';
  const billDateLabel = formatDateLabel(selectedBill?.billDate);
  const billingCycleLabel = selectedBill?.month
    ? monthRangeLabel(selectedBill.month)
    : monthRangeLabel(selectedMonth);
  const dueDateLabel = formatDateLabel(selectedBill?.dueDate);
  const currentReading = selectedBill?.reading?.currentReading ?? '-';
  const previousReading = selectedBill?.reading?.previousReading ?? '-';
  const unitsConsumed = selectedBill?.reading?.unitsConsumed ?? '-';
  const currentReadingDate = formatDateLabel(selectedBill?.readingPeriod?.endDate || selectedBill?.billDate);
  const previousReadingDate = formatDateLabel(selectedBill?.readingPeriod?.startDate);
  const paymentHistoryLabel = historyLoading ? 'Loading live billing history...' : 'Payment History (Live from Backend)';
  const exportRows = selectedBill ? [
    { field: 'Consumer Number', value: consumerNumber },
    { field: 'Consumer Name', value: consumerName },
    { field: 'Billing Cycle', value: billingCycleLabel },
    { field: 'Bill Date', value: billDateLabel },
    { field: 'Due Date', value: dueDateLabel },
    { field: 'Current Reading', value: currentReading },
    { field: 'Previous Reading', value: previousReading },
    { field: 'Units Consumed', value: unitsConsumed },
    { field: 'Total Bill Amount', value: liveBillAmountDisplay },
    { field: 'Status', value: selectedBill.status || 'N/A' }
  ] : billingHistory.map((item) => ({
    field: item.month,
    value: item.billAmount?.totalAmount ?? item.billAmount ?? 0,
    status: item.status
  }));

  // --- Derived Data (based on mock dailyKWh for the selected month) ---
  const daysInMonth = new Date(selectedMonth.split("-")[0], selectedMonth.split("-")[1], 0).getDate();
  const kWh = useMemo(() => dailyKWh.reduce((a, b) => a + b, 0), [selectedMonth]);
  const avgDaily = Math.round(kWh / daysInMonth);
  const peakIdx = dailyKWh.indexOf(Math.max(...dailyKWh));
  const peakDay = peakIdx + 1;
  const pfAvg = (dailyPF.reduce((a, b) => a + b, 0) / dailyPF.length).toFixed(2);
  const { items: slabItems, subtotal } = applySlabs(kWh, tariff.slabs);
  const totals = computeTotals(subtotal, tariff.fixedCharge, tariff.taxPct);

  // --- Actions ---
  function handleMonthChange(e) {
    const nextMonth = e.target.value;
    setSelectedMonth(nextMonth);
    try {
      localStorage.setItem('billingSelectedMonth', nextMonth);
    } catch {}
    setLoading(true);
    setTimeout(() => setLoading(false), 600); // Simulate fetch for daily data
  }

  function handlePrevMonth() {
    const idx = months.indexOf(selectedMonth);
    if (idx < months.length - 1) {
      const nextMonth = months[idx + 1];
      setSelectedMonth(nextMonth);
      try {
        localStorage.setItem('billingSelectedMonth', nextMonth);
      } catch {}
      setLoading(true);
      setTimeout(() => setLoading(false), 300);
    }
  }

  function handleNextMonth() {
    const idx = months.indexOf(selectedMonth);
    if (idx > 0) {
      const nextMonth = months[idx - 1];
      setSelectedMonth(nextMonth);
      try {
        localStorage.setItem('billingSelectedMonth', nextMonth);
      } catch {}
      setLoading(true);
      setTimeout(() => setLoading(false), 300);
    }
  }

  function handleExportCSV() {
    if (!exportRows.length) {
      setToast({ type: 'error', msg: 'No billing data available to export.' });
      return;
    }
    exportCSV(`Bill_${selectedMonth}`, exportRows);
    setToast({ type: "success", msg: "CSV export initiated." });
  }

  function handleExportPDF() {
    exportPDF(`Bill_${selectedMonth}`, slabItems);
    setToast({ type: "success", msg: "PDF export started. Check print dialog." });
  }

  function handlePrint() {
    window.print();
  }

  // --- UI ---
  return (
    <div className="dc-container">
      {/* Header */}
      <header className="dc-header" role="banner">
        <div className="dc-header-content">
          <div className="dc-logo-section">
            <img src={BrandingLogo} alt="PowerPulsePro logo" className="dc-logo" />
          </div>
          <h1 className="dc-page-title">Billing Summary</h1>
          <button className="dc-back-btn" onClick={() => navigate('/dashboard')} aria-label="Back to Dashboard">← Dashboard</button>
        </div>
      </header>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', top: 24, right: 24, zIndex: 100, padding: '12px 24px', borderRadius: 12, boxShadow: '0 4px 24px rgba(0,0,0,0.12)', color: '#fff', background: toast.type === 'success' ? '#22c55e' : toast.type === 'info' ? '#2563eb' : '#ef4444', fontWeight: 600 }} onClick={() => setToast(null)}>{toast.msg}</div>
      )}

      {/* Wrapper */}
      <div style={{ width: '100%', maxWidth: '900px', margin: '20px auto 0', padding: '0 8px', boxSizing: 'border-box' }}>
        {/* Month Controls */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16, flexWrap: 'wrap', gap: '0.75rem' }}>
          <div style={{ fontSize: '0.85rem', color: '#64748b' }}>
            <span style={{ fontWeight: 600 }}>{deviceId}</span>
            <span style={{ marginLeft: 12 }}>Source: <span style={{ fontWeight: 600, color: '#6366f1', fontSize: '0.7rem' }}>Backend API</span></span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <button className="dc-chip" onClick={handlePrevMonth} disabled={!dataReady || months.indexOf(selectedMonth) === months.length - 1}>← Prev</button>
            <input type="month" value={selectedMonth} onChange={handleMonthChange} className="dc-date-input" style={{ width: 140, textAlign: 'center' }} />
            <button className="dc-chip" onClick={handleNextMonth} disabled={!dataReady || months.indexOf(selectedMonth) === 0}>Next →</button>
          </div>
        </div>

        {/* Bill Layout */}
        <div style={{ width: '100%', maxWidth: '850px', margin: '0 auto 40px', padding: '4px', boxSizing: 'border-box' }}>
          <div style={{ background: '#fff', border: '1px solid #000', boxShadow: '0 8px 24px -8px rgba(0,0,0,0.12)', padding: '24px 32px', fontFamily: 'Arial, sans-serif', fontSize: '10pt', color: '#222', lineHeight: 1.4, borderRadius: 4 }} className="print-area">
            {/* Bill Header */}
            <div style={{ textAlign: 'center', marginBottom: 18, borderBottom: '1px solid #000', paddingBottom: 8 }}>
              <h2 style={{ fontSize: '14pt', fontWeight: 'bold', margin: 0 }}>Power Pulse Pro</h2>
                <div style={{ fontSize: '11pt', margin: '4px 0 0 0' }}>Bill of Supply For: {billingCycleLabel}</div>
            </div>

            {/* Consumer Details */}
            <div className="bill-grid-2col consumer-details" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 14, borderBottom: '1px dotted #555', paddingBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 'bold' }}>Consumer No: {consumerNumber}</div>
                <div style={{ fontWeight: 'bold' }}>{consumerName}</div>
                <div>{consumerAddress}</div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '4px 8px', fontSize: '9pt' }}>
                <div style={{ fontWeight: 'bold' }}>Bill Date:</div><div>{billDateLabel}</div>
                <div style={{ fontWeight: 'bold' }}>Bill Amount:</div><div style={{ fontWeight: 'bold', color: '#B30000' }}>{formatCurrencyINR(liveBillAmountDisplay)}</div>
                <div style={{ fontWeight: 'bold' }}>Due Date:</div><div style={{ fontWeight: 'bold', color: '#B30000' }}>{dueDateLabel}</div>
                <div style={{ fontWeight: 'bold' }}>Meter ID:</div><div>{meterId}</div>
              </div>
            </div>

            {/* Reading / Usage */}
            <div className="bill-grid-2col reading-usage" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 16 }}>
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #000', padding: '4px 0', fontWeight: 'bold', fontSize: '9pt' }}>
                  <span>Connection Type: {connectionType}</span>
                  <span>Billing Cycle: {billingCycleLabel}</span>
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', marginTop: 4 }}>
                  <thead>
                    <tr style={{ background: '#f0f0f0' }}>
                      <th style={tableH}>Current Reading</th>
                      <th style={tableH}>Previous Reading</th>
                      <th style={tableH}>MF</th>
                      <th style={tableH}>Unit</th>
                      <th style={tableH}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr style={{ textAlign: 'center' }}>
                      <td style={tableD}>{currentReading}</td>
                      <td style={tableD}>{previousReading}</td>
                      <td style={tableD}>1</td>
                      <td style={tableD}>{unitsConsumed}</td>
                      <td style={tableD}>{unitsConsumed}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ fontSize: '9pt' }}>
                <div><strong>Tariff Plan:</strong> {tariffPlan} &nbsp; | &nbsp; <strong>Meter ID:</strong> {meterId}</div>
                <div><strong>Current Reading Date:</strong> {currentReadingDate}</div>
                <div><strong>Previous Reading Date:</strong> {previousReadingDate}</div>
              </div>
            </div>

            {/* Bill Details */}
            <div style={{ border: '2px solid #000', padding: 10, marginBottom: 16 }}>
              <div style={{ textAlign: 'center', fontWeight: 'bold', fontSize: '11pt', marginBottom: 8 }}>BILL DETAILS</div>
              <table className="bill-details-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '10pt' }}>
                <tbody>
                  <tr><td style={billTDL}>Fixed Charges</td><td style={billTDR}>{formatCurrencyINR(liveBillingParts.fixedCharges)}</td></tr>
                  <tr><td style={billTDL}>Energy / Slab Charges</td><td style={billTDR}>{formatCurrencyINR(liveBillingParts.slabCharges)}</td></tr>
                  <tr><td style={billTDL}>Electricity Duty</td><td style={billTDR}>{formatCurrencyINR(liveBillingParts.electricityDuty)}</td></tr>
                  <tr><td style={billTDL}>Fuel Adjustment</td><td style={billTDR}>{formatCurrencyINR(liveBillingParts.fuelAdjustment)}</td></tr>
                  <tr><td style={billTDL}>Other Charges</td><td style={billTDR}>{formatCurrencyINR(liveBillingParts.otherCharges)}</td></tr>
                  <tr style={{ fontWeight: 'bold', borderTop: '1px solid #000', background: '#e0e0e0' }}>
                    <td style={billTDL}>Total Bill Amount (Rs)</td>
                    <td style={billTDR}>{formatCurrencyINR(liveBillAmountDisplay)}</td>
                  </tr>
                  <tr><td style={billTDL}>Units Consumed</td><td style={billTDR}>{unitsConsumed}</td></tr>
                  <tr style={{ fontWeight: 'bold', borderTop: '1px solid #000' }}><td style={billTDL}>Rounded Bill (Rs)</td><td style={billTDR}>{formatCurrencyINR(Math.round(liveBillAmountDisplay))}</td></tr>
                </tbody>
              </table>
            </div>

            {/* Payment Summary */}
            <div style={{ border: '2px solid #B30000', padding: 10, textAlign: 'center', marginBottom: 18, background: '#fffafa' }}>
              <div style={{ fontWeight: 'bold', fontSize: '12pt', color: '#B30000' }}>Pay Rs. {formatCurrencyINR(Math.round(liveBillAmountDisplay))}</div>
              <div style={{ fontSize: '10pt', marginTop: 6 }}>Due Date: {dueDateLabel}</div>
              <div style={{ fontSize: '9pt', marginTop: 10, color: '#006400', fontWeight: 'bold' }}>Status: {selectedBill?.status || 'N/A'}</div>
            </div>

            {/* Billing History (Backend) */}
            <div style={{ borderTop: '1px solid #ccc', paddingTop: 10 }}>
              <div style={{ fontWeight: 'bold', fontSize: '11pt', marginBottom: 10 }}>{paymentHistoryLabel}</div>
              <div className="table-responsive" style={{ width: '100%', overflowX: 'auto' }}>
              <table className="history-table" style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9pt', minWidth: 420 }}>
                <thead>
                  <tr style={{ background: '#f0f0f0' }}>
                    <th style={tableH}>Month</th>
                    <th style={tableH}>kWh</th>
                    <th style={tableH}>Paid Amount</th>
                    <th style={tableH}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {billingHistory.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ padding: '8px', textAlign: 'center', color: '#64748b' }}>
                        {historyLoading ? 'Loading history...' : historyMessage || 'No billing records found.'}
                      </td>
                    </tr>
                  ) : (
                    billingHistory.map(row => (
                      <tr key={row.month} style={{ borderBottom: '1px dotted #ccc' }}>
                        <td style={tableD}>{row.month}</td>
                        <td style={tableD}>{row.kWh}</td>
                        <td style={tableD}>{formatCurrencyINR(row.amount)}</td>
                        <td style={{ ...tableD, color: row.status === 'Paid' ? '#006400' : '#B30000', fontWeight: 'bold' }}>{row.status}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          {/* Action Buttons */}
          <div className="action-buttons" style={{ display: 'flex', gap: '1rem', justifyContent: 'center', marginTop: 20 }}>
            <button style={{ background: '#ea580c', color: '#fff', padding: '12px 24px', borderRadius: 10, fontWeight: 600, fontSize: '1rem', border: 'none', boxShadow: '0 2px 8px rgba(234,88,12,0.3)', cursor: 'pointer' }} onClick={handleExportPDF} disabled={!dataReady}>Generate PDF (Print)</button>
            <button style={{ background: '#fff', color: '#333', border: '1px solid #e0e7ff', padding: '12px 24px', borderRadius: 10, fontWeight: 600, fontSize: '1rem', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', cursor: 'pointer' }} onClick={handlePrint} disabled={!dataReady}>Print Page</button>
            <button style={{ background: '#64748b', color: '#fff', padding: '12px 24px', borderRadius: 10, fontWeight: 600, fontSize: '1rem', border: 'none', boxShadow: '0 2px 8px rgba(100,116,139,0.3)', cursor: 'pointer' }} onClick={handleExportCSV} disabled={!dataReady}>Export CSV</button>
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className="dc-footer" role="contentinfo">
        <div className="dc-footer-help">
          <span>Need help? Contact </span>
          <a href="mailto:powerpulsepro.smartmetering@gmail.com" className="dc-footer-link">PowerPulsePro Support</a>
        </div>
        <div className="dc-footer-copy">© {new Date().getFullYear()} PowerPulsePro Smart Energy Meter. All rights reserved.</div>
      </footer>
    </div>
  );
}

// --- MiniBarChart: Canvas Bar Chart ---
function MiniBarChart({ data, highlightIdx }) {
  const ref = useRef();
  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    // Handle responsiveness: ensure canvas size matches display size
    const container = canvas.parentElement;
    const displayWidth = container.clientWidth;
    const displayHeight = 48; // Fixed height

    // Set canvas drawing buffer size
    canvas.width = displayWidth;
    canvas.height = displayHeight;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const w = canvas.width, h = canvas.height;
    const barW = Math.max(2, Math.floor(w / data.length));
    const maxVal = Math.max(...data);

    data.forEach((v, i) => {
      const x = i * barW;
      const barH = Math.round((v / maxVal) * (h - 10));

      // Highlight current day/month, otherwise main color
      ctx.fillStyle = i === highlightIdx ? "#ff7e1b" : "#6366f1";
      ctx.fillRect(x, h - barH, barW - 1, barH);
    });
  }, [data, highlightIdx]);

  // Adjusted canvas to be width-fluid
  return <canvas ref={ref} width={320} height={48} style={{ width: '100%', height: '48px' }} aria-label="Daily Usage Bar Chart" />;
}

// --- Component CSS from DetailedCharts.jsx ---
const COMPONENT_CSS = `
@media (max-width: 600px) {
  .dc-header-content {
    display: flex !important;
    flex-direction: row !important;
    align-items: center !important;
    justify-content: space-between !important;
    padding: .5rem .5rem !important;
    gap: .5rem !important;
    width: 100% !important;
  }
  .dc-logo-section {
    margin-bottom: 0 !important;
    justify-content: flex-start !important;
    flex: 0 0 auto !important;
    min-width: 0 !important;
  }
  .dc-logo {
    height: 28px !important;
    width: auto !important;
    margin-bottom: 0 !important;
    min-width: 28px !important;
  }
  .dc-page-title {
    font-size: 1rem !important;
    text-align: center !important;
    margin: 0 !important;
    padding: 0 !important;
    position: static !important;
    transform: none !important;
    line-height: 1.15 !important;
    flex: 1 1 0 !important;
    min-width: 0 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
  .dc-back-btn {
    font-size: .8rem !important;
    padding: .3rem .6rem !important;
    border-radius: .5rem !important;
    margin-top: 0 !important;
    width: auto !important;
    min-width: 70px !important;
    max-width: 100px !important;
    box-sizing: border-box !important;
    text-align: center !important;
    display: block !important;
    flex: 0 0 auto !important;
  }
  .dc-page-title {
    font-size: 1.1rem !important;
    font-weight: 700 !important;
    color: var(--dc-primary) !important;
    text-align: center !important;
    margin: 0 !important;
    padding: 0 .5rem !important;
    position: static !important;
    transform: none !important;
    line-height: 1.15 !important;
    flex: 1 1 0 !important;
    min-width: 0 !important;
    white-space: nowrap !important;
    overflow: hidden !important;
    text-overflow: ellipsis !important;
  }
}
@media (max-width: 600px) {
  .dc-header-content {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    padding: .5rem .5rem;
    gap: .5rem;
  }
  .dc-logo-section {
    margin-bottom: 0;
    justify-content: flex-start;
    flex: 0 0 auto;
  }
  .dc-page-title {
    font-size: 1rem;
    text-align: center;
    margin: 0;
    padding: 0;
    position: static;
    transform: none;
    line-height: 1.15;
    flex: 1 1 auto;
    min-width: 0;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .dc-back-btn {
    font-size: .95rem;
    padding: .5rem .7rem;
    border-radius: .7rem;
    margin-top: 0;
    width: auto;
    box-sizing: border-box;
    text-align: center;
    display: block;
    flex: 0 0 auto;
  }
}
@media (max-width: 600px) {
  .dc-header-content {
    flex-direction: column;
    align-items: stretch;
    padding: .5rem .5rem;
    gap: .2rem;
  }
  .dc-logo-section {
    margin-bottom: 2px;
    justify-content: center;
  }
  .dc-page-title {
    font-size: 1rem;
    text-align: center;
    margin: 0 0 2px 0;
    padding: 0;
    position: static;
    transform: none;
    line-height: 1.15;
    width: 100%;
  }
  .dc-back-btn {
    font-size: .95rem;
    padding: .5rem 0;
    border-radius: .7rem;
    margin-top: 6px;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
    display: block;
  }
  .dc-filters {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: .6rem .4rem;
    gap: .7rem;
    margin: .5rem 0 1rem 0;
    border-radius: 12px;
  }
  .dc-filters > div {
    margin-bottom: 4px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
  }
  .dc-date-input {
    width: 100%;
    font-size: 1rem;
    margin: 4px 0;
    min-width: 0;
    text-align: center;
  }
  .dc-chip {
    font-size: 1rem;
    padding: .5rem 0;
    width: 100%;
    margin-bottom: 4px;
    border-radius: 999px;
    text-align: center;
    display: block;
  }
  .dc-filters > div:first-child {
    align-items: center;
    font-size: 1rem;
    margin-bottom: 0;
  }
}
@media (max-width: 600px) {
  .dc-header-content {
    flex-direction: column;
    align-items: flex-start;
    padding: .5rem .5rem;
    gap: .2rem;
  }
  .dc-logo-section {
    margin-bottom: 2px;
  }
  .dc-page-title {
    font-size: 1rem;
    text-align: left;
    margin: 0 0 2px 0;
    padding: 0;
    position: static;
    transform: none;
    line-height: 1.15;
  }
  .dc-back-btn {
    font-size: .85rem;
    padding: .35rem .7rem;
    border-radius: .5rem;
    margin-top: 2px;
    width: 100%;
    box-sizing: border-box;
    text-align: center;
  }
  .dc-filters {
    display: flex;
    flex-direction: column;
    align-items: stretch;
    padding: .6rem .4rem;
    gap: .5rem;
    margin: .5rem 0 1rem 0;
    border-radius: 12px;
  }
  .dc-filters > div {
    margin-bottom: 4px;
    width: 100%;
    display: flex;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }
  .dc-date-input {
    width: 100%;
    font-size: .95rem;
    margin: 4px 0;
    min-width: 0;
  }
  .dc-chip {
    font-size: .85rem;
    padding: .3rem .6rem;
    width: 100%;
    margin-bottom: 4px;
  }
}
/* --- Responsive Mobile Styles --- */
:root { --dc-bg: #fef7f0; --dc-bg-mid: #f0f9ff; --dc-bg-end: #ecfeff; --dc-surface: #ffffff; --dc-surface-alt: #f8fafc; --dc-border: #e2e8f0; --dc-border-strong: #cbd5e1; --dc-text: #111827; --dc-text-dim: #64748b; --dc-primary: #ea580c; --dc-primary-accent: #0891b2; --dc-radius-sm: 4px; --dc-radius: 10px; --dc-radius-lg: 18px; --dc-focus: 2px solid #0891b2; --dc-font-stack: -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif; --dc-max:1280px; }
.dc-container { font-family: var(--dc-font-stack); -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; background: linear-gradient(135deg,var(--dc-bg) 0%,var(--dc-bg-mid) 50%,var(--dc-bg-end) 100%); min-height: 100vh; padding: 0; color: var(--dc-text); box-sizing: border-box; display:flex; flex-direction:column; overflow-x:hidden; }
.dc-header { position: sticky; top: 0; z-index: 40; background: rgba(255,255,255,0.95); backdrop-filter: blur(20px); border-bottom: 2px solid var(--dc-primary); box-shadow: 0 4px 20px 0 rgba(234,88,12,0.2); }
.dc-header-content { width:100%; max-width: var(--dc-max); margin: 0 auto; display: flex; align-items: center; justify-content: space-between; padding: .65rem 1rem; gap: 1rem; box-sizing:border-box; position:relative; }
.dc-logo-section { display: flex; align-items: center; gap: .4rem; }
.dc-logo { height: 42px; width: auto; object-fit: contain; }
@media (max-width: 600px) {
  .dc-header-content {
    flex-direction: column;
    align-items: flex-start;
    padding: .5rem .5rem;
    gap: .5rem;
  }
  .dc-logo {
    height: 28px;
    margin-bottom: 4px;
  }
  .dc-page-title {
    font-size: 1.05rem;
    position: static;
    transform: none;
    text-align: left;
    margin: 0;
    padding: 0;
  }
  .dc-back-btn {
    font-size: .8rem;
    padding: .4rem .7rem;
    border-radius: .5rem;
    margin-top: 4px;
  }
  .dc-filters {
    grid-template-columns: 1fr;
    padding: .7rem .5rem;
    gap: .7rem;
    margin: .5rem 0 1rem 0;
    border-radius: 12px;
  }
  .dc-date-input {
    width: 100px;
    font-size: .9rem;
  }
  .dc-chip {
    font-size: .8rem;
    padding: .3rem .5rem;
  }
  .dc-container {
    padding: 0;
  }
  .dc-footer {
    font-size: .7rem;
    padding: .7rem .5rem 1rem;
  }
  .dc-footer-help {
    font-size: .8rem;
  }
  .dc-footer-copy {
    font-size: .7rem;
  }
}
.dc-brand-text { display:none; }
.dc-page-title { font-size: 1.4rem; font-weight: 700; margin: 0; color: var(--dc-primary); text-align: center; flex: 0; position:absolute; left:50%; top:50%; transform:translate(-50%,-50%); padding:0 .5rem; line-height:1.1; }
.dc-back-btn { background: var(--dc-primary); color: #fff; border: none; padding: .55rem .9rem; border-radius: .65rem; cursor: pointer; font-weight: 600; font-size: .8rem; letter-spacing: .5px; box-shadow: 0 2px 6px -1px rgba(234,88,12,0.5); transition: background .25s, transform .25s, box-shadow .25s; }
.dc-back-btn:hover { background: #c2410c; transform: translateY(-2px); box-shadow: 0 6px 14px -4px rgba(234,88,12,0.45); }
.dc-back-btn:active { transform: translateY(0); }
.dc-filters { display: grid; grid-template-columns: repeat(auto-fit,minmax(170px,1fr)); gap: 1rem; background: var(--dc-surface); padding: 1rem 1rem; border-radius: var(--dc-radius-lg); box-shadow: 0 4px 10px -4px rgba(0,0,0,0.1),0 0 0 1px rgba(0,0,0,0.05); margin: 1.1rem auto 1.25rem; width:100%; max-width: var(--dc-max); box-sizing:border-box; }
.dc-filter-group { display: flex; flex-direction: column; gap: .35rem; }
.dc-filter-label { font-size: .72rem; font-weight: 600; letter-spacing: .2px; color: var(--dc-text-dim); }
.dc-preset-row { display: flex; flex-wrap: wrap; gap: .4rem; }
.dc-chip { border: 1px solid var(--dc-border); background: var(--dc-surface-alt); padding: .38rem .6rem; font-size: .7rem; border-radius: 999px; cursor: pointer; color: var(--dc-text-dim); font-weight: 600; letter-spacing: .2px; transition: background .25s, color .25s, border-color .25s; }
.dc-chip.active, .dc-chip:hover { background: var(--dc-primary); color: #fff; border-color: var(--dc-primary); }
.dc-date-input, .dc-select, .dc-threshold-input { background: var(--dc-surface-alt); border: 1px solid var(--dc-border); padding: .55rem .6rem; border-radius: var(--dc-radius-sm); font-size: .8rem; color: var(--dc-text); outline: none; transition: border-color .25s, background .25s; }
.dc-date-input:focus, .dc-select:focus, .dc-threshold-input:focus { border-color: var(--dc-primary); box-shadow: 0 0 0 2px rgba(234,88,12,0.25); }
.dc-toggle-row { display: flex; align-items: center; gap: .75rem; flex-wrap: wrap; }
.dc-checkbox-label { display: inline-flex; align-items: center; gap: .45rem; font-size: .75rem; font-weight: 500; color: var(--dc-text-dim); cursor: pointer; }
.dc-checkbox-label input { transform: scale(1.1); accent-color: var(--dc-primary); cursor: pointer; }
.dc-metric-legend { display: flex; flex-wrap: wrap; gap: .6rem; margin: 0 auto 1rem; width:100%; max-width: var(--dc-max); padding:0 1rem; box-sizing:border-box; }
.dc-legend-item { display: inline-flex; align-items: center; gap: .5rem; padding: .5rem .75rem; background: var(--dc-surface); border: 1px solid var(--dc-border); border-radius: var(--dc-radius); cursor: pointer; font-size: .75rem; font-weight: 600; color: var(--dc-text-dim); position: relative; transition: box-shadow .25s, border-color .25s, background .25s; }
.dc-legend-item.visible { color: var(--dc-text); border-color: var(--dc-primary); box-shadow: 0 0 0 1px var(--dc-primary), 0 2px 6px -1px rgba(0,0,0,0.15); }
.dc-legend-item.dimmed { opacity: .55; }
.dc-legend-item:focus-visible { outline: var(--dc-focus); outline-offset: 2px; }
.dc-legend-item:hover { background: #fff; }
.dc-legend-dot { width: 14px; height: 14px; border-radius: 4px; background: var(--metric-color); box-shadow: 0 0 0 1px rgba(0,0,0,0.2) inset; }
.dc-threshold-panel { display: flex; flex-wrap: wrap; gap: .9rem; background: var(--dc-surface); padding: .75rem .9rem; border-radius: var(--dc-radius-lg); box-shadow: 0 3px 8px -3px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.05); margin: 0 auto 1.25rem; width:100%; max-width: var(--dc-max); box-sizing:border-box; }
.dc-threshold-item { display: flex; flex-direction: column; gap: .25rem; width: auto; flex:1 1 110px; min-width:95px; }
.dc-threshold-label { font-size: .65rem; font-weight: 600; letter-spacing: .5px; text-transform: uppercase; color: var(--dc-text-dim); }
.dc-charts-wrapper { display: flex; flex-direction: column; gap: 1.25rem; margin: 0 auto 1.5rem; width:100%; max-width: var(--dc-max); padding: 0 1rem; box-sizing: border-box; }
.dc-chart-card { background: var(--dc-surface); border-radius: var(--dc-radius-lg); padding: .85rem 1rem .6rem; box-shadow: 0 2px 6px -1px rgba(0,0,0,0.12), 0 4px 16px -2px rgba(0,0,0,0.06); position: relative; overflow-x: auto; border: 1px solid #f1f5f9; }
.dc-chart-card-header { display: flex; align-items: flex-start; justify-content: space-between; flex-wrap: wrap; gap: .75rem; padding-bottom: .5rem; border-bottom: 1px solid var(--dc-border); margin-bottom: .5rem; }
.dc-chart-title { font-size: .95rem; margin: 0; font-weight: 700; color: #0f172a; }
.dc-chart-subcontrols { display: flex; align-items: center; gap: .5rem; }
.dc-sub-label { font-size: .65rem; font-weight: 600; text-transform: uppercase; color: var(--dc-text-dim); letter-spacing: .5px; }
.dc-chart-body { width: 100%; min-height: 220px; }
.dc-chart-body-responsive{ width:100%; overflow-x:auto; -webkit-overflow-scrolling:touch; }
.dc-chart-body-responsive svg{ width:100%; min-width:0; height:auto; }
.dc-line-chart, .dc-bar-chart { font-family: inherit; }
.dc-axis-text { font-size: .6rem; fill: var(--dc-text-dim); font-weight: 500; letter-spacing: .3px; }
.dc-threshold-label { font-size: .55rem; font-weight: 600; background: #fff; padding: 2px 4px; border-radius: 4px; filter: drop-shadow(0 1px 2px rgba(0,0,0,0.25)); }
.dc-chart-empty { font-size: .75rem; color: var(--dc-text-dim); padding: 1rem 0; }
.dc-summary-grid { display: grid; grid-template-columns: repeat(auto-fit,minmax(180px,1fr)); gap: 1rem; margin: 0 auto 1.25rem; width:100%; max-width: var(--dc-max); padding: 0 1rem; box-sizing:border-box; }
.dc-summary-card { background: linear-gradient(175deg,#ffffff 0%,#f8fafc 85%); border: 1px solid var(--dc-border); border-radius: var(--dc-radius-lg); padding: .85rem .9rem; display: flex; flex-direction: column; gap: .65rem; position: relative; box-shadow: 0 2px 5px -2px rgba(0,0,0,0.15), 0 0 0 1px rgba(0,0,0,0.05); min-height: 160px; }
.dc-summary-header { display: flex; align-items: center; gap: .5rem; }
.dc-summary-color { width: 16px; height: 16px; border-radius: 5px; box-shadow: 0 0 0 1px rgba(0,0,0,0.3) inset; }
.dc-summary-title { font-size: .78rem; margin: 0; font-weight: 600; color: var(--dc-text-dim); letter-spacing:.2px; }
.dc-summary-stats { display: flex; flex-direction: column; gap: .4rem; font-size: .7rem; }
.dc-stat-line { display: flex; align-items: center; justify-content: space-between; background: #fff; padding: .4rem .55rem; border-radius: var(--dc-radius-sm); border: 1px solid var(--dc-border); font-weight: 600; letter-spacing: .3px; }
.dc-summary-foot { display: flex; flex-wrap: wrap; gap: .4rem; margin-top: auto; }
.dc-foot-tag { background: var(--dc-surface-alt); border: 1px solid var(--dc-border); font-size: .55rem; font-weight: 600; padding: .28rem .45rem; border-radius: 999px; letter-spacing: .15px; color: var(--dc-text-dim); }
.dc-peak-panel { background: var(--dc-surface); border-radius: var(--dc-radius-lg); padding: .9rem 1rem 1.15rem; box-shadow: 0 2px 6px -1px rgba(0,0,0,0.12), 0 4px 14px -4px rgba(0,0,0,0.06); margin: 0 auto 1.25rem; width:100%; max-width: var(--dc-max); border: 1px solid #f1f5f9; box-sizing:border-box; }
.dc-peak-title { font-size: .85rem; font-weight: 600; letter-spacing: .25px; color: var(--dc-text-dim); margin: 0 0 .6rem; }
.dc-peak-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: .55rem; font-size: .7rem; }
.dc-peak-item { display: flex; justify-content: space-between; background: var(--dc-surface-alt); border: 1px solid var(--dc-border); padding: .5rem .6rem; border-radius: var(--dc-radius-sm); font-weight: 600; letter-spacing: .4px; }
.dc-empty { color: var(--dc-text-dim); font-style: italic; }
.dc-peak-time { color: var(--dc-text-dim); }
.dc-peak-value { color: var(--dc-text); font-weight: 700; }
.dc-export-panel { display: flex; flex-wrap: wrap; gap: .75rem 1rem; align-items: center; background: var(--dc-surface); padding: .8rem 1rem .75rem; border-radius: var(--dc-radius-lg); box-shadow: 0 2px 6px -1px rgba(0,0,0,0.12), 0 4px 14px -4px rgba(0,0,0,0.06); margin: 0 auto .5rem; width:100%; max-width: var(--dc-max); border: 1px solid #f1f5f9; box-sizing:border-box; }
.dc-export-btn { background: var(--dc-primary); color: #fff; border: none; padding: .58rem .95rem; border-radius: var(--dc-radius); font-size: .7rem; letter-spacing: .2px; font-weight: 600; cursor: pointer; box-shadow: 0 2px 4px rgba(0,0,0,0.25); transition: background .25s, transform .2s; }
.dc-export-btn:hover:not(:disabled) { background: #c2410c; transform: translateY(-1px); }
.dc-export-btn:disabled { opacity: .5; cursor: not-allowed; }
.dc-alert-legend { display: flex; flex-wrap: wrap; gap: .6rem; margin-left: auto; font-size: .65rem; }
.dc-alert-legend-item { display: inline-flex; align-items: center; gap: .35rem; font-weight: 600; color: var(--dc-text-dim); background: var(--dc-surface-alt); padding: .35rem .55rem; border-radius: 999px; border: 1px solid var(--dc-border); letter-spacing: .4px; }
.dc-alert-dot { width: 10px; height: 10px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(0,0,0,0.25) inset; }
.dc-loader { display: flex; flex-direction: column; align-items: center; gap: .75rem; padding: 2.5rem 0; }
.dc-spinner { width: 34px; height: 34px; border-radius: 50%; border: 4px solid var(--dc-border); border-top-color: var(--dc-primary); animation: dc-spin 1s linear infinite; }
.dc-loader-text { font-size: .7rem; font-weight: 600; letter-spacing: .4px; color: var(--dc-text-dim); text-transform: uppercase; }
@keyframes dc-spin { to { transform: rotate(360deg); } }
.dc-footer { text-align: center; font-size: .65rem; color: #cbd5e1; letter-spacing: .5px; padding: 1rem 1.25rem 1.05rem; max-width: 100%; margin: 0; font-weight:500; background:#0f172a; border-top:1px solid #1e293b; display:flex; flex-direction:column; gap:.5rem; margin-top:auto; }
.dc-footer-help { font-size:.8rem; color:#f1f5f9; }
.dc-footer-link { color:#ea580c; font-weight:600; text-decoration:none; }
.dc-footer-link:hover { text-decoration:underline; }
.dc-footer-copy { font-size:.7rem; color:#cbd5e1; }
@media (max-width: 860px){
  .dc-chart-body{padding-top:.5rem;}
  .dc-header-content{display:flex; flex-direction:row; align-items:center; gap:.55rem; padding:.5rem .6rem;}
  .dc-logo{height:28px;}
  .dc-page-title{position:static; transform:none; font-size:1rem; line-height:1.15; text-align:left; margin:0 .5rem 0 0; font-weight:700; color:var(--dc-primary);}
  .dc-back-btn{align-self:flex-end; order:2;}
}
@media (min-width: 1080px) { .dc-charts-wrapper { flex-direction: column; } }
@media (max-width: 840px) { .dc-filters { grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); } .dc-summary-grid { grid-template-columns: repeat(auto-fit,minmax(150px,1fr)); } .dc-chart-card { padding: .65rem .65rem .85rem; } .dc-back-btn{font-size:.7rem; padding:.55rem .8rem;} }
/* Ultra-small / phone optimizations */
@media (max-width: 560px){
  /* Compact mobile header layout */
  .dc-header-content{display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:.55rem; padding:.5rem .6rem;}
  .dc-logo{height:28px;}
  .dc-page-title{grid-column:2; justify-self:center; position:static; transform:none; font-size:1rem; line-height:1.15; text-align:center; margin:0; font-weight:700; color:var(--dc-primary);}
  .dc-back-btn{background:transparent; color:var(--dc-primary); box-shadow:none; font-size:.7rem; padding:.35rem .5rem; margin:0; border:none; letter-spacing:.3px; font-weight:600;}
  .dc-back-btn:hover{background:transparent; text-decoration:underline; transform:none; box-shadow:none;}
  .dc-back-btn:active{transform:none;}
  .dc-filters{padding:.7rem .75rem; gap:.7rem;}
  .dc-threshold-panel{padding:.6rem .65rem; gap:.65rem;}
  .dc-threshold-item{flex:1 1 45%; min-width:120px;}
  .dc-threshold-input{padding:.45rem .5rem; font-size:.7rem;}
  .dc-metric-legend{gap:.45rem; padding:0 .6rem;}
  .dc-legend-item{padding:.45rem .6rem; font-size:.65rem;}
  .dc-export-panel{padding:.65rem .7rem .6rem; gap:.6rem .7rem;}
  .dc-summary-grid{padding:0 .6rem; gap:.65rem; grid-template-columns: repeat(auto-fit,minmax(150px,1fr));}
  .dc-charts-wrapper{padding:0 .6rem; gap:.85rem;}
  .dc-chart-card{padding:.55rem .55rem .4rem;}
  .dc-chart-title{font-size:.83rem;}
  .dc-axis-text{font-size:.5rem;}
  .dc-peak-panel{padding:.7rem .7rem .85rem; margin-bottom:1rem;}
  .dc-peak-title{font-size:.75rem;}
  .dc-foot-tag{font-size:.5rem;}
  .dc-export-btn{font-size:.6rem; padding:.5rem .7rem;}
  .dc-footer{padding:.85rem .75rem 1rem; font-size:.6rem;}
  .dc-footer-help{font-size:.7rem;}
  .dc-footer-copy{font-size:.6rem;}
  .dc-filters{grid-template-columns:repeat(2,minmax(0,1fr));}
  .dc-threshold-item{width:48%;}
}
@media (max-width: 420px){
  .dc-filters{grid-template-columns:1fr;}
  .dc-threshold-item{width:100%;}
  .dc-page-title{font-size:1rem;}
}
@media (prefers-reduced-motion: reduce) { .dc-back-btn, .dc-export-btn, .dc-chip { transition: none; } .dc-spinner { animation: none; } }
/* --- Added responsive helpers for bill layout --- */
@media (max-width: 760px) {
  .print-area { padding: 18px 18px !important; font-size: 9pt !important; }
  .print-area h2 { font-size: 12pt !important; }
  .bill-grid-2col { display: block !important; }
  .bill-grid-2col > div { margin-bottom: 12px; }
  .consumer-details { font-size: 9pt; }
  .reading-usage table { font-size: 8pt !important; }
  .bill-details-table td, .bill-details-table th { font-size: 8pt !important; padding: 3px 4px !important; }
  .bill-details-table { min-width: 100%; }
  .history-table { font-size: 8pt !important; }
  .action-buttons { flex-direction: column; align-items: stretch; }
  .action-buttons button { width: 100%; }
  .table-responsive { -webkit-overflow-scrolling: touch; }
}
@media (max-width: 420px) {
  .print-area { padding: 14px 14px !important; font-size: 8.5pt !important; }
  .print-area h2 { font-size: 11pt !important; }
  .action-buttons button { padding: 10px 18px !important; font-size: .9rem !important; }
  .bill-details-table td:nth-child(1) { max-width: 140px; }
}
@media (hover: none) and (pointer: coarse) {
  .action-buttons button { min-height: 46px; }
}
/* --- Final mobile header adjustments (ensure small back button & visible title) --- */
@media (max-width: 600px) {
  .dc-header-content { display: grid !important; grid-template-columns: auto 1fr auto; align-items: center; }
  .dc-logo-section { order: 1; }
  .dc-page-title { order: 2; position: static !important; transform: none !important; font-size: 1rem !important; line-height: 1.2 !important; white-space: normal !important; overflow: visible !important; text-overflow: unset !important; max-width: 100% !important; padding: 0 !important; }
  .dc-back-btn { order: 3; width: auto !important; min-width: 0 !important; padding: .3rem .55rem !important; font-size: .65rem !important; line-height: 1 !important; border-radius: .45rem !important; background: var(--dc-primary) !important; box-shadow: 0 2px 6px -1px rgba(234,88,12,0.4) !important; }
  .dc-back-btn:hover { background: #c2410c !important; }
}
`;
