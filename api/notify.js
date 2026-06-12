var webpush = require('web-push');
var { createClient } = require('@supabase/supabase-js');

// Cron schedule (UTC) → Paris time:
// revenue       : 0 5 1 * *  → 7h Paris le 1er du mois
// expenses-noon : 0 10 * * * → 12h Paris chaque jour
// expenses-evening: 0 18 * * * → 20h Paris chaque jour
// interest      : 0 5 * * *  → 7h Paris chaque jour

var MONTHS_FR = ['Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

function getParisNow() {
  var now = new Date();
  var str = now.toLocaleString('en-US', {
    timeZone: 'Europe/Paris',
    year: 'numeric', month: 'numeric', day: 'numeric'
  });
  // str = "M/D/YYYY"
  var p = str.split('/');
  var month1 = parseInt(p[0]);
  var day    = parseInt(p[1]);
  var year   = parseInt(p[2]);
  var month0 = month1 - 1; // 0-indexed (matches client mk())
  var dateStr = year + '-' + String(month1).padStart(2,'0') + '-' + String(day).padStart(2,'0');
  var mk = year + '-' + month0; // matches client mk()
  return { year, month0, month1, day, dateStr, mk };
}

module.exports = async function handler(req, res) {
  var secret = process.env.CRON_SECRET;
  if (secret && req.headers.authorization !== 'Bearer ' + secret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  var type = req.query.type;
  var validTypes = ['revenue', 'expenses-noon', 'expenses-evening', 'interest'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ error: 'Invalid type: ' + type });
  }

  webpush.setVapidDetails(
    'mailto:nathan.delaunay76@gmail.com',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  var supabase = createClient(
    process.env.SUPABASE_URL,
    process.env.SUPABASE_SERVICE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } }
  );

  var { data: subs, error: subsErr } = await supabase.from('push_subscriptions').select('*');
  if (subsErr) return res.status(500).json({ error: subsErr.message });
  if (!subs || subs.length === 0) return res.status(200).json({ ok: true, sent: 0 });

  var paris = getParisNow();
  var sent = 0;
  var expired = [];

  for (var i = 0; i < subs.length; i++) {
    var sub = subs[i];
    var payload = null;

    if (type === 'revenue') {
      payload = {
        title: '📊 Revenus de ' + MONTHS_FR[paris.month0],
        body: 'Nouveau mois ! Pense à mettre à jour tes revenus.',
        tag: 'revenue',
        url: '/?tab=revenus'
      };
    }

    if (type === 'expenses-noon' || type === 'expenses-evening') {
      var userData = await supabase
        .from('trivio_data').select('data').eq('user_id', sub.user_id).single();
      var txs = (userData.data && userData.data.data && userData.data.data.txData && userData.data.data.txData[paris.mk]) || [];
      var hasToday = txs.some(function(t) { return t.date === paris.dateStr; });
      if (hasToday) continue;
      if (type === 'expenses-noon') {
        payload = {
          title: '🧾 Et tes dépenses du matin ?',
          body: 'Tu n\'as rien noté aujourd\'hui. Prends 30 secondes pour saisir tes dépenses.',
          tag: 'expenses',
          url: '/?tab=transactions'
        };
      } else {
        payload = {
          title: '🌙 Bilan de ta journée',
          body: 'N\'oublie pas de noter tes dépenses avant de dormir !',
          tag: 'expenses',
          url: '/?tab=transactions'
        };
      }
    }

    if (type === 'interest') {
      var uData = await supabase
        .from('trivio_data').select('data').eq('user_id', sub.user_id).single();
      var objs = (uData.data && uData.data.data && uData.data.data.objs) || [];

      // Intérêts exacts (taux renseigné sur au moins un objectif)
      var daily = objs.reduce(function(sum, o) {
        if (o.taux > 0 && o.actuel > 0) return sum + (o.actuel * (o.taux / 100 / 365));
        return sum;
      }, 0);

      // Épargne totale (avec ou sans taux)
      var eTotal = objs.reduce(function(s, o) { return s + (o.actuel || 0); }, 0);

      if (daily >= 0.0001) {
        // ✅ Cas 1 : taux configuré → montant exact
        var fmtAmt = daily < 0.01 ? daily.toFixed(4) : daily.toFixed(2);
        payload = {
          title: '+' + fmtAmt + ' € d\'intérêts cette nuit 📈',
          body: 'Ton épargne travaille pour toi pendant que tu dors. Belle journée !',
          tag: 'interest',
          url: '/?tab=epargnes'
        };
      } else if (eTotal > 0) {
        // ✅ Cas 2 : épargne sans taux → estimation au taux Livret A (3 %)
        var estDaily = eTotal * (3 / 100 / 365);
        var estFmt = estDaily < 0.01 ? estDaily.toFixed(4) : estDaily.toFixed(2);
        payload = {
          title: '~' + estFmt + ' € d\'intérêts estimés 💡',
          body: 'Estimation à 3 % (Livret A). Renseigne le vrai taux de tes livrets pour un calcul exact.',
          tag: 'interest',
          url: '/?tab=epargnes'
        };
      } else {
        // ✅ Cas 3 : pas encore d'épargne → message motivant sur les intérêts composés
        payload = {
          title: '☀️ Bonjour ! Place aux intérêts composés',
          body: 'Même 50 € / mois à 3 % → +2 000 € d\'intérêts en 10 ans. Lance ton premier objectif aujourd\'hui !',
          tag: 'interest',
          url: '/?tab=epargnes'
        };
      }
    }

    if (!payload) continue;

    try {
      await webpush.sendNotification(sub.subscription, JSON.stringify(payload));
      sent++;
    } catch (err) {
      if (err.statusCode === 410 || err.statusCode === 404) {
        expired.push(sub.id);
      }
    }
  }

  if (expired.length > 0) {
    await supabase.from('push_subscriptions').delete().in('id', expired);
  }

  res.status(200).json({ ok: true, sent, expired: expired.length, type });
};
