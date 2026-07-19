const express = require('express');
const router = express.Router();
const { query } = require('../database/db');
const { authenticateToken } = require('../middleware/auth');

// ── LOG A TRADE ────────────────────────────────────────────────────────────
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { pair, direction, entry_price, sl_price, tp_price, exit_price, outcome, setup_type, screenshot_url, notes } = req.body;
    if (!pair || !direction || !entry_price || !sl_price || !tp_price) return res.status(400).json({ error: 'pair, direction, entry, SL and TP are required' });
    if (!['buy','sell'].includes(direction)) return res.status(400).json({ error: 'direction must be buy or sell' });

    // Calculate pips and R:R
    const entry = parseFloat(entry_price);
    const sl = parseFloat(sl_price);
    const tp = parseFloat(tp_price);
    const exit = exit_price ? parseFloat(exit_price) : null;

    const isJpy = pair.toUpperCase().includes('JPY');
    const pipMultiplier = isJpy ? 100 : 10000;

    const slPips = Math.abs(entry - sl) * pipMultiplier;
    const tpPips = Math.abs(tp - entry) * pipMultiplier;
    const rr = slPips > 0 ? parseFloat((tpPips / slPips).toFixed(2)) : null;

    let pipsResult = null;
    if (exit !== null) {
      pipsResult = direction === 'buy'
        ? parseFloat(((exit - entry) * pipMultiplier).toFixed(1))
        : parseFloat(((entry - exit) * pipMultiplier).toFixed(1));
    }

    const result = await query(`
      INSERT INTO trade_journal (user_id,pair,direction,entry_price,sl_price,tp_price,exit_price,outcome,setup_type,screenshot_url,notes,pips_result,rr_result)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *
    `, [req.user.id,pair.toUpperCase(),direction,entry_price,sl_price,tp_price,exit_price||null,outcome||'open',setup_type||null,screenshot_url||null,notes||null,pipsResult,rr]);

    res.status(201).json({ message:'Trade logged', trade: result.rows[0] });
  } catch (err) {
    console.error('Journal log error:', err);
    res.status(500).json({ error: 'Failed to log trade' });
  }
});

// ── GET ALL TRADES + STATS ─────────────────────────────────────────────────
router.get('/', authenticateToken, async (req, res) => {
  try {
    const trades = await query('SELECT * FROM trade_journal WHERE user_id=$1 ORDER BY created_at DESC', [req.user.id]);

    const closed = trades.rows.filter(t => t.outcome && t.outcome !== 'open');
    const wins = closed.filter(t => t.outcome === 'win').length;
    const losses = closed.filter(t => t.outcome === 'loss').length;
    const winRate = closed.length > 0 ? parseFloat((wins / closed.length * 100).toFixed(1)) : 0;

    const totalPips = trades.rows.reduce((s,t) => s + (parseFloat(t.pips_result) || 0), 0);
    const avgRR = closed.length > 0
      ? parseFloat((closed.reduce((s,t) => s + (parseFloat(t.rr_result)||0), 0) / closed.length).toFixed(2))
      : 0;

    // Pair breakdown
    const pairMap = {};
    for (const t of closed) {
      if (!pairMap[t.pair]) pairMap[t.pair] = { wins:0, losses:0, total:0 };
      pairMap[t.pair].total++;
      if (t.outcome === 'win') pairMap[t.pair].wins++;
      if (t.outcome === 'loss') pairMap[t.pair].losses++;
    }
    const pairStats = Object.entries(pairMap).map(([pair,s]) => ({ pair, ...s, win_rate: parseFloat((s.wins/s.total*100).toFixed(1)) }))
      .sort((a,b) => b.total - a.total);

    // Equity curve — running pips total
    let running = 0;
    const equityCurve = trades.rows.slice().reverse().map(t => {
      running += parseFloat(t.pips_result) || 0;
      return { date: t.created_at, pips: parseFloat(running.toFixed(1)) };
    });

    res.json({
      trades: trades.rows,
      stats: { total_trades: trades.rows.length, closed_trades: closed.length, wins, losses, win_rate: winRate, total_pips: parseFloat(totalPips.toFixed(1)), avg_rr: avgRR },
      pair_stats: pairStats,
      equity_curve: equityCurve
    });
  } catch (err) {
    console.error('Journal get error:', err);
    res.status(500).json({ error: 'Failed to get journal' });
  }
});

// ── UPDATE TRADE (close it, add exit) ─────────────────────────────────────
router.patch('/:id', authenticateToken, async (req, res) => {
  try {
    const { exit_price, outcome, notes, screenshot_url } = req.body;
    const result = await query('SELECT * FROM trade_journal WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    const trade = result.rows[0];
    if (!trade) return res.status(404).json({ error: 'Trade not found' });

    const entry = parseFloat(trade.entry_price);
    const isJpy = trade.pair.includes('JPY');
    const pipMultiplier = isJpy ? 100 : 10000;
    let pipsResult = trade.pips_result;

    if (exit_price) {
      const exit = parseFloat(exit_price);
      pipsResult = trade.direction === 'buy'
        ? parseFloat(((exit - entry) * pipMultiplier).toFixed(1))
        : parseFloat(((entry - exit) * pipMultiplier).toFixed(1));
    }

    await query(`UPDATE trade_journal SET exit_price=COALESCE($1,exit_price),outcome=COALESCE($2,outcome),notes=COALESCE($3,notes),screenshot_url=COALESCE($4,screenshot_url),pips_result=$5 WHERE id=$6`,
      [exit_price||null, outcome||null, notes||null, screenshot_url||null, pipsResult, req.params.id]);

    res.json({ message:'Trade updated' });
  } catch (err) { res.status(500).json({ error: 'Failed to update trade' }); }
});

// ── DELETE TRADE ───────────────────────────────────────────────────────────
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    await query('DELETE FROM trade_journal WHERE id=$1 AND user_id=$2', [req.params.id, req.user.id]);
    res.json({ message:'Trade deleted' });
  } catch (err) { res.status(500).json({ error: 'Failed to delete trade' }); }
});

module.exports = router;
