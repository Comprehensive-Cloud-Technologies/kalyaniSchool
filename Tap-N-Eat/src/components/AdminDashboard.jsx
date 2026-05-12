import { useState, useEffect } from 'react';
import './AdminDashboard.css';
import './WalletSummary.css';
import cctLogo from '../assets/logo.webp';

// Resolve API base dynamically so it works on Hostinger (/qsr/) and locally
const API_BASE_URL = (() => {
  const envBase = import.meta.env.VITE_API_BASE_URL;
  if (envBase) return envBase.replace(/\/$/, '');
  const { hostname, origin, pathname } = window.location;

  // Local Vite dev (localhost:5173) should call Apache/PHP backend (localhost)
  if (hostname === 'localhost' || hostname === '127.0.0.1') {
    return 'http://localhost:8000/api';
  }

  // Hostinger path like /qsr/Tap-N-Eat/frontend/
  if (pathname.includes('/qsr/') && pathname.includes('/Tap-N-Eat/frontend')) {
    return '/qsr/Tap-N-Eat/backend/api';
  }

  // Direct path like /Tap-N-Eat/frontend/
  if (pathname.includes('/Tap-N-Eat/frontend')) {
    return '/Tap-N-Eat/backend/api';
  }

  // Default: works on EC2/any plain domain — nginx proxies /api/
  if (pathname.includes('/qsr/')) return '/qsr/backend/api';
  return '/api';
})();

const getApiUrlCandidates = (endpoint) => {
  const normalizedEndpoint = String(endpoint || '').replace(/^\/+/, '');
  const primary = `${API_BASE_URL}/${normalizedEndpoint}`;
  const candidates = [primary];

  const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
  if (isLocal) {
    if (API_BASE_URL.endsWith('/api')) {
      candidates.push(`${API_BASE_URL.replace(/\/api$/, '/backend/api')}/${normalizedEndpoint}`);
    } else if (API_BASE_URL.endsWith('/backend/api')) {
      candidates.push(`${API_BASE_URL.replace(/\/backend\/api$/, '/api')}/${normalizedEndpoint}`);
    }
  }

  return [...new Set(candidates)];
};

