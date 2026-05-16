export default function ModGuardDashboard() {
  const stats = [
    { label: 'Total Actioned', value: '1,284' },
    { label: 'Removed', value: '482' },
    { label: 'Approved', value: '601' },
    { label: 'Escalated', value: '74' },
    { label: 'Banned', value: '38' },
    { label: 'Pending Appeals', value: '17' },
  ];

  const queue = [
    {
      author: 'u/RaidSpammer',
      violation: 'Harassment',
      confidence: '96%',
      risk: 'High',
      strikes: 4,
      language: 'English',
      preview: 'Your moderators are useless...'
    },
    {
      author: 'u/ScamDrop22',
      violation: 'Scam Link',
      confidence: '91%',
      risk: 'Critical',
      strikes: 3,
      language: 'English',
      preview: 'Claim your free crypto rewards now...'
    },
    {
      author: 'u/NewAccount445',
      violation: 'Raid Activity',
      confidence: '88%',
      risk: 'Medium',
      strikes: 1,
      language: 'Spanish',
      preview: 'Everyone spam this subreddit now...'
    },
  ];

  const timeline = [
    'AI auto-removed scam content from u/ScamDrop22',
    'Threat detector raised risk to HIGH',
    'Moderator approved appeal for u/HelpfulMember',
    'AI escalated coordinated attack warning',
    'New user added to repeat offender watchlist',
  ];

  const watchlist = [
    { user: 'u/RaidLeader', violations: 9 },
    { user: 'u/ToxicUser77', violations: 6 },
    { user: 'u/SpamNetwork', violations: 11 },
  ];

  const appeals = [
    {
      user: 'u/AppealUser',
      reason: 'I think my meme was misunderstood.',
      status: 'Pending'
    },
    {
      user: 'u/DiscussionGuy',
      reason: 'I was discussing moderation policy.',
      status: 'Pending'
    },
  ];

  return (
    <div className="min-h-screen bg-[#0D1117] text-white p-6 font-mono">
      {/* Header */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-4xl font-bold">🛡 ModGuard AI</h1>
          <p className="text-gray-400 mt-2">
            Advanced AI moderation intelligence dashboard
          </p>
        </div>

        <div className="flex gap-4 flex-wrap">
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl px-5 py-3 shadow-lg">
            <p className="text-sm text-gray-400">Community Health</p>
            <h2 className="text-2xl font-bold text-green-400">91% A+</h2>
          </div>

          <div className="bg-[#161B22] border border-red-500 rounded-2xl px-5 py-3 shadow-lg animate-pulse">
            <p className="text-sm text-gray-400">Threat Level</p>
            <h2 className="text-2xl font-bold text-red-400">HIGH</h2>
          </div>
        </div>
      </div>

      {/* Statistics */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4 mb-8">
        {stats.map((item) => (
          <div
            key={item.label}
            className="bg-[#161B22] border border-[#30363D] rounded-2xl p-5 shadow-lg"
          >
            <p className="text-gray-400 text-sm">{item.label}</p>
            <h3 className="text-3xl font-bold mt-2">{item.value}</h3>
          </div>
        ))}
      </div>

      {/* Main Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        {/* Queue */}
        <div className="xl:col-span-2 bg-[#161B22] border border-[#30363D] rounded-2xl p-5 shadow-xl">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-2xl font-bold">🚨 Live Mod Queue</h2>
            <span className="text-sm bg-red-500/20 text-red-300 px-3 py-1 rounded-full">
              12 Active Flags
            </span>
          </div>

          <div className="space-y-4">
            {queue.map((item, index) => (
              <div
                key={index}
                className="bg-[#0D1117] border border-[#30363D] rounded-xl p-4 hover:border-blue-500 transition-all"
              >
                <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-3">
                  <div>
                    <h3 className="font-bold text-lg">{item.author}</h3>
                    <p className="text-gray-400 text-sm mt-1">
                      {item.preview}
                    </p>
                  </div>

                  <div className="flex gap-2 flex-wrap">
                    <button className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg text-sm font-semibold">
                      Approve
                    </button>

                    <button className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm font-semibold">
                      Remove
                    </button>

                    <button className="bg-yellow-600 hover:bg-yellow-700 px-3 py-2 rounded-lg text-sm font-semibold">
                      Escalate
                    </button>

                    <button className="bg-purple-600 hover:bg-purple-700 px-3 py-2 rounded-lg text-sm font-semibold">
                      Ban
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mt-4 text-sm">
                  <div className="bg-[#161B22] p-2 rounded-lg">
                    <p className="text-gray-400">Violation</p>
                    <p className="font-semibold">{item.violation}</p>
                  </div>

                  <div className="bg-[#161B22] p-2 rounded-lg">
                    <p className="text-gray-400">Confidence</p>
                    <p className="font-semibold text-red-400">{item.confidence}</p>
                  </div>

                  <div className="bg-[#161B22] p-2 rounded-lg">
                    <p className="text-gray-400">Risk</p>
                    <p className="font-semibold">{item.risk}</p>
                  </div>

                  <div className="bg-[#161B22] p-2 rounded-lg">
                    <p className="text-gray-400">Strikes</p>
                    <p className="font-semibold">{item.strikes}</p>
                  </div>

                  <div className="bg-[#161B22] p-2 rounded-lg">
                    <p className="text-gray-400">Language</p>
                    <p className="font-semibold">{item.language}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Side Panels */}
        <div className="space-y-6">
          {/* Threat Detection */}
          <div className="bg-[#161B22] border border-red-500 rounded-2xl p-5 shadow-xl">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-xl font-bold">⚠ Threat Monitor</h2>
              <div className="w-3 h-3 rounded-full bg-red-500 animate-ping"></div>
            </div>

            <div className="space-y-3">
              <div>
                <p className="text-gray-400 text-sm">Threat Probability</p>
                <h3 className="text-3xl font-bold text-red-400">82%</h3>
              </div>

              <div>
                <p className="text-gray-400 text-sm">Signals Detected</p>
                <ul className="list-disc list-inside text-sm mt-1 text-gray-300">
                  <li>Mass new accounts detected</li>
                  <li>Spam pattern escalation</li>
                  <li>External coordination suspected</li>
                </ul>
              </div>

              <button className="w-full bg-red-600 hover:bg-red-700 py-3 rounded-xl font-bold mt-2">
                Activate Slow Mode
              </button>
            </div>
          </div>

          {/* Watchlist */}
          <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-5 shadow-xl">
            <h2 className="text-xl font-bold mb-4">👁 Watchlist</h2>

            <div className="space-y-3">
              {watchlist.map((user, index) => (
                <div
                  key={index}
                  className="bg-[#0D1117] rounded-xl p-3 border border-[#30363D]"
                >
                  <div className="flex justify-between items-center">
                    <p className="font-semibold">{user.user}</p>
                    <span className="text-red-400 font-bold">
                      {user.violations} Violations
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Grid */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 mt-6">
        {/* Timeline */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-5 shadow-xl">
          <h2 className="text-2xl font-bold mb-4">📜 Live Timeline</h2>

          <div className="space-y-3">
            {timeline.map((event, index) => (
              <div
                key={index}
                className="bg-[#0D1117] border border-[#30363D] rounded-xl p-3"
              >
                <div className="flex items-start gap-3">
                  <div className="w-2 h-2 rounded-full bg-blue-500 mt-2"></div>
                  <div>
                    <p>{event}</p>
                    <span className="text-xs text-gray-500">
                      {index + 1} minutes ago
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Appeals */}
        <div className="bg-[#161B22] border border-[#30363D] rounded-2xl p-5 shadow-xl">
          <h2 className="text-2xl font-bold mb-4">⚖ Appeals Queue</h2>

          <div className="space-y-4">
            {appeals.map((appeal, index) => (
              <div
                key={index}
                className="bg-[#0D1117] border border-[#30363D] rounded-xl p-4"
              >
                <div className="flex justify-between items-center mb-2">
                  <h3 className="font-bold">{appeal.user}</h3>
                  <span className="text-yellow-400 text-sm">
                    {appeal.status}
                  </span>
                </div>

                <p className="text-gray-300 text-sm mb-4">
                  {appeal.reason}
                </p>

                <div className="flex gap-2">
                  <button className="bg-green-600 hover:bg-green-700 px-3 py-2 rounded-lg text-sm font-semibold">
                    Approve Appeal
                  </button>

                  <button className="bg-red-600 hover:bg-red-700 px-3 py-2 rounded-lg text-sm font-semibold">
                    Reject Appeal
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
