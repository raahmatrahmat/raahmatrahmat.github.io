const config = window.STUDIO_CONFIG || {};
const state = { accessToken: '', user: null, balance: 0 };

const loginPanel = document.querySelector('#login-panel');
const dashboardPanel = document.querySelector('#dashboard-panel');
const loginForm = document.querySelector('#login-form');
const loginMessage = document.querySelector('#login-message');
const ledgerMessage = document.querySelector('#ledger-message');
const assistantOutput = document.querySelector('#assistant-message-output');
const rows = document.querySelector('#ledger-rows');
const safeText = (value) => String(value ?? '');

function showMessage(element, message, kind = '') {
  element.textContent = message;
  element.className = 'inline-message' + (kind ? ' ' + kind : '');
}

function setAuthenticated(user) {
  state.user = user;
  loginPanel.classList.add('hidden');
  dashboardPanel.classList.remove('hidden');
  document.querySelector('#account-label').textContent = user.email || 'Akun Bubble Crush';
}

function setUnauthenticated() {
  state.accessToken = '';
  state.user = null;
  state.balance = 0;
  dashboardPanel.classList.add('hidden');
  loginPanel.classList.remove('hidden');
}

function requireConfig() {
  if (!config.supabaseUrl || !config.supabasePublishableKey) {
    throw new Error('Konfigurasi Supabase belum tersedia.');
  }
}

async function signIn(email, password) {
  requireConfig();
  const response = await fetch(config.supabaseUrl + '/auth/v1/token?grant_type=password', {
    method: 'POST',
    headers: {
      apikey: config.supabasePublishableKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ email, password }),
  });
  const result = await response.json();
  if (!response.ok || !result.access_token || !result.user) {
    throw new Error(result.msg || result.message || 'Email atau kata sandi tidak cocok.');
  }
  state.accessToken = result.access_token;
  setAuthenticated(result.user);
  await loadLedger();
}

async function authFetch(path, options = {}) {
  requireConfig();
  if (!state.accessToken) throw new Error('Silakan masuk kembali.');
  const response = await fetch(config.supabaseUrl + path, {
    ...options,
    headers: {
      apikey: config.supabasePublishableKey,
      authorization: 'Bearer ' + state.accessToken,
      ...(options.headers || {}),
    },
  });
  if (response.status === 401) {
    setUnauthenticated();
    throw new Error('Sesi berakhir. Silakan masuk kembali.');
  }
  return response;
}

function formatDate(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('id-ID', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Jakarta',
  }).format(date);
}

function formatTransactionId(value) {
  const text = safeText(value);
  return text.length > 18 ? text.slice(0, 8) + '…' + text.slice(-6) : text;
}

async function loadLedger() {
  showMessage(ledgerMessage, 'Memuat ledger…');
  const [balanceResponse, ledgerResponse] = await Promise.all([
    authFetch('/rest/v1/rpc/get_my_reward_balance', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    }),
    authFetch('/rest/v1/reward_ledger?select=transaction_id,points,reward_item,ad_unit,created_at&order=created_at.desc&limit=50'),
  ]);
  if (!balanceResponse.ok || !ledgerResponse.ok) {
    showMessage(ledgerMessage, 'Ledger belum tersedia. Periksa koneksi Supabase dan kebijakan akses.', 'error');
    return;
  }
  const balance = await balanceResponse.json();
  const ledger = await ledgerResponse.json();
  state.balance = Number(balance) || 0;
  document.querySelector('#points-balance').textContent = new Intl.NumberFormat('id-ID').format(state.balance);
  document.querySelector('#event-count').textContent = new Intl.NumberFormat('id-ID').format(ledger.length);
  renderRows(ledger);
  showMessage(ledgerMessage, ledger.length ? 'Menampilkan 50 aktivitas terakhir.' : 'Belum ada callback SSV yang dikreditkan.', 'success');
}

function renderRows(ledger) {
  if (!Array.isArray(ledger) || ledger.length === 0) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty-cell';
    cell.textContent = 'Belum ada aktivitas.';
    row.append(cell);
    rows.replaceChildren(row);
    return;
  }
  const fragment = document.createDocumentFragment();
  for (const entry of ledger) {
    const row = document.createElement('tr');
    const values = [
      formatDate(entry.created_at),
      safeText(entry.ad_unit),
      safeText(entry.reward_item),
      '+' + new Intl.NumberFormat('id-ID').format(Number(entry.points) || 0),
    ];
    for (const value of values) {
      const cell = document.createElement('td');
      cell.textContent = value;
      if (value.startsWith('+')) cell.className = 'points';
      row.append(cell);
    }
    const transaction = safeText(entry.transaction_id);
    const transactionCell = document.createElement('td');
    transactionCell.className = 'transaction';
    transactionCell.title = transaction;
    transactionCell.textContent = formatTransactionId(transaction);
    row.append(transactionCell);
    fragment.append(row);
  }
  rows.replaceChildren(fragment);
}

async function askGemini(message) {
  if (!state.accessToken) throw new Error('Silakan masuk kembali.');
  const response = await fetch(config.supabaseUrl + '/functions/v1/gemini-assistant', {
    method: 'POST',
    headers: {
      apikey: config.supabasePublishableKey,
      authorization: 'Bearer ' + state.accessToken,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ message }),
  });
  const result = await response.json();
  if (!response.ok) {
    if (result.error === 'gemini_not_configured') {
      throw new Error('GEMINI_API_KEY dan GEMINI_MODEL belum dipasang di Supabase Function Secrets.');
    }
    throw new Error(result.error || 'Gemini belum dapat menjawab.');
  }
  return result.answer;
}

loginForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const submit = loginForm.querySelector('button[type="submit"]');
  submit.disabled = true;
  showMessage(loginMessage, 'Memeriksa akun…');
  try {
    await signIn(document.querySelector('#email').value.trim(), document.querySelector('#password').value);
    showMessage(loginMessage, '', '');
  } catch (error) {
    showMessage(loginMessage, error instanceof Error ? error.message : 'Gagal masuk.', 'error');
  } finally {
    submit.disabled = false;
  }
});

document.querySelector('#logout-button').addEventListener('click', async () => {
  try {
    await authFetch('/auth/v1/logout?scope=local', { method: 'POST' });
  } catch {
    // Clear the in-memory token even if the remote session has expired.
  }
  setUnauthenticated();
});

document.querySelector('#refresh-button').addEventListener('click', async () => {
  try {
    await loadLedger();
  } catch (error) {
    showMessage(ledgerMessage, error instanceof Error ? error.message : 'Gagal memuat ledger.', 'error');
  }
});

document.querySelector('#assistant-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = document.querySelector('#assistant-message');
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const message = input.value.trim();
  if (!message) return;
  button.disabled = true;
  assistantOutput.textContent = 'Gemini sedang menjawab…';
  try {
    assistantOutput.textContent = await askGemini(message);
  } catch (error) {
    assistantOutput.textContent = error instanceof Error ? error.message : 'Gemini belum tersedia.';
  } finally {
    button.disabled = false;
  }
});

document.querySelector('#ssv-url').textContent = config.ssvCallbackUrl || 'Belum tersedia';

