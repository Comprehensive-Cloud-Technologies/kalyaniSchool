import { useEffect, useState } from 'react';
import logo from '../assets/logo.webp';
import './ParentDashboard.css';

const RAZORPAY_KEY = import.meta.env.VITE_RAZORPAY_KEY_ID || 'rzp_test_SV4dT3pK23zxSP';
const CONVENIENCE_RATE = 0.02; // 2%

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function loadRazorpayScript() {
  return new Promise((resolve) => {
    if (window.Razorpay) { resolve(true); return; }
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve(true);
    s.onerror = () => resolve(false);
    document.body.appendChild(s);
  });
}

const API_BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const { hostname, pathname } = window.location;
  if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:8000/api';
  if (pathname.includes('/qsr/') && pathname.includes('/Tap-N-Eat/frontend')) return '/qsr/Tap-N-Eat/backend/api';
  if (pathname.includes('/Tap-N-Eat/frontend')) return '/Tap-N-Eat/backend/api';
  return '/api';
})();

const api = async (path, opts = {}) => {
  const response = await fetch(`${API_BASE_URL}/${path}`, opts);
  const text = await response.text();
  let data;
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { error: 'Invalid server response' };
  }
  return { ok: response.ok, data };
};

export default function ParentDashboard() {
  const parentEmail = (() => {
    try { return localStorage.getItem('parentEmail') || ''; } catch { return ''; }
  })();
  const parentName = (() => {
    try { return localStorage.getItem('parentName') || 'Parent'; } catch { return ''; }
  })();
  const [schoolLogoUrlRaw, setSchoolLogoUrlRaw] = useState(() => {
    try { return localStorage.getItem('parentSchoolLogoUrl') || ''; } catch { return ''; }
  });
  const [schoolNameFromSession, setSchoolNameFromSession] = useState(() => {
    try { return localStorage.getItem('parentSchoolName') || ''; } catch { return ''; }
  });
  const schoolLogoUrl = (() => {
    if (!schoolLogoUrlRaw) return '';
    if (/^https?:\/\//i.test(schoolLogoUrlRaw)) return schoolLogoUrlRaw;
    const base = API_BASE_URL.replace(/\/api$/, '').replace(/\/backend\/api$/, '/backend');
    return `${base}${schoolLogoUrlRaw.startsWith('/') ? '' : '/'}${schoolLogoUrlRaw}`;
  })();

  /* ── Navigation ── */
  const [activeTab, setActiveTab] = useState('wallet'); // 'wallet' | 'payments' | 'subscriptions' | 'payment-history'

  /* ── Payment History ── */
  const [paymentHistory, setPaymentHistory] = useState([]);
  const [phChildId, setPhChildId] = useState(null);
  const [phLoading, setPhLoading] = useState(false);

  /* ── Wallet / Profile ── */
  const [profile, setProfile] = useState(null);
  const [children, setChildren] = useState([]);
  const [selectedChildId, setSelectedChildId] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [showAllTx, setShowAllTx] = useState(false);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [loading, setLoading] = useState(true);
  const [alert, setAlert] = useState({ type: '', message: '' });

  /* ── Payments ── */
  const [paymentDate] = useState(() => {
    const d = new Date();
    return `${String(d.getDate()).padStart(2, '0')}-${d.toLocaleString('en-GB', { month: 'short' })}-${d.getFullYear()}`;
  });
  const [paySelectedChildId, setPaySelectedChildId] = useState('');
  const [mealTypes, setMealTypes] = useState([]);
  const [selectedMealTypeId, setSelectedMealTypeId] = useState('');
  const [paymentFor, setPaymentFor] = useState('Canteen');
  const [selectedMonths, setSelectedMonths] = useState([]);
  const [monthlyPrices, setMonthlyPrices] = useState({});
  const [payYear, setPayYear] = useState(() => new Date().getFullYear());
  const [prevMealService, setPrevMealService] = useState('');
  const [paymentLoading, setPaymentLoading] = useState(false);
  const [rzpKey, setRzpKey] = useState(RAZORPAY_KEY);
  const [tuckshopAmount, setTuckshopAmount] = useState('');

  /* ── Subscriptions ── */
  const [subscriptions, setSubscriptions] = useState([]);
  const [subChildId, setSubChildId] = useState(null);
  const [canteenLog, setCanteenLog] = useState([]);
  const [subLoading, setSubLoading] = useState(false);
  const [availablePlans, setAvailablePlans] = useState([]);

  const paySelectedChild = children.find((c) => String(c.id) === String(paySelectedChildId)) || null;
  const selectedChild = children.find((child) => child.id === selectedChildId) || children[0] || null;

  const showAlert = (message, type = 'success') => {
    setAlert({ message, type });
    window.setTimeout(() => setAlert({ message: '', type: '' }), 5000);
  };

  const loadProfile = async () => {
    if (!parentEmail) return;
    setLoading(true);
    const { ok, data } = await api(`parent-portal?action=profile&email=${encodeURIComponent(parentEmail)}`);
    if (!ok) { showAlert(data.error || 'Failed to load parent profile', 'error'); setLoading(false); return; }
    setProfile(data.parent);
    const kids = data.children || [];
    setChildren(kids);
    setSelectedChildId((c) => c || kids[0]?.id || null);
    setPaySelectedChildId((c) => c || (kids[0] ? String(kids[0].id) : ''));
    if (data.school) {
      const nextLogo = data.school.logo_url || '';
      const nextName = data.school.name || '';
      setSchoolLogoUrlRaw(nextLogo);
      setSchoolNameFromSession(nextName);
      try {
        localStorage.setItem('parentSchoolLogoUrl', nextLogo);
        localStorage.setItem('parentSchoolName', nextName);
      } catch { }
    }
    setLoading(false);
  };

  const loadSubscriptions = async (childId) => {
    if (!parentEmail || !childId) return;
    setSubLoading(true);
    const child = children.find((c) => c.id === childId) || children.find((c) => String(c.id) === String(childId));
    // Load subscribed plans
    const { ok, data } = await api(`parent-portal?action=subscriptions&email=${encodeURIComponent(parentEmail)}&student_id=${childId}`);
    if (ok) setSubscriptions(data.subscriptions || []);
    // Load canteen log
    const { ok: lok, data: ldata } = await api(`parent-portal?action=canteen-log&email=${encodeURIComponent(parentEmail)}&student_id=${childId}&limit=30`);
    if (lok) setCanteenLog(ldata.canteen_log || []);
    // Load all active plans for current year + next year in a single API call
    const now = new Date();
    const curYear = now.getFullYear();
    const schoolParam = child?.school_id ? `&school_id=${child.school_id}` : '';
    const gradeParam = child?.grade ? `&grade=${encodeURIComponent(child.grade)}` : '';
    const { ok: pOk, data: pData } = await api(
      `monthly-meal-plans?year=${curYear}&year_end=${curYear + 1}${schoolParam}${gradeParam}`
    );
    const seen = new Set();
    setAvailablePlans(
      (pOk && Array.isArray(pData?.plans) ? pData.plans : [])
        .filter((p) => { if (seen.has(p.id)) return false; seen.add(p.id); return true; })
    );
    setSubLoading(false);
  };

  const loadTransactions = async (childId) => {
    if (!parentEmail || !childId) return;
    const { ok, data } = await api(`parent-portal?action=transactions&email=${encodeURIComponent(parentEmail)}&student_id=${childId}&limit=20`);
    if (!ok) { showAlert(data.error || 'Failed to load transactions', 'error'); return; }
    setTransactions(data.transactions || []);
  };

  const loadPrevMealService = async (childId) => {
    if (!childId || !parentEmail) return;
    const { ok, data } = await api(`parent-portal?action=transactions&email=${encodeURIComponent(parentEmail)}&student_id=${childId}&limit=5`);
    if (ok && data.transactions?.length > 0) {
      const deductTx = data.transactions.find((t) => t.transaction_type === 'deduction');
      setPrevMealService(deductTx?.meal_category || '—');
    } else {
      setPrevMealService('—');
    }
  };

  const loadPaymentHistory = async (childId) => {
    if (!parentEmail || !childId) return;
    setPhLoading(true);
    const { ok, data } = await api(`parent-portal?action=payment-history&email=${encodeURIComponent(parentEmail)}&student_id=${childId}`);
    if (ok) setPaymentHistory(data.payments || []);
    else showAlert(data.error || 'Failed to load payment history', 'error');
    setPhLoading(false);
  };

  const loadMealTypes = async () => {
    const { ok, data } = await api('meal-slots?resource=types');
    if (ok) setMealTypes(Array.isArray(data.types) ? data.types.filter((t) => t.is_active) : []);
  };

  const loadMonthlyPrices = async (mealTypeId, schoolId, forYear) => {
    if (!mealTypeId) { setMonthlyPrices({}); return; }
    const yr = forYear || payYear;
    const schoolParam = schoolId ? `&school_id=${schoolId}` : '';
    const { ok, data } = await api(`monthly-meal-plans?meal_type_id=${mealTypeId}&year=${yr}${schoolParam}`);
    if (ok && Array.isArray(data.plans)) {
      const map = {};
      data.plans.forEach((p) => { map[parseInt(p.month, 10)] = parseFloat(p.price || 0); });
      setMonthlyPrices(map);
    } else {
      setMonthlyPrices({});
    }
    setSelectedMonths([]);
  };

  useEffect(() => {
    if (!parentEmail) { window.location.hash = '#/parent-login'; return; }
    loadProfile();
    loadMealTypes();
    api('razorpay-config').then(({ ok, data }) => { if (ok && data.key_id) setRzpKey(data.key_id); });
  }, [parentEmail]);

  useEffect(() => {
    if (selectedChildId) { setShowAllTx(false); loadTransactions(selectedChildId); }
    else setTransactions([]);
  }, [selectedChildId]);

  useEffect(() => {
    if (activeTab === 'subscriptions') {
      const childId = subChildId || selectedChildId || children[0]?.id || null;
      if (childId) { setSubChildId(childId); loadSubscriptions(childId); }
    }
    if (activeTab === 'payment-history') {
      const childId = phChildId || selectedChildId || children[0]?.id || null;
      if (childId) { setPhChildId(childId); loadPaymentHistory(childId); }
    }
  }, [activeTab]);

  useEffect(() => {
    if (paySelectedChildId) loadPrevMealService(paySelectedChildId);
  }, [paySelectedChildId]);

  useEffect(() => {
    const schoolId = paySelectedChild?.school_id || '';
    loadMonthlyPrices(selectedMealTypeId, schoolId);
  }, [selectedMealTypeId, paySelectedChildId]);

  /* ── Pricing ── */
  const isTuckShopMode = paymentFor === 'TuckShop';
  const subTotal = isTuckShopMode
    ? (parseFloat(tuckshopAmount) || 0)
    : selectedMonths.reduce((sum, m) => sum + (monthlyPrices[m] || 0), 0);
  const convenienceFee = parseFloat((subTotal * CONVENIENCE_RATE).toFixed(2));
  const totalPrice = parseFloat((subTotal + convenienceFee).toFixed(2));

  const toggleMonth = (m) => {
    setSelectedMonths((prev) => prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]);
  };

  /* ── Legacy quick recharge ── */
  const handleRecharge = async (e) => {
    e.preventDefault();
    if (!selectedChild) { showAlert('Select a child first', 'error'); return; }
    if (!rechargeAmount || Number(rechargeAmount) <= 0) { showAlert('Enter a valid recharge amount', 'error'); return; }
    const { ok, data } = await api('parent-portal?action=recharge', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: parentEmail, student_id: selectedChild.id, amount: Number(rechargeAmount) }),
    });
    if (!ok) { showAlert(data.error || 'Recharge failed', 'error'); return; }
    setProfile(data.data.parent);
    setChildren(data.data.children || []);
    setRechargeAmount('');
    showAlert(data.message || 'Wallet recharged successfully');
    loadTransactions(selectedChild.id);
  };

  /* ── Razorpay Payment ── */
  const handlePayWithRazorpay = async () => {
    if (!paySelectedChild) { showAlert('Please select a student', 'error'); return; }
    if (!isTuckShopMode && !selectedMealTypeId) { showAlert('Please select a meal plan', 'error'); return; }
    if (!isTuckShopMode && selectedMonths.length === 0) { showAlert('Please select at least one payment month', 'error'); return; }
    if (isTuckShopMode && (parseFloat(tuckshopAmount) || 0) <= 0) { showAlert('Please enter a valid top-up amount', 'error'); return; }
    if (totalPrice <= 0) { showAlert('Amount must be greater than zero', 'error'); return; }

    setPaymentLoading(true);
    const loaded = await loadRazorpayScript();
    if (!loaded) {
      showAlert('Failed to load payment gateway. Please check your internet connection.', 'error');
      setPaymentLoading(false);
      return;
    }

    const amountPaise = Math.round(totalPrice * 100);
    const selectedMealType = mealTypes.find((m) => String(m.id) === String(selectedMealTypeId));
    const mealTypeName = selectedMealType?.meal_name || '';

    const { ok, data: orderData } = await api('razorpay-create-order', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: `${isTuckShopMode ? 'TUCK' : 'MEAL'}-${paySelectedChild.student_id}-${Date.now()}`,
        notes: {
          student_id: String(paySelectedChild.id),
          student_name: paySelectedChild.student_name,
          meal_plan: isTuckShopMode ? 'TuckShop' : mealTypeName,
          payment_for: paymentFor,
          months: isTuckShopMode ? '' : selectedMonths.map((m) => MONTH_NAMES[m - 1]).join(', '),
          year: String(payYear),
        },
      }),
    });

    if (!ok) {
      showAlert(orderData.message || 'Failed to create payment order', 'error');
      setPaymentLoading(false);
      return;
    }

    const options = {
      key: rzpKey,
      amount: amountPaise,
      currency: 'INR',
      name: 'Tap-N-Eat',
      description: isTuckShopMode
        ? `TuckShop Wallet Top-Up ₹${subTotal.toFixed(2)}`
        : `${mealTypeName} — ${selectedMonths.map((m) => MONTH_NAMES[m - 1]).join(', ')} (${paymentFor})`,
      order_id: orderData.id,
      prefill: { name: parentName, email: parentEmail },
      theme: { color: '#00b894' },
      handler: async (response) => {
        const { ok: vOk, data: vData } = await api('wallet-recharge-verify', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            razorpay_payment_id: response.razorpay_payment_id,
            razorpay_order_id: response.razorpay_order_id,
            razorpay_signature: response.razorpay_signature,
            student_id: paySelectedChild.id,
            email: parentEmail,
            amount_paid: totalPrice,
            sub_total: subTotal,
            meal_type_id: parseInt(selectedMealTypeId, 10),
            meal_type_name: mealTypeName,
            months: selectedMonths,
            year: payYear,
            payment_for: paymentFor,
          }),
        });
        if (vOk && vData.verified) {
          showAlert(`Payment successful! ₹${subTotal.toFixed(2)} credited to ${paySelectedChild.student_name}'s wallet.`, 'success');
          setSelectedMonths([]);
          setSelectedMealTypeId('');
          setTuckshopAmount('');
          await loadProfile();
          if (selectedChildId) loadTransactions(selectedChildId);
        } else {
          showAlert(vData.message || 'Payment verification failed. Contact support.', 'error');
        }
        setPaymentLoading(false);
      },
      modal: { ondismiss: () => setPaymentLoading(false) },
    };

    try {
      const rzp = new window.Razorpay(options);
      rzp.on('payment.failed', (resp) => {
        showAlert(`Payment failed: ${resp.error?.description || 'Unknown error'}`, 'error');
        setPaymentLoading(false);
      });
      rzp.open();
    } catch {
      showAlert('Failed to open payment window', 'error');
      setPaymentLoading(false);
    }
  };

  return (
    <div className="parent-dashboard">
      <aside className="parent-sidebar">
        <div className="parent-brand">
          <img src={schoolLogoUrl || logo} alt={schoolNameFromSession || 'Tap-N-Eat Logo'} />
          <span>{schoolNameFromSession || 'Parent Portal'}</span>
        </div>
        <div className="parent-profile-card">
          <div className="parent-avatar">{(parentName || 'P').slice(0, 1).toUpperCase()}</div>
          <div>
            <h2>{parentName}</h2>
            <p>{parentEmail}</p>
          </div>
        </div>

        <nav className="parent-nav">
          <button
            className={`parent-nav-item ${activeTab === 'wallet' ? 'active' : ''}`}
            onClick={() => setActiveTab('wallet')}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
              <path d="M3 9h18M16.5 15h1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Wallet &amp; History
          </button>
          <button
            className={`parent-nav-item ${activeTab === 'payments' ? 'active' : ''}`}
            onClick={() => setActiveTab('payments')}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M7 3v2M17 3v2M4 7h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M8 11h3M13 11h3M8 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
            Payments
          </button>
          <button
            className={`parent-nav-item ${activeTab === 'subscriptions' ? 'active' : ''}`}
            onClick={() => setActiveTab('subscriptions')}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2" />
              <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
            Meal Plans
          </button>
          <button
            className={`parent-nav-item ${activeTab === 'payment-history' ? 'active' : ''}`}
            onClick={() => setActiveTab('payment-history')}
          >
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 8v4l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2" />
            </svg>
            Payment History
          </button>
        </nav>

        <button
          className="parent-logout"
          onClick={() => {
            try { localStorage.removeItem('parentEmail'); localStorage.removeItem('parentName'); } catch { }
            window.location.hash = '#/parent-login';
          }}
        >
          Logout
        </button>
      </aside>

      <main className="parent-main">
        {alert.message && <div className={`parent-alert ${alert.type}`}>{alert.message}</div>}

        {/* ══ WALLET TAB ══ */}
        {activeTab === 'wallet' && (
          <>
            <div className="parent-hero">
              <div>
                <div className="parent-chip">Wallet</div>
                <h1>Track and recharge your child wallet</h1>
                <p>See current balances, linked school details, and recent meal transactions.</p>
              </div>
              {profile && (
                <div className="parent-summary-card">
                  <span>Linked children</span>
                  <strong>{children.length}</strong>
                </div>
              )}
            </div>

            {loading ? (
              <div className="parent-empty">Loading parent profile…</div>
            ) : children.length === 0 ? (
              <div className="parent-empty">No children are linked to this parent email yet.</div>
            ) : (
              <div className="parent-grid">
                <section className="parent-card parent-children-card">
                  <div className="parent-section-head">
                    <h2>Your Children</h2>
                    <p>Select a child to see wallet details and history</p>
                  </div>
                  <div className="parent-children-list">
                    {children.map((child) => (
                      <button
                        key={child.id}
                        className={`parent-child-item ${selectedChild?.id === child.id ? 'active' : ''}`}
                        onClick={() => setSelectedChildId(child.id)}
                      >
                        <div>
                          <strong>{child.student_name}</strong>
                          <span>{child.grade || 'Grade N/A'} • {child.division || 'Division N/A'}</span>
                        </div>
                        <div className="parent-wallet-pill">₹{Number(child.wallet_amount || 0).toFixed(2)}</div>
                      </button>
                    ))}
                  </div>
                </section>

                <section className="parent-card parent-details-card">
                  {selectedChild && (
                    <>
                      <div className="parent-section-head">
                        <h2>{selectedChild.student_name}</h2>
                        <p>{selectedChild.school_name || 'School not assigned'} • {selectedChild.student_id}</p>
                      </div>
                      <div className="parent-stats">
                        <div className="parent-stat-box">
                          <span>Current Wallet</span>
                          <strong>₹{Number(selectedChild.wallet_amount || 0).toFixed(2)}</strong>
                        </div>
                        <div className="parent-stat-box">
                          <span>RFID Number</span>
                          <strong>{selectedChild.rfid_number}</strong>
                        </div>
                      </div>
                    </>
                  )}
                </section>

                <section className="parent-card parent-transactions-card">
                  <div className="parent-section-head">
                    <h2>Recent Transactions</h2>
                    <p>Latest wallet recharges and meal deductions</p>
                  </div>
                  {transactions.length === 0 ? (
                    <div className="parent-empty small">No transactions found for this child.</div>
                  ) : (
                    <div className="parent-table-wrap">
                      <table className="parent-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Type</th>
                            <th>Category</th>
                            <th>Amount</th>
                            <th>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {(showAllTx ? transactions : transactions.slice(0, 5)).map((item) => (
                            <tr key={item.id}>
                              <td>{item.transaction_date} {item.transaction_time}</td>
                              <td>
                                <span className={`parent-type ${item.transaction_type === 'recharge' || item.transaction_type === 'meal_subscription' ? 'recharge' : item.transaction_type === 'canteen' ? 'recharge' : 'deduction'}`}>
                                  {item.transaction_type === 'recharge'
                                    ? ((item.meal_category || '').toLowerCase().includes('tuckshop') ? 'TuckShop Top-Up' : 'Wallet Credit')
                                    : item.transaction_type === 'meal_subscription'
                                      ? 'Meal Plan'
                                      : item.transaction_type === 'tuckshop'
                                        ? 'Tuckshop'
                                        : item.transaction_type === 'canteen'
                                          ? '🍽 Canteen'
                                          : item.transaction_type === 'canteen_denied'
                                            ? '⛔ Denied'
                                            : 'Meal Slot'}
                                </span>
                              </td>
                              <td>{item.meal_category || 'Wallet'}</td>
                              <td>₹{Number(item.amount || 0).toFixed(2)}</td>
                              <td>₹{Number(item.new_balance || 0).toFixed(2)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {transactions.length > 5 && (
                        <button
                          className="parent-load-more-btn"
                          onClick={() => setShowAllTx((v) => !v)}
                        >
                          {showAllTx ? '▲ Show Less' : `▼ Show All ${transactions.length} Transactions`}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}

        {/* ══ PAYMENTS TAB ══ */}
        {activeTab === 'payments' && (
          <>
            <div className="parent-hero">
              <div>
                <div className="parent-chip">Meal Plan Payment</div>
                <h1>Pay for Monthly Meal Plan</h1>
                <p>Select meal type, choose months, and pay securely via Razorpay. A 2% convenience fee applies.</p>
              </div>
            </div>

            {loading ? (
              <div className="parent-empty">Loading…</div>
            ) : children.length === 0 ? (
              <div className="parent-empty">No children linked to this account.</div>
            ) : (
              <div className="pay-form-wrap">
                <div className="pay-card">
                  <h2 className="pay-card-title">Payment Details</h2>
                  <hr className="section-divider" />

                  <div className="pay-form-grid">
                    {/* Admission No */}
                    <div className="pay-field">
                      <label>Admission No <span className="req">*</span></label>
                      <select
                        value={paySelectedChildId}
                        onChange={(e) => setPaySelectedChildId(e.target.value)}
                      >
                        <option value="">— Select Student —</option>
                        {children.map((c) => (
                          <option key={c.id} value={String(c.id)}>{c.student_id} — {c.student_name}</option>
                        ))}
                      </select>
                    </div>

                    {/* Date */}
                    <div className="pay-field">
                      <label>Date <span className="req">*</span></label>
                      <input type="text" readOnly value={paymentDate} className="pay-readonly" />
                    </div>

                    {/* Name */}
                    <div className="pay-field">
                      <label>Name</label>
                      <input type="text" readOnly value={paySelectedChild?.student_name || ''} className="pay-readonly" />
                    </div>

                    {/* Parent Name */}
                    <div className="pay-field">
                      <label>Parent Name</label>
                      <input type="text" readOnly value={parentName} className="pay-readonly" />
                    </div>

                    {/* Previous Meal Service */}
                    <div className="pay-field">
                      <label>Previous Meal Service</label>
                      <input type="text" readOnly value={prevMealService} className="pay-readonly" />
                    </div>

                    {/* Current Meal Plan - hidden in TuckShop mode */}
                    {!isTuckShopMode && (
                      <div className="pay-field">
                        <label>Current Meal Plan <span className="req">*</span></label>
                        <select
                          value={selectedMealTypeId}
                          onChange={(e) => setSelectedMealTypeId(e.target.value)}
                        >
                          <option value="">— Select —</option>
                          {mealTypes.map((m) => (
                            <option key={m.id} value={String(m.id)}>{m.meal_name}</option>
                          ))}
                        </select>
                      </div>
                    )}

                    {/* Grade */}
                    <div className="pay-field">
                      <label>Grade</label>
                      <input type="text" readOnly value={paySelectedChild?.grade || paySelectedChild?.division || ''} className="pay-readonly" />
                    </div>

                    {/* Payment For */}
                    <div className="pay-field pay-field-full">
                      <label>Payment For <span className="req">*</span></label>
                      <div className="pay-radio-group">
                        {['Canteen', 'TuckShop'].map((opt) => (
                          <label key={opt} className="pay-radio-label">
                            <input
                              type="radio"
                              name="paymentFor"
                              value={opt}
                              checked={paymentFor === opt}
                              onChange={() => setPaymentFor(opt)}
                            />
                            {opt}
                          </label>
                        ))}
                      </div>
                    </div>

                    {/* Payment Month (Meal Plan) / Top-Up Amount (TuckShop) */}
                    {isTuckShopMode ? (
                      <div className="pay-field pay-field-full">
                        <label>Top-Up Amount (₹) <span className="req">*</span></label>
                        <input
                          type="number"
                          min="1"
                          step="1"
                          value={tuckshopAmount}
                          onChange={(e) => setTuckshopAmount(e.target.value)}
                          placeholder="Enter amount to top up"
                          style={{ width: '100%', padding: '10px 14px', fontSize: 16, borderRadius: 8, border: '1.5px solid #e2e8f0' }}
                        />
                        <p className="pay-hint">This amount will be credited to the student wallet for tuckshop use.</p>
                      </div>
                    ) : (
                      <div className="pay-field pay-field-full">
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                          <label style={{ margin: 0 }}>Payment Year</label>
                          {[new Date().getFullYear(), new Date().getFullYear() + 1].map((yr) => (
                            <button key={yr} type="button"
                              className={`btn btn-small ${payYear === yr ? 'btn-primary' : 'btn-secondary'}`}
                              onClick={() => { setPayYear(yr); setSelectedMonths([]); const sid = paySelectedChild?.school_id || null; loadMonthlyPrices(selectedMealTypeId, sid, yr); }}
                            >{yr}</button>
                          ))}
                        </div>
                        <label>Payment Month</label>
                        <div className="pay-months-grid">
                          {MONTH_NAMES.map((name, idx) => {
                            const m = idx + 1;
                            const price = monthlyPrices[m];
                            const hasPrice = price !== undefined;
                            return (
                              <label
                                key={m}
                                className={`pay-month-checkbox${!hasPrice ? ' disabled' : ''}${selectedMonths.includes(m) ? ' checked' : ''}`}
                              >
                                <input
                                  type="checkbox"
                                  checked={selectedMonths.includes(m)}
                                  disabled={!hasPrice}
                                  onChange={() => hasPrice && toggleMonth(m)}
                                />
                                <span className="pay-month-name">{name.slice(0, 3)}</span>
                                {hasPrice && <small className="pay-month-price">₹{price.toFixed(0)}</small>}
                              </label>
                            );
                          })}
                        </div>
                        {selectedMealTypeId && Object.keys(monthlyPrices).length === 0 && (
                          <p className="pay-hint">No monthly prices configured for this meal plan. Please contact school.</p>
                        )}
                      </div>
                    )}

                    {/* Sub Total */}
                    <div className="pay-field">
                      <label>Sub Total</label>
                      <div className="pay-amount-box">
                        <span className="pay-currency">₹</span>
                        <span className="pay-amount-val">{subTotal.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Convenience Fee */}
                    <div className="pay-field">
                      <label>Convenience Fee (2%)</label>
                      <div className="pay-amount-box">
                        <span className="pay-currency">₹</span>
                        <span className="pay-amount-val">{convenienceFee.toFixed(2)}</span>
                      </div>
                    </div>

                    {/* Total Price */}
                    <div className="pay-field pay-field-full">
                      <label>Total Price</label>
                      <div className="pay-amount-box pay-total-box">
                        <span className="pay-currency">₹</span>
                        <span className="pay-amount-val pay-total-val">{totalPrice.toFixed(2)}</span>
                      </div>
                    </div>
                  </div>

                  <div className="pay-actions">
                    <button
                      type="button"
                      className="pay-btn-razorpay"
                      disabled={paymentLoading || totalPrice <= 0 || (!isTuckShopMode && selectedMonths.length === 0)}
                      onClick={handlePayWithRazorpay}
                    >
                      {paymentLoading ? 'Processing…' : `Pay ₹${totalPrice.toFixed(2)} via Razorpay`}
                    </button>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {/* ══ SUBSCRIPTIONS TAB ══ */}
        {activeTab === 'subscriptions' && (
          <>
            <div className="parent-hero">
              <div>
                <div className="parent-chip">Canteen Meal Plans</div>
                <h1>My Meal Plan Subscriptions</h1>
                <p>View active meal plan subscriptions and canteen access history for your child.</p>
              </div>
            </div>

            {children.length > 1 && (
              <div style={{ marginBottom: 16 }}>
                <label style={{ fontWeight: 600, marginRight: 8 }}>Select Child:</label>
                <select
                  value={subChildId || ''}
                  onChange={(e) => {
                    const id = parseInt(e.target.value);
                    setSubChildId(id);
                    loadSubscriptions(id);
                  }}
                  style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid #e2e8f0' }}
                >
                  {children.map((c) => (
                    <option key={c.id} value={c.id}>{c.student_name} — {c.grade || 'Grade N/A'}</option>
                  ))}
                </select>
              </div>
            )}

            {subLoading ? (
              <div className="parent-empty">Loading subscriptions…</div>
            ) : (
              <div className="parent-grid">
                <section className="parent-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="parent-section-head">
                    <h2>Available Meal Plans</h2>
                    <p>All active meal plans for this academic year. Click Subscribe to enroll your child.</p>
                  </div>
                  {availablePlans.length === 0 ? (
                    <div className="parent-empty small">No meal plans available for the current period. Contact the school admin.</div>
                  ) : (() => {
                    // Group by meal type
                    const MN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                    const groups = {};
                    availablePlans.forEach((p) => {
                      if (!groups[p.meal_type_id]) groups[p.meal_type_id] = { meal_name: p.meal_name, meal_type_id: p.meal_type_id, plans: [] };
                      groups[p.meal_type_id].plans.push(p);
                    });
                    return (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        {Object.values(groups).map((g) => {
                          const unsubscribed = g.plans.filter(
                            (p) => !subscriptions.some(
                              (s) => s.meal_type_id === p.meal_type_id &&
                                parseInt(s.month) === parseInt(p.month) &&
                                parseInt(s.year) === parseInt(p.year) &&
                                s.status === 'Active'
                            )
                          );
                          const prices = g.plans.map((p) => parseFloat(p.price));
                          const minP = Math.min(...prices), maxP = Math.max(...prices);
                          const allDone = unsubscribed.length === 0;
                          return (
                            <div key={g.meal_type_id} style={{ border: '1px solid #e2e8f0', borderRadius: 12, padding: '16px 20px', background: allDone ? '#f0fdf4' : '#fff' }}>
                              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                                <div>
                                  <div style={{ fontWeight: 700, fontSize: 16, color: '#1e293b' }}>{g.meal_name}</div>
                                  <div style={{ fontSize: 13, color: '#64748b', marginTop: 4 }}>
                                    {g.plans.length} month{g.plans.length !== 1 ? 's' : ''} available
                                    {' • '}₹{minP.toFixed(0)}{minP !== maxP ? `–₹${maxP.toFixed(0)}` : ''}/month
                                    {unsubscribed.length > 0 && ` • ${unsubscribed.length} not yet subscribed`}
                                  </div>
                                  {/* Month-price table */}
                                  <div style={{ marginTop: 8, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                    {g.plans.map((p) => {
                                      const done = !unsubscribed.some((u) => u.id === p.id);
                                      return (
                                        <span key={p.id} style={{
                                          padding: '2px 8px', borderRadius: 6, fontSize: 12, fontWeight: 600,
                                          background: done ? '#d1fae5' : '#f1f5f9',
                                          color: done ? '#065f46' : '#334155',
                                          border: `1px solid ${done ? '#6ee7b7' : '#e2e8f0'}`
                                        }}>
                                          {MN[(p.month || 1) - 1]} {p.year} — ₹{parseFloat(p.price).toFixed(0)}
                                          {done ? ' ✓' : ''}
                                        </span>
                                      );
                                    })}
                                  </div>
                                </div>
                                {allDone ? (
                                  <span style={{ padding: '6px 14px', borderRadius: 20, background: '#d1fae5', color: '#065f46', fontWeight: 700, fontSize: 13 }}>✓ All Subscribed</span>
                                ) : (
                                  <button
                                    className="btn btn-primary"
                                    style={{ whiteSpace: 'nowrap' }}
                                    onClick={() => {
                                      setSelectedMealTypeId(String(g.meal_type_id));
                                      setPaymentFor('Canteen');
                                      setActiveTab('payments');
                                    }}
                                  >
                                    Subscribe Months ({unsubscribed.length})
                                  </button>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    );
                  })()}
                </section>

                <section className="parent-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="parent-section-head">
                    <h2>Active Meal Plan Subscriptions</h2>
                    <p>Plans you have subscribed to for your child</p>
                  </div>
                  {subscriptions.length === 0 ? (
                    <div className="parent-empty small">No meal plan subscriptions found. Go to <strong>Payments</strong> tab to subscribe.</div>
                  ) : (
                    <div className="parent-table-wrap">
                      <table className="parent-table">
                        <thead>
                          <tr>
                            <th>Meal Plan</th>
                            <th>Month</th>
                            <th>Year</th>
                            <th>Grade</th>
                            <th>Amount Paid</th>
                            <th>Status</th>
                            <th>Subscribed On</th>
                          </tr>
                        </thead>
                        <tbody>
                          {subscriptions.map((sub) => {
                            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
                            const isActive = sub.status === 'Active';
                            return (
                              <tr key={sub.id}>
                                <td style={{ fontWeight: 600 }}>{sub.meal_type_name}</td>
                                <td>{monthNames[(sub.month || 1) - 1]}</td>
                                <td>{sub.year}</td>
                                <td>{sub.grade || 'All'}</td>
                                <td style={{ fontWeight: 700, color: '#16a34a' }}>₹{parseFloat(sub.amount_paid || 0).toFixed(2)}</td>
                                <td>
                                  <span style={{
                                    padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                    background: isActive ? '#d1fae5' : '#fee2e2',
                                    color: isActive ? '#065f46' : '#991b1b'
                                  }}>{sub.status}</span>
                                </td>
                                <td style={{ fontSize: 12, color: '#64748b' }}>
                                  {sub.subscribed_at ? new Date(sub.subscribed_at).toLocaleDateString('en-IN') : '—'}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                <section className="parent-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="parent-section-head">
                    <h2>Canteen Access History</h2>
                    <p>Record of RFID taps at the canteen</p>
                  </div>
                  {canteenLog.length === 0 ? (
                    <div className="parent-empty small">No canteen access records yet.</div>
                  ) : (
                    <div className="parent-table-wrap">
                      <table className="parent-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Time</th>
                            <th>Meal Plan</th>
                            <th>Status</th>
                            <th>Reason</th>
                          </tr>
                        </thead>
                        <tbody>
                          {canteenLog.map((log) => {
                            const isAllowed = log.access_status === 'Allowed';
                            return (
                              <tr key={log.id}>
                                <td>{log.access_date}</td>
                                <td>{log.access_time}</td>
                                <td>{log.meal_type_name || '—'}</td>
                                <td>
                                  <span style={{
                                    padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                    background: isAllowed ? '#d1fae5' : '#fee2e2',
                                    color: isAllowed ? '#065f46' : '#991b1b'
                                  }}>{isAllowed ? '✓ Allowed' : '✗ Denied'}</span>
                                </td>
                                <td style={{ fontSize: 12, color: '#64748b' }}>{log.deny_reason || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}

            {activeTab === 'payment-history' && (
              <div className="parent-grid">
                {/* Child selector */}
                {children.length > 1 && (
                  <section className="parent-card">
                    <div className="parent-section-head">
                      <h2>Select Child</h2>
                    </div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                      {children.map((child) => (
                        <button
                          key={child.id}
                          className={`btn ${phChildId === child.id ? 'btn-primary' : 'btn-outline'}`}
                          onClick={() => { setPhChildId(child.id); loadPaymentHistory(child.id); }}
                        >
                          {child.student_name}
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                <section className="parent-card" style={{ gridColumn: '1 / -1' }}>
                  <div className="parent-section-head">
                    <h2>Razorpay Payment History</h2>
                    <p>All Razorpay payments made for meal plans and tuckshop wallet recharge</p>
                  </div>
                  {phLoading ? (
                    <div className="parent-empty small">Loading payment history…</div>
                  ) : paymentHistory.length === 0 ? (
                    <div className="parent-empty small">No Razorpay payment records found for this child.</div>
                  ) : (
                    <div className="parent-table-wrap">
                      <table className="parent-table">
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Payment For</th>
                            <th>Plan / Meal</th>
                            <th>Sub Total</th>
                            <th>Fee</th>
                            <th>Total Paid</th>
                            <th>Status</th>
                            <th>Razorpay Payment ID</th>
                            <th>Razorpay Order ID</th>
                          </tr>
                        </thead>
                        <tbody>
                          {paymentHistory.map((p) => {
                            const isCompleted = p.payment_status === 'Completed';
                            return (
                              <tr key={p.id}>
                                <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                                  {p.created_at ? new Date(p.created_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                                </td>
                                <td>{p.payment_for || '—'}</td>
                                <td>{p.meal_type_name || '—'}</td>
                                <td>₹{parseFloat(p.sub_total || 0).toFixed(2)}</td>
                                <td>₹{parseFloat(p.convenience_fee || 0).toFixed(2)}</td>
                                <td style={{ fontWeight: 700, color: '#16a34a' }}>₹{parseFloat(p.total_paid || 0).toFixed(2)}</td>
                                <td>
                                  <span style={{
                                    padding: '2px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                    background: isCompleted ? '#d1fae5' : '#fee2e2',
                                    color: isCompleted ? '#065f46' : '#991b1b',
                                  }}>{p.payment_status || 'Completed'}</span>
                                </td>
                                <td style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569' }}>{p.razorpay_payment_id || '—'}</td>
                                <td style={{ fontSize: 11, fontFamily: 'monospace', color: '#475569' }}>{p.razorpay_order_id || '—'}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
