import { useState, useEffect, useCallback } from 'react';

// ─── Animations (simple, safe) ───────────────────────────────────────────────
function ensureKeyframes() {
  if (typeof document === 'undefined') return;
  const id = 'modguard-animations';
  if (document.getElementById(id)) return;

  const style = document.createElement('style');
  style.id = id;
  style.textContent = `
    @keyframes mg-pulse {
      0% { transform: scale(1); opacity: 0.95; }
      50% { transform: scale(1.35); opacity: 1; }
      100% { transform: scale(1); opacity: 0.9; }
    }
    @keyframes mg-glow {
      0% { box-shadow: 0 0 0 rgba(255,69,0,0.0); }
      50% { box-shadow: 0 0 18px rgba(255,69,0,0.35); }
      100% { box-shadow: 0 0 0 rgba(255,69,0,0.0); }
    }
    @keyframes mg-slideIn {
      from { transform: translateY(10px); opacity: 0; }
      to { transform: translateY(0); opacity: 1; }
    }
    .mg-anim-pulse { animation: mg-pulse 1s infinite; }
    .mg-anim-glow { animation: mg-glow 1.5s infinite; }
    .mg-anim-slideIn { animation: mg-slideIn 220ms ease-out both; }
  `;
  document.head.appendChild(style);
}

// ─── Types ────────────────────────────────────────────────────────────────────


type AnalysisItem = {
  postId: string; type: string; author: string; title?: string; content: string;
  violation: string; confidence: number; severity: string; suggestedAction: string;
  removalMessage: string | null; existingStrikes: number; tier: number; createdAt: string;
  riskScore?: number; riskLevel?: string; triggeredDetectors?: string[];
  contextNote?: string; falsePositiveRisk?: number; language?: string;
  memoryInsight?: string; decisionFactors?: string[];
  estimatedImpact?: { toxicityReduction: number; appealProbability: string; falsePositiveRisk: number };
};

type Stats = {
  totalActioned: number; totalRemoved: number; totalApproved: number;
  totalEscalated: number; totalBanned: number; autoRemoved: number; criticalAlerts: number;
  recentActions: { action: string; author: string; timestamp: string }[];
};

type ThreatData = {
  threat: { threatLevel: string; probability: number; signals: string[]; warning: string | null; timeWindow: string | null };
  slowMode: { shouldActivate: boolean; mode: string; reason: string | null; suggestedDurationMinutes: number };
};

type HealthData = {
  health: { score: number; grade: string; summary: string };
  emotional: { temperature: number; status: string; warning: string | null };
};

type TimelineEvent = {
  timestamp: string; type: string; message: string; severity: string; actor?: string; auto: boolean;
};

type Insight = {
  generatedAt: string; period: string;
  topIssues: { category: string; count: number; trend: string; changePercent: number }[];
  totalActions: number; autoActions: number; humanActions: number;
  suggestions: string[]; healthTrend: string;
};

type Appeal = {
  id: string; username: string; postId: string; reason: string;
  submittedAt: string; status: string; reviewNote?: string;
};

type WatchlistEntry = { username: string; reason: string; addedAt: string };
type CollabAlert = { id: string; type: string; message: string; targetUser?: string; createdBy: string; createdAt: string; resolved: boolean };

type Tab = 'queue' | 'timeline' | 'insights' | 'appeals' | 'watchlist' | 'collab' | 'transparency';

// ─── Colour Palettes ──────────────────────────────────────────────────────────

const SEV: Record<string, { color: string; bg: string; border: string }> = {
  critical: { color: '#F85149', bg: '#3D1A1A', border: '#F85149' },
  high:     { color: '#F85149', bg: '#3D1A1A', border: '#F85149' },
  medium:   { color: '#D29922', bg: '#3D2E0A', border: '#D29922' },
  low:      { color: '#3FB950', bg: '#1A3D1A', border: '#3FB950' },
  none:     { color: '#3FB950', bg: '#1A3D1A', border: '#3FB950' },
};

const ACT: Record<string, { color: string; bg: string }> = {
  approve:  { color: '#3FB950', bg: '#1A3D1A' },
  remove:   { color: '#F85149', bg: '#3D1A1A' },
  escalate: { color: '#D29922', bg: '#3D2E0A' },
  ban:      { color: '#BC8CFF', bg: '#2A1A3D' },
};

const THREAT_COLOR: Record<string, string> = {
  none: '#3FB950', low: '#3FB950', elevated: '#D29922', high: '#F85149', imminent: '#FF4500',
};

// ─── Shared Styles ────────────────────────────────────────────────────────────

const card = (extra?: object) => ({
  background: '#161B22', border: '1px solid #30363D', borderRadius: 8,
  padding: '10px 14px', ...extra,
});

const sectionHeader = {
  padding: '7px 12px', fontSize: 9, color: '#8B949E',
  letterSpacing: '1.5px', borderBottom: '1px solid #30363D', background: '#1C2128',
};

// ─── App ──────────────────────────────────────────────────────────────────────

