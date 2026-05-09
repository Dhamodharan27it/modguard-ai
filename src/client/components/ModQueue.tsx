type Props = {
    queue: any[];
    selected: any;
    onSelect: (item: any) => void;
    onAction: (itemId: string, action: string, author: string) => void;
  };
  
  const severityColors: Record<string, { color: string; bg: string; border: string }> = {
    critical: { color: '#F85149', bg: '#3D1A1A', border: '#F8514966' },
    high:     { color: '#F85149', bg: '#3D1A1A', border: '#F8514944' },
    medium:   { color: '#D29922', bg: '#3D2E0A', border: '#D2992244' },
    low:      { color: '#3FB950', bg: '#1A3D1A', border: '#3FB95044' },
    none:     { color: '#3FB950', bg: '#1A3D1A', border: '#3FB95044' },
  };
  
  const actionStyle: Record<string, { color: string; bg: string; border: string }> = {
    approve:  { color: '#3FB950', bg: '#1A3D1A', border: '#3FB950' },
    remove:   { color: '#F85149', bg: '#3D1A1A', border: '#F85149' },
    escalate: { color: '#D29922', bg: '#3D2E0A', border: '#D29922' },
    ban:      { color: '#BC8CFF', bg: '#2A1A3D', border: '#BC8CFF' },
  };
  
  const actionIcons: Record<string, string> = {
    approve: '✓',
    remove: '✕',
    escalate: '⚠',
    ban: '⊘',
  };
  
  export function ModQueue({ queue, selected, onSelect, onAction }: Props) {
    return (
      <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
  
        {/* Queue List */}
        <div style={{
          width: '220px',
          borderRight: '1px solid #30363D',
          overflow: 'auto',
          background: '#161B22',
          flexShrink: 0,
        }}>
          <div style={{
            padding: '7px 12px',
            fontSize: '9px',
            color: '#8B949E',
            letterSpacing: '1.5px',
            borderBottom: '1px solid #30363D',
            background: '#1C2128',
          }}>MOD QUEUE</div>
  
          {queue.length === 0 ? (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '32px 16px',
              gap: '8px',
            }}>
              <div style={{ fontSize: '24px' }}>✓</div>
              <div style={{ fontSize: '12px', color: '#3FB950' }}>Queue cleared!</div>
              <div style={{ fontSize: '10px', color: '#8B949E' }}>All items resolved</div>
            </div>
          ) : (
            queue.map((item) => {
              const sc = severityColors[item.severity] ?? severityColors.none;
              const isActive = selected?.postId === item.postId;
              return (
                <div
                  key={item.postId}
                  onClick={() => onSelect(item)}
                  style={{
                    padding: '10px 12px',
                    borderBottom: '1px solid #30363D',
                    borderLeft: `2px solid ${isActive ? '#FF4500' : 'transparent'}`,
                    background: isActive ? '#1C2128' : 'transparent',
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                >
                  <div style={{
                    fontSize: '11px',
                    color: '#FF4500',
                    fontWeight: 500,
                    marginBottom: '3px',
                  }}>{item.author}</div>
                  <div style={{
                    fontSize: '10px',
                    color: '#8B949E',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    marginBottom: '5px',
                  }}>{item.content?.slice(0, 44)}...</div>
                  <span style={{
                    display: 'inline-block',
                    fontSize: '9px',
                    padding: '2px 7px',
                    borderRadius: '4px',
                    fontWeight: 500,
                    color: sc.color,
                    background: sc.bg,
                    border: `1px solid ${sc.border}`,
                  }}>
                    {item.confidence}% · {item.violation?.split('/')[0].trim()}
                  </span>
                </div>
              );
            })
          )}
        </div>
  
        {/* Detail Panel */}
        <div style={{
          flex: 1,
          padding: '14px 18px',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: '10px',
        }}>
          {!selected ? (
            <div style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '12px',
              color: '#8B949E',
            }}>← Select an item from the queue</div>
          ) : (
            <>
              {/* AI Tag */}
              <div style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '6px',
                fontSize: '10px',
                color: '#8B949E',
                background: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '4px',
                padding: '3px 9px',
                width: 'fit-content',
              }}>
                <span style={{ color: '#FF4500' }}>◈</span>
                ModGuard AI · analysis complete
                {selected.autoDetected && (
                  <span style={{
                    color: '#3FB950',
                    fontSize: '9px',
                    marginLeft: '4px',
                  }}>· auto-detected</span>
                )}
              </div>
  
              {/* Violation Card */}
              {(() => {
                const sc = severityColors[selected.severity] ?? severityColors.none;
                return (
                  <div style={{
                    borderRadius: '8px',
                    padding: '12px 14px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: sc.bg,
                    border: `1px solid ${sc.border}`,
                  }}>
                    <div>
                      <div style={{
                        fontSize: '9px',
                        color: '#8B949E',
                        marginBottom: '4px',
                        letterSpacing: '1px',
                      }}>DETECTED VIOLATION</div>
                      <div style={{
                        fontSize: '14px',
                        fontWeight: 500,
                        color: sc.color,
                      }}>{selected.violation}</div>
                      {selected.rule && (
                        <div style={{
                          fontSize: '10px',
                          color: '#8B949E',
                          marginTop: '3px',
                        }}>{selected.rule}</div>
                      )}
                      {selected.existingStrikes > 0 && (
                        <div style={{
                          fontSize: '10px',
                          color: '#F85149',
                          marginTop: '4px',
                        }}>⚠️ Existing strikes: {selected.existingStrikes}/5</div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{
                        fontSize: '26px',
                        fontWeight: 500,
                        color: sc.color,
                      }}>{selected.confidence}%</div>
                      <div style={{
                        fontSize: '9px',
                        color: '#8B949E',
                        letterSpacing: '1px',
                      }}>CONFIDENCE</div>
                      <div style={{
                        fontSize: '9px',
                        marginTop: '4px',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        background: sc.bg,
                        color: sc.color,
                        border: `1px solid ${sc.border}`,
                        textTransform: 'uppercase',
                      }}>{selected.severity}</div>
                    </div>
                  </div>
                );
              })()}
  
              {/* Meta */}
              <div style={{
                display: 'flex',
                gap: '10px',
                fontSize: '10px',
                color: '#8B949E',
                flexWrap: 'wrap',
              }}>
                <span>author: <span style={{ color: '#FF4500' }}>{selected.author}</span></span>
                <span>·</span>
                <span>type: <span style={{ color: '#E6EDF3' }}>{selected.type?.toUpperCase()}</span></span>
                <span>·</span>
                <span style={{ color: '#E6EDF3' }}>{new Date(selected.createdAt).toLocaleTimeString()}</span>
                {selected.tier > 0 && (
                  <>
                    <span>·</span>
                    <span>tier: <span style={{ color: '#FF4500' }}>{selected.tier}</span></span>
                  </>
                )}
              </div>
  
              {/* Content */}
              <div style={{
                background: '#161B22',
                border: '1px solid #30363D',
                borderRadius: '8px',
                padding: '11px 13px',
                fontSize: '12px',
                color: '#E6EDF3',
                lineHeight: 1.7,
              }}>{selected.content}</div>
  
              {/* Removal Message */}
              {selected.removalMessage && (
                <div>
                  <div style={{
                    fontSize: '9px',
                    color: '#8B949E',
                    letterSpacing: '1.5px',
                    marginBottom: '5px',
                  }}>AUTO-GENERATED REMOVAL MESSAGE</div>
                  <div style={{
                    background: '#1C2128',
                    border: '1px dashed #30363D',
                    borderRadius: '8px',
                    padding: '9px 13px',
                    fontSize: '11px',
                    color: '#8B949E',
                    lineHeight: 1.6,
                  }}>{selected.removalMessage}</div>
                </div>
              )}
  
              {/* Action Buttons */}
              <div style={{
                display: 'flex',
                gap: '6px',
                marginTop: 'auto',
                paddingTop: '6px',
              }}>
                {['approve', 'remove', 'escalate', 'ban'].map((action) => {
                  const style = actionStyle[action];
                  const isSuggested = selected.suggestedAction === action;
                  return (
                    <button
                      key={action}
                      onClick={() => onAction(selected.postId, action, selected.author)}
                      style={{
                        flex: 1,
                        padding: '9px 4px',
                        borderRadius: '8px',
                        fontSize: '10px',
                        fontWeight: 500,
                        cursor: 'pointer',
                        letterSpacing: '0.5px',
                        fontFamily: 'monospace',
                        border: `1px solid ${isSuggested ? style.border : '#30363D'}`,
                        background: isSuggested ? style.bg : '#161B22',
                        color: isSuggested ? style.color : '#8B949E',
                        transition: 'all 0.15s',
                      }}
                    >
                      {actionIcons[action]} {action.toUpperCase()}
                      {isSuggested && (
                        <span style={{
                          fontSize: '8px',
                          marginLeft: '3px',
                          opacity: 0.8,
                        }}>· AI</span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </div>
    );
  }