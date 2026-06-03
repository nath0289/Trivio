var { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();

  var supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  var body = req.body || {};
  var token = body.token;
  if (!token) return res.status(401).json({ error: 'No token' });

  // Verify JWT and get user
  var authRes = await supabase.auth.getUser(token);
  if (authRes.error || !authRes.data.user) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  var userId = authRes.data.user.id;

  if (req.method === 'POST') {
    if (!body.subscription) return res.status(400).json({ error: 'No subscription' });
    var { error } = await supabase.from('push_subscriptions').upsert({
      user_id: userId,
      subscription: body.subscription,
      updated_at: new Date().toISOString()
    }, { onConflict: 'user_id' });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ ok: true });
  }

  if (req.method === 'DELETE') {
    await supabase.from('push_subscriptions').delete().eq('user_id', userId);
    return res.status(200).json({ ok: true });
  }

  res.status(405).end();
};
