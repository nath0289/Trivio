var { createClient } = require('@supabase/supabase-js');

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).end();

  var body = req.body || {};
  var email = (body.email || '').trim().toLowerCase();
  var password = body.password || '';

  if (!email || !password) {
    return res.status(400).json({ error: 'Email et mot de passe requis.' });
  }

  // Supabase admin client (service key = bypass email confirmation)
  var supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  // Créer le compte avec email déjà confirmé (pas d'email nécessaire)
  var createResult = await supabase.auth.admin.createUser({
    email: email,
    password: password,
    email_confirm: true
  });

  if (createResult.error) {
    var msg = createResult.error.message || 'Erreur inscription';
    // Compte déjà existant
    if (msg.toLowerCase().includes('already') || msg.includes('existe')) {
      return res.status(400).json({ error: 'Cet email est déjà utilisé.' });
    }
    return res.status(400).json({ error: msg });
  }

  // Connexion immédiate pour obtenir la session
  var signIn = await supabase.auth.signInWithPassword({ email, password });
  if (signIn.error) {
    return res.status(400).json({ error: signIn.error.message });
  }

  return res.status(200).json({
    session: signIn.data.session,
    user: signIn.data.user
  });
};
