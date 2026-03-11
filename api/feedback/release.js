// /api/feedback/release.js
// Marks a submission as "released" so the employee can see manager notes
// Body: { employee, type, period }

import { put, list } from '@vercel/blob';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { employee, type, period } = req.body;
    if (!employee || !type || !period) {
      return res.status(400).json({ error: 'Missing fields: employee, type, period' });
    }

    const sanitize = str =>
      String(str).toLowerCase().replace(/[^a-z0-9\-_ ]/g, '').replace(/\s+/g, '_').slice(0, 80);

    const sanitizedPeriod = sanitize(period);
    const key = `feedback/${sanitize(type)}/${sanitize(employee)}/${sanitizedPeriod}.json`;

    // Use a directory-level prefix so the listing doesn't miss exact-name matches
    const dirPrefix = `feedback/${sanitize(type)}/${sanitize(employee)}/`;
    const { blobs } = await list({ prefix: dirPrefix, token: process.env.BLOB_READ_WRITE_TOKEN });

    // Find the exact file
    const target = blobs.find(b => b.pathname === key || (b.url && b.url.endsWith(key)));
    if (!target) {
      return res.status(404).json({ error: 'Submission not found', key, found: blobs.map(b => b.pathname || b.url) });
    }

    // Fetch current content (cache-busted to avoid CDN staleness)
    const bustUrl = target.url + (target.url.includes('?') ? '&' : '?') + '_=' + Date.now();
    const existingRes = await fetch(bustUrl);
    if (!existingRes.ok) return res.status(500).json({ error: 'Could not fetch existing record' });
    const record = await existingRes.json();

    // Overwrite with released flag
    await put(key, JSON.stringify({ ...record, released: true, releasedAt: new Date().toISOString() }), {
      access: 'public',
      contentType: 'application/json',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      allowOverwrite: true,
    });

    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error('POST /api/feedback/release error:', err);
    return res.status(500).json({ error: err.message });
  }
}
