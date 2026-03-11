// /api/feedback/release.js
// Marks a manager's notes as "released" — visible to the employee
// Body: { employee, type, period }

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://tt-checkins.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { employee, type, period } = req.body;

    if (!employee || !type || !period) {
      return res.status(400).json({ error: 'Missing fields: employee, type, period' });
    }

    // Build the stable key (matches the format used in /api/feedback)
    const sanitize = str => String(str).replace(/[^a-zA-Z0-9\-_ ]/g, '').replace(/\s+/g, '_').slice(0, 80);
    const id = `${type}__${sanitize(employee)}__${sanitize(period)}`;
    const key = `feedback:${id}`;

    const record = await kv.get(key);
    if (!record) {
      return res.status(404).json({ error: 'Submission not found', id });
    }

    // Flip released flag
    await kv.set(key, { ...record, released: true, releasedAt: new Date().toISOString() });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('POST /api/feedback/release error:', err);
    return res.status(500).json({ error: 'Failed to release submission' });
  }
}
