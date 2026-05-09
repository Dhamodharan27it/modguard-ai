import { useState, useEffect } from 'react';
import { ModQueue } from './components/ModQueue';
import { StatsBar } from './components/StatsBar';
import { Sidebar } from './components/Sidebar';

export function App() {
  const [queue, setQueue] = useState<any[]>([]);
  const [stats, setStats] = useState<any>(null);
  const [offenders, setOffenders] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  // Fetch queue from our API
  async function fetchQueue() {
    try {
      const res = await fetch('/api/queue');
      const data = await res.json();
      if (data.success) {
        setQueue(data.queue);
        if (!selected && data.queue.length > 0) {
          setSelected(data.queue[0]);
        }
      }
    } catch (error) {
      console.error('Failed to fetch queue:', error);
    }
  }

  // Fetch stats
  async function fetchStats() {
    try {
      const res = await fetch('/api/stats');
      const data = await res.json();
      if (data.success) setStats(data.stats);
    } catch (error) {
      console.error('Failed to fetch stats:', error);
    }
  }

  // Fetch offenders
  async function fetchOffenders() {
    try {
      const res = await fetch('/api/offenders');
      const data = await res.json();
      if (data.success) setOffenders(data.offenders);
    } catch (error) {
      console.error('Failed to fetch offenders:', error);
    }
  }

  // Handle mod action
  async function handleAction(itemId: string, action: string, author: string) {
    try {
      // Call appropriate endpoint
      if (action === 'approve') {
        await fetch('/internal/menu/approve-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ postId: itemId }),
        });
      } else if (action === 'remove') {
        await fetch('/internal/menu/remove-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postId: itemId,
            reason: selected?.removalMessage ?? 'Removed for violating community rules.',
          }),
        });
      } else if (action === 'escalate') {
        await fetch('/internal/menu/escalate-post', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            postId: itemId,
            reason: selected?.violation ?? 'Escalated for review.',
          }),
        });
      } else if (action === 'ban') {
        await fetch('/internal/menu/ban-user', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            username: author,
            reason: selected?.violation ?? 'Banned for violating community rules.',
            days: 0,
          }),
        });
      }

      // Resolve from queue
      await fetch('/api/resolve', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ itemId, action, author }),
      });

      // Refresh everything
      await fetchQueue();
      await fetchStats();
      await fetchOffenders();
      setSelected(null);
    } catch (error) {
      console.error('Action failed:', error);
    }
  }

  // Load data on mount + refresh every 30 seconds
  useEffect(() => {
    async function loadAll() {
      setLoading(true);
      await Promise.all([fetchQueue(), fetchStats(), fetchOffenders()]);
      setLoading(false);
    }
    loadAll();
    const interval = setInterval(loadAll, 30000);
    return () => clearInterval(interval);
  }, []);

  if (loading) {
    return (
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        height: '100vh',
        background: '#0D1117',
        color: '#FF4500',
        fontFamily: 'monospace',
        fontSize: '14px',
        gap: '10px',
      }}>
        <span style={{ fontSize: '20px' }}>⚡</span>
        Loading ModGuard AI...
      </div>
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100vh',
      background: '#0D1117',
      fontFamily: 'monospace',
      color: '#E6EDF3',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 16px',
        borderBottom: '1px solid #30363D',
        background: '#161B22',
      }}>
        <div style={{
          width: '28px', height: '28px',
          borderRadius: '8px',
          background: '#FF4500',
          display: 'flex', alignItems: 'center',
          justifyContent: 'center',
          fontSize: '14px',
          boxShadow: '0 0 12px #FF450055',
        }}>⚡</div>
        <div>
          <div style={{ fontSize: '13px', fontWeight: 500 }}>ModGuard AI</div>
          <div style={{ fontSize: '10px', color: '#8B949E' }}>AI-powered mod dashboard</div>
        </div>
        <div style={{
          marginLeft: 'auto',
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '10px',
          color: '#3FB950',
        }}>
          <div style={{
            width: '6px', height: '6px',
            borderRadius: '50%',
            background: '#3FB950',
            animation: 'pulse 2s infinite',
          }} />
          live
        </div>
        <div style={{ display: 'flex', gap: '16px', fontSize: '11px', color: '#8B949E', marginLeft: '16px' }}>
          <span style={{ color: '#D29922' }}>{queue.length} pending</span>
          <span style={{ color: '#3FB950' }}>{stats?.totalActioned ?? 0} resolved</span>
        </div>
      </div>

      {/* Stats Bar */}
      <StatsBar stats={stats} />

      {/* Main Body */}
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
        {/* Queue */}
        <ModQueue
          queue={queue}
          selected={selected}
          onSelect={setSelected}
          onAction={handleAction}
        />

        {/* Sidebar */}
        <Sidebar
          offenders={offenders}
          recentActions={stats?.recentActions ?? []}
        />
      </div>
    </div>
  );
}