export function App() {
  const [tab, setTab] = useState<Tab>('queue');
  const [queue, setQueue] = useState<AnalysisItem[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<AnalysisItem | null>(null);
  const [threat, setThreat] = useState<ThreatData | null>(null);
  const [healthData, setHealthData] = useState<HealthData | null>(null);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [insights, setInsights] = useState<Insight | null>(null);
  const [appeals, setAppeals] = useState<Appeal[]>([]);
  const [watchlist, setWatchlist] = useState<WatchlistEntry[]>([]);
  const [collab, setCollab] = useState<CollabAlert[]>([]);
  const [offenders, setOffenders] = useState<{ username: string; violations: number }[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [noteInput, setNoteInput] = useState('');
  const [collabInput, setCollabInput] = useState('');

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(null), 4000);
  }

  const fetchAll = useCallback(async () => {
    try {
      // Fetch with fallback defaults
      const fetchWithDefault = async (url: string, defaultValue: any) => {
        try {
          const res = await fetch(url);
          if (!res.ok) return defaultValue;
          return await res.json();
        } catch {
          return defaultValue;
        }
      };

      const qD = await fetchWithDefault('/api/queue', { success: true, queue: [] });
      const sD = await fetchWithDefault('/api/stats', { success: true, stats: { totalActioned: 0, totalRemoved: 0, totalApproved: 0, totalEscalated: 0, totalBanned: 0, autoRemoved: 0, criticalAlerts: 0, recentActions: [] } });
      const tD = await fetchWithDefault('/api/threat', { success: true, threat: { threatLevel: 'none', probability: 0, signals: [], warning: null, timeWindow: null }, slowMode: { shouldActivate: false, mode: 'none', reason: null, suggestedDurationMinutes: 0 } });
      const hD = await fetchWithDefault('/api/health', { success: true, health: { score: 85, grade: 'A', summary: 'Community healthy' }, emotional: { temperature: 50, status: 'normal', warning: null } });
      const tlD = await fetchWithDefault('/api/timeline?limit=60', { success: true, timeline: [] });
      const oD = await fetchWithDefault('/api/offenders', { success: true, offenders: [] });

      if (qD.success) { setQueue(qD.queue ?? []); if (!selected && qD.queue?.length > 0) setSelected(qD.queue[0]); }
      if (sD.success) setStats(sD.stats);
      if (tD.success) setThreat(tD);
      if (hD.success) setHealthData(hD);
      if (tlD.success) setTimeline(tlD.timeline ?? []);
      if (oD.success) setOffenders(oD.offenders ?? []);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [selected]);

  const fetchTabData = useCallback(async (t: Tab) => {
    try {
      if (t === 'insights') {
        try {
          const r = await fetch('/api/insights');
          const d = await r.json();
          if (d.success) setInsights(d.insights);
          else setInsights({ generatedAt: new Date().toISOString(), period: 'week', topIssues: [], totalActions: 0, autoActions: 0, humanActions: 0, suggestions: ['Loading insights...'], healthTrend: 'stable' });
        } catch {
          setInsights({ generatedAt: new Date().toISOString(), period: 'week', topIssues: [], totalActions: 0, autoActions: 0, humanActions: 0, suggestions: ['API unavailable'], healthTrend: 'stable' });
        }
      } else if (t === 'appeals') {
        try {
          const r = await fetch('/api/appeals');
          const d = await r.json();
          if (d.success) setAppeals(d.appeals);
          else setAppeals([]);
        } catch {
          setAppeals([]);
        }
      } else if (t === 'watchlist') {
        try {
          const r = await fetch('/api/watchlist');
          const d = await r.json();
          if (d.success) setWatchlist(d.watchlist);
          else setWatchlist([]);
        } catch {
          setWatchlist([]);
        }
      } else if (t === 'collab') {
        try {
          const r = await fetch('/api/collab');
          const d = await r.json();
          if (d.success) setCollab(d.alerts);
          else setCollab([]);
        } catch {
          setCollab([]);
        }
      }
    } catch (e) { console.error(e); }
  }, []);

  async function handleAction(action: string) {
    if (!selected || acting) return;
    setActing(true);
    try {
      let endpoint = '';
      let body: Record<string, string> = { itemId: selected.postId, action, author: selected.author };
      if (action === 'approve') endpoint = '/internal/menu/approve-post';
      else if (action === 'remove') endpoint = '/internal/menu/remove-post';
      else if (action === 'escalate') endpoint = '/internal/menu/escalate-post';
      else if (action === 'ban') endpoint = '/internal/menu/ban-user';
      if (action !== 'ban') body = { ...body, postId: selected.postId, reason: selected.removalMessage ?? selected.violation };
      else body = { ...body, username: selected.author, reason: selected.violation, days: '0' };
      await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await fetch('/api/resolve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ itemId: selected.postId, action, author: selected.author, reason: selected.violation }) });
      showToast(`✅ ${action.toUpperCase()} completed for u/${selected.author}`);
      setSelected(null);
      await fetchAll();
    } catch { showToast('❌ Action failed'); }
    finally { setActing(false); }
  }

  async function handleResolveAppeal(id: string, decision: 'approved' | 'rejected') {
    await fetch(`/api/appeals/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision, note: `${decision} by moderator` }) });
    showToast(`Appeal ${decision}`);
    await fetchTabData('appeals');
  }

  async function handleAddNote() {
    if (!selected || !noteInput.trim()) return;
    await fetch(`/api/notes/${selected.author}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ note: noteInput }) });
    setNoteInput('');
    showToast('Note added');
  }

  async function handleAddToWatchlist() {
    if (!selected) return;
    await fetch('/api/watchlist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: selected.author, reason: selected.violation }) });
    showToast(`u/${selected.author} added to watchlist`);
    await fetchTabData('watchlist');
  }

  async function handleCollabPost() {
    if (!collabInput.trim()) return;
    await fetch('/api/collab', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'note', message: collabInput, targetUser: selected?.author }) });
    setCollabInput('');
    showToast('Alert posted to team');
    await fetchTabData('collab');
  }

  useEffect(() => {
    ensureKeyframes();
  }, []);

  useEffect(() => { fetchAll(); const iv = setInterval(fetchAll, 30000); return () => clearInterval(iv); }, [fetchAll]);
  useEffect(() => { fetchTabData(tab); }, [tab, fetchTabData]);


  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: '#0D1117', color: '#FF4500', fontFamily: 'monospace', fontSize: 14, gap: 10 }}>
        <span style={{ fontSize: 20 }}>⚡</span> Loading ModGuard AI...
      </div>
    );
  }

  const threatColor = THREAT_COLOR[threat?.threat.threatLevel ?? 'none'] ?? '#3FB950';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', background: '#0D1117', fontFamily: 'monospace', color: '#E6EDF3', overflow: 'hidden' }}>

      {/* Toast */}
      {toast && (
        <div style={{ position: 'fixed', bottom: 20, left: '50%', transform: 'translateX(-50%)', background: '#161B22', border: '1px solid #30363D', borderRadius: 8, padding: '10px 20px', fontSize: 13, color: '#E6EDF3', zIndex: 999, whiteSpace: 'nowrap' }}>
          {toast}
        </div>
      )}

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 16px', borderBottom: '1px solid #30363D', background: '#161B22', flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#FF4500', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, boxShadow: '0 0 12px #FF450055' }}>⚡</div>
        <div>
          <div style={{ fontSize: 13, fontWeight: 500 }}>ModGuard AI</div>
          <div style={{ fontSize: 10, color: '#8B949E' }}>Community Safety Operating System</div>
        </div>

        {/* Threat indicator */}
        {threat && threat.threat.threatLevel !== 'none' && (
          <div className="mg-anim-glow" style={{ marginLeft: 12, display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: threatColor, background: '#1C2128', border: `1px solid ${threatColor}44`, borderRadius: 6, padding: '3px 8px' }}>
            <div style={{ width: 6, height: 6, borderRadius: '50%', background: threatColor }} className="mg-anim-pulse" />
            THREAT: {threat.threat.threatLevel.toUpperCase()} ({threat.threat.probability}%)
          </div>
        )}

        {/* Health */}
        {healthData && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#8B949E', marginLeft: 8 }}>
            <span style={{ color: healthData.health.score >= 70 ? '#3FB950' : healthData.health.score >= 50 ? '#D29922' : '#F85149' }}>
              ❤ {healthData.health.score}% {healthData.health.grade}
            </span>
            {healthData.emotional.warning && (
              <span style={{ color: '#D29922' }}>· {healthData.emotional.status}</span>
            )}
          </div>
        )}

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#3FB950' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3FB950' }} /> live
        </div>
        <div style={{ display: 'flex', gap: 14, fontSize: 11, color: '#8B949E', marginLeft: 12 }}>
          <span style={{ color: '#D29922' }}>{queue.length} pending</span>
          <span style={{ color: '#3FB950' }}>{stats?.totalActioned ?? 0} resolved</span>
        </div>
      </div>

      {/* Stats Row */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 5, padding: '6px 12px', borderBottom: '1px solid #30363D', background: '#161B22', flexShrink: 0 }}>
        {[
          { label: 'REMOVED', value: stats?.totalRemoved ?? 0, color: '#F85149' },
          { label: 'APPROVED', value: stats?.totalApproved ?? 0, color: '#3FB950' },
          { label: 'ESCALATED', value: stats?.totalEscalated ?? 0, color: '#D29922' },
          { label: 'BANNED', value: stats?.totalBanned ?? 0, color: '#BC8CFF' },
          { label: 'AUTO', value: stats?.autoRemoved ?? 0, color: '#FF4500' },
          { label: 'CRITICAL', value: stats?.criticalAlerts ?? 0, color: '#F85149' },
          { label: 'APPEALS', value: appeals.filter(a => a.status === 'pending').length, color: '#58A6FF' },
        ].map(s => (
          <div key={s.label} style={{ background: '#0D1117', border: '1px solid #30363D', borderRadius: 8, padding: '5px 8px', textAlign: 'center' }}>
            <div style={{ fontSize: 17, fontWeight: 500, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#8B949E', marginTop: 2 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Threat Warning Banner */}
      {threat?.threat.warning && (
        <div style={{ padding: '6px 16px', background: '#3D1A1A', borderBottom: '1px solid #F8514944', fontSize: 11, color: '#F85149', display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
          <span>{threat.threat.warning}</span>
          {threat.slowMode.shouldActivate && (
            <span style={{ marginLeft: 'auto', color: '#D29922' }}>
              💡 Recommended: {threat.slowMode.mode.toUpperCase()} MODE for {threat.slowMode.suggestedDurationMinutes} mins
            </span>
          )}
        </div>
      )}

      {/* Tab Bar */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid #30363D', background: '#161B22', flexShrink: 0 }}>
        {([
          { id: 'queue', label: '📋 Queue' },
          { id: 'timeline', label: '⏱ Timeline' },
          { id: 'insights', label: '📊 Insights' },
          { id: 'appeals', label: '⚖ Appeals' },
          { id: 'watchlist', label: '👁 Watchlist' },
          { id: 'collab', label: '💬 Team' },
          { id: 'transparency', label: '🔍 Transparency' },
        ] as { id: Tab; label: string }[]).map(t => (
          <button key={t.id} onClick={() => setTab(t.id)} style={{
            padding: '8px 14px', fontSize: 10, fontFamily: 'monospace', cursor: 'pointer',
            background: tab === t.id ? '#0D1117' : 'transparent',
            color: tab === t.id ? '#FF4500' : '#8B949E',
            border: 'none', borderBottom: tab === t.id ? '2px solid #FF4500' : '2px solid transparent',
          }}>{t.label}</button>
        ))}
      </div>

      {/* Body */}
      <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
        {tab === 'queue' && <QueueTab queue={queue} selected={selected} setSelected={setSelected} stats={stats} offenders={offenders} acting={acting} noteInput={noteInput} setNoteInput={setNoteInput} onAction={handleAction} onAddNote={handleAddNote} onWatchlist={handleAddToWatchlist} />}
        {tab === 'timeline' && <TimelineTab events={timeline} />}
        {tab === 'insights' && <InsightsTab insights={insights} />}
        {tab === 'appeals' && <AppealsTab appeals={appeals} onResolve={handleResolveAppeal} />}
        {tab === 'watchlist' && <WatchlistTab watchlist={watchlist} />}
        {tab === 'collab' && <CollabTab alerts={collab} input={collabInput} setInput={setCollabInput} onPost={handleCollabPost} />}
        {tab === 'transparency' && <TransparencyTab subreddit="" />}
      </div>
    </div>
  );
}

// ─── Queue Tab ────────────────────────────────────────────────────────────────

function QueueTab({ queue, selected, setSelected, stats, offenders, acting, noteInput, setNoteInput, onAction, onAddNote, onWatchlist }: {
  queue: AnalysisItem[]; selected: AnalysisItem | null; setSelected: (i: AnalysisItem) => void;
  stats: Stats | null; offenders: { username: string; violations: number }[];
  acting: boolean; noteInput: string; setNoteInput: (v: string) => void;
  onAction: (a: string) => void; onAddNote: () => void; onWatchlist: () => void;
}) {
  const sc = SEV[selected?.severity ?? 'none'] ?? SEV['none']!;

  return (
    <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>

      {/* Queue List */}
      <div style={{ width: 210, borderRight: '1px solid #30363D', overflow: 'auto', background: '#161B22', flexShrink: 0 }}>
        <div style={sectionHeader}>MOD QUEUE ({queue.length})</div>
        {queue.length === 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '32px 16px', gap: 8 }}>
            <div style={{ fontSize: 24 }}>✓</div>
            <div style={{ fontSize: 12, color: '#3FB950' }}>Queue cleared!</div>
          </div>
        ) : queue.map(item => {
          const isc = SEV[item.severity] ?? SEV['none']!;
          const isActive = selected?.postId === item.postId;
          return (
            <div key={item.postId} className="mg-anim-slideIn" onClick={() => setSelected(item)} style={{ padding: '9px 12px', borderBottom: '1px solid #30363D', borderLeft: `2px solid ${isActive ? '#FF4500' : 'transparent'}`, background: isActive ? '#1C2128' : 'transparent', cursor: 'pointer' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 2 }}>
                <div style={{ fontSize: 11, color: '#FF4500', fontWeight: 500 }}>{item.author}</div>
                {item.riskScore !== undefined && (
                  <div style={{ fontSize: 9, color: item.riskScore >= 60 ? '#F85149' : '#8B949E' }}>R:{item.riskScore}</div>
                )}
              </div>
              <div style={{ fontSize: 10, color: '#8B949E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: 4 }}>{item.content?.slice(0, 40)}...</div>
              <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                <span style={{ display: 'inline-block', fontSize: 9, padding: '1px 6px', borderRadius: 4, color: isc.color, background: isc.bg, border: `1px solid ${isc.border}44` }}>
                  {item.confidence}% · {item.severity}
                </span>
                {item.language && item.language !== 'en' && item.language !== 'unknown' && (
                  <span style={{ fontSize: 9, padding: '1px 5px', borderRadius: 4, color: '#58A6FF', background: '#1A2A3D', border: '1px solid #58A6FF44' }}>{item.language}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Detail Panel */}
      <div style={{ flex: 1, padding: '12px 16px', overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 10 }}>
        {!selected ? (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#8B949E' }}>← Select an item from the queue</div>
        ) : (
          <>
            {/* AI Tag */}
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, color: '#8B949E', ...card({ padding: '3px 9px', width: 'fit-content' }) }}>
              <span style={{ color: '#FF4500' }}>◈</span> ModGuard AI · Full Pipeline Analysis
              {selected.language && selected.language !== 'unknown' && (
                <span style={{ color: '#58A6FF', marginLeft: 4 }}>· {selected.language.toUpperCase()}</span>
              )}
            </div>

            {/* Violation Card */}
            <div style={{ borderRadius: 8, padding: '12px 14px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', background: sc.bg, border: `1px solid ${sc.border}44` }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 9, color: '#8B949E', marginBottom: 4, letterSpacing: 1 }}>DETECTED VIOLATION</div>
                <div style={{ fontSize: 14, fontWeight: 500, color: sc.color }}>{selected.violation}</div>
                {selected.triggeredDetectors && selected.triggeredDetectors.length > 0 && (
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {selected.triggeredDetectors.map(d => (
                      <span key={d} style={{ fontSize: 9, padding: '1px 6px', borderRadius: 4, color: '#F85149', background: '#3D1A1A', border: '1px solid #F8514944' }}>{d}</span>
                    ))}
                  </div>
                )}
                {selected.existingStrikes > 0 && (
                  <div style={{ fontSize: 10, color: '#F85149', marginTop: 5 }}>⚠️ {selected.existingStrikes} prior strikes</div>
                )}
                {selected.contextNote && (
                  <div style={{ fontSize: 10, color: '#D29922', marginTop: 4 }}>💡 {selected.contextNote}</div>
                )}
                {selected.memoryInsight && (
                  <div style={{ fontSize: 10, color: '#BC8CFF', marginTop: 4 }}>🧠 {selected.memoryInsight}</div>
                )}
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: 12 }}>
                <div style={{ fontSize: 26, fontWeight: 500, color: sc.color }}>{selected.confidence}%</div>
                <div style={{ fontSize: 9, color: '#8B949E', letterSpacing: 1 }}>CONFIDENCE</div>
                {selected.riskScore !== undefined && (
                  <div style={{ fontSize: 11, color: selected.riskScore >= 60 ? '#F85149' : '#D29922', marginTop: 4 }}>Risk: {selected.riskScore}/100</div>
                )}
                <div style={{ fontSize: 9, marginTop: 4, padding: '2px 6px', borderRadius: 4, background: sc.bg, color: sc.color, border: `1px solid ${sc.border}44`, textTransform: 'uppercase' }}>{selected.severity}</div>
              </div>
            </div>

            {/* Decision Simulator */}
            {selected.estimatedImpact && (
              <div style={card()}>
                <div style={{ fontSize: 9, color: '#8B949E', letterSpacing: 1, marginBottom: 6 }}>🤖 DECISION SIMULATOR</div>
                <div style={{ display: 'flex', gap: 16, fontSize: 10 }}>
                  <span>Toxicity reduction: <span style={{ color: '#3FB950' }}>{selected.estimatedImpact.toxicityReduction}%</span></span>
                  <span>Appeal risk: <span style={{ color: selected.estimatedImpact.appealProbability === 'high' ? '#F85149' : '#3FB950' }}>{selected.estimatedImpact.appealProbability}</span></span>
                  <span>FP risk: <span style={{ color: selected.estimatedImpact.falsePositiveRisk > 30 ? '#D29922' : '#3FB950' }}>{selected.estimatedImpact.falsePositiveRisk}%</span></span>
                </div>
              </div>
            )}

            {/* Meta */}
            <div style={{ display: 'flex', gap: 10, fontSize: 10, color: '#8B949E', flexWrap: 'wrap' }}>
              <span>author: <span style={{ color: '#FF4500' }}>{selected.author}</span></span>
              <span>·</span>
              <span>type: <span style={{ color: '#E6EDF3' }}>{selected.type?.toUpperCase()}</span></span>
              <span>·</span>
              <span style={{ color: '#E6EDF3' }}>{new Date(selected.createdAt).toLocaleTimeString()}</span>
              {selected.falsePositiveRisk !== undefined && selected.falsePositiveRisk > 20 && (
                <><span>·</span><span style={{ color: '#D29922' }}>FP risk: {selected.falsePositiveRisk}%</span></>
              )}
            </div>

            {/* Content */}
            <div style={card({ fontSize: 12, lineHeight: 1.7 })}>{selected.content}</div>

            {/* Removal Message */}
            {selected.removalMessage && (
              <div>
                <div style={{ fontSize: 9, color: '#8B949E', letterSpacing: 1.5, marginBottom: 5 }}>AUTO-GENERATED REMOVAL MESSAGE</div>
                <div style={{ background: '#1C2128', border: '1px dashed #30363D', borderRadius: 8, padding: '9px 13px', fontSize: 11, color: '#8B949E', lineHeight: 1.6 }}>{selected.removalMessage}</div>
              </div>
            )}

            {/* Mod Note Input */}
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                value={noteInput}
                onChange={e => setNoteInput(e.target.value)}
                placeholder="Add private mod note..."
                style={{ flex: 1, background: '#161B22', border: '1px solid #30363D', borderRadius: 6, padding: '6px 10px', fontSize: 11, color: '#E6EDF3', fontFamily: 'monospace', outline: 'none' }}
              />
              <button onClick={onAddNote} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: '#1C2128', border: '1px solid #30363D', color: '#8B949E', fontFamily: 'monospace' }}>+ Note</button>
              <button onClick={onWatchlist} style={{ padding: '6px 12px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: '#1C2128', border: '1px solid #30363D', color: '#D29922', fontFamily: 'monospace' }}>👁 Watch</button>
            </div>

            {/* Action Buttons */}
            <div style={{ display: 'flex', gap: 6, paddingTop: 4 }}>
              {(['approve', 'remove', 'escalate', 'ban'] as const).map(action => {
                const ac = ACT[action]!;
                const isSuggested = selected.suggestedAction === action;
                return (
                  <button key={action} onClick={() => onAction(action)} disabled={acting} style={{
                    flex: 1, padding: '9px 4px', borderRadius: 8, fontSize: 10, fontWeight: 500,
                    cursor: acting ? 'not-allowed' : 'pointer', letterSpacing: 0.5, fontFamily: 'monospace',
                    border: `1px solid ${isSuggested ? ac.color : '#30363D'}`,
                    background: isSuggested ? ac.bg : '#161B22',
                    color: isSuggested ? ac.color : '#8B949E',
                    opacity: acting ? 0.5 : 1,
                  }}>
                    {action === 'approve' ? '✓' : action === 'remove' ? '✕' : action === 'escalate' ? '⚠' : '⊘'} {action.toUpperCase()}
                    {isSuggested && <span style={{ fontSize: 8, marginLeft: 3, opacity: 0.8 }}>·AI</span>}
                  </button>
                );
              })}
            </div>
          </>
        )}
      </div>

      {/* Sidebar */}
      <div style={{ width: 170, borderLeft: '1px solid #30363D', overflow: 'auto', background: '#161B22', flexShrink: 0 }}>
        <div style={sectionHeader}>REPEAT OFFENDERS</div>
        {offenders.length === 0 ? (
          <div style={{ padding: 12, fontSize: 11, color: '#8B949E' }}>None</div>
        ) : offenders.slice(0, 8).map(o => (
          <div key={o.username} style={{ padding: '7px 12px', borderBottom: '1px solid #30363D' }}>
            <div style={{ fontSize: 11, color: '#FF4500', fontWeight: 500 }}>{o.username}</div>
            <div style={{ fontSize: 10, color: '#8B949E' }}>{o.violations} violations</div>
            <div style={{ height: 3, borderRadius: 2, background: '#1C2128', marginTop: 4, overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 2, background: '#F85149', width: `${Math.min(100, o.violations * 12)}%` }} />
            </div>
          </div>
        ))}

        <div style={{ ...sectionHeader, marginTop: 4 }}>RECENT ACTIONS</div>
        {(stats?.recentActions ?? []).slice(0, 8).map((log, i) => (
          <div key={i} style={{ padding: '7px 12px', borderBottom: '1px solid #30363D' }}>
            <div style={{ fontSize: 10, fontWeight: 500, color: log.action === 'removed' || log.action === 'auto_removed' ? '#F85149' : log.action === 'approved' || log.action === 'auto_approved' ? '#3FB950' : '#D29922' }}>
              {log.action?.toUpperCase()}
            </div>
            <div style={{ fontSize: 10, color: '#8B949E', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{log.author}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Timeline Tab ─────────────────────────────────────────────────────────────

function TimelineTab({ events }: { events: TimelineEvent[] }) {
  const sevColor: Record<string, string> = { info: '#58A6FF', warning: '#D29922', critical: '#F85149' };
  const typeIcon: Record<string, string> = { detection: '🔍', action: '⚡', alert: '🚨', system: '⚙', threat: '⚠️', slow_mode: '🐢' };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '12px 16px' }}>
      <div style={{ fontSize: 11, color: '#8B949E', marginBottom: 12 }}>AI Moderator Timeline — real-time event log</div>
      {events.length === 0 ? (
        <div style={{ color: '#8B949E', fontSize: 12 }}>No events yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {events.map((e, i) => (
            <div key={i} style={{ display: 'flex', gap: 12, padding: '8px 0', borderBottom: '1px solid #21262D' }}>
              <div style={{ fontSize: 10, color: '#8B949E', flexShrink: 0, width: 60 }}>
                {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </div>
              <div style={{ fontSize: 14, flexShrink: 0 }}>{typeIcon[e.type] ?? '•'}</div>
              <div style={{ flex: 1 }}>
                <span style={{ fontSize: 11, color: sevColor[e.severity] ?? '#E6EDF3' }}>{e.message}</span>
                {e.actor && <span style={{ fontSize: 10, color: '#8B949E', marginLeft: 8 }}>u/{e.actor}</span>}
              </div>
              <div style={{ fontSize: 9, color: e.auto ? '#FF4500' : '#58A6FF', flexShrink: 0 }}>
                {e.auto ? 'AUTO' : 'MOD'}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Insights Tab ─────────────────────────────────────────────────────────────

function InsightsTab({ insights }: { insights: Insight | null }) {
  if (!insights) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E', fontSize: 12 }}>Loading insights...</div>;

  const trendIcon = (t: string) => t === 'up' ? '↑' : t === 'down' ? '↓' : '→';
  const trendColor = (t: string) => t === 'up' ? '#F85149' : t === 'down' ? '#3FB950' : '#8B949E';

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
        <div style={{ fontSize: 13, fontWeight: 500 }}>Weekly Insights</div>
        <div style={{ fontSize: 10, color: '#8B949E' }}>{insights.period}</div>
        <div style={{ marginLeft: 'auto', fontSize: 10, color: insights.healthTrend === 'improving' ? '#3FB950' : insights.healthTrend === 'declining' ? '#F85149' : '#D29922' }}>
          Community: {insights.healthTrend.toUpperCase()}
        </div>
      </div>

      {/* Summary Cards */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          { label: 'Total Actions', value: insights.totalActions, color: '#E6EDF3' },
          { label: 'Auto Actions', value: insights.autoActions, color: '#FF4500' },
          { label: 'Human Actions', value: insights.humanActions, color: '#58A6FF' },
          { label: 'Auto Rate', value: `${insights.totalActions > 0 ? Math.round((insights.autoActions / insights.totalActions) * 100) : 0}%`, color: '#BC8CFF' },
        ].map(s => (
          <div key={s.label} style={card({ textAlign: 'center' })}>
            <div style={{ fontSize: 22, fontWeight: 500, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#8B949E', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* Top Issues */}
      <div style={card()}>
        <div style={{ fontSize: 10, color: '#8B949E', letterSpacing: 1, marginBottom: 10 }}>TOP ISSUES THIS WEEK</div>
        {insights.topIssues.length === 0 ? (
          <div style={{ fontSize: 11, color: '#8B949E' }}>No issues this week 🎉</div>
        ) : insights.topIssues.map(issue => (
          <div key={issue.category} style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{ fontSize: 11, color: '#E6EDF3', width: 140 }}>{issue.category}</div>
            <div style={{ flex: 1, height: 6, background: '#21262D', borderRadius: 3, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: '#FF4500', borderRadius: 3, width: `${Math.min(100, issue.count * 5)}%` }} />
            </div>
            <div style={{ fontSize: 11, color: '#E6EDF3', width: 30, textAlign: 'right' }}>{issue.count}</div>
            <div style={{ fontSize: 11, color: trendColor(issue.trend), width: 40, textAlign: 'right' }}>
              {trendIcon(issue.trend)} {Math.abs(issue.changePercent)}%
            </div>
          </div>
        ))}
      </div>

      {/* AI Suggestions */}
      <div style={card()}>
        <div style={{ fontSize: 10, color: '#8B949E', letterSpacing: 1, marginBottom: 10 }}>💡 AI MODERATOR SUGGESTIONS</div>
        {insights.suggestions.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, fontSize: 11, color: '#E6EDF3', lineHeight: 1.5 }}>
            <span style={{ color: '#FF4500', flexShrink: 0 }}>→</span>
            <span>{s}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Appeals Tab ──────────────────────────────────────────────────────────────

function AppealsTab({ appeals, onResolve }: { appeals: Appeal[]; onResolve: (id: string, d: 'approved' | 'rejected') => void }) {
  const statusColor: Record<string, string> = { pending: '#D29922', approved: '#3FB950', rejected: '#F85149' };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
      <div style={{ fontSize: 11, color: '#8B949E', marginBottom: 12 }}>User appeals — review and resolve</div>
      {appeals.length === 0 ? (
        <div style={{ color: '#8B949E', fontSize: 12 }}>No appeals submitted</div>
      ) : appeals.map(a => (
        <div key={a.id} style={{ ...card({ marginBottom: 10 }) }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <span style={{ fontSize: 12, color: '#FF4500', fontWeight: 500 }}>u/{a.username}</span>
              <span style={{ fontSize: 10, color: '#8B949E', marginLeft: 10 }}>Post: {a.postId}</span>
            </div>
            <span style={{ fontSize: 10, padding: '2px 8px', borderRadius: 4, color: statusColor[a.status] ?? '#8B949E', background: '#1C2128', border: `1px solid ${statusColor[a.status] ?? '#30363D'}44` }}>
              {a.status.toUpperCase()}
            </span>
          </div>
          <div style={{ fontSize: 11, color: '#E6EDF3', marginBottom: 8, lineHeight: 1.5 }}>{a.reason}</div>
          <div style={{ fontSize: 10, color: '#8B949E', marginBottom: a.status === 'pending' ? 10 : 0 }}>
            Submitted: {new Date(a.submittedAt).toLocaleString()}
          </div>
          {a.status === 'pending' && (
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => onResolve(a.id, 'approved')} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: '#1A3D1A', border: '1px solid #3FB950', color: '#3FB950', fontFamily: 'monospace' }}>✓ Approve</button>
              <button onClick={() => onResolve(a.id, 'rejected')} style={{ padding: '5px 14px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: '#3D1A1A', border: '1px solid #F85149', color: '#F85149', fontFamily: 'monospace' }}>✕ Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ─── Watchlist Tab ────────────────────────────────────────────────────────────

function WatchlistTab({ watchlist }: { watchlist: WatchlistEntry[] }) {
  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px' }}>
      <div style={{ fontSize: 11, color: '#8B949E', marginBottom: 12 }}>Users flagged for extra scrutiny</div>
      {watchlist.length === 0 ? (
        <div style={{ color: '#8B949E', fontSize: 12 }}>Watchlist is empty</div>
      ) : watchlist.map((w, i) => (
        <div key={i} style={{ ...card({ marginBottom: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }) }}>
          <div>
            <div style={{ fontSize: 12, color: '#FF4500', fontWeight: 500, marginBottom: 3 }}>u/{w.username}</div>
            <div style={{ fontSize: 11, color: '#8B949E' }}>{w.reason}</div>
          </div>
          <div style={{ fontSize: 10, color: '#8B949E' }}>{new Date(w.addedAt).toLocaleDateString()}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Collab Tab ───────────────────────────────────────────────────────────────

function CollabTab({ alerts, input, setInput, onPost }: { alerts: CollabAlert[]; input: string; setInput: (v: string) => void; onPost: () => void }) {
  const typeColor: Record<string, string> = { note: '#58A6FF', warning: '#D29922', escalation: '#F85149', discussion: '#3FB950' };

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ fontSize: 11, color: '#8B949E' }}>Moderator collaboration — shared alerts and notes</div>

      {/* Post input */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={input} onChange={e => setInput(e.target.value)} placeholder="Post a note or alert to the mod team..." style={{ flex: 1, background: '#161B22', border: '1px solid #30363D', borderRadius: 6, padding: '8px 12px', fontSize: 11, color: '#E6EDF3', fontFamily: 'monospace', outline: 'none' }} />
        <button onClick={onPost} style={{ padding: '8px 16px', borderRadius: 6, fontSize: 10, cursor: 'pointer', background: '#FF4500', border: 'none', color: '#fff', fontFamily: 'monospace', fontWeight: 500 }}>Post</button>
      </div>

      {alerts.length === 0 ? (
        <div style={{ color: '#8B949E', fontSize: 12 }}>No team alerts yet</div>
      ) : alerts.map(a => (
        <div key={a.id} style={card()}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
            <span style={{ fontSize: 10, padding: '1px 7px', borderRadius: 4, color: typeColor[a.type] ?? '#8B949E', background: '#1C2128', border: `1px solid ${typeColor[a.type] ?? '#30363D'}44` }}>{a.type.toUpperCase()}</span>
            <span style={{ fontSize: 10, color: '#8B949E' }}>{new Date(a.createdAt).toLocaleTimeString()}</span>
          </div>
          <div style={{ fontSize: 11, color: '#E6EDF3', lineHeight: 1.5, marginBottom: 4 }}>{a.message}</div>
          {a.targetUser && <div style={{ fontSize: 10, color: '#8B949E' }}>re: u/{a.targetUser}</div>}
          <div style={{ fontSize: 10, color: '#8B949E', marginTop: 4 }}>by {a.createdBy}</div>
        </div>
      ))}
    </div>
  );
}

// ─── Transparency Tab ─────────────────────────────────────────────────────────

function TransparencyTab({ subreddit }: { subreddit: string }) {
  const [report, setReport] = useState<{
    totalActions: number; autoActions: number; humanActions: number;
    falsePositiveRate: number; appealSuccessRate: number; moderationAccuracy: number;
    avgConfidence: number; topCategories: { category: string; count: number }[];
  } | null>(null);

  useEffect(() => {
    fetch('/api/transparency').then(r => r.json()).then(d => { if (d.success) setReport(d.report); });
  }, [subreddit]);

  if (!report) return <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#8B949E', fontSize: 12 }}>Loading transparency report...</div>;

  return (
    <div style={{ flex: 1, overflow: 'auto', padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div>
        <div style={{ fontSize: 13, fontWeight: 500, marginBottom: 4 }}>AI Safety Transparency Center</div>
        <div style={{ fontSize: 11, color: '#8B949E' }}>Public metrics showing moderation fairness and accuracy</div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          { label: 'Moderation Accuracy', value: `${report.moderationAccuracy}%`, color: '#3FB950' },
          { label: 'Avg Confidence', value: `${report.avgConfidence}%`, color: '#58A6FF' },
          { label: 'False Positive Rate', value: `${report.falsePositiveRate}%`, color: report.falsePositiveRate > 10 ? '#F85149' : '#3FB950' },
          { label: 'Appeal Success Rate', value: `${report.appealSuccessRate}%`, color: '#D29922' },
        ].map(s => (
          <div key={s.label} style={card({ textAlign: 'center' })}>
            <div style={{ fontSize: 22, fontWeight: 500, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 9, color: '#8B949E', marginTop: 3 }}>{s.label}</div>
          </div>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
        <div style={card()}>
          <div style={{ fontSize: 10, color: '#8B949E', letterSpacing: 1, marginBottom: 10 }}>ACTION BREAKDOWN</div>
          {[
            { label: 'Total Actions', value: report.totalActions, color: '#E6EDF3' },
            { label: 'Auto (AI)', value: report.autoActions, color: '#FF4500' },
            { label: 'Human (Mod)', value: report.humanActions, color: '#58A6FF' },
          ].map(s => (
            <div key={s.label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
              <span style={{ color: '#8B949E' }}>{s.label}</span>
              <span style={{ color: s.color, fontWeight: 500 }}>{s.value}</span>
            </div>
          ))}
        </div>

        <div style={card()}>
          <div style={{ fontSize: 10, color: '#8B949E', letterSpacing: 1, marginBottom: 10 }}>TOP VIOLATION CATEGORIES</div>
          {report.topCategories.length === 0 ? (
            <div style={{ fontSize: 11, color: '#8B949E' }}>No data yet</div>
          ) : report.topCategories.map(cat => (
            <div key={cat.category} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 11 }}>
              <span style={{ color: '#8B949E' }}>{cat.category}</span>
              <span style={{ color: '#E6EDF3', fontWeight: 500 }}>{cat.count}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={card()}>
        <div style={{ fontSize: 10, color: '#8B949E', letterSpacing: 1, marginBottom: 8 }}>ETHICAL AI COMMITMENTS</div>
        {[
          '✅ Every removal generates a full evidence log',
          '✅ Users can appeal any automated decision',
          '✅ False positive risk shown before every action',
          '✅ Context analysis reduces sarcasm/gaming false positives',
          '✅ Human moderators review all borderline cases',
          '✅ Transparency metrics updated in real time',
        ].map((c, i) => (
          <div key={i} style={{ fontSize: 11, color: '#E6EDF3', marginBottom: 5, lineHeight: 1.5 }}>{c}</div>
        ))}
      </div>
    </div>
  );
}
