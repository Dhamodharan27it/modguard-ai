
type Props = {
    stats: any;
  };
  
  export function StatsBar({ stats }: Props) {
    const items = [
      { label: 'IN QUEUE', value: stats?.totalActioned ?? 0, color: '#D29922' },
      { label: 'REMOVED', value: stats?.totalRemoved ?? 0, color: '#F85149' },
      { label: 'APPROVED', value: stats?.totalApproved ?? 0, color: '#3FB950' },
      { label: 'ESCALATED', value: stats?.totalEscalated ?? 0, color: '#D29922' },
      { label: 'BANNED', value: stats?.totalBanned ?? 0, color: '#BC8CFF' },
      { label: 'AUTO REMOVED', value: stats?.autoRemoved ?? 0, color: '#FF4500' },
      { label: 'CRITICAL', value: stats?.criticalAlerts ?? 0, color: '#F85149' },
    ];
  
    return (
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(7, 1fr)',
        gap: '6px',
        padding: '8px 12px',
        borderBottom: '1px solid #30363D',
        background: '#161B22',
      }}>
        {items.map((item) => (
          <div key={item.label} style={{
            background: '#0D1117',
            border: '1px solid #30363D',
            borderRadius: '8px',
            padding: '8px 10px',
            textAlign: 'center',
          }}>
            <div style={{
              fontSize: '18px',
              fontWeight: 500,
              color: item.color,
            }}>{item.value}</div>
            <div style={{
              fontSize: '9px',
              color: '#8B949E',
              marginTop: '2px',
              letterSpacing: '0.5px',
            }}>{item.label}</div>
          </div>
        ))}
      </div>
    );
}