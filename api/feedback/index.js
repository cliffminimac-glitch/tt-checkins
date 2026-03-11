// /api/feedback/index.js
// Handles GET (load submissions) and POST (save submission)
// Storage: Vercel KV (Redis-based, native to Vercel)
// Setup: Enable KV in Vercel dashboard > Storage > Create KV Store > connect to this project

import { kv } from '@vercel/kv';

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', 'https://tt-checkins.vercel.app');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── GET: load submissions ──────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { type, employee, week, month } = req.query;

      // Fetch all submission IDs from the index
      const ids = await kv.lrange('feedback:index', 0, -1);
      if (!ids || ids.length === 0) return res.status(200).json([]);

      // Fetch all records in parallel
      const records = await Promise.all(
        ids.map(id => kv.get(`feedback:${id}`))
      );

      // Filter out nulls (deleted/expired entries)
      let results = records.filter(Boolean);

      // Apply optional filters from query params
      if (type)     results = results.filter(r => r.type === type);
      if (employee) results = results.filter(r => r.employee === employee);
      if (week)     results = results.filter(r => r.week === week);
      if (month)    results = results.filter(r => r.month === month);

      // Sort newest first
      results.sort((a, b) => new Date(b.date) - new Date(a.date));

      return res.status(200).json(results);
    } catch (err) {
      console.error('GET /api/feedback error:', err);
      return res.status(500).json({ error: 'Failed to load submissions' });
    }
  }

  // ── POST: save submission ──────────────────────────────────────
  if (req.method === 'POST') {
    try {
      const data = req.body;

      // Basic validation
      if (!data || !data.type || !data.employee) {
        return res.status(400).json({ error: 'Missing required fields: type, employee' });
      }

      // Generate a unique ID for this submission
      // For weekly/monthly: use a stable key so re-saves overwrite, not duplicate
      let id;
      if (data.type === 'weekly' && data.employee && data.week) {
        id = `weekly__${sanitize(data.employee)}__${sanitize(data.week)}`;
      } else if (data.type === 'monthly' && data.employee && data.month) {
        id = `monthly__${sanitize(data.employee)}__${sanitize(data.month)}`;
      } else if (data.type === 'peer') {
        id = `peer__${Date.now()}__${Math.random().toString(36).slice(2, 8)}`;
      } else {
        id = `misc__${Date.now()}`;
      }

      // Stamp with server time and save
      const record = { ...data, id, savedAt: new Date().toISOString(), released: data.released || false };
      await kv.set(`feedback:${id}`, record);

      // Add to index only if it's a new entry (weekly/monthly overwrite same slot)
      const existing = await kv.lpos('feedback:index', id);
      if (existing === null) {
        await kv.lpush('feedback:index', id);
      }

      return res.status(200).json({ ok: true, id });
    } catch (err) {
      console.error('POST /api/feedback error:', err);
      return res.status(500).json({ error: 'Failed to save submission' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

function sanitize(str) {
  return String(str).replace(/[^a-zA-Z0-9\-_ ]/g, '').replace(/\s+/g, '_').slice(0, 80);
}
