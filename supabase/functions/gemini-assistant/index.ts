import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

const allowedOrigins = new Set([
  'https://raahmatrahmat.github.io',
  'http://localhost:5173',
]);

function corsHeaders(origin: string | null): Record<string, string> {
  const allowedOrigin = origin && allowedOrigins.has(origin) ? origin : 'https://raahmatrahmat.github.io';
  return {
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
    'access-control-allow-methods': 'POST, OPTIONS',
    'vary': 'origin',
  };
}

function jsonResponse(body: Record<string, unknown>, status: number, origin: string | null): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(origin), 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function publishableKey(): string | null {
  const rawKeys = Deno.env.get('SUPABASE_PUBLISHABLE_KEYS');
  if (rawKeys) {
    try {
      const keys = JSON.parse(rawKeys);
      if (typeof keys.default === 'string') return keys.default;
    } catch {
      console.error('SUPABASE_PUBLISHABLE_KEYS is not valid JSON');
    }
  }
  return Deno.env.get('SUPABASE_ANON_KEY') || null;
}

Deno.serve(async (request: Request) => {
  const origin = request.headers.get('origin');
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(origin) });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405, origin);

  const projectUrl = Deno.env.get('SUPABASE_URL');
  const publicKey = publishableKey();
  const geminiKey = Deno.env.get('GEMINI_API_KEY');
  const model = Deno.env.get('GEMINI_MODEL');
  const authorization = request.headers.get('authorization');
  if (!projectUrl || !publicKey || !authorization?.startsWith('Bearer ')) {
    return jsonResponse({ error: 'authentication_required' }, 401, origin);
  }
  if (!geminiKey || !model) {
    return jsonResponse({ error: 'gemini_not_configured' }, 503, origin);
  }

  let body: { message?: unknown };
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, origin);
  }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message || message.length > 1600) return jsonResponse({ error: 'message_required_or_too_long' }, 400, origin);

  const userResponse = await fetch(projectUrl + '/auth/v1/user', {
    headers: { apikey: publicKey, authorization },
  });
  if (!userResponse.ok) return jsonResponse({ error: 'invalid_session' }, 401, origin);

  const balanceResponse = await fetch(projectUrl + '/rest/v1/rpc/get_my_reward_balance', {
    method: 'POST',
    headers: { apikey: publicKey, authorization, 'content-type': 'application/json' },
    body: '{}',
  });
  if (!balanceResponse.ok) return jsonResponse({ error: 'reward_summary_unavailable' }, 503, origin);
  const balance = await balanceResponse.json();

  const response = await fetch(
    'https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(model) + ':generateContent',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': geminiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text: 'Anda adalah asisten bantuan Bubble Crush. Jelaskan status dan poin game saja. Poin ini tidak dapat ditukar menjadi uang atau dipindahkan. Anda tidak memiliki tool untuk mengirim uang, mengubah saldo, mengklik iklan, atau menjalankan transaksi. Jangan menjanjikan pendapatan atau payout.',
          }],
        },
        contents: [{
          role: 'user',
          parts: [{
            text: 'Saldo poin game saya menurut ledger: ' + String(balance) + '. Pertanyaan: ' + message,
          }],
        }],
        generationConfig: { temperature: 0.2, maxOutputTokens: 500 },
      }),
    },
  );
  if (!response.ok) {
    console.error('Gemini API returned HTTP ' + response.status);
    return jsonResponse({ error: 'gemini_request_failed' }, 502, origin);
  }

  const result = await response.json();
  const answer = result.candidates?.[0]?.content?.parts
    ?.map((part: { text?: string }) => part.text || '')
    .join('')
    .trim();
  if (!answer) return jsonResponse({ error: 'empty_gemini_response' }, 502, origin);
  return jsonResponse({ answer, balance }, 200, origin);
});

