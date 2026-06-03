module.exports = function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (!process.env.VAPID_PUBLIC_KEY) return res.status(500).json({ error: 'VAPID not configured' });
  res.status(200).json({ publicKey: process.env.VAPID_PUBLIC_KEY });
};
