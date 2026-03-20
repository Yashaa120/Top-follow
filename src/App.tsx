import React, { useState, useEffect } from 'react';
import { Bot, MessageSquare, ShieldCheck, Zap, ExternalLink, RefreshCw, CheckCircle2, AlertCircle, Users, Settings, Send, Plus, Trash2, Edit2, Save, X } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

interface UserData {
  id: string;
  username: string;
  firstName: string;
  points: number;
  referrals: number;
  referredBy: string | null;
  joined: boolean;
}

interface BotSettings {
  dailyCode: string;
  activeCodes: string[];
  referralPoints: number;
}

export default function App() {
  const [view, setView] = useState<'public' | 'admin'>('public');
  const [status, setStatus] = useState<{ status: string; name: string; messages: any[]; settings: BotSettings }>({ 
    status: 'Loading...', 
    name: '', 
    messages: [],
    settings: { dailyCode: '', activeCodes: [], referralPoints: 1 }
  });
  const [loading, setLoading] = useState(true);
  const [adminUsers, setAdminUsers] = useState<UserData[]>([]);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [isBroadcasting, setIsBroadcasting] = useState(false);
  const [editingUser, setEditingUser] = useState<UserData | null>(null);
  const [isAdminLoggedIn, setIsAdminLoggedIn] = useState(localStorage.getItem('adminToken') === 'admin-token-123');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: adminUsername, password: adminPassword })
      });
      const data = await res.json();
      if (data.success) {
        localStorage.setItem('adminToken', data.token);
        setIsAdminLoggedIn(true);
        setLoginError('');
      } else {
        setLoginError('Invalid credentials');
      }
    } catch (err) {
      setLoginError('Login failed');
    }
  };

  const handleLogout = () => {
    localStorage.removeItem('adminToken');
    setIsAdminLoggedIn(false);
  };

  const getAdminHeaders = () => ({
    'Content-Type': 'application/json',
    'x-admin-token': localStorage.getItem('adminToken') || ''
  });

  const fetchStatus = async () => {
    try {
      const res = await fetch('/api/bot-status');
      if (!res.ok) throw new Error(`HTTP error! status: ${res.status}`);
      const data = await res.json();
      setStatus(data);
    } catch (err) {
      console.error('Failed to fetch bot status:', err);
    } finally {
      setLoading(false);
    }
  };

  const fetchAdminUsers = async () => {
    try {
      const res = await fetch('/api/admin/users', {
        headers: getAdminHeaders()
      });
      if (res.status === 403) {
        handleLogout();
        return;
      }
      const data = await res.json();
      setAdminUsers(data);
    } catch (err) {
      console.error('Failed to fetch admin users:', err);
    }
  };

  useEffect(() => {
    fetchStatus();
    const interval = setInterval(fetchStatus, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (view === 'admin') {
      fetchAdminUsers();
    }
  }, [view]);

  const updateSettings = async (newSettings: Partial<BotSettings>) => {
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify(newSettings)
      });
      if (res.ok) fetchStatus();
      else if (res.status === 403) handleLogout();
    } catch (err) {
      console.error('Failed to update settings:', err);
    }
  };

  const updateUserPoints = async (userId: string, points: number) => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/points`, {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ points })
      });
      if (res.ok) {
        fetchAdminUsers();
        setEditingUser(null);
      } else if (res.status === 403) {
        handleLogout();
      }
    } catch (err) {
      console.error('Failed to update user points:', err);
    }
  };

  const handleBroadcast = async () => {
    if (!broadcastMsg) return;
    setIsBroadcasting(true);
    try {
      const res = await fetch('/api/admin/broadcast', {
        method: 'POST',
        headers: getAdminHeaders(),
        body: JSON.stringify({ message: broadcastMsg })
      });
      if (res.ok) {
        const data = await res.json();
        alert(`Broadcast complete! Success: ${data.successCount}, Failed: ${data.failCount}`);
        setBroadcastMsg('');
      } else if (res.status === 403) {
        handleLogout();
      }
    } catch (err) {
      console.error('Broadcast failed:', err);
    } finally {
      setIsBroadcasting(false);
    }
  };

  return (
    <div className="min-h-screen bg-zinc-50 font-sans text-zinc-900">
      {/* Header */}
      <header className="border-b border-zinc-200 bg-white sticky top-0 z-10">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <div className="bg-indigo-600 p-1.5 rounded-lg">
                <Zap className="w-5 h-5 text-white" />
              </div>
              <h1 className="font-semibold text-lg tracking-tight">LootSystem</h1>
            </div>
            
            <nav className="hidden md:flex items-center gap-1 bg-zinc-100 p-1 rounded-xl">
              <button 
                onClick={() => setView('public')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'public' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                Overview
              </button>
              <button 
                onClick={() => setView('admin')}
                className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-all ${view === 'admin' ? 'bg-white shadow-sm text-indigo-600' : 'text-zinc-500 hover:text-zinc-700'}`}
              >
                Admin Panel
              </button>
            </nav>
          </div>

          <div className="flex items-center gap-4">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-medium ${
              status.status === 'Connected' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' :
              status.status === 'Waiting for Token' ? 'bg-amber-50 text-amber-700 border border-amber-200' :
              'bg-rose-50 text-rose-700 border border-rose-200'
            }`}>
              <div className={`w-1.5 h-1.5 rounded-full ${
                status.status === 'Connected' ? 'bg-emerald-500 animate-pulse' :
                status.status === 'Waiting for Token' ? 'bg-amber-500' :
                'bg-rose-500'
              }`} />
              {status.status === 'Connected' ? 'Bot Active' : status.status}
            </div>
            <button 
              onClick={() => { setLoading(true); fetchStatus(); if(view === 'admin') fetchAdminUsers(); }}
              className="p-2 hover:bg-zinc-100 rounded-lg transition-colors"
            >
              <RefreshCw className={`w-4 h-4 text-zinc-500 ${loading ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-12">
        <AnimatePresence mode="wait">
          {view === 'public' ? (
            <motion.div 
              key="public"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="grid grid-cols-1 lg:grid-cols-3 gap-8"
            >
              {/* Main Content */}
              <div className="lg:col-span-2 space-y-8">
                <section>
                  <h2 className="text-3xl font-bold tracking-tight mb-4">Loot System Bot</h2>
                  <p className="text-zinc-500 text-lg leading-relaxed">
                    Your bot is now specialized in the Loot System. 
                    Users can refer friends, earn points, and redeem Shein coupons for free.
                  </p>
                </section>

                <div className="space-y-6">
                  <Step 
                    number="01"
                    title="Redeem Rewards"
                    description="Users can redeem their earned points for Shein coupons and other loot."
                    icon={<Zap className="w-5 h-5" />}
                  />
                  <Step 
                    number="02"
                    title="Refer & Earn"
                    description="Encourage users to invite their friends to grow the community and earn more points."
                    icon={<CheckCircle2 className="w-5 h-5" />}
                  />
                  <Step 
                    number="03"
                    title="Profile Tracking"
                    description="Users can check their points and referral status directly in the bot."
                    icon={<MessageSquare className="w-5 h-5" />}
                  />
                  <Step 
                    number="04"
                    title="AI Powered"
                    description="Your bot uses Gemini AI to answer any questions about the Loot System."
                    icon={<ShieldCheck className="w-5 h-5" />}
                    isLast
                  />
                </div>
              </div>

              {/* Sidebar / Status Card */}
              <div className="space-y-6">
                <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="font-semibold mb-4 flex items-center gap-2">
                    <Bot className="w-4 h-4 text-indigo-600" />
                    Bot Status
                  </h3>
                  
                  <div className="space-y-4">
                    <div className="p-4 bg-zinc-50 rounded-xl border border-zinc-100">
                      <div className="text-xs text-zinc-400 uppercase font-bold tracking-wider mb-1">Username</div>
                      <div className="font-mono text-sm">
                        {status.name ? `@${status.name}` : 'Not configured'}
                      </div>
                    </div>

                    {status.status === 'Connected' ? (
                      <div className="flex items-start gap-3 p-4 bg-emerald-50 rounded-xl border border-emerald-100">
                        <CheckCircle2 className="w-5 h-5 text-emerald-600 mt-0.5" />
                        <div>
                          <div className="font-medium text-emerald-900 text-sm">Online</div>
                          <p className="text-xs text-emerald-700 mt-1">Your bot is responding to messages!</p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 p-4 bg-amber-50 rounded-xl border border-amber-100">
                        <AlertCircle className="w-5 h-5 text-amber-600 mt-0.5" />
                        <div>
                          <div className="font-medium text-amber-900 text-sm">Offline</div>
                          <p className="text-xs text-amber-700 mt-1">Add your token to the secrets to start the bot.</p>
                        </div>
                      </div>
                    )}
                  </div>

                  <button 
                    onClick={() => window.open(`https://t.me/${status.name}`, '_blank')}
                    disabled={!status.name || status.name === 'Unknown'}
                    className="w-full mt-6 bg-indigo-600 text-white py-2.5 rounded-xl font-medium hover:bg-indigo-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    Open in Telegram
                    <ExternalLink className="w-4 h-4" />
                  </button>
                </div>

                <div className="bg-zinc-900 text-white rounded-2xl p-6">
                  <h3 className="font-semibold mb-2">Loot System Features</h3>
                  <div className="space-y-2">
                    <div className="text-xs font-mono text-indigo-400">🎁 Redeem Loot - Get rewards</div>
                    <div className="text-xs font-mono text-indigo-400">🤝 Refer & Earn - Invite friends</div>
                    <div className="text-xs font-mono text-emerald-400">Join Check - Access Restricted UI</div>
                    <div className="text-xs font-mono text-red-400">Verification - Real-time Join Check</div>
                    <p className="text-xs text-zinc-500 italic">Rewards are updated automatically.</p>
                  </div>
                </div>

                {/* Recent Messages */}
                <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
                  <h3 className="font-semibold mb-4 flex items-center gap-2 text-sm text-zinc-500 uppercase tracking-wider">
                    Recent Activity
                  </h3>
                  <div className="space-y-4 max-h-[300px] overflow-y-auto pr-2">
                    {status.messages && status.messages.length > 0 ? (
                      status.messages.map((msg, i) => (
                        <div key={i} className="border-l-2 border-indigo-100 pl-3 py-1">
                          <div className="flex justify-between items-center mb-1">
                            <span className="text-xs font-bold text-zinc-700">{msg.user}</span>
                            <span className="text-[10px] text-zinc-400">{msg.time}</span>
                          </div>
                          <p className="text-sm text-zinc-600 line-clamp-2">{msg.text}</p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-zinc-400 italic text-center py-4">No messages yet...</p>
                    )}
                  </div>
                </div>
              </div>
            </motion.div>
          ) : !isAdminLoggedIn ? (
            <motion.div 
              key="login"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="max-w-md mx-auto bg-white border border-zinc-200 rounded-3xl p-8 shadow-xl"
            >
              <div className="text-center mb-8">
                <div className="w-16 h-16 bg-indigo-100 rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <ShieldCheck className="w-8 h-8 text-indigo-600" />
                </div>
                <h2 className="text-2xl font-bold">Admin Login</h2>
                <p className="text-zinc-500 text-sm">Enter credentials to access the dashboard</p>
              </div>

              <form onSubmit={handleLogin} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5 ml-1">Username</label>
                  <input 
                    type="text"
                    value={adminUsername}
                    onChange={(e) => setAdminUsername(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="admin"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1.5 ml-1">Password</label>
                  <input 
                    type="password"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    className="w-full bg-zinc-50 border border-zinc-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                    placeholder="••••••••"
                    required
                  />
                </div>
                {loginError && (
                  <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50 p-3 rounded-xl border border-red-100">
                    <AlertCircle className="w-4 h-4" />
                    {loginError}
                  </div>
                )}
                <button 
                  type="submit"
                  className="w-full bg-indigo-600 text-white font-bold py-3 rounded-xl hover:bg-indigo-700 transition-all shadow-lg shadow-indigo-200 active:scale-[0.98]"
                >
                  Access Dashboard
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div 
              key="admin"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -20 }}
              className="space-y-8"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-3xl font-bold tracking-tight">Admin Dashboard</h2>
                  <p className="text-zinc-500">Manage your bot's users, codes, and settings.</p>
                </div>
                <div className="flex gap-4">
                  <button 
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-4 py-2 bg-zinc-100 hover:bg-zinc-200 text-zinc-700 rounded-xl text-sm font-medium transition-all"
                  >
                    <X className="w-4 h-4" />
                    Logout
                  </button>
                  <div className="bg-white border border-zinc-200 rounded-xl px-4 py-2 shadow-sm">
                    <div className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Total Users</div>
                    <div className="text-xl font-bold text-indigo-600">{adminUsers.length}</div>
                  </div>
                  <div className="bg-white border border-zinc-200 rounded-xl px-4 py-2 shadow-sm">
                    <div className="text-[10px] text-zinc-400 uppercase font-bold tracking-wider">Referral Pts</div>
                    <div className="text-xl font-bold text-indigo-600">{status.settings.referralPoints}</div>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* User Management */}
                <div className="lg:col-span-2 space-y-6">
                  <div className="bg-white border border-zinc-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="p-6 border-b border-zinc-100 flex items-center justify-between">
                      <h3 className="font-semibold flex items-center gap-2">
                        <Users className="w-4 h-4 text-indigo-600" />
                        User Management
                      </h3>
                      <div className="text-xs text-zinc-400">{adminUsers.length} users registered</div>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead className="bg-zinc-50 text-zinc-500 uppercase text-[10px] font-bold tracking-wider">
                          <tr>
                            <th className="px-6 py-3">User</th>
                            <th className="px-6 py-3">Points</th>
                            <th className="px-6 py-3">Referrals</th>
                            <th className="px-6 py-3">Status</th>
                            <th className="px-6 py-3 text-right">Actions</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-zinc-100">
                          {adminUsers.map((user) => (
                            <tr key={user.id} className="hover:bg-zinc-50 transition-colors">
                              <td className="px-6 py-4">
                                <div className="font-medium text-zinc-900">{user.firstName}</div>
                                <div className="text-xs text-zinc-400">@{user.username || 'no_username'}</div>
                                <div className="text-[10px] font-mono text-zinc-300">{user.id}</div>
                              </td>
                              <td className="px-6 py-4 font-mono font-bold text-indigo-600">
                                {editingUser?.id === user.id ? (
                                  <input 
                                    type="number" 
                                    value={editingUser.points}
                                    onChange={(e) => setEditingUser({ ...editingUser, points: parseInt(e.target.value) || 0 })}
                                    className="w-16 px-2 py-1 border border-indigo-200 rounded bg-white"
                                  />
                                ) : (
                                  user.points
                                )}
                              </td>
                              <td className="px-6 py-4 text-zinc-500">{user.referrals}</td>
                              <td className="px-6 py-4">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${user.joined ? 'bg-emerald-50 text-emerald-600' : 'bg-zinc-100 text-zinc-400'}`}>
                                  {user.joined ? 'Joined' : 'Pending'}
                                </span>
                              </td>
                              <td className="px-6 py-4 text-right">
                                {editingUser?.id === user.id ? (
                                  <div className="flex justify-end gap-2">
                                    <button onClick={() => updateUserPoints(user.id, editingUser.points)} className="p-1.5 bg-emerald-50 text-emerald-600 rounded-lg hover:bg-emerald-100">
                                      <Save className="w-4 h-4" />
                                    </button>
                                    <button onClick={() => setEditingUser(null)} className="p-1.5 bg-rose-50 text-rose-600 rounded-lg hover:bg-rose-100">
                                      <X className="w-4 h-4" />
                                    </button>
                                  </div>
                                ) : (
                                  <button onClick={() => setEditingUser(user)} className="p-1.5 hover:bg-zinc-100 rounded-lg text-zinc-400 hover:text-indigo-600 transition-colors">
                                    <Edit2 className="w-4 h-4" />
                                  </button>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>

                {/* Sidebar Controls */}
                <div className="space-y-6">
                  {/* Settings */}
                  <div className="bg-white border border-zinc-200 rounded-2xl p-6 shadow-sm">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Settings className="w-4 h-4 text-indigo-600" />
                      Bot Settings
                    </h3>
                    <div className="space-y-4">
                      <div>
                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1 block">Daily Code</label>
                        <div className="flex gap-2">
                          <input 
                            type="text" 
                            value={status.settings.dailyCode}
                            onChange={(e) => updateSettings({ dailyCode: e.target.value })}
                            className="flex-1 px-3 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm font-mono"
                          />
                        </div>
                      </div>
                      <div>
                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1 block">Referral Points</label>
                        <input 
                          type="number" 
                          value={status.settings.referralPoints}
                          onChange={(e) => updateSettings({ referralPoints: parseInt(e.target.value) || 0 })}
                          className="w-full px-3 py-2 bg-zinc-50 border border-zinc-100 rounded-xl text-sm font-mono"
                        />
                      </div>
                      <div>
                        <label className="text-xs font-bold text-zinc-400 uppercase tracking-wider mb-1 block">Active Codes</label>
                        <div className="space-y-2">
                          {status.settings.activeCodes.map((code, i) => (
                            <div key={i} className="flex items-center justify-between bg-zinc-50 px-3 py-2 rounded-xl border border-zinc-100">
                              <span className="text-sm font-mono">{code}</span>
                              <button 
                                onClick={() => updateSettings({ activeCodes: status.settings.activeCodes.filter((_, idx) => idx !== i) })}
                                className="text-rose-500 hover:bg-rose-50 p-1 rounded-lg transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          ))}
                          <div className="flex gap-2">
                            <input 
                              type="text" 
                              placeholder="New code..."
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  const val = e.currentTarget.value;
                                  if (val) {
                                    updateSettings({ activeCodes: [...status.settings.activeCodes, val] });
                                    e.currentTarget.value = '';
                                  }
                                }
                              }}
                              className="flex-1 px-3 py-2 bg-white border border-zinc-200 rounded-xl text-sm font-mono"
                            />
                            <div className="bg-zinc-100 p-2 rounded-xl">
                              <Plus className="w-4 h-4 text-zinc-400" />
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Broadcast */}
                  <div className="bg-zinc-900 text-white rounded-2xl p-6 shadow-lg">
                    <h3 className="font-semibold mb-4 flex items-center gap-2">
                      <Send className="w-4 h-4 text-indigo-400" />
                      Broadcast Message
                    </h3>
                    <p className="text-xs text-zinc-400 mb-4 leading-relaxed">
                      Send an HTML-formatted message to all registered users. Use <b>bold</b>, <i>italic</i>, or <code>code</code>.
                    </p>
                    <textarea 
                      value={broadcastMsg}
                      onChange={(e) => setBroadcastMsg(e.target.value)}
                      placeholder="Enter message..."
                      rows={4}
                      className="w-full bg-zinc-800 border border-zinc-700 rounded-xl p-3 text-sm text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500 mb-4"
                    />
                    <button 
                      onClick={handleBroadcast}
                      disabled={isBroadcasting || !broadcastMsg}
                      className="w-full bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed text-white py-2.5 rounded-xl font-medium transition-all flex items-center justify-center gap-2"
                    >
                      {isBroadcasting ? 'Sending...' : 'Send Broadcast'}
                      <Send className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Step({ number, title, description, icon, link, isLast }: { 
  number: string; 
  title: string; 
  description: string; 
  icon: React.ReactNode;
  link?: string;
  isLast?: boolean;
}) {
  return (
    <div className="flex gap-6">
      <div className="flex flex-col items-center">
        <div className="w-10 h-10 rounded-full bg-white border-2 border-indigo-600 flex items-center justify-center font-bold text-indigo-600 z-10">
          {number}
        </div>
        {!isLast && <div className="w-0.5 h-full bg-zinc-200 -mt-1" />}
      </div>
      <div className="pb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="text-zinc-400">{icon}</div>
          <h3 className="font-bold text-xl">{title}</h3>
        </div>
        <p className="text-zinc-500 leading-relaxed max-w-lg">
          {description}
        </p>
        {link && (
          <a 
            href={link} 
            target="_blank" 
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-indigo-600 font-medium mt-3 hover:underline"
          >
            Go to @BotFather
            <ExternalLink className="w-3 h-3" />
          </a>
        )}
      </div>
    </div>
  );
}
