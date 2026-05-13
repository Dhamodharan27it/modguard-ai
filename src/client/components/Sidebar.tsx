
type Props = {
    offenders: any[];
    recentActions: any[];
  };
  
  const actionColors: Record<string, string> = {
    removed: '#F85149',
    approved: '#3FB950',
    escalated: '#D29922',
    ban: '#BC8CFF',
    auto_removed: '#FF4500',
  };
  
  export function Sidebar({ offenders, recentActions }: Props) {
    return (
      <div style={{
        width: '180px',
        borderLeft: '1px solid #30363D',
        overflow: 'auto',
        background: '#161B22',
        flexShrink: 0,
      }}>
        {/* Repeat Offenders */}
        <div style={{
          padding: '7px 12px',
          fontSize: '9px',
          color: '#8B949E',
          letterSpacing: '1.5px',
          borderBottom: '1px solid #30363D',
          background: '#1C2128',
        }}>REPEAT OFFENDERS</div>
  
        {offenders.length === 0 ? (
          <div style={{
            padding: '12px',
            fontSize: '11px',
            color: '#8B949E',
          }}>No repeat offenders</div>
        ) : (
          offenders.map((o) => (
            <div key={o.username} style={{
              padding: '8px 12px',
              borderBottom: '1px solid #30363D',
            }}>
              <div style={{
                fontSize: '11px',
                color: '#FF4500',
                fontWeight: 500,
                marginBottom: '2px',
              }}>{o.username}</div>
              <div style={{
                fontSize: '10px',
                color: '#8B949E',
              }}>{o.violations} violations</div>
              <div style={{
                height: '3px',
                borderRadius: '2px',
                background: '#1C2128',
                marginTop: '4px',
                overflow: 'hidden',
              }}>
                <div style={{
                  height: '100%',
                  borderRadius: '2px',
                  background: '#F85149',
                  width: `${Math.min(100, o.violations * 12)}%`,
                }} />
              </div>
            </div>
          ))
        )}
  
        {/* Recent Actions */}
        <div style={{
          padding: '7px 12px',
          fontSize: '9px',
          color: '#8B949E',
          letterSpacing: '1.5px',
          borderBottom: '1px solid #30363D',
          background: '#1C2128',
          marginTop: '4px',
        }}>RECENT ACTIONS</div>
  
        {recentActions.length === 0 ? (
          <div style={{
            padding: '12px',
            fontSize: '11px',
            color: '#8B949E',
          }}>No actions yet</div>
        ) : (
          recentActions.slice(0, 8).map((log: any, i: number) => (
            <div key={i} style={{
              padding: '8px 12px',
              borderBottom: '1px solid #30363D',
            }}>
              <div style={{
                fontSize: '10px',
                fontWeight: 500,
                color: actionColors[log.action] ?? '#8B949E',
              }}>{log.action?.toUpperCase()}</div>
              <div style={{
                fontSize: '10px',
                color: '#8B949E',
                marginTop: '1px',
                whiteSpace: 'nowrap',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}>{log.author}</div>
            </div>
          ))
        )}
      </div>
    );
  }