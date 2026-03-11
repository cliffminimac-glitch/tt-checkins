// /api/feedback/index.js
// Handles GET (load submissions) and POST (save submission)
// Storage: Vercel Blob — submissions stored as JSON files at feedback/{type}/{employee}/{period}.json

import { put, list } from '@vercel/blob';

const CORS = {
  'Access-Control-Allow-Origin': 'https://tt-checkins.vercel.app',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default async function handler(req, res) {
  Object.entries(CORS).forEach(([k, v]) => res.setHeader(k, v));
  if (req.method === 'OPTIONS') return res.status(200).end();

  // ── GET: load submissions ──────────────────────────────────────
  if (req.method === 'GET') {
    try {
      const { type, employee, week, month } = req.query;

      // Build prefix to narrow the blob list
      let prefix = 'feedback/';
      if (type && employee) {
        const safePeriod = week || month;
        if (safePeriod) {
          // Direct lookup — fetch single blob
          const blobPath = blobKey(type, employee, safePeriod);
          try {
            const blobRes = await fetch(
              `https://blob.vercel-storage.com/${blobPath}`,
              { headers: { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } }
            );
            if (blobRes.ok) {
              const record = await blobRes.json();
              return res.status(200).json([record]);
            }
          } catch (_) { /* fall through to full scan */ }
        }
        prefix = `feedback/${type}/${sanitize(employee)}/`;
      } else if (type) {
        prefix = `feedback/${type}/`;
      }

      // List and fetch all matching blobs
      const { blobs } = await list({ prefix, token: process.env.BLOB_READ_WRITE_TOKEN });
      const token = process.env.BLOB_READ_WRITE_TOKEN;
      const records = await Promise.all(
        blobs.map(b => {
          // Use downloadUrl to bypass CDN caching; fall back to url with cache-bust
          const fetchUrl = b.downloadUrl
            ? b.downloadUrl
            : b.url + (b.url.includes('?') ? '&' : '?') + '_nc=' + Date.now();
          const headers = b.downloadUrl ? { Authorization: `Bearer ${token}` } : {};
          return fetch(fetchUrl, { headers }).then(r => r.ok ? r.json() : null).catch(() => null);
        })
      );

      let results = records.filter(Boolean);

      // Apply remaining filters
      if (employee) results = results.filter(r => r.employee === employee);
      if (week)     results = results.filter(r => r.week === week);
      if (month)    results = results.filter(r => r.month === month);

      // Sort newest first
      results.sort((a, b) => new Date(b.savedAt || b.date) - new Date(a.savedAt || a.date));

      // Deduplicate: keep only the most recent record per (type + employee + period)
      const seen = new Set();
      results = results.filter(r => {
        const period = r.week || r.month || '';
        const key = `${r.type}|${r.employee}|${period}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

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
      if (!data || !data.type || !data.employee) {
        return res.status(400).json({ error: 'Missing required fields: type, employee' });
      }

      // Determine period key
      const period = data.week || data.month || new Date().toISOString().slice(0, 10);
      const key = blobKey(data.type, data.employee, period);

      // Try to load existing record to merge (preserves manager fields if employee is saving, vice-versa)
      let existing = {};
      try {
        const existingBlob = await list({ prefix: key, token: process.env.BLOB_READ_WRITE_TOKEN });
        if (existingBlob.blobs.length > 0) {
          const eb = existingBlob.blobs[0];
          const existUrl = eb.downloadUrl
            ? eb.downloadUrl
            : eb.url + (eb.url.includes('?') ? '&' : '?') + '_nc=' + Date.now();
          const existHeaders = eb.downloadUrl ? { Authorization: `Bearer ${process.env.BLOB_READ_WRITE_TOKEN}` } : {};
          const existingRes = await fetch(existUrl, { headers: existHeaders });
          if (existingRes.ok) existing = await existingRes.json();
        }
      } catch (_) { /* first save, no existing record */ }

      const record = {
        ...existing,
        ...data,
        id: key,
        savedAt: new Date().toISOString(),
        released: data.released ?? existing.released ?? false,
      };

      await put(key, JSON.stringify(record), {
        access: 'public',
        contentType: 'application/json',
        token: process.env.BLOB_READ_WRITE_TOKEN,
        allowOverwrite: true,
      });

      return res.status(200).json({ ok: true, id: key });
    } catch (err) {
      console.error('POST /api/feedback error:', err);
      return res.status(500).json({ error: 'Failed to save submission' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}

// ── Helpers ────────────────────────────────────────────────────────
function sanitize(str) {
  return String(str)
    .toLowerCase()
    .replace(/[^a-z0-9\-_ ]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 80);
}

function blobKey(type, employee, period) {
  return `feedback/${sanitize(type)}/${sanitize(employee)}/${sanitize(period)}.json`;
}
