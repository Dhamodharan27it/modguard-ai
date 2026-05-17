import React from 'react';
import ReactDOM from 'react-dom/client';

function ModGuardDashboard() {
  const stats = [
    { label: 'Total Actioned', value: '1,284' },
    { label: 'Removed', value: '482' },
    { label: 'Approved', value: '601' },
    { label: 'Escalated', value: '74' },
    { label: 'Banned', value: '38' },
    { label: 'Pending Appeals', value: '17' },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        background: '#0D1117',
        color: 'white',
        padding: '30px',
        fontFamily: 'Arial',
      }}
    >
      <h1 style={{ fontSize: '40px' }}>
        🛡 ModGuard AI Dashboard
      </h1>

      <p style={{ color: '#999', marginBottom: '30px' }}>
        Advanced AI moderation intelligence dashboard
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))',
          gap: '20px',
        }}
      >
        {stats.map((item) => (
          <div
            key={item.label}
            style={{
              background: '#161B22',
              padding: '20px',
              borderRadius: '16px',
              border: '1px solid #30363D',
            }}
          >
            <p style={{ color: '#999' }}>{item.label}</p>

            <h2 style={{ fontSize: '32px' }}>
              {item.value}
            </h2>
          </div>
        ))}
      </div>

      <div
        style={{
          marginTop: '40px',
          background: '#161B22',
          padding: '20px',
          borderRadius: '16px',
          border: '1px solid #30363D',
        }}
      >
        <h2>🚨 AI Moderation Active</h2>

        <ul>
          <li>✅ Threat Detection</li>
          <li>✅ Strike System</li>
          <li>✅ AI Analysis</li>
          <li>✅ Appeals Queue</li>
          <li>✅ Watchlist Monitoring</li>
        </ul>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ModGuardDashboard />
  </React.StrictMode>
);