const fetchJsonWithApiFallback = async (endpoint, options = {}) => {
  const candidates = getApiUrlCandidates(endpoint);
  let lastError = null;

  for (const url of candidates) {
    try {
      const response = await fetch(url, options);
      const rawText = await response.text();
      let parsed = null;

      try {
        parsed = rawText ? JSON.parse(rawText) : {};
      } catch {
        parsed = null;
      }

      const isJson = parsed && typeof parsed === 'object';
      if (response.status === 404 && candidates.length > 1 && url !== candidates[candidates.length - 1]) {
        continue;
      }

      if (!isJson) {
        const snippet = (rawText || '').trim().slice(0, 120);
        throw new Error(`Invalid JSON response from ${url}${snippet ? `: ${snippet}` : ''}`);
      }

      return { response, data: parsed, url };
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error('API request failed');

};

/**
 * Wraps fetch() to automatically inject school_id from localStorage into every
 * school-scoped API request: appended as query param for GET, injected into JSON
 * body for POST/PUT/DELETE.
 */
const apiFetch = (url, options = {}) => {
  const schoolId = localStorage.getItem('adminSchoolId');
  if (!schoolId) return fetch(url, options);

  const method = (options.method || 'GET').toUpperCase();

  if (method === 'GET' || !options.method) {
    const sep = url.includes('?') ? '&' : '?';
    return fetch(`${url}${sep}school_id=${schoolId}`, options);
  }

  if (options.body) {
    try {
      const body = JSON.parse(options.body);
      body.school_id = parseInt(schoolId, 10);
      return fetch(url, { ...options, body: JSON.stringify(body) });
    } catch {
      // body is not JSON — send as-is
    }
  }
  return fetch(url, options);
};

/**
 * Same as fetchJsonWithApiFallback but injects school_id.
 */
const schoolApiFallback = (endpoint, options = {}) => {
  const schoolId = localStorage.getItem('adminSchoolId');
  if (!schoolId) return fetchJsonWithApiFallback(endpoint, options);

  const method = (options.method || 'GET').toUpperCase();

  if (method === 'GET' || !options.method) {
    const sep = endpoint.includes('?') ? '&' : '?';
    return fetchJsonWithApiFallback(`${endpoint}${sep}school_id=${schoolId}`, options);
  }

  if (options.body) {
    try {
      const body = JSON.parse(options.body);
      body.school_id = parseInt(schoolId, 10);
      return fetchJsonWithApiFallback(endpoint, { ...options, body: JSON.stringify(body) });
    } catch {}
  }
  return fetchJsonWithApiFallback(endpoint, options);
};

function AdminDashboard({
  authStorageKey = 'adminRole',
  loginHashRoute = '#/admin-login',
  activeSectionStorageKey = 'adminActiveSection',
  portalLabel = 'Admin',
  isTeacherPortal = false,
}) {
  const [role] = useState(() => {
    try {
      return localStorage.getItem(authStorageKey) || '';
    } catch {
      return '';
    }
  });
    const schoolName = (() => {
      try { return localStorage.getItem('adminSchoolName') || ''; } catch { return ''; }
    })();
    const schoolLogoUrlRaw = (() => {
      try { return localStorage.getItem('adminSchoolLogoUrl') || ''; } catch { return ''; }
    })();
    // Resolve /uploads/... to an absolute URL using the same base as the API.
    const schoolLogoUrl = (() => {
      if (!schoolLogoUrlRaw) return '';
      if (/^https?:\/\//i.test(schoolLogoUrlRaw)) return schoolLogoUrlRaw;
      const base = API_BASE_URL.replace(/\/api$/, '').replace(/\/backend\/api$/, '/backend');
      return `${base}${schoolLogoUrlRaw.startsWith('/') ? '' : '/'}${schoolLogoUrlRaw}`;
    })();
    const adminFullName = (() => {
      try { return localStorage.getItem('adminFullName') || ''; } catch { return ''; }
    })();
  const isSecurity = role === 'security';
  const isReadOnly = role === 'hr' || isSecurity;

  // ── Permission helpers ─────────────────────────
  // For 'admin' role every permission is granted.
  // For other roles the value stored in localStorage after login is used.
  // An absent key defaults to allowed (safe for existing installs).
  const _adminPermissions = (() => {
    try {
      const s = localStorage.getItem('adminPermissions');
      return s ? JSON.parse(s) : null;
    } catch { return null; }
  })();
  const hasPerm = (section, op) => {
    if (!section) return true;
    if (!_adminPermissions) return true;  // no permissions configured = full access
    const p = _adminPermissions[section];
    return !p || p[`can_${op}`] !== 0;   // 0 = explicitly denied; 1 or missing = allowed
  };
  // Map dashboard section keys → permission section names
  const SECTION_PERM = {
    employees:              'students',
    'grade-division-master':'masters',
    'meal-categories':      'meal-categories',
    'monthly-plans':        'monthly-plans',
    'meal-subscriptions':   'meal-subscriptions',
    reports:                'reports',
    tuckshop:               'tuckshop',
    scan:                   'rfid-scan',
    wallet:                 'wallet',
    transactions:           'transactions',
  };

  const baseSections = isSecurity
    ? ['employees', 'scan']
    : isTeacherPortal
      ? ['dashboard', 'employees', 'lookup', 'wallet', 'scan', 'transactions']
      : ['dashboard', 'employees', 'lookup', 'wallet', 'scan', 'transactions', 'tuckshop', 'reports'];
  const teacherSections = !isSecurity
    ? ['grade-division-master', 'meal-categories', 'monthly-plans', 'meal-subscriptions']
    : [];
  const allowedSections = [...baseSections, ...teacherSections];
  const defaultSection = allowedSections[0] || 'employees';

  const personLabel = 'Student';
  const personLabelPlural = 'Students';
  const gradeLabel = isTeacherPortal ? 'Grade' : 'Shift';
  const divisionLabel = isTeacherPortal ? 'Division' : 'Site';

  useEffect(() => {
    if (!role) {
      window.location.hash = loginHashRoute;
    }
  }, [role, loginHashRoute]);

  const [employees, setEmployees] = useState([]);
  const [loading, setLoading] = useState(false);
  const [alert, setAlert] = useState({ show: false, message: '', type: '' });
  const [showEditModal, setShowEditModal] = useState(false);
  const ACTIVE_SECTION_KEY = activeSectionStorageKey;
  const [activeSection, setActiveSectionState] = useState(() => {
    try {
      const stored = localStorage.getItem(ACTIVE_SECTION_KEY);
      return stored && allowedSections.includes(stored) ? stored : defaultSection;
    } catch {
      return defaultSection;
    }
  });
  const setActiveSection = (section) => {
    const next = allowedSections.includes(section) ? section : defaultSection;
    setActiveSectionState(next);
    try {
      localStorage.setItem(ACTIVE_SECTION_KEY, next);
    } catch {
      // ignore
    }
  };
  const [walletMode, setWalletMode] = useState('single');
  const [showRechargeForm, setShowRechargeForm] = useState(false);

  // Dashboard states
  const [dashboardDate, setDashboardDate] = useState(() => new Date().toISOString().split('T')[0]);
  // Empty string means "no filter" (all meals)
  const [dashboardMealFilter, setDashboardMealFilter] = useState('Lunch');
  const [dashboardSearch, setDashboardSearch] = useState('');
  const [trendRange, setTrendRange] = useState('week');
  
  // Wallet Recharge States
  const [searchQuery, setSearchQuery] = useState('');
  const [searchedEmployee, setSearchedEmployee] = useState(null);
  const [rechargeAmount, setRechargeAmount] = useState('');
  const [bulkRechargeAmount, setBulkRechargeAmount] = useState('');
  
  // RFID Scan States
  const [rfidInput, setRfidInput] = useState('');
  const [scanLoading, setScanLoading] = useState(false);
  const [lastTransaction, setLastTransaction] = useState(null);
  const [scannedEmployee, setScannedEmployee] = useState(null);
  const [currentMealInfo, setCurrentMealInfo] = useState(null);
  const [scanStatus, setScanStatus] = useState('idle'); // 'idle' | 'allowed' | 'denied'
  const [denyReason, setDenyReason] = useState('');
  
  // Transaction History States
  const [transactions, setTransactions] = useState([]);
  const [transactionFilter, setTransactionFilter] = useState({
    date: new Date().toISOString().split('T')[0],
    mealCategory: ''
  });
  
  const [formData, setFormData] = useState({
    rfid_number: '',
    emp_id: '',
    emp_name: '',
    parent_name: '',
    parent_email: '',
    parent_password: '',
    grade: '',
    division: '',
    site_name: '',
    shift: '',
    wallet_amount: '0.00'
  });

  const [employeeSearch, setEmployeeSearch] = useState('');
  const [employeeGradeFilter, setEmployeeGradeFilter] = useState('');
  const [employeeDivisionFilter, setEmployeeDivisionFilter] = useState('');
  const [gradeOptions, setGradeOptions] = useState([]);
  const [divisionOptions, setDivisionOptions] = useState([]);
  const [newGrade, setNewGrade] = useState('');
  const [newDivision, setNewDivision] = useState('');
  const [mealTypes, setMealTypes] = useState([]);
  const [newMealTypeName, setNewMealTypeName] = useState('');
  const [gradeMealPrices, setGradeMealPrices] = useState([]);
  const [gradeMealPriceForm, setGradeMealPriceForm] = useState({
    grade: '',
    meal_type_id: '',
    price: '',
  });
  const [mealSlots, setMealSlots] = useState([]);
  const [mealSlotForm, setMealSlotForm] = useState({
    meal_type_id: '',
    meal_name: '',
    amount: '',
    start_time: '',
    end_time: '',
  });

  // Tuckshop state
  const [tuckshopItems, setTuckshopItems] = useState([]);
  const [tuckshopCart, setTuckshopCart] = useState([]);
  const [tuckshopRfid, setTuckshopRfid] = useState('');
  const [tuckshopScanLoading, setTuckshopScanLoading] = useState(false);
  const [tuckshopScannedStudent, setTuckshopScannedStudent] = useState(null);
  const [tuckshopLastSale, setTuckshopLastSale] = useState(null);
  const [tuckshopItemForm, setTuckshopItemForm] = useState({ item_name: '', price: '', category: 'General' });
  const [tuckshopEditId, setTuckshopEditId] = useState(null); // null = add, number = edit
  const [tuckshopActiveCategory, setTuckshopActiveCategory] = useState('All');
  const [tuckshopView, setTuckshopView] = useState('pos'); // 'pos' | 'items'

  // Scan history state
  const [scanHistory, setScanHistory] = useState([]);

  // Reports state
  const [reportType, setReportType] = useState('razorpay');
  const [reportFrom, setReportFrom] = useState(() => {
    const d = new Date(); d.setDate(1); return d.toISOString().split('T')[0];
  });
  const [reportTo, setReportTo] = useState(() => new Date().toISOString().split('T')[0]);
  const [reportData, setReportData] = useState([]);
  const [reportLoading, setReportLoading] = useState(false);
  const [reportTotals, setReportTotals] = useState({});

  // Meal Categories state
  const [mealCategories, setMealCategories] = useState([]);
  const [categoryForm, setCategoryForm] = useState({ category_name: '', start_time: '', end_time: '' });
  const [editingCategoryId, setEditingCategoryId] = useState(null);

  // Monthly Meal Plans state
  const [monthlyPlans, setMonthlyPlans] = useState([]);
  const [monthlyPlanYear, setMonthlyPlanYear] = useState(() => new Date().getFullYear());
  const [monthlyPlanForm, setMonthlyPlanForm] = useState({ meal_type_name: '', month: '', price: '', grade: '', category_id: '' });
  const [bulkRows, setBulkRows] = useState([{ meal_type_name: '', month: '', price: '', grade: '', category_id: '' }]);
  const [bulkMode, setBulkMode] = useState(false);
  const [csvMode, setCsvMode] = useState(false);
  const [csvRows, setCsvRows] = useState([]);
  const [csvImporting, setCsvImporting] = useState(false);
  const [planPageSize] = useState(10);
  const [planPage, setPlanPage] = useState(1);
  const [planCatFilter, setPlanCatFilter] = useState('');
  const [selectedPlanIds, setSelectedPlanIds] = useState(new Set());
  const [editingPlanId, setEditingPlanId] = useState(null);
  const [editingPlanData, setEditingPlanData] = useState({});

  // Subscription Report state
  const [subscriptionReport, setSubscriptionReport] = useState([]);
  const [subReportYear, setSubReportYear] = useState(() => new Date().getFullYear());
  const [subReportMonth, setSubReportMonth] = useState('');
  const [subReportLoading, setSubReportLoading] = useState(false);

  // Employee Lookup (search by ID/RFID/Name)
  const [lookupTerm, setLookupTerm] = useState('');
  const [lookupSelectedId, setLookupSelectedId] = useState(null);
  const [lookupTransactions, setLookupTransactions] = useState([]);

  useEffect(() => {
    if (lookupSelectedId) {
      loadLookupTransactions(lookupSelectedId);
    } else {
      setLookupTransactions([]);
    }
  }, [lookupSelectedId]);

  const loadLookupTransactions = async (empId) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/transactions?employee_id=${empId}&limit=500`);
      const data = await response.json();
      if (response.ok) {
        setLookupTransactions(data.transactions || []);
      }
    } catch (error) {
      console.error('Error fetching lookup transactions:', error);
    }
  };

  const [editData, setEditData] = useState({
    id: '',
    rfid_number: '',
    emp_id: '',
    emp_name: '',
    parent_name: '',
    parent_email: '',
    parent_password: '',
    grade: '',
    division: '',
    site_name: '',
    shift: '',
    wallet_amount: '0.00'
  });

  const normalize = (v) => String(v ?? '').trim().toLowerCase();

  // Derived state for Employee Lookup
  const lookupMatches = (() => {
    if (activeSection !== 'lookup') return [];
    const q = normalize(lookupTerm);
    if (!q) return [];
    
    return employees
      .filter((e) => {
        const empId = normalize(e.emp_id);
        const rfid = normalize(e.rfid_number);
        const name = normalize(e.emp_name);
        return empId.includes(q) || rfid.includes(q) || name.includes(q);
      })
      .slice(0, 20);
  })();

  const lookupSelected = (() => {
    if (activeSection !== 'lookup') return null;
    // 1. If explicit ID selected, return that
    if (lookupSelectedId) {
      return employees.find((e) => String(e.id) === String(lookupSelectedId));
    }
    // 2. If exactly one match, return that automatically
    if (lookupMatches.length === 1) {
      return lookupMatches[0];
    }
    return null;
  })();

  useEffect(() => {
    if (lookupSelected && lookupSelected.id) {
      loadLookupTransactions(lookupSelected.id);
    } else {
      setLookupTransactions([]);
    }
  }, [lookupSelected?.id, activeSection]);

  useEffect(() => {
    loadEmployees();
    loadCurrentMealInfo();
    if (activeSection === 'transactions' || activeSection === 'dashboard') {
      loadTransactions({ bypassFilters: activeSection === 'dashboard' });
    }
  }, [activeSection]);

  useEffect(() => {
    try {
      localStorage.setItem(ACTIVE_SECTION_KEY, activeSection);
    } catch {
      // ignore
    }
  }, [activeSection]);

  useEffect(() => {
    if (!allowedSections.includes(activeSection)) {
      setActiveSection(defaultSection);
    }
  }, [role]);

  useEffect(() => {
    if (activeSection === 'wallet') {
      loadTransactions({ bypassFilters: true });
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'tuckshop') loadTuckshopItems();
    if (activeSection === 'reports') loadReports();
  }, [activeSection]);

  useEffect(() => {
    if (isSecurity) return;
    if (activeSection === 'employees' || activeSection === 'grade-division-master' || activeSection === 'monthly-plans') {
      loadMasters();
    }
    if (activeSection === 'scan') {
      loadMealSlots();
      loadMealTypes();
      loadGradeMealPrices();
      loadScanHistory();
    }
    if (activeSection === 'monthly-plans') {
      loadMealTypes();
      loadMealCategories();
      loadMonthlyPlans();
    }
    if (activeSection === 'meal-categories') {
      loadMealCategories();
    }
    if (activeSection === 'meal-subscriptions') {
      loadSubscriptionReport();
    }
    if (activeSection === 'dashboard') {
      loadMealTypes();
    }
  }, [activeSection]);

  useEffect(() => {
    if (activeSection === 'monthly-plans') {
      loadMonthlyPlans();
    }
  }, [monthlyPlanYear]);
  
  useEffect(() => {
    if (activeSection === 'transactions') {
      loadTransactions();
    }
  }, [transactionFilter]);

  const loadEmployees = async () => {
    try {
      setLoading(true);
      const response = await apiFetch(`${API_BASE_URL}/employees`);
      const data = await response.json();
      setEmployees(Array.isArray(data) ? data : []);
      setLoading(false);
    } catch (error) {
      console.error('Error loading employees:', error);
      showAlert('Error loading employees', 'error');
      setLoading(false);
    }
  };

  const loadMasters = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/masters`);
      const data = await response.json();
      if (response.ok) {
        setGradeOptions(Array.isArray(data.grades) ? data.grades : []);
        setDivisionOptions(Array.isArray(data.divisions) ? data.divisions : []);
      }
    } catch (error) {
      console.error('Error loading masters:', error);
    }
  };

  const createMasterItem = async (type, value) => {
    const trimmed = String(value || '').trim();
    if (!trimmed) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/masters`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, value: trimmed }),
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || `${type} added`, 'success');
        await loadMasters();
      } else {
        showAlert(result.message || `Unable to add ${type}`, 'error');
      }
    } catch (error) {
      console.error(`Error adding ${type}:`, error);
      showAlert(`Error adding ${type}`, 'error');
    }
  };

  const deleteMasterItem = async (type, id) => {
    if (!window.confirm(`Delete this ${type}?`)) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/masters?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || `${type} deleted`, 'success');
        await loadMasters();
      } else {
        showAlert(result.message || `Unable to delete ${type}`, 'error');
      }
    } catch (error) {
      console.error(`Error deleting ${type}:`, error);
      showAlert(`Error deleting ${type}`, 'error');
    }
  };

  const loadMealSlots = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots`);
      const data = await response.json();
      if (response.ok) {
        setMealSlots(Array.isArray(data.slots) ? data.slots : []);
      }
    } catch (error) {
      console.error('Error loading meal slots:', error);
    }
  };

  const loadMealTypes = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=types`);
      const data = await response.json();
      if (response.ok) {
        setMealTypes(Array.isArray(data.types) ? data.types : []);
      }
    } catch (error) {
      console.error('Error loading meal types:', error);
    }
  };

  const createMealType = async () => {
    const mealName = String(newMealTypeName || '').trim();
    if (!mealName) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ meal_name: mealName }),
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Meal type created', 'success');
        setNewMealTypeName('');
        await loadMealTypes();
      } else {
        showAlert(result.message || 'Unable to create meal type', 'error');
      }
    } catch (error) {
      console.error('Error creating meal type:', error);
      showAlert('Error creating meal type', 'error');
    }
  };

  const updateMealType = async (mealType) => {
    const nextName = window.prompt('Update meal type name', mealType.meal_name);
    if (!nextName || !nextName.trim()) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=types`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: mealType.id, meal_name: nextName.trim(), is_active: mealType.is_active ? 1 : 0 }),
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Meal type updated', 'success');
        await Promise.all([loadMealTypes(), loadMealSlots(), loadGradeMealPrices()]);
      } else {
        showAlert(result.message || 'Unable to update meal type', 'error');
      }
    } catch (error) {
      console.error('Error updating meal type:', error);
      showAlert('Error updating meal type', 'error');
    }
  };

  const deleteMealType = async (mealTypeId) => {
    if (!window.confirm('Delete this meal type? Related slots and grade-wise prices will also be removed.')) {
      return;
    }
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=types&id=${mealTypeId}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Meal type deleted', 'success');
        await Promise.all([loadMealTypes(), loadMealSlots(), loadGradeMealPrices()]);
      } else {
        showAlert(result.message || 'Unable to delete meal type', 'error');
      }
    } catch (error) {
      console.error('Error deleting meal type:', error);
      showAlert('Error deleting meal type', 'error');
    }
  };

  const loadGradeMealPrices = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=prices`);
      const data = await response.json();
      if (response.ok) {
        setGradeMealPrices(Array.isArray(data.prices) ? data.prices : []);
      }
    } catch (error) {
      console.error('Error loading grade-wise meal prices:', error);
    }
  };

  const saveGradeMealPrice = async (e) => {
    e.preventDefault();
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=prices`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(gradeMealPriceForm),
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Grade-wise price saved', 'success');
        setGradeMealPriceForm({ grade: '', meal_type_id: '', price: '' });
        await loadGradeMealPrices();
      } else {
        showAlert(result.message || 'Unable to save grade-wise price', 'error');
      }
    } catch (error) {
      console.error('Error saving grade-wise meal price:', error);
      showAlert('Error saving grade-wise meal price', 'error');
    }
  };

  const deleteGradeMealPrice = async (id) => {
    if (!window.confirm('Delete this grade-wise meal price?')) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?resource=prices&id=${id}`, {
        method: 'DELETE',
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Grade-wise price deleted', 'success');
        await loadGradeMealPrices();
      } else {
        showAlert(result.message || 'Unable to delete grade-wise price', 'error');
      }
    } catch (error) {
      console.error('Error deleting grade-wise meal price:', error);
      showAlert('Error deleting grade-wise meal price', 'error');
    }
  };

  /* ── Subscription Report ── */
  const loadSubscriptionReport = async () => {
    setSubReportLoading(true);
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      let url = `meal-plan-subscriptions?action=report&year=${subReportYear}`;
      if (schoolId) url += `&school_id=${schoolId}`;
      if (subReportMonth) url += `&month=${subReportMonth}`;
      const { response, data } = await fetchJsonWithApiFallback(url);
      if (response.ok) setSubscriptionReport(Array.isArray(data.report) ? data.report : []);
    } catch (error) {
      console.error('Error loading subscription report:', error);
    }
    setSubReportLoading(false);
  };

  /* ── Meal Categories ── */
  const loadMealCategories = async () => {
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      const qs = schoolId ? `?school_id=${schoolId}` : '';
      const { response, data } = await fetchJsonWithApiFallback(`meal-categories${qs}`);
      if (response.ok) setMealCategories(Array.isArray(data.categories) ? data.categories : []);
    } catch (error) {
      console.error('Error loading meal categories:', error);
    }
  };

  const saveCategory = async (e) => {
    e.preventDefault();
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      let response, data;
      if (editingCategoryId) {
        ({ response, data } = await fetchJsonWithApiFallback('meal-categories', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: editingCategoryId, ...categoryForm }),
        }));
      } else {
        const body = { ...categoryForm, school_id: schoolId ? parseInt(schoolId, 10) : null };
        ({ response, data } = await fetchJsonWithApiFallback('meal-categories', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }));
      }
      if (response.ok) {
        showAlert(data.message || 'Category saved', 'success');
        setCategoryForm({ category_name: '', start_time: '', end_time: '' });
        setEditingCategoryId(null);
        await loadMealCategories();
      } else {
        showAlert(data.error || 'Unable to save category', 'error');
      }
    } catch (error) {
      showAlert('Error saving category', 'error');
    }
  };

  const deleteCategory = async (id) => {
    if (!window.confirm('Delete this category?')) return;
    try {
      const { response } = await fetchJsonWithApiFallback(`meal-categories?id=${id}`, { method: 'DELETE' });
      if (response.ok) { showAlert('Category deleted', 'success'); await loadMealCategories(); }
      else showAlert('Unable to delete category', 'error');
    } catch { showAlert('Error deleting category', 'error'); }
  };

  /* ── Monthly Meal Plans ── */
  const loadMonthlyPlans = async () => {
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      const sep = schoolId ? `?school_id=${schoolId}&year=${monthlyPlanYear}&show_all=1` : `?year=${monthlyPlanYear}&show_all=1`;
      const { response, data } = await fetchJsonWithApiFallback(`monthly-meal-plans${sep}`);
      if (response.ok) {
        setMonthlyPlans(Array.isArray(data.plans) ? data.plans : []);
      }
    } catch (error) {
      console.error('Error loading monthly plans:', error);
    }
  };

  const togglePlanActive = async (id, currentActive) => {
    try {
      const { response, data } = await fetchJsonWithApiFallback(`monthly-meal-plans?id=${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ is_active: currentActive ? 0 : 1 }),
      });
      if (response.ok) {
        showAlert(currentActive ? 'Plan deactivated — hidden from parents' : 'Plan activated — visible to parents', 'success');
        await loadMonthlyPlans();
      } else {
        showAlert(data.error || 'Failed to update plan', 'error');
      }
    } catch { showAlert('Error updating plan', 'error'); }
  };

  const saveMonthlyPlan = async (e) => {
    e.preventDefault();
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      const body = {
        meal_type_name: monthlyPlanForm.meal_type_name.trim(),
        month: parseInt(monthlyPlanForm.month, 10),
        year: monthlyPlanYear,
        price: parseFloat(monthlyPlanForm.price),
        grade: monthlyPlanForm.grade ? monthlyPlanForm.grade : null,
        category_id: monthlyPlanForm.category_id ? parseInt(monthlyPlanForm.category_id) : null,
        school_id: schoolId ? parseInt(schoolId, 10) : null,
      };
      const { response, data } = await fetchJsonWithApiFallback('monthly-meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (response.ok) {
        showAlert(data.message || 'Monthly plan saved', 'success');
        setMonthlyPlanForm({ meal_type_name: '', month: '', price: '', grade: '', category_id: '' });
        await loadMonthlyPlans();
      } else {
        showAlert(data.error || 'Unable to save monthly plan', 'error');
      }
    } catch (error) {
      console.error('Error saving monthly plan:', error);
      showAlert('Error saving monthly plan', 'error');
    }
  };

  const saveBulkPlans = async (e) => {
    e.preventDefault();
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      const validRows = bulkRows.filter((r) => r.meal_type_name && r.month && r.price !== '');
      if (validRows.length === 0) { showAlert('Add at least one complete row', 'error'); return; }
      const bulk = validRows.map((r) => ({
        meal_type_name: r.meal_type_name,
        month: parseInt(r.month),
        year: monthlyPlanYear,
        price: parseFloat(r.price),
        grade: r.grade ? r.grade.trim() : null,
        category_id: r.category_id ? parseInt(r.category_id) : null,
      }));
      const { response, data } = await fetchJsonWithApiFallback('monthly-meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk, school_id: schoolId ? parseInt(schoolId, 10) : null }),
      });
      if (response.ok) {
        showAlert(data.message || 'Plans imported', 'success');
        setBulkRows([{ meal_type_name: '', month: '', price: '', grade: '', category_id: '' }]);
        setBulkMode(false);
        await loadMonthlyPlans();
      } else {
        showAlert(data.error || 'Unable to import plans', 'error');
      }
    } catch (error) {
      showAlert('Error importing plans', 'error');
    }
  };

  const MONTH_NAME_MAP = { january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12 };

  const parseCsvMealPlans = (text) => {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) return [];
    const rows = [];
    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''));
      if (cols.length < 5) continue;
      const [mealPlan, month, grade, year, price] = cols;
      const monthNum = MONTH_NAME_MAP[month.toLowerCase()];
      if (!mealPlan || !monthNum || !year || price === '') continue;
      rows.push({ meal_type_name: mealPlan, month: monthNum, year: parseInt(year, 10), grade: grade || null, price: parseFloat(price) });
    }
    return rows;
  };

  const handleCsvFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setCsvRows(parseCsvMealPlans(ev.target.result)); };
    reader.readAsText(file);
  };

  const importCsvPlans = async () => {
    if (csvRows.length === 0) { showAlert('No valid rows found in CSV', 'error'); return; }
    setCsvImporting(true);
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      const { response, data } = await fetchJsonWithApiFallback('monthly-meal-plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bulk: csvRows, school_id: schoolId ? parseInt(schoolId, 10) : null }),
      });
      if (response.ok) {
        showAlert(data.message || `${csvRows.length} plans imported`, 'success');
        setCsvRows([]);
        setCsvMode(false);
        await loadMonthlyPlans();
      } else {
        showAlert(data.error || 'Import failed', 'error');
      }
    } catch { showAlert('Error importing CSV', 'error'); }
    finally { setCsvImporting(false); }
  };

  const deleteMonthlyPlan = async (id) => {
    if (!window.confirm('Delete this monthly meal plan?')) return;
    try {
      const { response, data } = await fetchJsonWithApiFallback(`monthly-meal-plans?id=${id}`, { method: 'DELETE' });
      if (response.ok) {
        showAlert(data.message || 'Monthly plan deleted', 'success');
        setSelectedPlanIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
        await loadMonthlyPlans();
      } else {
        showAlert(data.error || 'Unable to delete monthly plan', 'error');
      }
    } catch (error) {
      showAlert('Error deleting monthly plan', 'error');
    }
  };

  const bulkDeletePlans = async () => {
    if (selectedPlanIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedPlanIds.size} selected plan${selectedPlanIds.size > 1 ? 's' : ''}? This cannot be undone.`)) return;
    let failed = 0;
    for (const id of selectedPlanIds) {
      try {
        const { response } = await fetchJsonWithApiFallback(`monthly-meal-plans?id=${id}`, { method: 'DELETE' });
        if (!response.ok) failed++;
      } catch { failed++; }
    }
    setSelectedPlanIds(new Set());
    if (failed > 0) showAlert(`Deleted with ${failed} error(s)`, 'error');
    else showAlert(`${selectedPlanIds.size} plans deleted`, 'success');
    await loadMonthlyPlans();
  };

  const startEditPlan = (plan) => {
    setEditingPlanId(plan.id);
    setEditingPlanData({
      meal_type_name: plan.meal_name || '',
      month: String(plan.month),
      price: String(plan.price),
      grade: plan.grade || '',
      category_id: plan.category_id ? String(plan.category_id) : '',
    });
  };

  const saveEditPlan = async (planId) => {
    try {
      const { response, data } = await fetchJsonWithApiFallback(`monthly-meal-plans?id=${planId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          meal_type_name: editingPlanData.meal_type_name,
          month: parseInt(editingPlanData.month),
          price: parseFloat(editingPlanData.price),
          grade: editingPlanData.grade || null,
          category_id: editingPlanData.category_id ? parseInt(editingPlanData.category_id) : null,
        }),
      });
      if (response.ok) {
        showAlert('Plan updated', 'success');
        setEditingPlanId(null);
        await loadMonthlyPlans();
      } else {
        showAlert(data.error || 'Update failed', 'error');
      }
    } catch { showAlert('Error updating plan', 'error'); }
  };

  const createMealSlot = async (e) => {
    e.preventDefault();
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(mealSlotForm),
      });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Meal slot created', 'success');
        setMealSlotForm({ meal_type_id: '', meal_name: '', amount: '', start_time: '', end_time: '' });
        loadMealSlots();
      } else {
        showAlert(result.message || 'Unable to create meal slot', 'error');
      }
    } catch (error) {
      console.error('Error creating meal slot:', error);
      showAlert('Error creating meal slot', 'error');
    }
  };

  const deleteMealSlot = async (id) => {
    if (!window.confirm('Delete this meal slot?')) return;
    try {
      const response = await apiFetch(`${API_BASE_URL}/meal-slots?id=${id}`, { method: 'DELETE' });
      const result = await response.json();
      if (response.ok) {
        showAlert(result.message || 'Meal slot deleted', 'success');
        loadMealSlots();
      } else {
        showAlert(result.message || 'Unable to delete meal slot', 'error');
      }
    } catch (error) {
      console.error('Error deleting meal slot:', error);
      showAlert('Error deleting meal slot', 'error');
    }
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleEditInputChange = (e) => {
    const { name, value } = e.target;
    setEditData(prev => ({
      ...prev,
      [name]: value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (isReadOnly) return showAlert('Read-only role: cannot add employees', 'warning');

    const payload = {
      ...formData,
      parent_name: formData.parent_name,
      parent_email: formData.parent_email,
      parent_password: formData.parent_password,
      grade: formData.grade,
      division: formData.division,
      shift: formData.grade,
      site_name: formData.division,
    };
    
    try {
      const response = await apiFetch(`${API_BASE_URL}/employees`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok) {
        showAlert('Student added successfully!', 'success');
        resetForm();
        loadEmployees();
      } else {
        showAlert(result.message || 'Error adding student', 'error');
      }
    } catch (error) {
      console.error('Error creating student:', error);
      showAlert('Error adding student', 'error');
    }
  };

  const handleEditSubmit = async (e) => {
    e.preventDefault();
    if (isReadOnly) return showAlert('Read-only role: cannot edit employees', 'warning');

    const payload = {
      ...editData,
      parent_name: editData.parent_name,
      parent_email: editData.parent_email,
      parent_password: editData.parent_password,
      grade: editData.grade,
      division: editData.division,
      shift: editData.grade,
      site_name: editData.division,
    };
    
    try {
      const response = await apiFetch(`${API_BASE_URL}/employees`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });

      const result = await response.json();

      if (response.ok) {
        showAlert('Student updated successfully!', 'success');
        setShowEditModal(false);
        loadEmployees();
      } else {
        showAlert(result.message || 'Error updating student', 'error');
      }
    } catch (error) {
      console.error('Error updating student:', error);
      showAlert('Error updating student', 'error');
    }
  };

  const editEmployee = async (id) => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/employees?id=${id}`);
      const employee = await response.json();

      if (response.ok) {
        setEditData({
          id: employee.id,
          rfid_number: employee.rfid_number,
          emp_id: employee.emp_id,
          emp_name: employee.emp_name,
          parent_name: employee.parent_name || '',
          parent_email: employee.parent_email || '',
          parent_password: '',
          grade: employee.grade || employee.shift || '',
          division: employee.division || employee.site_name || '',
          site_name: employee.site_name,
          shift: employee.shift,
          wallet_amount: employee.wallet_amount || '0.00'
        });
        setShowEditModal(true);
      } else {
        showAlert('Error loading employee data', 'error');
      }
    } catch (error) {
      console.error('Error loading employee:', error);
      showAlert('Error loading employee data', 'error');
    }
  };

  const deleteEmployee = async (id) => {
    if (isReadOnly) return showAlert('Read-only role: cannot delete employees', 'warning');
    if (!window.confirm('Are you sure you want to delete this employee?')) {
      return;
    }

    try {
      const response = await apiFetch(`${API_BASE_URL}/employees`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ id: id })
      });

      const result = await response.json();

      if (response.ok) {
        showAlert('Employee deleted successfully!', 'success');
        loadEmployees();
      } else {
        showAlert(result.message || 'Error deleting employee', 'error');
      }
    } catch (error) {
      console.error('Error deleting employee:', error);
      showAlert('Error deleting employee', 'error');
    }
  };

  const resetForm = () => {
    setFormData({
      rfid_number: '',
      emp_id: '',
      emp_name: '',
      parent_email: '',
      grade: '',
      division: '',
      site_name: '',
      shift: '',
      wallet_amount: '0.00'
    });
  };

  const handleLookupChange = (e) => {
    setLookupTerm(e.target.value);
    setLookupSelectedId(null);
  };

  const showAlert = (message, type) => {
    setAlert({ show: true, message, type });
    setTimeout(() => {
      setAlert({ show: false, message: '', type: '' });
    }, 5000);
  };

  const getInitials = (fullName) => {
    const cleaned = String(fullName || '').trim();
    if (!cleaned) return '—';
    const parts = cleaned.split(/\s+/).filter(Boolean);
    const first = parts[0]?.[0] || '';
    const last = parts.length > 1 ? parts[parts.length - 1]?.[0] : '';
    const initials = (first + last).toUpperCase();
    return initials || '—';
  };

  // Search Employee by RFID or Employee ID
  const searchEmployee = async () => {
    if (!searchQuery.trim()) {
      showAlert('Please enter RFID or Employee ID', 'error');
      return;
    }

    try {
      const response = await apiFetch(`${API_BASE_URL}/wallet-recharge?search=${encodeURIComponent(searchQuery)}`);
      const data = await response.json();

      if (response.ok) {
        setSearchedEmployee(data);
        setRechargeAmount('');
        setShowRechargeForm(false);
        showAlert('Employee found!', 'success');
      } else {
        setSearchedEmployee(null);
        setShowRechargeForm(false);
        showAlert(data.message || 'Employee not found', 'error');
      }
    } catch (error) {
      console.error('Error searching employee:', error);
      showAlert('Error searching employee', 'error');
    }
  };

  // Recharge Individual Employee
  const rechargeIndividualWallet = async () => {
    if (isReadOnly) {
      showAlert('Read-only role: cannot recharge wallets', 'warning');
      return;
    }
    if (!searchedEmployee) {
      showAlert('Please search for an employee first', 'error');
      return;
    }

    if (!rechargeAmount || parseFloat(rechargeAmount) <= 0) {
      showAlert('Please enter a valid amount', 'error');
      return;
    }

    try {
      const response = await apiFetch(`${API_BASE_URL}/wallet-recharge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          employee_id: searchedEmployee.id,
          amount: parseFloat(rechargeAmount)
        })
      });

      const result = await response.json();

      if (response.ok) {
        showAlert(`₹${rechargeAmount} added to ${searchedEmployee.emp_name}'s wallet!`, 'success');
        setSearchedEmployee(result.employee);
        setRechargeAmount('');
        loadEmployees(); // Refresh employee list
      } else {
        showAlert(result.message || 'Error recharging wallet', 'error');
      }
    } catch (error) {
      console.error('Error recharging wallet:', error);
      showAlert('Error recharging wallet', 'error');
    }
  };

  // Bulk Recharge All Employees
  const bulkRechargeWallets = async () => {
    if (isReadOnly) {
      showAlert('Read-only role: cannot recharge wallets', 'warning');
      return;
    }
    if (!bulkRechargeAmount || parseFloat(bulkRechargeAmount) <= 0) {
      showAlert('Please enter a valid amount for bulk recharge', 'error');
      return;
    }

    if (!window.confirm(`Are you sure you want to add ₹${bulkRechargeAmount} to ALL employees' wallets?`)) {
      return;
    }

    try {
      const response = await apiFetch(`${API_BASE_URL}/wallet-recharge`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          bulk_recharge: true,
          amount: parseFloat(bulkRechargeAmount)
        })
      });

      const result = await response.json();

      if (response.ok) {
        showAlert(`₹${bulkRechargeAmount} added to ${result.employees_recharged} employees!`, 'success');
        setBulkRechargeAmount('');
        loadEmployees(); // Refresh employee list
      } else {
        showAlert(result.message || 'Error performing bulk recharge', 'error');
      }
    } catch (error) {
      console.error('Error performing bulk recharge:', error);
      showAlert('Error performing bulk recharge', 'error');
    }
  };
  
 
  
  // RFID Scan for Meal Deduction
  const loadCurrentMealInfo = async () => {
    try {
      const response = await apiFetch(`${API_BASE_URL}/rfid-scan`);
      const data = await response.json();
      setCurrentMealInfo(data.meal_info);
    } catch (error) {
      console.error('Error loading meal info:', error);
    }
  };
  
  const loadScanHistory = async () => {
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      let url = `${API_BASE_URL}/transactions?limit=20`;
      if (schoolId) url += `&school_id=${schoolId}`;
      const response = await apiFetch(url);
      const data = await response.json();
      if (response.ok) {
        const canteenRecords = (data.transactions || []).filter(
          (t) => t.transaction_type === 'canteen' || t.transaction_type === 'canteen_denied'
        );
        setScanHistory(canteenRecords);
      }
    } catch (e) { /* silent */ }
  };

  const handleRfidScan = async (e) => {
    if (e) e.preventDefault();
    if (!rfidInput.trim()) { showAlert('Please enter RFID number', 'error'); return; }

    const scannedRfid = rfidInput.trim();
    setRfidInput('');
    setScanLoading(true);

    const refocus = () => setTimeout(() => {
      const el = document.getElementById('rfidInput');
      if (el) { el.focus(); el.select(); }
    }, 200);

    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      const response = await apiFetch(`${API_BASE_URL}/rfid-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rfid_number: scannedRfid, school_id: schoolId ? parseInt(schoolId) : undefined }),
      });
      const result = await response.json();

      if (response.ok) {
        setScannedEmployee({ ...result.employee, rfid: scannedRfid });
        setLastTransaction(result.transaction || {});
        setScanStatus('allowed');
        setDenyReason('');
        showAlert(`✅ Access granted — ${result.transaction?.meal_plan || result.transaction?.meal_category || 'Meal Plan'}`, 'success');
        loadEmployees();
        loadScanHistory();
      } else {
        // Denied or error — still show student info if returned
        setScannedEmployee(result.employee ? { ...result.employee, rfid: scannedRfid } : null);
        setLastTransaction(null);
        setScanStatus('denied');
        setDenyReason(result.deny_reason || result.message || 'Access denied');
        showAlert(`❌ ${result.deny_reason || result.message || 'Access denied'}`, 'error');
        loadScanHistory();
      }
    } catch (error) {
      console.error('Error scanning RFID:', error);
      showAlert('Unable to process RFID scan', 'error');
      setScanStatus('idle');
    } finally {
      setScanLoading(false);
      refocus();
    }
  };

  const clearScanState = () => {
    setLastTransaction(null);
    setScannedEmployee(null);
    setRfidInput('');
    setScanStatus('idle');
    setDenyReason('');
  };

  /* ── Tuckshop ── */
  const loadTuckshopItems = async () => {
    try {
      const { response, data } = await schoolApiFallback('tuckshop');
      if (response.ok) setTuckshopItems(Array.isArray(data.items) ? data.items : []);
    } catch (e) { console.error('Error loading tuckshop items', e); }
  };

  const saveTuckshopItem = async (e) => {
    e.preventDefault();
    const name  = tuckshopItemForm.item_name.trim();
    const price = parseFloat(tuckshopItemForm.price);
    if (!name || isNaN(price) || price < 0) return showAlert('Item name and valid price are required', 'error');
    try {
      let result;
      if (tuckshopEditId) {
        result = await schoolApiFallback('tuckshop', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: tuckshopEditId, ...tuckshopItemForm, price }),
        });
      } else {
        result = await schoolApiFallback('tuckshop', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'item', ...tuckshopItemForm, price }),
        });
      }
      const { response, data } = result;
      if (response.ok) {
        showAlert(data.message || 'Item saved', 'success');
        setTuckshopItemForm({ item_name: '', price: '', category: 'General' });
        setTuckshopEditId(null);
        loadTuckshopItems();
      } else {
        showAlert(data.message || 'Could not save item', 'error');
      }
    } catch (e) { showAlert('Error saving item', 'error'); }
  };

  const deleteTuckshopItem = async (id) => {
    if (!window.confirm('Remove this item from the tuckshop?')) return;
    try {
      const { response } = await schoolApiFallback(`tuckshop?id=${id}`, { method: 'DELETE' });
      if (response.ok) { showAlert('Item removed', 'success'); loadTuckshopItems(); }
    } catch (e) { showAlert('Error removing item', 'error'); }
  };

  const addToCart = (item) => {
    setTuckshopCart((prev) => {
      const existing = prev.find((c) => c.id === item.id);
      if (existing) return prev.map((c) => c.id === item.id ? { ...c, qty: c.qty + 1 } : c);
      return [...prev, { ...item, qty: 1 }];
    });
  };

  const updateCartQty = (id, qty) => {
    const q = parseInt(qty, 10);
    if (q <= 0) { setTuckshopCart((prev) => prev.filter((c) => c.id !== id)); return; }
    setTuckshopCart((prev) => prev.map((c) => c.id === id ? { ...c, qty: q } : c));
  };

  const removeFromCart = (id) => setTuckshopCart((prev) => prev.filter((c) => c.id !== id));
  const clearTuckshopCart = () => { setTuckshopCart([]); setTuckshopRfid(''); setTuckshopScannedStudent(null); setTuckshopLastSale(null); };

  const cartTotal = tuckshopCart.reduce((s, c) => s + parseFloat(c.price) * c.qty, 0);

  const processTuckshopPurchase = async () => {
    if (!tuckshopRfid.trim()) return showAlert('Please scan or enter student RFID', 'error');
    if (tuckshopCart.length === 0) return showAlert('Cart is empty', 'error');
    setTuckshopScanLoading(true);
    try {
      const { response, data } = await schoolApiFallback('tuckshop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'purchase',
          rfid_number: tuckshopRfid.trim(),
          items: tuckshopCart.map((c) => ({ id: c.id, name: c.item_name, price: c.price, qty: c.qty })),
        }),
      });
      if (response.ok) {
        setTuckshopScannedStudent(data.employee);
        setTuckshopLastSale(data);
        setTuckshopCart([]);
        setTuckshopRfid('');
        loadEmployees();
        showAlert(`₹${parseFloat(data.transaction?.total || 0).toFixed(2)} deducted from ${data.employee?.name}'s wallet`, 'success');
      } else {
        showAlert(data.message || 'Purchase failed', 'error');
      }
    } catch (e) { showAlert('Error processing purchase', 'error'); }
    finally { setTuckshopScanLoading(false); }
  };

  /* ── Reports ── */
  const loadReports = async () => {
    setReportLoading(true);
    try {
      const schoolId = localStorage.getItem('adminSchoolId');
      let url = `reports?type=${reportType}&from=${reportFrom}&to=${reportTo}&limit=500`;
      if (schoolId) url += `&school_id=${schoolId}`;
      const { response, data } = await fetchJsonWithApiFallback(url);
      if (response.ok) {
        setReportData(data.payments || data.sales || data.transactions || []);
        setReportTotals(data.totals || {});
      } else {
        showAlert(data.message || 'Failed to load report', 'error');
      }
    } catch (e) { showAlert('Error loading report', 'error'); }
    finally { setReportLoading(false); }
  };

  const deleteReport = async (id) => {
    if (!window.confirm('Delete this record? This cannot be undone.')) return;
    try {
      const { response, data } = await fetchJsonWithApiFallback(`reports?type=${reportType}&id=${id}`, { method: 'DELETE' });
      if (response.ok) { showAlert('Record deleted', 'success'); loadReports(); }
      else showAlert(data.message || 'Could not delete record', 'error');
    } catch (e) { showAlert('Error deleting record', 'error'); }
  };
  
  // Load Transactions
  const loadTransactions = async ({ bypassFilters = false } = {}) => {
    try {
      setLoading(true);
      let url = `${API_BASE_URL}/transactions?limit=100`;
      
      if (!bypassFilters) {
        if (transactionFilter.date) {
          url += `&date=${transactionFilter.date}`;
        }
        if (transactionFilter.mealCategory) {
          url += `&meal_category=${transactionFilter.mealCategory}`;
        }
      }
      
      const response = await apiFetch(url);
      const data = await response.json();
      
      if (response.ok) {
        setTransactions(data.transactions || []);
      }
      setLoading(false);
    } catch (error) {
      console.error('Error loading transactions:', error);
      showAlert('Error loading transactions', 'error');
      setLoading(false);
    }
  };

  // Insight calculations
  const totalEmployees = employees.length;
  const totalWallet = employees.reduce((sum, e) => sum + parseFloat(e.wallet_amount || 0), 0);
  const avgWallet = totalEmployees ? totalWallet / totalEmployees : 0;

  const deductionTx = transactions.filter((t) => t.transaction_type === 'deduction');
  const rechargeTx = transactions.filter((t) => t.transaction_type !== 'deduction');

  const todayIso = new Date().toISOString().split('T')[0];
  const dashboardIso = dashboardDate || todayIso;
  const spendToday = deductionTx
    .filter(
      (t) =>
        t.transaction_date === dashboardIso &&
        (!dashboardMealFilter || t.meal_category === dashboardMealFilter)
    )
    .reduce((sum, t) => sum + parseFloat(t.amount || 0), 0);

  const parseIsoDate = (iso) => {
    if (!iso) return null;
    const d = new Date(`${iso}T00:00:00`);
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const inRangeInclusive = (iso, start, end) => {
    const d = parseIsoDate(iso);
    if (!d || !start || !end) return false;
    return d.getTime() >= start.getTime() && d.getTime() <= end.getTime();
  };

  const getTrendWindow = () => {
    const base = parseIsoDate(dashboardIso) || new Date();
    const end = new Date(base);
    end.setHours(23, 59, 59, 999);

    if (trendRange === 'year') {
      const start = new Date(base.getFullYear(), 0, 1);
      const yearEnd = new Date(base.getFullYear(), 11, 31);
      yearEnd.setHours(23, 59, 59, 999);
      return { start, end: yearEnd };
    }

    if (trendRange === 'month') {
      const start = new Date(base.getFullYear(), base.getMonth(), 1);
      const monthEnd = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      monthEnd.setHours(23, 59, 59, 999);
      return { start, end: monthEnd };
    }

    if (trendRange === 'day') {
      const start = new Date(base);
      start.setHours(0, 0, 0, 0);
      return { start, end };
    }

    const start = new Date(base);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);
    return { start, end };
  };

  const trendWindow = getTrendWindow();
  const trendTx = transactions.filter((t) => inRangeInclusive(t.transaction_date, trendWindow.start, trendWindow.end));
  const trendDeductionTx = trendTx.filter((t) => t.transaction_type === 'deduction');
  const trendRechargeTx = trendTx.filter((t) => t.transaction_type !== 'deduction');

  // Meal Participation: Unique employees who had a transaction ON THE SELECTED DASHBOARD DATE
  // Filtered by meal type if selected
  const participationUnique = new Set(
    deductionTx
      .filter((t) => 
        t.transaction_date === dashboardIso && 
        (dashboardMealFilter ? t.meal_category === dashboardMealFilter : true)
      )
      .map((t) => t.emp_id || t.emp_name || t.rfid_number)
      .filter(Boolean)
  );
  const participationCount = participationUnique.size;
  const participationPct = totalEmployees ? Math.round((participationCount / totalEmployees) * 100) : 0;

  const mealCounts = mealTypes.map((m) => ({
    meal: m.meal_name,
    count: trendDeductionTx.filter((t) => t.meal_category === m.meal_name).length,
  }));
  const mealTotal = mealCounts.reduce((s, m) => s + m.count, 0);

  const scannedBalance = Number(scannedEmployee?.wallet_amount ?? lastTransaction?.new_balance ?? 0);
  const recentRecharges = transactions
    .filter((t) => t.transaction_type !== 'deduction')
    .slice(0, 5);

  // Build conic gradient for meal distribution
  const pieStyle = (() => {
    if (!mealTotal) return { background: '#f1f5f9' };
    const colors = ['#6c5ce7', '#00b894', '#0984e3', '#ff7675'];
    let angle = 0;
    const segments = mealCounts.map((m, i) => {
      const deg = (m.count / mealTotal) * 360;
      const seg = `${colors[i % colors.length]} ${angle}deg ${angle + deg}deg`;
      angle += deg;
      return seg;
    });
    return { background: `conic-gradient(${segments.join(', ')})` };
  })();

  const buildSeries = () => {
    const base = parseIsoDate(dashboardIso) || new Date();

    if (trendRange === 'year') {
      const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const spend = Array(12).fill(0);
      const recharge = Array(12).fill(0);

      trendDeductionTx.forEach((t) => {
        const d = parseIsoDate(t.transaction_date);
        if (!d) return;
        spend[d.getMonth()] += parseFloat(t.amount || 0);
      });
      trendRechargeTx.forEach((t) => {
        const d = parseIsoDate(t.transaction_date);
        if (!d) return;
        recharge[d.getMonth()] += parseFloat(t.amount || 0);
      });

      return { labels, spend, recharge };
    }

    if (trendRange === 'month') {
      const labels = [];
      const spend = [];
      const recharge = [];

      const start = new Date(base.getFullYear(), base.getMonth(), 1);
      const end = new Date(base.getFullYear(), base.getMonth() + 1, 0);
      const dayMapSpend = new Map();
      const dayMapRecharge = new Map();

      trendDeductionTx.forEach((t) => {
        dayMapSpend.set(t.transaction_date, (dayMapSpend.get(t.transaction_date) || 0) + parseFloat(t.amount || 0));
      });
      trendRechargeTx.forEach((t) => {
        dayMapRecharge.set(t.transaction_date, (dayMapRecharge.get(t.transaction_date) || 0) + parseFloat(t.amount || 0));
      });

      for (let d = new Date(start); d.getTime() <= end.getTime(); d.setDate(d.getDate() + 1)) {
        const iso = d.toISOString().split('T')[0];
        labels.push(String(d.getDate()));
        spend.push(dayMapSpend.get(iso) || 0);
        recharge.push(dayMapRecharge.get(iso) || 0);
      }

      return { labels, spend, recharge };
    }

    if (trendRange === 'day') {
      const labels = ['00', '02', '04', '06', '08', '10', '12', '14', '16', '18', '20', '22'];
      const spend = Array(12).fill(0);
      const recharge = Array(12).fill(0);
      
      const getBucket = (t) => {
        if (!t.transaction_time) return -1;
        const h = parseInt(t.transaction_time.split(':')[0], 10);
        return Math.floor(h / 2);
      };

      trendDeductionTx.forEach((t) => {
        const b = getBucket(t);
        if (b >= 0 && b < 12) spend[b] += parseFloat(t.amount || 0);
      });
      trendRechargeTx.forEach((t) => {
        const b = getBucket(t);
        if (b >= 0 && b < 12) recharge[b] += parseFloat(t.amount || 0);
      });
      
      return { labels, spend, recharge };
    }

    // week
    const labels = [];
    const spend = [];
    const recharge = [];
    const start = new Date(base);
    start.setDate(start.getDate() - 6);
    start.setHours(0, 0, 0, 0);

    const dayMapSpend = new Map();
    const dayMapRecharge = new Map();
    trendDeductionTx.forEach((t) => {
      dayMapSpend.set(t.transaction_date, (dayMapSpend.get(t.transaction_date) || 0) + parseFloat(t.amount || 0));
    });
    trendRechargeTx.forEach((t) => {
      dayMapRecharge.set(t.transaction_date, (dayMapRecharge.get(t.transaction_date) || 0) + parseFloat(t.amount || 0));
    });

    for (let d = new Date(start); labels.length < 7; d.setDate(d.getDate() + 1)) {
      const iso = d.toISOString().split('T')[0];
      labels.push(d.toLocaleDateString(undefined, { weekday: 'short' }));
      spend.push(dayMapSpend.get(iso) || 0);
      recharge.push(dayMapRecharge.get(iso) || 0);
    }

    return { labels, spend, recharge };
  };

  const trendSeries = buildSeries();
  const maxTrend = Math.max(...trendSeries.spend, ...trendSeries.recharge, 1);
  
  // Bar Chart Calculations
  const chartH = 200;
  const chartW = 560;
  const chartPad = 20;
  const drawW = chartW - chartPad * 2;
  const drawH = chartH - chartPad * 2;
  
  const barGroups = trendSeries.labels.map((label, i) => {
    const n = trendSeries.labels.length;
    const groupWidth = drawW / n;
    const barWidth = groupWidth * 0.35; 
    const gap = groupWidth * 0.1; 
      
    const xBase = chartPad + (i * groupWidth) + (groupWidth - (barWidth * 2 + gap)) / 2;
      
    const spendVal = trendSeries.spend[i] || 0;
    const spendH = (spendVal / maxTrend) * drawH;
    const spendY = chartH - chartPad - spendH;
      
    const rechargeVal = trendSeries.recharge[i] || 0;
    const rechargeH = (rechargeVal / maxTrend) * drawH;
    const rechargeY = chartH - chartPad - rechargeH;
      
    return {
      label,
      xSpend: xBase,
      ySpend: spendY,
      hSpend: spendH,
      xRecharge: xBase + barWidth + gap,
      yRecharge: rechargeY,
      hRecharge: rechargeH,
      width: barWidth
    };
  });


  return (
    <div className="dashboard-container">
      {/* Sidebar */}
      <div className="sidebar">
        <div className="sidebar-brand">
          <img src={schoolLogoUrl || cctLogo} alt={schoolName || 'Tap-N-Eat'} />
          {schoolName && (
            <div className="sidebar-school-name" title={schoolName}>{schoolName}</div>
          )}
        </div>
        {!isSecurity && (
          <div 
            className={`menu-item menu-dashboard ${activeSection === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveSection('dashboard')}
          >
            <span className="menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 19V5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M8 19V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M12 19V7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M16 19V14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M20 19V9" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </span>
            <span className="menu-label">Dashboard</span>
          </div>
        )}
        {hasPerm('students', 'view') && (
        <div 
          className={`menu-item menu-employees ${activeSection === 'employees' ? 'active' : ''}`}
          onClick={() => setActiveSection('employees')}
        >
          <span className="menu-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M22 21v-2a3 3 0 0 0-2-2.82" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M17 3.18a4 4 0 0 1 0 7.64" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </span>
          <span className="menu-label">{personLabelPlural}</span>
        </div>
        )}

        {!isSecurity && (
          <>
            <div
              className={`menu-item menu-lookup ${activeSection === 'lookup' ? 'active' : ''}`}
              onClick={() => setActiveSection('lookup')}
            >
              <span className="menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M10.5 18a7.5 7.5 0 1 0 0-15 7.5 7.5 0 0 0 0 15Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M21 21l-4.2-4.2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                  <path d="M10.5 7a3.5 3.5 0 0 1 3.5 3.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.7" />
                </svg>
              </span>
              <span className="menu-label">{personLabel} Details</span>
            </div>
            <div 
              className={`menu-item menu-wallet ${activeSection === 'wallet' ? 'active' : ''}`}
              onClick={() => setActiveSection('wallet')}
              style={hasPerm('wallet', 'view') ? {} : { display: 'none' }}
            >
              <span className="menu-icon" aria-hidden="true">
                <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M17 15a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z" stroke="currentColor" strokeWidth="2" />
                  <path d="M3 9h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              </span>
              <span className="menu-label">Wallet Recharge</span>
            </div>
          </>
        )}
        <div 
          className={`menu-item menu-scan ${activeSection === 'scan' ? 'active' : ''}`}
          onClick={() => setActiveSection('scan')}
          style={hasPerm('rfid-scan', 'view') ? {} : { display: 'none' }}
        >
          <span className="menu-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" />
              <path d="M10 19h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M9 6h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M7 9h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.9" />
              <path d="M7 12h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" opacity="0.75" />
            </svg>
          </span>
          <span className="menu-label">RFID {personLabel} Scan</span>
        </div>
        {!isSecurity && (
          <>
            {!isSecurity && (
              <>
                <div
                  className={`menu-item menu-grade ${activeSection === 'grade-division-master' ? 'active' : ''}`}
                  onClick={() => setActiveSection('grade-division-master')}
                  style={hasPerm('masters', 'view') ? {} : { display: 'none' }}
                >
                  <span className="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="3" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                      <rect x="14" y="3" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                      <rect x="3" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                      <rect x="14" y="14" width="7" height="7" rx="1.5" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </span>
                  <span className="menu-label">Grade &amp; Division</span>
                </div>

                <div
                  className={`menu-item ${activeSection === 'meal-categories' ? 'active' : ''}`}
                  onClick={() => setActiveSection('meal-categories')}
                  style={hasPerm('meal-categories', 'view') ? {} : { display: 'none' }}
                >
                  <span className="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="2"/>
                      <path d="M12 7v5l3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                    </svg>
                  </span>
                  <span className="menu-label">Meal Categories</span>
                </div>

                <div
                  className={`menu-item menu-calendar ${activeSection === 'monthly-plans' ? 'active' : ''}`}
                  onClick={() => setActiveSection('monthly-plans')}
                  style={hasPerm('monthly-plans', 'view') ? {} : { display: 'none' }}
                >
                  <span className="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 3v2M17 3v2M4 7h16M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 11h3M13 11h3M8 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="menu-label">Monthly Meal Plans</span>
                </div>

                <div
                  className={`menu-item ${activeSection === 'meal-subscriptions' ? 'active' : ''}`}
                  onClick={() => setActiveSection('meal-subscriptions')}
                  style={hasPerm('meal-subscriptions', 'view') ? {} : { display: 'none' }}
                >
                  <span className="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                      <rect x="9" y="3" width="6" height="4" rx="1" stroke="currentColor" strokeWidth="2"/>
                      <path d="M9 12l2 2 4-4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                    </svg>
                  </span>
                  <span className="menu-label">Subscriptions Report</span>
                </div>
              </>
            )}

            {!isTeacherPortal && (
              <>
                <div
                  className={`menu-item ${activeSection === 'tuckshop' ? 'active' : ''}`}
                  onClick={() => setActiveSection('tuckshop')}
                  style={hasPerm('tuckshop', 'view') ? {} : { display: 'none' }}
                >
                  <span className="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M3 3h2l.4 2M7 13h10l4-8H5.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M7 13L5.4 5M7 13l-1.5 6h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <circle cx="9" cy="21" r="1" stroke="currentColor" strokeWidth="2" />
                      <circle cx="20" cy="21" r="1" stroke="currentColor" strokeWidth="2" />
                    </svg>
                  </span>
                  <span className="menu-label">Tuckshop</span>
                </div>

                <div
                  className={`menu-item ${activeSection === 'reports' ? 'active' : ''}`}
                  onClick={() => setActiveSection('reports')}
                  style={hasPerm('reports', 'view') ? {} : { display: 'none' }}
                >
                  <span className="menu-icon" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <rect x="3" y="3" width="18" height="18" rx="2" stroke="currentColor" strokeWidth="2" />
                      <path d="M9 7h6M9 11h6M9 15h4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M16 14l2 2 3-3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </span>
                  <span className="menu-label">Payment Reports</span>
                </div>
              </>
            )}

          </>
        )}
        {!isSecurity && (
          <div
            className={`menu-item menu-transactions ${activeSection === 'transactions' ? 'active' : ''}`}
            onClick={() => setActiveSection('transactions')}
            style={hasPerm('transactions', 'view') ? {} : { display: 'none' }}
          >
            <span className="menu-icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M9 5h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M9 9h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M9 13h8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M9 17h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                <path d="M7 3h10a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" />
              </svg>
            </span>
            <span className="menu-label">Transaction History</span>
          </div>
        )}
        <div className="menu-item menu-logout" onClick={() => {
          try {
            localStorage.removeItem(authStorageKey);
            localStorage.removeItem('adminSchoolId');
            localStorage.removeItem('adminSchoolName');
            localStorage.removeItem('adminFullName');
            localStorage.removeItem('adminAdminId');
          } catch {}
          window.location.hash = loginHashRoute;
        }}>
          <span className="menu-icon" aria-hidden="true">
            <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M10 17l1.5 1.5a2 2 0 0 0 1.4.6H20a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-7.1a2 2 0 0 0-1.4.6L10 7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M15 12H3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
              <path d="M6 9l-3 3 3 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </span>
          <span className="menu-label">Logout</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="main-content">
        <div className="content-header">
          {activeSection === 'dashboard' ? (
            <div className="dash-topbar">
              <div>
                <h1 className="dash-title">Dashboard Overview</h1>
                <p className="dash-subtitle">Welcome back, {portalLabel}. Here's today's meal report.</p>
              </div>

              <div className="dash-actions">
                <label className="dash-control" aria-label="Dashboard date">
                  <span className="dash-control-ico" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 3v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M17 3v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M4 7h16" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M6 5h12a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="2" />
                      <path d="M8 11h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M13 11h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M8 15h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <span className="dash-control-label">Today:</span>
                  <input
                    type="date"
                    value={dashboardDate}
                    onChange={(e) => setDashboardDate(e.target.value)}
                  />
                </label>

                <label className="dash-control" aria-label="Meal filter">
                  <span className="dash-control-ico" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                      <path d="M7 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M10 3v8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M7 7h3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M14 3v7a2 2 0 0 0 2 2h0V3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M5 21h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M12 21V11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </span>
                  <select value={dashboardMealFilter} onChange={(e) => setDashboardMealFilter(e.target.value)}>
                    <option value="">None</option>
                    {mealTypes.map((m) => (
                      <option key={m.id} value={m.meal_name}>
                        {m.meal_name}
                      </option>
                    ))}
                  </select>
                </label>


              </div>
            </div>
          ) : (
            <h1>
              {activeSection === 'employees' ? `${personLabel} Management` : 
              activeSection === 'lookup' ? `${personLabel} Lookup` :
               activeSection === 'wallet' ? 'Wallet Recharge' :
              activeSection === 'scan' ? `RFID ${personLabel} Meal Scan` :
               activeSection === 'transactions' ? 'Transaction History' :
              activeSection === 'grade-division-master' ? 'Grade & Division Master' :
              activeSection === 'meal-categories' ? 'Meal Categories' :
              activeSection === 'monthly-plans' ? 'Monthly Meal Plans' :
              activeSection === 'meal-subscriptions' ? 'Meal Subscription Report' :
              activeSection === 'tuckshop' ? 'Tuckshop POS' :
              activeSection === 'reports' ? 'Payment Reports' :
               'Dashboard'}
            </h1>
          )}
        </div>

        <div className="content-body">
          {/* Alert Messages */}
          {alert.show && (
            <div className={`alert alert-${alert.type}`}>
              {alert.message}
            </div>
          )}

          {/* Insights Dashboard */}
          {activeSection === 'dashboard' && (
            <>
              <div className="insight-grid">
                <div className="insight-card kpi kpi-employees">
                  <div className="kpi-top">
                    <div className="kpi-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8Z" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M22 21v-2a3 3 0 0 0-2-2.82" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M17 3.18a4 4 0 0 1 0 7.64" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="kpi-pill">+0</div>
                  </div>
                  <h2>{totalEmployees.toLocaleString()}</h2>
                  <p className="kpi-label">Total {personLabelPlural}</p>
                  <span className="muted">Active profiles in system</span>
                </div>

                <div className="insight-card kpi kpi-wallet">
                  <div className="kpi-top">
                    <div className="kpi-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M3 7a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" strokeWidth="2" />
                        <path d="M3 9h18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M16.5 15h1.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="kpi-pill">+12%</div>
                  </div>
                  <h2>₹{totalWallet.toFixed(0).toLocaleString()}</h2>
                  <p className="kpi-label">Wallet Balance</p>
                  <span className="muted">Avg ₹{avgWallet.toFixed(0)} / {personLabel.toLowerCase()}</span>
                </div>

                <div className="insight-card kpi kpi-spend">
                  <div className="kpi-top">
                    <div className="kpi-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M6 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M6 11h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M9 21l6-10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <path d="M6 17h8a4 4 0 0 0 0-8H6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    </div>
                    <div className="kpi-pill">0%</div>
                  </div>
                  <h2>₹{spendToday.toFixed(2)}</h2>
                  <p className="kpi-label">Today's Spend</p>
                  <span className="muted">
                    {dashboardMealFilter ? `${dashboardMealFilter} spend on ${dashboardIso}` : `Total spend on ${dashboardIso}`}
                  </span>
                </div>

                <div className="insight-card kpi kpi-participation">
                  <div className="kpi-top">
                    <div className="kpi-ico" aria-hidden="true">
                      <svg viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M12 22c4 0 7-3 7-7 0-3-1.5-5.5-4-7.5.2 2.2-.6 3.7-2 5-1.6 1.4-2.8 2.7-2.8 4.8 0 2.7 1.9 4.7 4.8 4.7Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                        <path d="M10 12c-.6 1-.9 1.9-.9 3 0 1.8 1.1 3 2.9 3" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    </div>
                    <div className="kpi-pill">{participationPct}%</div>
                  </div>
                  <h2>
                    {participationCount} / {totalEmployees}
                  </h2>
                  <p className="kpi-label">Meal Participation</p>
                  <span className="muted">
                    {dashboardMealFilter 
                      ? `${dashboardMealFilter} visits on ${dashboardIso}` 
                      : `Unique visits on ${dashboardIso}`}
                  </span>
                </div>
              </div>

              <div className="chart-grid">
                <div className="chart-card">
                  <div className="chart-header">
                    <h3>Meal Distribution</h3>
                    <span className="muted">By count</span>
                  </div>
                  <div className="chart-body pie-wrap">
                    <div className="pie" style={pieStyle}>
                      <div className="pie-center">
                        <div className="pie-center-muted">Total</div>
                        <div className="pie-center-value">{mealTotal}</div>
                      </div>
                    </div>
                    <div className="legend">
                      {mealCounts.map((m, idx) => (
                        <div key={m.meal} className="legend-row">
                          <span className={`dot dot-${idx}`}></span>
                          <span>{m.meal}</span>
                          <span className="muted">{m.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="chart-card">
                  <div className="chart-header">
                    <div>
                      <h3>Spending Trends</h3>
                      <span className="muted">Spending vs Recharges</span>
                    </div>
                    <div className="trend-tabs" role="tablist" aria-label="Trend range">
                      <button
                        type="button"
                        className={`trend-tab ${trendRange === 'day' ? 'active' : ''}`}
                        onClick={() => setTrendRange('day')}
                      >
                        Day
                      </button>
                      <button
                        type="button"
                        className={`trend-tab ${trendRange === 'week' ? 'active' : ''}`}
                        onClick={() => setTrendRange('week')}
                      >
                        Week
                      </button>
                      <button
                        type="button"
                        className={`trend-tab ${trendRange === 'month' ? 'active' : ''}`}
                        onClick={() => setTrendRange('month')}
                      >
                        Month
                      </button>
                      <button
                        type="button"
                        className={`trend-tab ${trendRange === 'year' ? 'active' : ''}`}
                        onClick={() => setTrendRange('year')}
                      >
                        Year
                      </button>
                    </div>
                  </div>

                  <div className="trend-legend">
                    <div className="trend-legend-item">
                      <span className="trend-dot spend"></span>
                      <span>Spending</span>
                    </div>
                    <div className="trend-legend-item">
                      <span className="trend-dot recharge"></span>
                      <span>Recharges</span>
                    </div>
                  </div>

                  <div className="trend-chart">
                    <svg viewBox="0 0 560 200" preserveAspectRatio="none" aria-hidden="true">
                      {barGroups.map((g, i) => (
                        <g key={i}>
                          <rect x={g.xSpend} y={g.ySpend} width={g.width} height={g.hSpend} className="trend-bar spend" rx="2" />
                          <rect x={g.xRecharge} y={g.yRecharge} width={g.width} height={g.hRecharge} className="trend-bar recharge" rx="2" />
                        </g>
                      ))}
                    </svg>
                    <div className="trend-x">
                      {trendSeries.labels.map((l, i) => {
                        const show = trendRange === 'month' ? i % 5 === 0 : true;
                        return <span key={i} style={{ visibility: show ? 'visible' : 'hidden' }}>{l}</span>;
                      })}
                    </div>
                  </div>
                </div>
              </div>

            </>
          )}

          {/* Person Lookup */}
          {activeSection === 'lookup' && (
            <div>
              <div className="lookup-page">
                <div className="card lookup-card">
                  <div className="lookup-header">
                    <div>
                      <h2>Find {personLabel}</h2>
                      <p>Enter {personLabel} ID, RFID, or Name to view details.</p>
                    </div>
                    <button
                      type="button"
                      className="btn btn-danger btn-small"
                      onClick={() => {
                        setLookupTerm('');
                        setLookupSelectedId(null);
                      }}
                    >
                      Clear
                    </button>
                  </div>

                  <div className="lookup-grid">
                    <div className="form-group">
                      <label>Search ({personLabel} ID / RFID / Name)</label>
                      <input
                        type="text"
                        value={lookupTerm}
                        onChange={handleLookupChange}
                        placeholder={`Type ${personLabel} ID, RFID number, or name`}
                      />
                    </div>
                  </div>

                  <div className="lookup-meta">
                    {lookupTerm ? (
                      <span className="muted">Showing up to 20 matches. Matches: {lookupMatches.length}</span>
                    ) : (
                      <span className="muted">Start typing in any field to search.</span>
                    )}
                  </div>

                  {lookupMatches.length > 1 && (
                    <div className="lookup-results">
                      {lookupMatches.map((e) => (
                        <button
                          key={e.id}
                          type="button"
                          className={`lookup-row ${String(lookupSelectedId) === String(e.id) ? 'active' : ''}`}
                          onClick={() => setLookupSelectedId(e.id)}
                        >
                          <span className="lookup-name">{e.emp_name}</span>
                          <span className="lookup-sub muted">{e.emp_id} • {e.rfid_number}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                <div className="card lookup-detail">
                  <h2>{personLabel} Details</h2>

                  {lookupSelected ? (
                    <div className="lookup-detail-grid">
                      <div>
                        <span className="muted">{personLabel} Name</span>
                        <div className="lookup-value">{lookupSelected.emp_name}</div>
                      </div>
                      <div>
                        <span className="muted">{personLabel} ID</span>
                        <div className="lookup-value mono">{lookupSelected.emp_id}</div>
                      </div>
                      <div>
                        <span className="muted">RFID Number</span>
                        <div className="lookup-value mono">{lookupSelected.rfid_number}</div>
                      </div>
                      <div>
                        <span className="muted">{divisionLabel}</span>
                        <div className="lookup-value">{lookupSelected.division || lookupSelected.site_name || '—'}</div>
                      </div>
                      <div>
                        <span className="muted">{gradeLabel}</span>
                        <div className="lookup-value">{lookupSelected.grade || lookupSelected.shift || '—'}</div>
                      </div>
                      <div>
                        <span className="muted">Wallet Amount</span>
                        <div className="lookup-value">₹{parseFloat(lookupSelected.wallet_amount || 0).toFixed(2)}</div>
                      </div>
                    </div>
                  ) : (
                    <div className="muted" style={{ padding: '8px 0' }}>
                      {lookupTerm ? `No ${personLabel.toLowerCase()} selected. Choose a result above.` : `Enter search details to view ${personLabel.toLowerCase()} information.`}
                    </div>
                  )}
                </div>

                {lookupSelected && (
                  <div className="card lookup-history">
                    <h2>Transaction History</h2>
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Date</th>
                            <th>Time</th>
                            <th>Type</th>
                            <th>Amount</th>
                            <th>Balance</th>
                          </tr>
                        </thead>
                        <tbody>
                          {lookupTransactions.length === 0 ? (
                            <tr>
                              <td colSpan="5" className="empty-cell">No transactions found for this {personLabel.toLowerCase()}.</td>
                            </tr>
                          ) : (
                            lookupTransactions.map((t) => (
                              <tr key={t.id}>
                                <td>{t.transaction_date}</td>
                                <td>{t.transaction_time}</td>
                                <td>
                                  <span style={{
                                    padding: '4px 8px',
                                    borderRadius: '4px',
                                    fontSize: '12px',
                                    background: t.transaction_type === 'deduction' ? '#fff3cd' : '#d4edda',
                                    color: '#0f172a'
                                  }}>
                                    {t.meal_category || (t.transaction_type === 'deduction' ? 'Meal' : 'Recharge')}
                                  </span>
                                </td>
                                <td style={{ 
                                  color: t.transaction_type === 'deduction' ? '#dc2626' : '#16a34a',
                                  fontWeight: 'bold'
                                }}>
                                  {t.transaction_type === 'deduction' ? '-' : '+'}₹{parseFloat(t.amount || 0).toFixed(2)}
                                </td>
                                <td>{t.new_balance ? `₹${parseFloat(t.new_balance).toFixed(2)}` : '—'}</td>
                              </tr>
                            ))
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* RFID Scan Section */}
          {activeSection === 'scan' && (
            <>
            <div className="rfid-section">
              {/* Scan input panel */}
              <div className="rfid-panels">
                <div className="rfid-card rfid-wait-card">
                  <div className="rfid-wave">
                    <div className="rfid-wave-inner">📶</div>
                  </div>
                  <h3 className="rfid-wait-title">Waiting for Scan...</h3>
                  <p className="rfid-wait-sub">Place the {personLabel} RFID card near the reader or enter manually below.</p>
                  <form className="rfid-form" onSubmit={handleRfidScan}>
                    <label className="rfid-form-label">RFID / {personLabel} ID</label>
                    <div className="rfid-form-row">
                      <input
                        type="text"
                        id="rfidInput"
                        value={rfidInput}
                        onChange={(e) => setRfidInput(e.target.value)}
                        placeholder="Scan or type RFID here"
                        autoFocus
                        disabled={scanLoading}
                      />
                      <button
                        type="submit"
                        className="btn btn-primary"
                        disabled={scanLoading}
                        style={{ minWidth: '96px' }}
                      >
                        {scanLoading ? 'Scanning...' : 'Scan'}
                      </button>
                    </div>
                  </form>
                </div>

                {/* Result panel */}
                <div className={`rfid-card rfid-result-card ${scanStatus === 'allowed' ? 'result-allowed' : scanStatus === 'denied' ? 'result-denied' : ''}`}>
                  {scanStatus === 'idle' ? (
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', flex: 1, gap: 12, color: '#94a3b8', paddingTop: 24 }}>
                      <svg width="64" height="64" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ opacity: 0.4 }}>
                        <path d="M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2Z" stroke="currentColor" strokeWidth="1.5"/>
                        <path d="M10 19h4M9 6h6M7 9h10M7 12h10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"/>
                      </svg>
                      <p style={{ fontSize: 15, textAlign: 'center' }}>Scan a student card to see their meal plan</p>
                    </div>
                  ) : (
                    <>
                      {/* Status banner */}
                      <div style={{
                        borderRadius: 10,
                        padding: '10px 16px',
                        marginBottom: 14,
                        background: scanStatus === 'allowed' ? '#dcfce7' : '#fee2e2',
                        color: scanStatus === 'allowed' ? '#15803d' : '#dc2626',
                        fontWeight: 700,
                        fontSize: 16,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                      }}>
                        <span>{scanStatus === 'allowed' ? '✅' : '❌'}</span>
                        <span>{scanStatus === 'allowed' ? 'Access Granted' : 'Access Denied'}</span>
                      </div>

                      {/* Student name */}
                      <h2 className="rfid-emp-name" style={{ fontSize: 22, marginBottom: 4 }}>
                        {scannedEmployee?.name || scannedEmployee?.emp_name || '—'}
                      </h2>
                      <p className="rfid-emp-id" style={{ marginBottom: 12 }}>
                        ID: {scannedEmployee?.emp_id || '—'} &nbsp;|&nbsp; RFID: {scannedEmployee?.rfid || '—'}
                      </p>

                      {/* Meal Plan — most prominent */}
                      {scanStatus === 'allowed' && (
                        <div style={{
                          background: 'linear-gradient(135deg, #6c5ce7, #0984e3)',
                          color: '#fff',
                          borderRadius: 12,
                          padding: '14px 20px',
                          textAlign: 'center',
                          marginBottom: 14,
                        }}>
                          <div style={{ fontSize: 12, opacity: 0.85, marginBottom: 4, letterSpacing: 1 }}>MEAL PLAN TO SERVE</div>
                          <div style={{ fontSize: 26, fontWeight: 800 }}>
                            {lastTransaction?.meal_plan || lastTransaction?.meal_category || '—'}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.8, marginTop: 4 }}>
                            {lastTransaction?.date || lastTransaction?.transaction_date || ''} &nbsp;{(lastTransaction?.time || lastTransaction?.transaction_time || '').slice(0, 5)}
                          </div>
                        </div>
                      )}

                      {/* Deny reason */}
                      {scanStatus === 'denied' && denyReason && (
                        <div style={{
                          background: '#fff1f2',
                          border: '1px solid #fecdd3',
                          borderRadius: 10,
                          padding: '12px 14px',
                          color: '#9f1239',
                          fontSize: 14,
                          marginBottom: 14,
                        }}>
                          <strong>Reason: </strong>{denyReason}
                        </div>
                      )}

                      {/* Student badges */}
                      <div className="rfid-badges">
                        <div className="rfid-badge">
                          <span className="badge-label">{gradeLabel}</span>
                          <span className="badge-value">{scannedEmployee?.grade || scannedEmployee?.shift || '—'}</span>
                        </div>
                        <div className="rfid-badge">
                          <span className="badge-label">{divisionLabel}</span>
                          <span className="badge-value">{scannedEmployee?.division || scannedEmployee?.site || scannedEmployee?.site_name || '—'}</span>
                        </div>
                      </div>

                      <button type="button" className="btn btn-secondary" style={{ marginTop: 16 }} onClick={clearScanState}>
                        Clear / Next Student
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>

            {/* Recent Scan Records */}
            <div className="master-card" style={{ marginTop: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                <div>
                  <p className="master-card-title">Recent Meal Scan Records</p>
                  <p className="master-card-sub">Last 20 canteen access entries for this school</p>
                </div>
                <button type="button" className="btn btn-secondary btn-small" onClick={loadScanHistory}>Refresh</button>
              </div>
              <div className="price-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Date</th>
                      <th>Time</th>
                      <th>Student</th>
                      <th>RFID</th>
                      <th>Meal Plan</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanHistory.length === 0 ? (
                      <tr><td colSpan="6" style={{ textAlign: 'center', color: '#94a3b8', padding: 18 }}>No scan records yet. Records appear after students scan their RFID cards.</td></tr>
                    ) : scanHistory.map((row) => (
                      <tr key={row.id}>
                        <td>{row.transaction_date}</td>
                        <td style={{ fontSize: 12, color: '#64748b' }}>{row.transaction_time ? String(row.transaction_time).slice(0, 5) : '—'}</td>
                        <td><strong>{row.emp_name || '—'}</strong><div style={{ fontSize: 11, color: '#64748b' }}>{row.emp_id}</div></td>
                        <td className="mono" style={{ fontSize: 12 }}>{row.rfid_number || '—'}</td>
                        <td>{row.meal_category || '—'}</td>
                        <td>
                          <span className={`status-pill ${row.transaction_type === 'canteen_denied' ? 'status-cancelled' : 'status-delivered'}`}>
                            {row.transaction_type === 'canteen_denied' ? 'Denied' : 'Allowed'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            </>
          )}

          {/* Wallet Recharge Section */}
          {activeSection === 'wallet' && (
            <div className="wallet-section">
              <div className="wallet-header card">
                <div className="wallet-tabs">
                  <button
                    className={`wallet-tab ${walletMode === 'single' ? 'active' : ''}`}
                    onClick={() => setWalletMode('single')}
                  >
                    Single Recharge
                  </button>
                  <button
                    className={`wallet-tab ${walletMode === 'bulk' ? 'active' : ''}`}
                    onClick={() => setWalletMode('bulk')}
                  >
                    Bulk Recharge
                  </button>
                </div>
              </div>

              {walletMode === 'bulk' ? (
                <div className="card wallet-bulk">
                  <div className="bulk-icon">👥</div>
                  <h2>Mass Recharge</h2>
                  <p className="bulk-sub">The amount specified below will be added to every registered employee's wallet instantly.</p>

                  <div className="bulk-field">
                    <label htmlFor="bulkAmount">Amount to add to all (₹)</label>
                    <div className="input-row">
                      <input
                        type="number"
                        id="bulkAmount"
                        value={bulkRechargeAmount}
                        onChange={(e) => setBulkRechargeAmount(e.target.value)}
                        placeholder="₹ 0.00"
                        step="0.01"
                        min="0"
                      />
                    </div>
                    <div className="chip-row">
                      {[50, 2100, 2200, 2500].map((amt) => (
                        <button key={amt} type="button" className="chip" onClick={() => setBulkRechargeAmount(String(amt))}>
                          ₹{amt}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="bulk-warning">
                    <strong>⚠️</strong>
                    <span>This action will affect all employees in the system. Please double-check the amount before processing.</span>
                  </div>

                  <button className="btn btn-primary bulk-submit" onClick={bulkRechargeWallets}>
                    ⚡ Recharge All IDs
                  </button>
                </div>
              ) : (
                <>
                  <div className="wallet-grid">
                    <div className="card wallet-card">
                      {!searchedEmployee ? (
                        <>
                          <h3>Find Employee</h3>
                          <div className="search-field">
                            <label htmlFor="searchQuery">Scan RFID or ID</label>
                            <div className="input-row">
                              <input
                                type="text"
                                id="searchQuery"
                                value={searchQuery}
                                onChange={(e) => setSearchQuery(e.target.value)}
                                placeholder="Scan RFID or enter ID"
                                onKeyDown={(e) => e.key === 'Enter' && searchEmployee()}
                              />
                            </div>
                          </div>
                          <div className="wallet-actions-row">
                            <button className="btn btn-secondary" onClick={searchEmployee}>Scan RFID</button>
                            <button className="btn btn-primary" onClick={searchEmployee}>Search</button>
                          </div>
                        </>
                      ) : (
                        <>
                          <h3>Employee Found</h3>
                          <p className="muted" style={{ marginBottom: 12 }}>
                            {searchedEmployee.emp_name} • {searchedEmployee.emp_id}
                          </p>
                          <button
                            className="btn btn-primary"
                            style={{ width: '100%', marginBottom: 12 }}
                            onClick={() => setShowRechargeForm(true)}
                          >
                            Recharge
                          </button>

                          {showRechargeForm && (
                            <div className="recharge-panel">
                              <h3>Recharge Details</h3>
                              <div className="search-field">
                                <label htmlFor="rechargeAmount">Amount (₹)</label>
                                <div className="input-row">
                                  <input
                                    type="number"
                                    id="rechargeAmount"
                                    value={rechargeAmount}
                                    onChange={(e) => setRechargeAmount(e.target.value)}
                                    placeholder="₹ 0.00"
                                    step="0.01"
                                    min="0"
                                  />
                                </div>
                                <div className="chip-row">
                                  {[100, 500, 1000, 2000].map((amt) => (
                                    <button key={amt} type="button" className="chip" onClick={() => setRechargeAmount(String(amt))}>
                                      + ₹{amt}
                                    </button>
                                  ))}
                                </div>
                              </div>
                              <div className="wallet-actions-row">
                                <button className="btn btn-primary" onClick={rechargeIndividualWallet} disabled={!rechargeAmount}>
                                  ✓ Process Recharge
                                </button>
                                <button className="btn btn-danger" onClick={() => setRechargeAmount('')}>
                                  Reset
                                </button>
                              </div>
                            </div>
                          )}

                          <div className="wallet-actions-row" style={{ marginTop: 10 }}>
                            <button
                              className="btn btn-secondary"
                              onClick={() => {
                                setSearchedEmployee(null);
                                setRechargeAmount('');
                                setSearchQuery('');
                                setShowRechargeForm(false);
                              }}
                            >
                              Change Employee
                            </button>
                          </div>
                        </>
                      )}
                    </div>

                    <div className="card wallet-summary">
                      {searchedEmployee ? (
                        <div className="summary-content">
                          <div className="summary-header">
                            <div className="summary-avatar">
                              {getInitials(searchedEmployee.emp_name)}
                            </div>
                            <div className="summary-info">
                              <div className="summary-name">{searchedEmployee.emp_name}</div>
                              <div className="summary-sub">{searchedEmployee.emp_id}</div>
                            </div>
                            <span className="status-pill status-delivered">Active</span>
                          </div>

                          <div className="summary-balance-card">
                            <span className="balance-label">Wallet Balance</span>
                            <div className="summary-balance">
                              ₹{parseFloat(searchedEmployee.wallet_amount || 0).toFixed(2)}
                            </div>
                          </div>

                          <div className="summary-details-grid">
                            <div className="detail-item">
                              <span className="detail-label">Site Location</span>
                              <span className="detail-value">{searchedEmployee.site_name}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">RFID Number</span>
                              <span className="detail-value mono">{searchedEmployee.rfid_number}</span>
                            </div>
                            <div className="detail-item">
                              <span className="detail-label">Shift</span>
                              <span className="detail-value">{searchedEmployee.shift || '—'}</span>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="summary-placeholder">
                           <div className="placeholder-icon">👤</div>
                           <h3>No Employee Selected</h3>
                           <p>Search for an employee on the left to view their details and process recharges.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {recentRecharges.length > 0 && (
                    <div className="card wallet-recent">
                      <div className="recent-header">
                        <div>
                          <h3>Recent Recharges</h3>
                          <p>Latest wallet top-ups.</p>
                        </div>
                      </div>
                      <div className="wallet-table">
                        <div className="wallet-row head">
                          <span>Txn ID</span>
                          <span>Employee</span>
                          <span>Amount</span>
                          <span>Method</span>
                          <span>Status</span>
                        </div>
                        {recentRecharges.map((t) => (
                          <div key={t.id} className="wallet-row">
                            <span>#{t.id}</span>
                            <span>
                              <strong>{t.emp_name}</strong>
                              <small style={{ display: 'block', color: '#6b7280' }}>{t.emp_id}</small>
                            </span>
                            <span className="recharge-amount">+ ₹{parseFloat(t.amount || 0).toFixed(2)}</span>
                            <span>{t.payment_method || '—'}</span>
                            <span><span className="status-pill status-delivered">{t.order_status || 'Success'}</span></span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
          )}

          {/* Grade & Division Master */}
          {!isSecurity && activeSection === 'grade-division-master' && (
            <div className="master-config-page">
              <div className="master-config-grid">
                <div className="master-card">
                  <div>
                    <p className="master-card-title">Grade / Standard</p>
                    <p className="master-card-sub">Add grade levels available in your school (e.g. 1, 2 … 12)</p>
                  </div>
                  <hr className="section-divider" />
                  <div className="master-add-row">
                    <input
                      type="text"
                      value={newGrade}
                      onChange={(e) => setNewGrade(e.target.value)}
                      placeholder="e.g. 8"
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-with-icon"
                      onClick={async () => { await createMasterItem('grade', newGrade); setNewGrade(''); }}
                    >
                      + Add
                    </button>
                  </div>
                  <div className="chip-row">
                    {gradeOptions.length === 0
                      ? <span style={{ fontSize: 13, color: '#94a3b8' }}>No grades added yet</span>
                      : [...new Map(gradeOptions.map(g => [g.value, g])).values()].map((g) => (
                          <span key={g.id || g.value} className="chip chip-deletable">
                            {g.value}
                            <button
                              type="button"
                              className="chip-delete-btn"
                              onClick={() => deleteMasterItem('grade', g.id)}
                              aria-label={`Delete grade ${g.value}`}
                            >×</button>
                          </span>
                        ))
                    }
                  </div>
                </div>

                <div className="master-card">
                  <div>
                    <p className="master-card-title">Division / Section</p>
                    <p className="master-card-sub">Add division labels available in your school (e.g. A, B, C)</p>
                  </div>
                  <hr className="section-divider" />
                  <div className="master-add-row">
                    <input
                      type="text"
                      value={newDivision}
                      onChange={(e) => setNewDivision(e.target.value)}
                      placeholder="e.g. A"
                    />
                    <button
                      type="button"
                      className="btn btn-primary btn-with-icon"
                      onClick={async () => { await createMasterItem('division', newDivision); setNewDivision(''); }}
                    >
                      + Add
                    </button>
                  </div>
                  <div className="chip-row">
                    {divisionOptions.length === 0
                      ? <span style={{ fontSize: 13, color: '#94a3b8' }}>No divisions added yet</span>
                      : [...new Map(divisionOptions.map(d => [d.value, d])).values()].map((d) => (
                          <span key={d.id || d.value} className="chip chip-deletable">
                            {d.value}
                            <button
                              type="button"
                              className="chip-delete-btn"
                              onClick={() => deleteMasterItem('division', d.id)}
                              aria-label={`Delete division ${d.value}`}
                            >×</button>
                          </span>
                        ))
                    }
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Meal Categories Section */}
          {!isSecurity && activeSection === 'meal-categories' && (
            <div className="master-config-page">
              <div className="master-config-grid" style={{ gridTemplateColumns: '1fr 2fr' }}>
                <div className="master-card">
                  <p className="master-card-title">{editingCategoryId ? 'Edit Category' : 'Add / Edit Category'}</p>
                  <p className="master-card-sub">Define meal categories with their access time window</p>
                  <hr className="section-divider" />
                  <form onSubmit={saveCategory} className="price-form-inline">
                    <div className="form-group" style={{ gridColumn: '1 / -1' }}>
                      <label>Category Name</label>
                      <input
                        type="text"
                        value={categoryForm.category_name}
                        onChange={(e) => setCategoryForm((p) => ({ ...p, category_name: e.target.value }))}
                        placeholder="e.g. Breakfast, Lunch, Dinner"
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>Start Time</label>
                      <input
                        type="time"
                        value={categoryForm.start_time}
                        onChange={(e) => setCategoryForm((p) => ({ ...p, start_time: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group">
                      <label>End Time</label>
                      <input
                        type="time"
                        value={categoryForm.end_time}
                        onChange={(e) => setCategoryForm((p) => ({ ...p, end_time: e.target.value }))}
                        required
                      />
                    </div>
                    <div className="form-group" style={{ alignSelf: 'end' }}>
                      <button type="submit" className="btn btn-primary">{editingCategoryId ? 'Update Category' : 'Save Category'}</button>
                      {editingCategoryId && (
                        <button type="button" className="btn btn-secondary" style={{ marginLeft: 6 }} onClick={() => { setEditingCategoryId(null); setCategoryForm({ category_name: '', start_time: '', end_time: '' }); }}>Cancel</button>
                      )}
                    </div>
                  </form>
                </div>

                <div className="master-card">
                  <p className="master-card-title">Meal Categories</p>
                  <p className="master-card-sub">Categories define which time window a meal plan is accessible</p>
                  <hr className="section-divider" />
                  <div className="price-table-wrap">
                    <table>
                      <thead>
                        <tr>
                          <th>Category Name</th>
                          <th>Access From</th>
                          <th>Access Until</th>
                          <th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {mealCategories.length === 0 ? (
                          <tr><td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8', padding: 18 }}>No categories yet</td></tr>
                        ) : mealCategories.map((cat) => (
                          <tr key={cat.id}>
                            <td style={{ fontWeight: 700 }}>{cat.category_name}</td>
                            <td>{cat.start_time ? cat.start_time.slice(0, 5) : '—'}</td>
                            <td>{cat.end_time ? cat.end_time.slice(0, 5) : '—'}</td>
                            <td style={{ display: 'flex', gap: 6 }}>
                              <button type="button" className="btn btn-secondary btn-small" onClick={() => { setEditingCategoryId(cat.id); setCategoryForm({ category_name: cat.category_name, start_time: cat.start_time ? cat.start_time.slice(0,5) : '', end_time: cat.end_time ? cat.end_time.slice(0,5) : '' }); }}>Edit</button>
                              <button type="button" className="btn btn-delete btn-small" onClick={() => deleteCategory(cat.id)}>Delete</button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Monthly Meal Plans Section */}
          {!isSecurity && activeSection === 'monthly-plans' && (
            <div className="master-config-page">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>

                {/* Add / Edit Form */}
                <div className="master-card">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <p className="master-card-title">
                        {csvMode ? 'Bulk Import Plans' : 'Set Monthly Price'}
                      </p>
                      <p className="master-card-sub">
                        {csvMode ? 'Upload a CSV file to create meal plans in bulk' : 'Define meal plan price for a specific month'}
                      </p>
                    </div>
                    <div style={{ display: 'flex', gap: 6 }}>
                      <button type="button" className={`btn btn-small ${!csvMode ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => { setBulkMode(false); setCsvMode(false); }}>Single</button>
                      <button type="button" className={`btn btn-small ${csvMode ? 'btn-primary' : 'btn-secondary'}`}
                        onClick={() => { setCsvMode(true); setBulkMode(false); }}>📂 Bulk Import</button>
                    </div>
                  </div>
                  <hr className="section-divider" />

                  {/* Year selector shared by all modes */}
                  <div className="form-group" style={{ marginBottom: 12 }}>
                    <label>Year</label>
                    <input
                      type="number" min="2020" max="2099"
                      value={monthlyPlanYear}
                      onChange={(e) => { setMonthlyPlanYear(parseInt(e.target.value, 10) || new Date().getFullYear()); setPlanPage(1); }}
                      style={{ width: 100 }}
                    />
                  </div>

                  {csvMode ? (
                    <div>
                      <div className="form-group">
                        <label>Upload CSV File</label>
                        <p style={{ fontSize: 12, color: '#64748b', marginBottom: 8 }}>
                          Format: <strong>Meal Plan, Month, Student Grade, Year, Price</strong>
                        </p>
                        <input type="file" accept=".csv,text/csv" onChange={handleCsvFileChange} style={{ display: 'block', marginBottom: 12 }} />
                      </div>
                      {csvRows.length > 0 && (
                        <>
                          <p style={{ fontSize: 13, fontWeight: 600, color: '#1e293b', marginBottom: 8 }}>
                            {csvRows.length} plans parsed — preview:
                          </p>
                          <div style={{ maxHeight: 260, overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                              <thead style={{ position: 'sticky', top: 0, background: '#f1f5f9' }}>
                                <tr>
                                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Meal Plan</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Month</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Year</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Grade</th>
                                  <th style={{ padding: '6px 8px', textAlign: 'left' }}>Price (₹)</th>
                                </tr>
                              </thead>
                              <tbody>
                                {csvRows.map((row, i) => {
                                  const mn = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                                  return (
                                    <tr key={i} style={{ borderTop: '1px solid #f1f5f9' }}>
                                      <td style={{ padding: '4px 8px' }}>{row.meal_type_name}</td>
                                      <td style={{ padding: '4px 8px' }}>{mn[row.month - 1]}</td>
                                      <td style={{ padding: '4px 8px' }}>{row.year}</td>
                                      <td style={{ padding: '4px 8px' }}>{row.grade || 'All'}</td>
                                      <td style={{ padding: '4px 8px', fontWeight: 700 }}>₹{row.price.toFixed(2)}</td>
                                    </tr>
                                  );
                                })}
                              </tbody>
                            </table>
                          </div>
                          <div style={{ marginTop: 12, display: 'flex', gap: 8 }}>
                            <button type="button" className="btn btn-primary" onClick={importCsvPlans} disabled={csvImporting}>
                              {csvImporting ? 'Importing…' : `Import ${csvRows.length} Plans`}
                            </button>
                            <button type="button" className="btn btn-secondary" onClick={() => setCsvRows([])}>Clear</button>
                          </div>
                        </>
                      )}
                    </div>
                  ) : !bulkMode ? (
                    <form onSubmit={saveMonthlyPlan} className="price-form-inline">
                      <div className="form-group">
                        <label>Meal Type</label>
                        <input
                          type="text"
                          value={monthlyPlanForm.meal_type_name}
                          onChange={(e) => setMonthlyPlanForm((p) => ({ ...p, meal_type_name: e.target.value }))}
                          placeholder="e.g. Breakfast With Veg"
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Month</label>
                        <select
                          value={monthlyPlanForm.month}
                          onChange={(e) => setMonthlyPlanForm((p) => ({ ...p, month: e.target.value }))}
                          required
                        >
                          <option value="">Select Month</option>
                          {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                            <option key={i + 1} value={i + 1}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Price (₹ / student)</label>
                        <input
                          type="number" min="0" step="0.01"
                          value={monthlyPlanForm.price}
                          onChange={(e) => setMonthlyPlanForm((p) => ({ ...p, price: e.target.value }))}
                          placeholder="e.g. 1250"
                          required
                        />
                      </div>
                      <div className="form-group">
                        <label>Grade (optional, blank = all grades)</label>
                        <select
                          value={monthlyPlanForm.grade}
                          onChange={(e) => setMonthlyPlanForm((p) => ({ ...p, grade: e.target.value }))}
                        >
                          <option value="">All Grades</option>
                          {[...new Map(gradeOptions.map(g => [g.value, g])).values()].map((g) => (
                            <option key={g.value} value={g.value}>{g.value}</option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label>Category (access time)</label>
                        <select
                          value={monthlyPlanForm.category_id}
                          onChange={(e) => setMonthlyPlanForm((p) => ({ ...p, category_id: e.target.value }))}
                        >
                          <option value="">— No restriction —</option>
                          {mealCategories.map((cat) => (
                            <option key={cat.id} value={cat.id}>
                              {cat.category_name} ({cat.start_time ? cat.start_time.slice(0,5) : ''} – {cat.end_time ? cat.end_time.slice(0,5) : ''})
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group" style={{ alignSelf: 'end' }}>
                        <button type="submit" className="btn btn-primary">Save Plan</button>
                      </div>
                    </form>
                  ) : (
                    <form onSubmit={saveBulkPlans}>
                      <div style={{ overflowX: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                          <thead>
                            <tr style={{ background: '#f1f5f9' }}>
                              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Meal Type</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Month</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Price (₹)</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Grade</th>
                              <th style={{ padding: '6px 8px', textAlign: 'left' }}>Category</th>
                              <th style={{ padding: '6px 4px' }}></th>
                            </tr>
                          </thead>
                          <tbody>
                            {bulkRows.map((row, idx) => (
                              <tr key={idx}>
                                <td style={{ padding: '4px 4px' }}>
                                  <input
                                    type="text"
                                    value={row.meal_type_name}
                                    onChange={(e) => setBulkRows((rows) => rows.map((r, i) => i === idx ? { ...r, meal_type_name: e.target.value } : r))}
                                    style={{ width: 130 }}
                                    placeholder="Meal name"
                                  />
                                </td>
                                <td style={{ padding: '4px 4px' }}>
                                  <select
                                    value={row.month}
                                    onChange={(e) => setBulkRows((rows) => rows.map((r, i) => i === idx ? { ...r, month: e.target.value } : r))}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="">—</option>
                                    {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, mi) => (
                                      <option key={mi + 1} value={mi + 1}>{m}</option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '4px 4px' }}>
                                  <input
                                    type="number" min="0" step="0.01"
                                    value={row.price}
                                    onChange={(e) => setBulkRows((rows) => rows.map((r, i) => i === idx ? { ...r, price: e.target.value } : r))}
                                    style={{ width: 80 }}
                                    placeholder="0"
                                  />
                                </td>
                                <td style={{ padding: '4px 4px' }}>
                                  <select
                                    value={row.grade}
                                    onChange={(e) => setBulkRows((rows) => rows.map((r, i) => i === idx ? { ...r, grade: e.target.value } : r))}
                                    style={{ width: 90 }}
                                  >
                                    <option value="">All</option>
                                    {[...new Map(gradeOptions.map(g => [g.value, g])).values()].map((g) => (
                                      <option key={g.value} value={g.value}>{g.value}</option>
                                    ))}
                                  </select>
                                </td>
                                <td style={{ padding: '4px 4px' }}>
                                  <select
                                    value={row.category_id}
                                    onChange={(e) => setBulkRows((rows) => rows.map((r, i) => i === idx ? { ...r, category_id: e.target.value } : r))}
                                    style={{ width: '100%' }}
                                  >
                                    <option value="">—</option>
                                    {mealCategories.map((cat) => <option key={cat.id} value={cat.id}>{cat.category_name}</option>)}
                                  </select>
                                </td>
                                <td style={{ padding: '4px 2px' }}>
                                  <button type="button" className="btn btn-delete btn-small"
                                    onClick={() => setBulkRows((rows) => rows.length > 1 ? rows.filter((_, i) => i !== idx) : rows)}>✕</button>
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
                        <button type="button" className="btn btn-secondary btn-small"
                          onClick={() => setBulkRows((rows) => [...rows, { meal_type_name: '', month: '', price: '', grade: '', category_id: '' }])}>
                          + Add Row
                        </button>
                        <button type="submit" className="btn btn-primary">Import All</button>
                      </div>
                    </form>
                  )}
                </div>

                {/* Plans Table */}
                {(() => {
                  const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                  const filtered = planCatFilter
                    ? monthlyPlans.filter((p) => String(p.category_id || '') === planCatFilter)
                    : monthlyPlans;
                  const paginated = filtered.slice(0, planPage * planPageSize);
                  return (
                    <div className="master-card">
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 10 }}>
                        <div>
                          <p className="master-card-title">Monthly Plans — {monthlyPlanYear}</p>
                          <p className="master-card-sub">Prices parents will pay per meal type per month</p>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                          {selectedPlanIds.size > 0 && (
                            <button type="button" className="btn btn-delete btn-small" onClick={bulkDeletePlans}>
                              🗑 Delete Selected ({selectedPlanIds.size})
                            </button>
                          )}
                          <select
                            value={planCatFilter}
                            onChange={(e) => { setPlanCatFilter(e.target.value); setPlanPage(1); }}
                            style={{ fontSize: 13, padding: '4px 8px', borderRadius: 6, border: '1px solid #e2e8f0' }}
                          >
                            <option value="">All Categories</option>
                            {mealCategories.map((cat) => <option key={cat.id} value={String(cat.id)}>{cat.category_name}</option>)}
                            <option value="none">No Category</option>
                          </select>
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setMonthlyPlanYear((y) => { setPlanPage(1); return y - 1; })}>‹ Prev</button>
                          <span style={{ fontWeight: 700 }}>{monthlyPlanYear}</span>
                          <button type="button" className="btn btn-secondary btn-small" onClick={() => setMonthlyPlanYear((y) => { setPlanPage(1); return y + 1; })}>Next ›</button>
                        </div>
                      </div>
                      <hr className="section-divider" />
                      <div className="price-table-wrap">
                        <table>
                          <thead>
                            <tr>
                              <th style={{ width: 32 }}>
                                <input type="checkbox"
                                  checked={filtered.length > 0 && filtered.every((p) => selectedPlanIds.has(p.id))}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedPlanIds(new Set(filtered.map((p) => p.id)));
                                    else setSelectedPlanIds(new Set());
                                  }}
                                  title="Select all visible"
                                />
                              </th>
                              <th>Month</th>
                              <th>Meal Type</th>
                              <th>Grade</th>
                              <th>Price (₹)</th>
                              <th>Category</th>
                              <th>Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {filtered.length === 0 ? (
                              <tr><td colSpan="7" style={{ textAlign: 'center', color: '#94a3b8', padding: '18px' }}>No plans found for {monthlyPlanYear}</td></tr>
                            ) : (
                              paginated.map((plan) => {
                                const isEditing = editingPlanId === plan.id;
                                if (isEditing) {
                                  return (
                                    <tr key={plan.id} style={{ background: '#fffbeb' }}>
                                      <td>
                                        <select value={editingPlanData.month} onChange={(e) => setEditingPlanData((p) => ({ ...p, month: e.target.value }))} style={{ width: 70 }}>
                                          {monthNames.map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
                                        </select>
                                      </td>
                                      <td>
                                        <input type="text" value={editingPlanData.meal_type_name} onChange={(e) => setEditingPlanData((p) => ({ ...p, meal_type_name: e.target.value }))} style={{ width: 140 }} />
                                      </td>
                                      <td>
                                        <select value={editingPlanData.grade} onChange={(e) => setEditingPlanData((p) => ({ ...p, grade: e.target.value }))} style={{ width: 80 }}>
                                          <option value="">All</option>
                                          {[...new Map(gradeOptions.map(g => [g.value, g])).values()].map((g) => <option key={g.value} value={g.value}>{g.value}</option>)}
                                        </select>
                                      </td>
                                      <td>
                                        <input type="number" min="0" step="0.01" value={editingPlanData.price} onChange={(e) => setEditingPlanData((p) => ({ ...p, price: e.target.value }))} style={{ width: 90 }} />
                                      </td>
                                      <td>
                                        <select value={editingPlanData.category_id} onChange={(e) => setEditingPlanData((p) => ({ ...p, category_id: e.target.value }))} style={{ width: 120 }}>
                                          <option value="">— None —</option>
                                          {mealCategories.map((cat) => <option key={cat.id} value={String(cat.id)}>{cat.category_name}</option>)}
                                        </select>
                                      </td>
                                      <td style={{ display: 'flex', gap: 4 }}>
                                        <button type="button" className="btn btn-primary btn-small" onClick={() => saveEditPlan(plan.id)}>Save</button>
                                        <button type="button" className="btn btn-secondary btn-small" onClick={() => setEditingPlanId(null)}>Cancel</button>
                                      </td>
                                    </tr>
                                  );
                                }
                                const isInactive = !parseInt(plan.is_active);
                                return (
                                  <tr key={plan.id} style={{ background: selectedPlanIds.has(plan.id) ? '#fef9ec' : isInactive ? '#f8fafc' : '', opacity: isInactive ? 0.6 : 1 }}>
                                    <td>
                                      <input type="checkbox"
                                        checked={selectedPlanIds.has(plan.id)}
                                        onChange={(e) => {
                                          setSelectedPlanIds((prev) => {
                                            const n = new Set(prev);
                                            if (e.target.checked) n.add(plan.id); else n.delete(plan.id);
                                            return n;
                                          });
                                        }}
                                      />
                                    </td>
                                    <td style={{ fontWeight: 700 }}>{monthNames[(plan.month || 1) - 1]}</td>
                                    <td>{plan.meal_name}</td>
                                    <td>{plan.grade || 'All Grades'}</td>
                                    <td style={{ fontWeight: 800, color: isInactive ? '#94a3b8' : '#16a34a' }}>₹{parseFloat(plan.price || 0).toFixed(2)}</td>
                                    <td style={{ fontSize: 13, color: '#475569' }}>
                                      {plan.category_name
                                        ? `${plan.category_name} (${(plan.start_time || '').slice(0,5)} – ${(plan.end_time || '').slice(0,5)})`
                                        : <span style={{ color: '#94a3b8' }}>No restriction</span>}
                                    </td>
                                    <td style={{ display: 'flex', gap: 4 }}>
                                      <button
                                        type="button"
                                        className={`btn btn-small ${isInactive ? 'btn-secondary' : 'btn-primary'}`}
                                        title={isInactive ? 'Activate — makes visible to parents' : 'Deactivate — hides from parents'}
                                        onClick={() => togglePlanActive(plan.id, !isInactive)}
                                        style={{ minWidth: 72, fontSize: 11 }}
                                      >
                                        {isInactive ? '▶ Activate' : '⏸ Active'}
                                      </button>
                                      <button type="button" className="btn btn-secondary btn-small" onClick={() => startEditPlan(plan)}>Edit</button>
                                      <button type="button" className="btn btn-delete btn-small" onClick={() => deleteMonthlyPlan(plan.id)}>Delete</button>
                                    </td>
                                  </tr>
                                );
                              })
                            )}
                          </tbody>
                        </table>
                      </div>
                      {paginated.length < filtered.length && (
                        <div style={{ textAlign: 'center', marginTop: 14 }}>
                          <button type="button" className="btn btn-secondary"
                            onClick={() => setPlanPage((p) => p + 1)}>
                            Load More ({filtered.length - paginated.length} remaining)
                          </button>
                        </div>
                      )}
                      <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 8 }}>
                        Showing {Math.min(paginated.length, filtered.length)} of {filtered.length} plans
                      </div>
                    </div>
                  );
                })()}
              </div>
            </div>
          )}

          {/* Meal Subscription Report Section */}
          {!isSecurity && activeSection === 'meal-subscriptions' && (
            <div className="master-config-page">
              <div className="master-card" style={{ gridColumn: '1 / -1' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
                  <div>
                    <p className="master-card-title">Meal Plan Subscriptions</p>
                    <p className="master-card-sub">View all student meal plan subscriptions</p>
                  </div>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                    <select
                      value={subReportMonth}
                      onChange={(e) => setSubReportMonth(e.target.value)}
                      style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid #e2e8f0', fontSize: 14 }}
                    >
                      <option value="">All Months</option>
                      {['January','February','March','April','May','June','July','August','September','October','November','December'].map((m, i) => (
                        <option key={i + 1} value={i + 1}>{m}</option>
                      ))}
                    </select>
                    <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setSubReportYear((y) => y - 1)}>‹</button>
                      <input
                        type="number" min="2020" max="2099"
                        value={subReportYear}
                        onChange={(e) => setSubReportYear(parseInt(e.target.value) || new Date().getFullYear())}
                        style={{ width: 70, textAlign: 'center', padding: '4px', borderRadius: 6, border: '1px solid #e2e8f0', fontWeight: 700 }}
                      />
                      <button type="button" className="btn btn-secondary btn-small" onClick={() => setSubReportYear((y) => y + 1)}>›</button>
                    </div>
                    <button type="button" className="btn btn-primary btn-small" onClick={loadSubscriptionReport}>
                      {subReportLoading ? 'Loading…' : 'Refresh'}
                    </button>
                  </div>
                </div>
                <hr className="section-divider" />
                <div className="price-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>Student ID</th>
                        <th>Grade</th>
                        <th>Division</th>
                        <th>Meal Plan</th>
                        <th>Month</th>
                        <th>Year</th>
                        <th>Amount Paid</th>
                        <th>Status</th>
                        <th>Subscribed On</th>
                      </tr>
                    </thead>
                    <tbody>
                      {subReportLoading ? (
                        <tr><td colSpan="10" style={{ textAlign: 'center', padding: 20 }}>Loading…</td></tr>
                      ) : subscriptionReport.length === 0 ? (
                        <tr><td colSpan="10" style={{ textAlign: 'center', color: '#94a3b8', padding: 20 }}>No subscriptions found</td></tr>
                      ) : (
                        subscriptionReport.map((row) => {
                          const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
                          return (
                            <tr key={row.id}>
                              <td style={{ fontWeight: 600 }}>{row.student_name}</td>
                              <td>{row.student_code}</td>
                              <td>{row.grade || '—'}</td>
                              <td>{row.division || '—'}</td>
                              <td>{row.meal_type_name}</td>
                              <td>{monthNames[(row.month || 1) - 1]}</td>
                              <td>{row.year}</td>
                              <td style={{ fontWeight: 700, color: '#16a34a' }}>₹{parseFloat(row.amount_paid || 0).toFixed(2)}</td>
                              <td>
                                <span style={{
                                  padding: '2px 8px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                                  background: row.status === 'Active' ? '#d1fae5' : '#fee2e2',
                                  color: row.status === 'Active' ? '#065f46' : '#991b1b'
                                }}>{row.status}</span>
                              </td>
                              <td style={{ fontSize: 12, color: '#64748b' }}>{row.subscribed_at ? new Date(row.subscribed_at).toLocaleDateString('en-IN') : '—'}</td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>
                {subscriptionReport.length > 0 && (
                  <p style={{ marginTop: 10, fontSize: 13, color: '#64748b' }}>
                    Total: <strong>{subscriptionReport.length}</strong> subscription(s)
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Employee Management Section */}
          {activeSection === 'employees' && (
            <>
              {(() => {
                const query = employeeSearch.trim().toLowerCase();
                const filteredEmployees = employees.filter((e) => {
                  if (employeeGradeFilter && (e.grade || e.shift) !== employeeGradeFilter) return false;
                  if (employeeDivisionFilter && (e.division || e.site_name) !== employeeDivisionFilter) return false;
                  if (!query) return true;
                  const haystack = [
                    e.rfid_number,
                    e.emp_id,
                    e.emp_name,
                    e.parent_email,
                    e.grade || e.shift,
                    e.division || e.site_name,
                  ]
                    .filter(Boolean)
                    .join(' ')
                    .toLowerCase();
                  return haystack.includes(query);
                });

                return (
                  <div className="employee-page">
                    {!isSecurity && hasPerm('students', 'create') && (
                      <div className="card employee-card">
                        <h2 className="employee-title">Student Registration</h2>
                        <form onSubmit={handleSubmit}>
                          <div className="employee-form-grid">
                            <div className="form-group">
                              <label htmlFor="rfid_number">RFID Card ID <span className="req">*</span></label>
                              <input
                                type="text"
                                id="rfid_number"
                                name="rfid_number"
                                value={formData.rfid_number}
                                onChange={handleInputChange}
                                placeholder="Scan or enter RFID"
                                required
                              />
                            </div>
                            <div className="form-group">
                              <label htmlFor="emp_id">Student ID <span className="req">*</span></label>
                              <input
                                type="text"
                                id="emp_id"
                                name="emp_id"
                                value={formData.emp_id}
                                onChange={handleInputChange}
                                placeholder="e.g. STU001"
                                required
                              />
                            </div>
                            <div className="form-group">
                              <label htmlFor="emp_name">Full Name <span className="req">*</span></label>
                              <input
                                type="text"
                                id="emp_name"
                                name="emp_name"
                                value={formData.emp_name}
                                onChange={handleInputChange}
                                placeholder="Full Name"
                                required
                              />
                            </div>
                            <div className="form-group">
                              <label htmlFor="parent_name">Parent Name <span className="req">*</span></label>
                              <input
                                type="text"
                                id="parent_name"
                                name="parent_name"
                                value={formData.parent_name}
                                onChange={handleInputChange}
                                placeholder="Enter parent full name"
                                required
                              />
                            </div>
                            <div className="form-group">
                              <label htmlFor="parent_email">Parent Email ID <span className="req">*</span></label>
                              <input
                                type="email"
                                id="parent_email"
                                name="parent_email"
                                value={formData.parent_email}
                                onChange={handleInputChange}
                                placeholder="parent@example.com"
                                required
                              />
                            </div>
                            <div className="form-group">
                              <label htmlFor="parent_password">Parent Password <span className="req">*</span></label>
                              <input
                                type="password"
                                id="parent_password"
                                name="parent_password"
                                value={formData.parent_password}
                                onChange={handleInputChange}
                                placeholder="Set parent login password"
                                required
                              />
                            </div>
                            <div className="form-group">
                              <label htmlFor="grade">Grade / Standard <span className="req">*</span></label>
                              <select
                                id="grade"
                                name="grade"
                                value={formData.grade}
                                onChange={handleInputChange}
                                required
                              >
                                <option value="">Select Grade</option>
                                {[...new Set(gradeOptions.length ? gradeOptions.map((g) => g.value) : ['1','2','3','4','5','6','7','8','9','10','11','12'])].map((grade) => (
                                  <option key={grade} value={grade}>{grade}</option>
                                ))}
                              </select>
                            </div>
                            <div className="form-group">
                              <label htmlFor="division">Division <span className="req">*</span></label>
                              <select
                                id="division"
                                name="division"
                                value={formData.division}
                                onChange={handleInputChange}
                                required
                              >
                                <option value="">Select Division</option>
                                {[...new Set(divisionOptions.length ? divisionOptions.map((d) => d.value) : ['A', 'B', 'C', 'D'])].map((division) => (
                                  <option key={division} value={division}>{division}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                          <div className="employee-actions">
                            <button type="submit" className="btn btn-primary btn-with-icon">
                              <span className="btn-ico">+</span>
                              Register Student
                            </button>
                            <button type="button" className="btn btn-danger btn-with-icon" onClick={resetForm}>
                              <span className="btn-ico">×</span>
                              Cancel
                            </button>
                          </div>
                        </form>
                      </div>
                    )}

                    <div className="card employee-card">
                      <div className="employee-list-header">
                        <h2 className="employee-title">Student List</h2>
                          <div className="employee-search-bar">
                            <div className="employee-search">
                              <span className="search-ico" aria-hidden="true">🔍</span>
                              <input
                                value={employeeSearch}
                                onChange={(e) => setEmployeeSearch(e.target.value)}
                                placeholder="Search students..."
                                aria-label="Search students"
                              />
                            </div>
                            <select
                              value={employeeGradeFilter}
                              onChange={(e) => setEmployeeGradeFilter(e.target.value)}
                              aria-label="Filter by grade"
                              className="emp-filter-select"
                            >
                              <option value="">All Grades</option>
                              {[...new Map(gradeOptions.map(g => [g.value, g])).values()].map((g) => (
                                <option key={g.id || g.value} value={g.value}>{g.value}</option>
                              ))}
                            </select>
                            <select
                              value={employeeDivisionFilter}
                              onChange={(e) => setEmployeeDivisionFilter(e.target.value)}
                              aria-label="Filter by division"
                              className="emp-filter-select"
                            >
                              <option value="">All Divisions</option>
                              {[...new Map(divisionOptions.map(d => [d.value, d])).values()].map((d) => (
                                <option key={d.id || d.value} value={d.value}>{d.value}</option>
                              ))}
                            </select>
                          </div>
                      </div>
                      {loading ? (
                        <div className="loading" style={{ padding: '10px 0' }}>
                          <div className="spinner"></div>
                          <p>Loading...</p>
                        </div>
                      ) : (
                        <div className="employee-table-wrap">
                          <table className="employee-table">
                            <thead>
                              <tr>
                                <th>RFID Card ID</th>
                                <th>Student ID</th>
                                <th>Name</th>
                                <th>Parent Email</th>
                                <th>Grade</th>
                                <th>Division</th>
                                <th>Wallet Amount</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {filteredEmployees.length === 0 ? (
                                <tr>
                                  <td colSpan="8" className="empty-cell">No students found</td>
                                </tr>
                              ) : (
                                filteredEmployees.map((employee) => (
                                  <tr key={employee.id}>
                                    <td className="mono">{employee.rfid_number}</td>
                                    <td className="mono">{employee.emp_id}</td>
                                    <td>
                                      <div className="emp-name-cell">
                                        <span className="emp-avatar">{getInitials(employee.emp_name)}</span>
                                        <span className="emp-name">{employee.emp_name}</span>
                                      </div>
                                    </td>
                                    <td>
                                      {employee.parent_email || '—'}
                                    </td>
                                    <td>{employee.grade || employee.shift || '—'}</td>
                                    <td>{employee.division || employee.site_name || '—'}</td>
                                    <td className="wallet-amt">₹{parseFloat(employee.wallet_amount || 0).toFixed(2)}</td>
                                    <td>
                                      {!isReadOnly && (
                                        <div className="employee-row-actions">
                                          {hasPerm('students', 'edit') && (
                                            <button className="btn btn-edit btn-small" onClick={() => editEmployee(employee.id)}>
                                              ✎ Edit
                                            </button>
                                          )}
                                          {hasPerm('students', 'delete') && (
                                            <button className="btn btn-delete btn-small" onClick={() => deleteEmployee(employee.id)}>
                                              🗑 Delete
                                            </button>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </>
          )}
          
          {/* Tuckshop Section */}
          {!isTeacherPortal && activeSection === 'tuckshop' && (() => {
            const categories = ['All', ...Array.from(new Set(tuckshopItems.map((i) => i.category || 'General')))];
            const visibleItems = tuckshopActiveCategory === 'All'
              ? tuckshopItems
              : tuckshopItems.filter((i) => (i.category || 'General') === tuckshopActiveCategory);

            return (
              <div className="tuckshop-page">
                {/* Sub-nav */}
                <div className="tuckshop-tabs">
                  <button
                    className={`wallet-tab ${tuckshopView === 'pos' ? 'active' : ''}`}
                    onClick={() => setTuckshopView('pos')}
                  >
                    POS Terminal
                  </button>
                  <button
                    className={`wallet-tab ${tuckshopView === 'items' ? 'active' : ''}`}
                    onClick={() => setTuckshopView('items')}
                  >
                    Manage Items
                  </button>
                </div>

                {/* ── POS VIEW ── */}
                {tuckshopView === 'pos' && (
                  <div className="tuckshop-pos">
                    {/* Left: Items */}
                    <div className="tuckshop-pos-items">
                      <div className="tuckshop-cat-bar">
                        {categories.map((cat) => (
                          <button
                            key={cat}
                            type="button"
                            className={`tuckshop-cat-btn ${tuckshopActiveCategory === cat ? 'active' : ''}`}
                            onClick={() => setTuckshopActiveCategory(cat)}
                          >
                            {cat}
                          </button>
                        ))}
                      </div>

                      {tuckshopItems.length === 0 ? (
                        <div className="tuckshop-empty">
                          No items configured. Go to <strong>Manage Items</strong> to add tuckshop items.
                        </div>
                      ) : (
                        <div className="tuckshop-item-grid">
                          {visibleItems.map((item) => (
                            <button
                              key={item.id}
                              type="button"
                              className="tuckshop-item-card"
                              onClick={() => addToCart(item)}
                            >
                              <div className="tuckshop-item-cat">{item.category || 'General'}</div>
                              <div className="tuckshop-item-name">{item.item_name}</div>
                              <div className="tuckshop-item-price">₹{parseFloat(item.price).toFixed(2)}</div>
                              <div className="tuckshop-item-add">+ Add</div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Right: Cart */}
                    <div className="tuckshop-cart-panel">
                      <div className="tuckshop-cart-header">
                        <h3>Cart</h3>
                        {tuckshopCart.length > 0 && (
                          <button type="button" className="btn btn-danger btn-small" onClick={clearTuckshopCart}>
                            Clear
                          </button>
                        )}
                      </div>

                      {tuckshopCart.length === 0 ? (
                        <div className="tuckshop-cart-empty">No items in cart. Tap an item to add.</div>
                      ) : (
                        <div className="tuckshop-cart-items">
                          {tuckshopCart.map((c) => (
                            <div key={c.id} className="tuckshop-cart-row">
                              <div className="tuckshop-cart-name">{c.item_name}</div>
                              <div className="tuckshop-cart-controls">
                                <button type="button" className="tuckshop-qty-btn" onClick={() => updateCartQty(c.id, c.qty - 1)}>−</button>
                                <input
                                  type="number"
                                  className="tuckshop-qty-input"
                                  value={c.qty}
                                  min="1"
                                  onChange={(e) => updateCartQty(c.id, e.target.value)}
                                />
                                <button type="button" className="tuckshop-qty-btn" onClick={() => updateCartQty(c.id, c.qty + 1)}>+</button>
                              </div>
                              <div className="tuckshop-cart-sub">₹{(parseFloat(c.price) * c.qty).toFixed(2)}</div>
                              <button type="button" className="tuckshop-remove-btn" onClick={() => removeFromCart(c.id)}>✕</button>
                            </div>
                          ))}
                        </div>
                      )}

                      <div className="tuckshop-cart-total">
                        <span>Total</span>
                        <strong>₹{cartTotal.toFixed(2)}</strong>
                      </div>

                      {/* RFID Payment */}
                      <div className="tuckshop-rfid-section">
                        <label className="tuckshop-rfid-label">Scan Student RFID to Pay</label>
                        <div className="rfid-form-row">
                          <input
                            type="text"
                            value={tuckshopRfid}
                            onChange={(e) => setTuckshopRfid(e.target.value)}
                            placeholder="Scan or enter RFID"
                            onKeyDown={(e) => e.key === 'Enter' && tuckshopCart.length > 0 && processTuckshopPurchase()}
                          />
                          <button
                            type="button"
                            className="btn btn-success"
                            disabled={tuckshopScanLoading || tuckshopCart.length === 0 || !tuckshopRfid.trim()}
                            onClick={processTuckshopPurchase}
                            style={{ minWidth: 90 }}
                          >
                            {tuckshopScanLoading ? 'Processing…' : `Pay ₹${cartTotal.toFixed(2)}`}
                          </button>
                        </div>
                      </div>

                      {/* Last Sale */}
                      {tuckshopLastSale && (
                        <div className="tuckshop-last-sale">
                          <div className="tuckshop-sale-success">✅ Payment Successful</div>
                          <div className="tuckshop-sale-student">{tuckshopLastSale.employee?.name}</div>
                          <div className="tuckshop-sale-detail">
                            <span>Deducted: <strong>₹{parseFloat(tuckshopLastSale.transaction?.total || 0).toFixed(2)}</strong></span>
                            <span>New Balance: <strong>₹{parseFloat(tuckshopLastSale.transaction?.new_balance || tuckshopLastSale.employee?.wallet_balance || 0).toFixed(2)}</strong></span>
                          </div>
                          <div className="tuckshop-sale-items-list">
                            {(tuckshopLastSale.items || []).map((it, idx) => (
                              <div key={idx} className="tuckshop-sale-line">
                                {it.item_name} × {it.qty} = ₹{parseFloat(it.subtotal).toFixed(2)}
                              </div>
                            ))}
                          </div>
                          <button type="button" className="btn btn-secondary btn-small" style={{ marginTop: 8 }} onClick={() => setTuckshopLastSale(null)}>
                            New Sale
                          </button>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {/* ── MANAGE ITEMS VIEW ── */}
                {tuckshopView === 'items' && (
                  <div className="master-config-page">
                    <div className="master-config-grid">
                      <div className="master-card">
                        <div>
                          <p className="master-card-title">{tuckshopEditId ? 'Edit Tuckshop Item' : 'Add Tuckshop Item'}</p>
                          <p className="master-card-sub">Items will appear in the POS terminal for selection</p>
                        </div>
                        <hr className="section-divider" />
                        <form onSubmit={saveTuckshopItem} className="price-form-inline">
                          <div className="form-group">
                            <label>Item Name</label>
                            <input
                              type="text"
                              value={tuckshopItemForm.item_name}
                              onChange={(e) => setTuckshopItemForm((p) => ({ ...p, item_name: e.target.value }))}
                              placeholder="e.g. Muffin"
                              required
                            />
                          </div>
                          <div className="form-group">
                            <label>Price (₹)</label>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={tuckshopItemForm.price}
                              onChange={(e) => setTuckshopItemForm((p) => ({ ...p, price: e.target.value }))}
                              placeholder="10"
                              required
                            />
                          </div>
                          <div className="form-group">
                            <label>Category</label>
                            <input
                              type="text"
                              value={tuckshopItemForm.category}
                              onChange={(e) => setTuckshopItemForm((p) => ({ ...p, category: e.target.value }))}
                              placeholder="Snacks, Beverages…"
                            />
                          </div>
                          <div className="form-group" style={{ alignSelf: 'end', display: 'flex', gap: 6 }}>
                            <button type="submit" className="btn btn-primary">{tuckshopEditId ? 'Update' : '+ Add'}</button>
                            {tuckshopEditId && (
                              <button type="button" className="btn btn-secondary" onClick={() => { setTuckshopEditId(null); setTuckshopItemForm({ item_name: '', price: '', category: 'General' }); }}>Cancel</button>
                            )}
                          </div>
                        </form>
                      </div>

                      <div className="master-card">
                        <div>
                          <p className="master-card-title">Item List</p>
                          <p className="master-card-sub">{tuckshopItems.length} items configured</p>
                        </div>
                        <hr className="section-divider" />
                        <div className="price-table-wrap">
                          <table>
                            <thead>
                              <tr>
                                <th>Item Name</th>
                                <th>Category</th>
                                <th>Price</th>
                                <th>Actions</th>
                              </tr>
                            </thead>
                            <tbody>
                              {tuckshopItems.length === 0 ? (
                                <tr><td colSpan="4" style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No items yet</td></tr>
                              ) : (
                                tuckshopItems.map((item) => (
                                  <tr key={item.id}>
                                    <td style={{ fontWeight: 700 }}>{item.item_name}</td>
                                    <td><span className="slot-meal-tag">{item.category || 'General'}</span></td>
                                    <td style={{ fontWeight: 800, color: '#16a34a' }}>₹{parseFloat(item.price).toFixed(2)}</td>
                                    <td style={{ display: 'flex', gap: 6 }}>
                                      <button type="button" className="btn btn-secondary btn-small" onClick={() => { setTuckshopEditId(item.id); setTuckshopItemForm({ item_name: item.item_name, price: String(item.price), category: item.category || 'General' }); setTuckshopView('items'); }}>
                                        Edit
                                      </button>
                                      <button type="button" className="btn btn-delete btn-small" onClick={() => deleteTuckshopItem(item.id)}>
                                        Delete
                                      </button>
                                    </td>
                                  </tr>
                                ))
                              )}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })()}

          {/* Payment Reports Section */}
          {!isTeacherPortal && activeSection === 'reports' && (
            <div className="master-config-page">
              {/* Filters */}
              <div className="master-card" style={{ marginBottom: 20 }}>
                <p className="master-card-title">Report Filters</p>
                <div className="price-form-inline" style={{ alignItems: 'flex-end' }}>
                  <div className="form-group">
                    <label>Report Type</label>
                    <select
                      value={reportType}
                      onChange={(e) => setReportType(e.target.value)}
                    >
                      <option value="razorpay">Razorpay Payments (Parent Recharges)</option>
                      <option value="tuckshop">Tuckshop Sales</option>
                      <option value="deductions">All Transactions (Meal Slot + Tuckshop)</option>
                    </select>
                  </div>
                  <div className="form-group">
                    <label>From Date</label>
                    <input type="date" value={reportFrom} onChange={(e) => setReportFrom(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <label>To Date</label>
                    <input type="date" value={reportTo} onChange={(e) => setReportTo(e.target.value)} />
                  </div>
                  <div className="form-group">
                    <button type="button" className="btn btn-primary" onClick={loadReports} disabled={reportLoading}>
                      {reportLoading ? 'Loading…' : 'Generate Report'}
                    </button>
                  </div>
                </div>

                {/* Totals */}
                {reportData.length > 0 && (
                  <div className="report-totals-row">
                    <div className="report-total-chip">
                      <span>Records</span>
                      <strong>{reportData.length}</strong>
                    </div>
                    {reportType === 'razorpay' && (
                      <>
                        <div className="report-total-chip">
                          <span>Total Collected</span>
                          <strong>₹{parseFloat(reportTotals.total_paid || 0).toFixed(2)}</strong>
                        </div>
                        <div className="report-total-chip">
                          <span>Total Credited to Wallets</span>
                          <strong>₹{parseFloat(reportTotals.total_credited || 0).toFixed(2)}</strong>
                        </div>
                      </>
                    )}
                    {reportType === 'tuckshop' && (
                      <div className="report-total-chip">
                        <span>Total Revenue</span>
                        <strong>₹{parseFloat(reportTotals.total_revenue || 0).toFixed(2)}</strong>
                      </div>
                    )}
                    {reportType === 'deductions' && (
                      <>
                        <div className="report-total-chip">
                          <span>Total Deducted</span>
                          <strong>₹{parseFloat(reportTotals.total_amount || 0).toFixed(2)}</strong>
                        </div>
                        <div className="report-total-chip">
                          <span>Meal Slot Total</span>
                          <strong>₹{parseFloat(reportTotals.meal_total || 0).toFixed(2)}</strong>
                        </div>
                        <div className="report-total-chip">
                          <span>Tuckshop Total</span>
                          <strong>₹{parseFloat(reportTotals.tuckshop_total || 0).toFixed(2)}</strong>
                        </div>
                      </>
                    )}
                  </div>
                )}
              </div>

              {/* Razorpay Table */}
              {reportType === 'razorpay' && (
                <div className="price-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Student</th>
                        <th>Parent Email</th>
                        <th>Meal Type</th>
                        <th>Months</th>
                        <th>Sub Total</th>
                        <th>Conv. Fee</th>
                        <th>Total Paid</th>
                        <th>Razorpay Order ID</th>
                        <th>Razorpay Payment ID</th>
                        <th>Status</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportLoading ? (
                        <tr><td colSpan="12" style={{ textAlign: 'center', padding: '20px' }}>Loading…</td></tr>
                      ) : reportData.length === 0 ? (
                        <tr><td colSpan="12" style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No payments found for the selected period</td></tr>
                      ) : (
                        reportData.map((row) => (
                          <tr key={row.id}>
                            <td>{row.created_at ? row.created_at.split(' ')[0] : '—'}</td>
                            <td>
                              <strong>{row.student_name || '—'}</strong>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{row.student_id_no}</div>
                            </td>
                            <td>{row.parent_email || '—'}</td>
                            <td>{row.meal_type_name || '—'}</td>
                            <td style={{ fontSize: 12 }}>{row.payment_months_labels || '—'}</td>
                            <td>₹{parseFloat(row.sub_total || 0).toFixed(2)}</td>
                            <td style={{ color: '#64748b' }}>₹{parseFloat(row.convenience_fee || 0).toFixed(2)}</td>
                            <td style={{ fontWeight: 800, color: '#16a34a' }}>₹{parseFloat(row.total_paid || 0).toFixed(2)}</td>
                            <td><span className="mono" style={{ fontSize: 11 }}>{row.razorpay_order_id || '—'}</span></td>
                            <td><span className="mono" style={{ fontSize: 11, color: '#6c5ce7' }}>{row.razorpay_payment_id || '—'}</span></td>
                            <td><span className="status-pill status-delivered">{row.payment_status || 'Completed'}</span></td>
                            <td><button type="button" className="btn btn-delete btn-small" onClick={() => deleteReport(row.id)}>Delete</button></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* All Transactions Table (Meal Slot + Tuckshop) */}
              {reportType === 'deductions' && (
                <div className="price-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Student</th>
                        <th>RFID</th>
                        <th>Type</th>
                        <th>Details</th>
                        <th>Amount</th>
                        <th>Prev Balance</th>
                        <th>New Balance</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportLoading ? (
                        <tr><td colSpan="10" style={{ textAlign: 'center', padding: '20px' }}>Loading…</td></tr>
                      ) : reportData.length === 0 ? (
                        <tr><td colSpan="10" style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No transactions found for the selected period</td></tr>
                      ) : (
                        reportData.map((row) => (
                          <tr key={row.transaction_id}>
                            <td>{row.transaction_date}</td>
                            <td style={{ fontSize: 12, color: '#64748b' }}>{row.transaction_time ? row.transaction_time.slice(0, 5) : '—'}</td>
                            <td>
                              <strong>{row.student_name}</strong>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{row.student_id_no}</div>
                            </td>
                            <td className="mono" style={{ fontSize: 12 }}>{row.rfid_number}</td>
                            <td>
                              <span className={`status-pill ${row.transaction_type === 'tuckshop' ? 'status-pending' : 'status-delivered'}`}>
                                {row.transaction_type === 'tuckshop' ? 'Tuckshop' : 'Meal Slot'}
                              </span>
                            </td>
                            <td style={{ fontSize: 12 }}>
                              {row.transaction_type === 'tuckshop'
                                ? (row.items || []).map((it, i) => (
                                    <div key={i}>{it.item_name} ×{it.qty}</div>
                                  ))
                                : row.meal_category}
                            </td>
                            <td style={{ fontWeight: 800, color: '#dc2626' }}>₹{parseFloat(row.amount || 0).toFixed(2)}</td>
                            <td>₹{parseFloat(row.previous_balance || 0).toFixed(2)}</td>
                            <td style={{ fontWeight: 700, color: '#16a34a' }}>₹{parseFloat(row.new_balance || 0).toFixed(2)}</td>
                            <td><button type="button" className="btn btn-delete btn-small" onClick={() => deleteReport(row.transaction_id || row.id)}>Delete</button></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Tuckshop Sales Table */}
              {reportType === 'tuckshop' && (
                <div className="price-table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>Student</th>
                        <th>RFID</th>
                        <th>Items</th>
                        <th>Total</th>
                        <th>Prev Balance</th>
                        <th>New Balance</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reportLoading ? (
                        <tr><td colSpan="9" style={{ textAlign: 'center', padding: '20px' }}>Loading…</td></tr>
                      ) : reportData.length === 0 ? (
                        <tr><td colSpan="9" style={{ textAlign: 'center', color: '#94a3b8', padding: '20px' }}>No tuckshop sales found</td></tr>
                      ) : (
                        reportData.map((row) => (
                          <tr key={row.transaction_id}>
                            <td>{row.transaction_date}</td>
                            <td>{row.transaction_time}</td>
                            <td>
                              <strong>{row.student_name}</strong>
                              <div style={{ fontSize: 11, color: '#64748b' }}>{row.student_id_no}</div>
                            </td>
                            <td className="mono">{row.rfid_number}</td>
                            <td style={{ fontSize: 12 }}>
                              {(row.items || []).map((it, i) => (
                                <div key={i}>{it.item_name} ×{it.qty} — ₹{parseFloat(it.subtotal).toFixed(2)}</div>
                              ))}
                            </td>
                            <td style={{ fontWeight: 800, color: '#dc2626' }}>₹{parseFloat(row.total_amount || 0).toFixed(2)}</td>
                            <td>₹{parseFloat(row.previous_balance || 0).toFixed(2)}</td>
                            <td style={{ fontWeight: 700, color: '#16a34a' }}>₹{parseFloat(row.new_balance || 0).toFixed(2)}</td>
                            <td><button type="button" className="btn btn-delete btn-small" onClick={() => deleteReport(row.transaction_id)}>Delete</button></td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* Transaction History Section */}
          {activeSection === 'transactions' && (
            <>
              {/* Filters */}
              <div className="form-section">
                <h2>Filter Transactions</h2>
                <div className="form-grid" style={{ gridTemplateColumns: '1fr 1fr auto auto' }}>
                  <div className="form-group">
                    <label htmlFor="filterDate">Date</label>
                    <input
                      type="date"
                      id="filterDate"
                      value={transactionFilter.date}
                      onChange={(e) => setTransactionFilter({...transactionFilter, date: e.target.value})}
                    />
                  </div>
                  <div className="form-group">
                    <label htmlFor="filterMeal">Meal Category</label>
                    <select
                      id="filterMeal"
                      value={transactionFilter.mealCategory}
                      onChange={(e) => setTransactionFilter({...transactionFilter, mealCategory: e.target.value})}
                    >
                      <option value="">All Meals</option>
                      <option value="Breakfast">Breakfast</option>
                      <option value="Mid-Meal">Mid-Meal</option>
                      <option value="Lunch">Lunch</option>
                      <option value="Dinner">Dinner</option>
                    </select>
                  </div>
                  <div className="form-group" style={{ alignSelf: 'flex-end' }}>
                    <button 
                      className="btn btn-primary"
                      onClick={loadTransactions}
                      style={{ padding: '12px 30px' }}
                    >
                      Refresh
                    </button>
                  </div>

                </div>
              </div>

              {/* Transactions Table */}
              {loading ? (
                <div className="loading">
                  <div className="spinner"></div>
                  <p>Loading transactions...</p>
                </div>
              ) : (
                <div className="table-container">
                  <h2>Transaction History ({transactions.length})</h2>
                  <table>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Time</th>
                        <th>{personLabel}</th>
                        <th>RFID</th>
                        <th>Meal</th>
                        <th>Amount</th>
                        <th>Previous Balance</th>
                        <th>New Balance</th>
                        <th>{divisionLabel}</th>
                        <th>Status</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.length === 0 ? (
                        <tr>
                          <td colSpan="10" style={{ textAlign: 'center' }}>
                            No transactions found
                          </td>
                        </tr>
                      ) : (
                        transactions.map((transaction) => (
                          <tr key={transaction.id}>
                            <td>{transaction.transaction_date}</td>
                            <td>{transaction.transaction_time}</td>
                            <td>
                              <div>
                                <strong>{transaction.emp_name || 'Visitor'}</strong>
                                <br />
                                <small style={{ color: '#666' }}>{transaction.emp_id || 'VIS'}</small>
                              </div>
                            </td>
                            <td>{transaction.rfid_number}</td>
                            <td>
                              <span style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                background: transaction.transaction_type === 'canteen' ? '#e0f2fe' :
                                           transaction.transaction_type === 'canteen_denied' ? '#fee2e2' :
                                           transaction.meal_category === 'Breakfast' ? '#fff3cd' :
                                           transaction.meal_category === 'Lunch' ? '#d4edda' : '#d1ecf1',
                                color: '#000'
                              }}>
                                {transaction.transaction_type === 'canteen' ? `✅ ${transaction.meal_category || 'Canteen'}` :
                                 transaction.transaction_type === 'canteen_denied' ? `❌ Denied` :
                                 transaction.meal_category || (transaction.transaction_type === 'visitor' ? 'Visitor Order' : 'Recharge')}
                              </span>
                            </td>
                            <td style={{ 
                              color: transaction.transaction_type === 'deduction' || transaction.transaction_type === 'tuckshop' ? '#e74c3c' :
                                     transaction.transaction_type === 'canteen_denied' ? '#dc2626' : '#27ae60',
                              fontWeight: 'bold'
                            }}>
                              {transaction.transaction_type === 'deduction' || transaction.transaction_type === 'tuckshop' ? '-' :
                               transaction.transaction_type === 'canteen' || transaction.transaction_type === 'canteen_denied' ? '' : '+'}₹{parseFloat(transaction.amount || 0).toFixed(2)}
                            </td>
                            <td>{transaction.previous_balance ? `₹${parseFloat(transaction.previous_balance).toFixed(2)}` : '—'}</td>
                            <td style={{ fontWeight: 'bold', color: '#27ae60' }}>
                              {transaction.new_balance ? `₹${parseFloat(transaction.new_balance).toFixed(2)}` : '—'}
                            </td>
                            <td>{transaction.division || transaction.site_name || (transaction.transaction_type === 'visitor' ? 'Visitor' : '')}</td>
                            <td>
                              {(() => {
                                const status = (transaction.order_status || 'Pending').toLowerCase();
                                const label = status.charAt(0).toUpperCase() + status.slice(1);
                                const safeClass = status.replace(/\s+/g, '-');
                                return (
                                  <span className={`status-pill status-${safeClass}`}>
                                    {label}
                                  </span>
                                );
                              })()}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Edit Modal */}
      {showEditModal && (
        <div className="modal">
          <div className="modal-content">
            <div className="modal-header">
              <h2>Edit Student</h2>
              <span className="close-modal" onClick={() => setShowEditModal(false)}>
                &times;
              </span>
            </div>
            <form onSubmit={handleEditSubmit}>
              <div className="form-grid">
                <div className="form-group">
                  <label htmlFor="edit_rfid_number">RFID Card ID *</label>
                  <input
                    type="text"
                    id="edit_rfid_number"
                    name="rfid_number"
                    value={editData.rfid_number}
                    onChange={handleEditInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_emp_id">Student ID *</label>
                  <input
                    type="text"
                    id="edit_emp_id"
                    name="emp_id"
                    value={editData.emp_id}
                    onChange={handleEditInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_emp_name">Full Name *</label>
                  <input
                    type="text"
                    id="edit_emp_name"
                    name="emp_name"
                    value={editData.emp_name}
                    onChange={handleEditInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_parent_name">Parent Name *</label>
                  <input
                    type="text"
                    id="edit_parent_name"
                    name="parent_name"
                    value={editData.parent_name}
                    onChange={handleEditInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_parent_email">Parent Email ID *</label>
                  <input
                    type="email"
                    id="edit_parent_email"
                    name="parent_email"
                    value={editData.parent_email}
                    onChange={handleEditInputChange}
                    required
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_parent_password">Parent Password (leave blank to keep current)</label>
                  <input
                    type="password"
                    id="edit_parent_password"
                    name="parent_password"
                    value={editData.parent_password}
                    onChange={handleEditInputChange}
                  />
                </div>
                <div className="form-group">
                  <label htmlFor="edit_grade">Grade / Standard *</label>
                  <select
                    id="edit_grade"
                    name="grade"
                    value={editData.grade}
                    onChange={handleEditInputChange}
                    required
                  >
                    <option value="">Select Grade</option>
                    {[...new Set(gradeOptions.length ? gradeOptions.map((g) => g.value) : ['1','2','3','4','5','6','7','8','9','10','11','12'])].map((grade) => (
                      <option key={grade} value={grade}>{grade}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit_division">Division *</label>
                  <select
                    id="edit_division"
                    name="division"
                    value={editData.division}
                    onChange={handleEditInputChange}
                    required
                  >
                    <option value="">Select Division</option>
                    {[...new Set(divisionOptions.length ? divisionOptions.map((d) => d.value) : ['A', 'B', 'C', 'D'])].map((division) => (
                      <option key={division} value={division}>{division}</option>
                    ))}
                  </select>
                </div>
                <div className="form-group">
                  <label htmlFor="edit_wallet_amount">Wallet Amount (₹) *</label>
                  <input
                    type="number"
                    id="edit_wallet_amount"
                    name="wallet_amount"
                    value={editData.wallet_amount}
                    onChange={handleEditInputChange}
                    step="0.01"
                    min="0"
                    required
                  />
                </div>
              </div>
              <button type="submit" className="btn btn-success">
                Update Student
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={() => setShowEditModal(false)}
                style={{ marginLeft: '10px' }}
              >
                Cancel
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default AdminDashboard;
